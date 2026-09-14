import { describe, expect, it } from "vite-plus/test";
import {
	createTimingCollector,
	withWatchdog,
	type CdpSession,
	type TimingEntry,
	type TimingPage,
	type TimingSnapshot,
} from "./collect.ts";

class FakePage implements TimingPage {
	readonly cleared: unknown[] = [];

	constructor(
		private readonly snapshot: TimingSnapshot,
		private readonly startTime = 100,
	) {}

	evaluate<T, A>(_pageFunction: (argument: A) => T, argument: A): Promise<T> {
		if (typeof argument === "number") return Promise.resolve(this.snapshot as T);
		this.cleared.push(argument);
		return Promise.resolve(this.startTime as T);
	}
}

class FakeCdp implements CdpSession {
	private metricRead = 0;

	constructor(private readonly metrics: readonly { task: number; heap: number }[]) {}

	send(method: string): Promise<unknown> {
		if (method === "Performance.enable") return Promise.resolve(undefined);
		const values = this.metrics[Math.min(this.metricRead++, this.metrics.length - 1)];
		return Promise.resolve({
			metrics: [
				{ name: "TaskDuration", value: values.task },
				{ name: "JSHeapUsedSize", value: values.heap },
			],
		});
	}
}

function frame(atMs: number, callbackWorkMs = 2): TimingEntry {
	return {
		name: "benchmark-frame",
		entryType: "mark",
		startTime: atMs,
		duration: 0,
		detail: {
			rawElapsedMs: 16,
			callbackWorkMs,
			phases: { simulation: 1, projection: 0.5 },
		},
	};
}

function snapshot(entries: readonly TimingEntry[], droppedEntries = 0): TimingSnapshot {
	return { entries, droppedEntries, supportedEntryTypes: ["longtask"] };
}

describe("performance timing collection", () => {
	it("synchronizes sample markers, bounds buffers, and reads CDP only at boundaries", async () => {
		const page = new FakePage(
			snapshot([
				{
					name: "benchmark-sample-start",
					entryType: "mark",
					startTime: 10,
					duration: 0,
					detail: null,
				},
				frame(20),
				frame(36, 3),
				{
					name: "benchmark-sample-end",
					entryType: "mark",
					startTime: 50,
					duration: 0,
					detail: null,
				},
			]),
		);
		const cdp = new FakeCdp([
			{ task: 1, heap: 100 },
			{ task: 3, heap: 140 },
		]);
		const collector = createTimingCollector({
			page,
			cdp,
			scenarioId: "idle",
			repetition: 1,
			requestedDurationMs: 40,
			maximumSamples: 2,
		});

		await collector.start();
		const record = await collector.finish();

		expect(record.monotonicStartMs).toBe(10);
		expect(record.monotonicEndMs).toBe(50);
		expect(record.actualElapsedMs).toBe(40);
		expect(record.rawRafSamples.values).toEqual([16, 16]);
		expect(record.frameCpuWorkSamples.values).toEqual([2, 3]);
		expect(record.cdp.taskDurationDeltaMs).toBe(2000);
		expect(record.cdp.heapUsedDeltaBytes).toBe(40);
		expect(page.cleared).toHaveLength(2);
	});

	it("marks dropped entries and malformed or empty runtime data invalid", async () => {
		const page = new FakePage(
			snapshot(
				[
					{
						name: "benchmark-sample-start",
						entryType: "mark",
						startTime: 10,
						duration: 0,
						detail: null,
					},
					{
						name: "benchmark-sample-end",
						entryType: "mark",
						startTime: 20,
						duration: 0,
						detail: null,
					},
					frame(15),
					{ name: "benchmark-frame", entryType: "mark", startTime: 16, duration: 0, detail: "bad" },
				],
				1,
			),
		);
		const collector = createTimingCollector({
			page,
			cdp: new FakeCdp([{ task: 0, heap: 0 }]),
			scenarioId: "idle",
			repetition: 0,
			requestedDurationMs: 10,
		});
		await collector.start();
		const record = await collector.finish();
		expect(record.failures.map(({ message }) => message)).toEqual(
			expect.arrayContaining([
				"runtime frame entries were malformed",
				"timing entries exceeded the bounded collector buffer",
			]),
		);

		const empty = createTimingCollector({
			page: new FakePage(snapshot([])),
			cdp: new FakeCdp([{ task: 0, heap: 0 }]),
			scenarioId: "idle",
			repetition: 0,
			requestedDurationMs: 10,
		});
		await empty.start();
		expect((await empty.cancel()).failures).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ message: "no runtime frame samples were collected" }),
			]),
		);
	});

	it("distinguishes unsupported long tasks from zero observations", async () => {
		const page = new FakePage(
			snapshot([
				{
					name: "benchmark-sample-start",
					entryType: "mark",
					startTime: 10,
					duration: 0,
					detail: null,
				},
				frame(15),
				{
					name: "benchmark-sample-end",
					entryType: "mark",
					startTime: 20,
					duration: 0,
					detail: null,
				},
			]),
		);
		const collector = createTimingCollector({
			page,
			cdp: new FakeCdp([{ task: 0, heap: 0 }]),
			scenarioId: "idle",
			repetition: 0,
			requestedDurationMs: 10,
		});
		await collector.start();
		const record = await collector.finish();
		expect(record.longTasks.capability.supported).toBe(true);
		expect(record.longTasks.count).toBe(0);

		const unsupportedPage = new FakePage({
			entries: [
				{
					name: "benchmark-sample-start",
					entryType: "mark",
					startTime: 10,
					duration: 0,
					detail: null,
				},
				frame(15),
				{
					name: "benchmark-sample-end",
					entryType: "mark",
					startTime: 20,
					duration: 0,
					detail: null,
				},
			],
			droppedEntries: 0,
			supportedEntryTypes: [],
		});
		const unsupported = createTimingCollector({
			page: unsupportedPage,
			cdp: new FakeCdp([{ task: 0, heap: 0 }]),
			scenarioId: "idle",
			repetition: 0,
			requestedDurationMs: 10,
		});
		await unsupported.start();
		const unsupportedRecord = await unsupported.finish();
		expect(unsupportedRecord.longTasks.capability.supported).toBe(false);
		expect(unsupportedRecord.longTasks.count).toBeNull();
	});

	it("cancels and bounds stalled page operations with a watchdog", async () => {
		await expect(
			withWatchdog(
				new Promise<void>((resolve) => setTimeout(resolve, 50)),
				5,
				() => new Error("watchdog"),
			),
		).rejects.toThrow("watchdog");
	});
});
