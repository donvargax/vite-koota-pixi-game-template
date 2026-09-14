import { describe, expect, it } from "vite-plus/test";
import {
	createAllocationCollector,
	createCpuTraceCollector,
	createEvidenceBudget,
	type ArtifactKind,
	type DiagnosticArtifactSink,
	type DiagnosticCdpSession,
} from "./diagnostics.ts";

class FakeCdp implements DiagnosticCdpSession {
	readonly calls: string[] = [];
	readonly listeners = new Map<string, Set<(params: unknown) => void>>();
	categories = ["devtools.timeline", "blink.user_timing", "v8", "toplevel"];
	traceChunks = ['{"traceEvents":[', '{"name":"RunTask"}', "]}"];
	traceComplete = true;
	fail = new Set<string>();
	closeCalls = 0;

	on(event: string, listener: (params: unknown) => void): void {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(listener);
		this.listeners.set(event, listeners);
	}

	off(event: string, listener: (params: unknown) => void): void {
		this.listeners.get(event)?.delete(listener);
	}

	emit(event: string, params: unknown): void {
		for (const listener of this.listeners.get(event) ?? []) listener(params);
	}

	// fallow-ignore-next-line complexity -- the fake transport intentionally enumerates CDP failure and event paths.
	async send(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown> {
		this.calls.push(method);
		if (this.fail.has(method)) throw new Error(`${method} failed`);
		switch (method) {
			case "Tracing.getCategories":
				return { categories: this.categories };
			case "Profiler.stop":
				return {
					profile: { nodes: [{ id: 1, callFrame: { functionName: "known" } }], samples: [1] },
				};
			case "HeapProfiler.stopSampling":
				return { profile: { head: { callFrame: { functionName: "known" } } } };
			case "Tracing.end":
				if (this.traceComplete)
					queueMicrotask(() => this.emit("Tracing.tracingComplete", { stream: "trace" }));
				return {};
			case "IO.read": {
				const chunk = this.traceChunks.shift() ?? "";
				return { data: chunk, eof: this.traceChunks.length === 0 };
			}
			case "IO.close":
				this.closeCalls++;
				return {};
			default:
				return params;
		}
	}
}

function sinkFactory(contents: string[], closed: { value: number }) {
	return async (_kind: ArtifactKind, _path: string): Promise<DiagnosticArtifactSink> => ({
		write: async (chunk) => {
			contents.push(new TextDecoder().decode(chunk));
		},
		close: async () => {
			closed.value++;
		},
	});
}

describe("diagnostic collectors", () => {
	it("labels unavailable trace categories without inventing support", async () => {
		const cdp = new FakeCdp();
		cdp.categories = ["devtools.timeline"];
		const contents: string[] = [];
		const collector = createCpuTraceCollector({
			session: cdp,
			tracePath: "trace.json",
			createSink: sinkFactory(contents, { value: 0 }),
		});
		await collector.start();
		const result = await collector.stop();
		expect(result.status).toBe("complete");
		expect(result.missingCapabilities).toContain("trace category unavailable: v8");
		expect(result.selectedCategories).toEqual(["devtools.timeline"]);
	});

	it("cleans up a CPU start failure", async () => {
		const cdp = new FakeCdp();
		cdp.fail.add("Profiler.start");
		const collector = createCpuTraceCollector({ session: cdp, cpuProfilePath: "profile.json" });
		await expect(collector.start()).rejects.toThrow("Profiler.start failed");
		expect(cdp.calls).toContain("Profiler.disable");
	});

	it("returns failed evidence when profile execution or stop fails", async () => {
		const cdp = new FakeCdp();
		cdp.fail.add("Profiler.stop");
		const collector = createCpuTraceCollector({
			session: cdp,
			cpuProfilePath: "profile.json",
			createSink: sinkFactory([], { value: 0 }),
		});
		await collector.start();
		const result = await collector.stop();
		expect(result.status).toBe("failed");
		expect(result.artifacts[0]?.validJson).toBe(false);
		expect(cdp.calls).toContain("Profiler.disable");
	});

	it("streams and closes a complete trace artifact", async () => {
		const cdp = new FakeCdp();
		const contents: string[] = [];
		const closed = { value: 0 };
		const collector = createCpuTraceCollector({
			session: cdp,
			tracePath: "trace.json",
			createSink: sinkFactory(contents, closed),
		});
		await collector.start();
		const result = await collector.stop();
		expect(result.status).toBe("complete");
		expect(result.artifacts[0]).toMatchObject({ status: "complete", validJson: true });
		expect(contents.join("")).toContain('"traceEvents"');
		expect(closed.value).toBe(1);
		expect(cdp.closeCalls).toBe(1);
	});

	it("reports tracingComplete timeout and still closes the stream when available", async () => {
		const cdp = new FakeCdp();
		cdp.traceComplete = false;
		const collector = createCpuTraceCollector({
			session: cdp,
			tracePath: "trace.json",
			drainTimeoutMs: 1,
			createSink: sinkFactory([], { value: 0 }),
		});
		await collector.start();
		const result = await collector.stop();
		expect(result.status).toBe("failed");
		expect(result.errors.some((error) => error.includes("timed out"))).toBe(true);
	});

	it("marks a trace truncated at the per-replay or total cap", async () => {
		const cdp = new FakeCdp();
		const collector = createCpuTraceCollector({
			session: cdp,
			tracePath: "trace.json",
			maxTraceBytes: 3,
			createSink: sinkFactory([], { value: 0 }),
		});
		await collector.start();
		const result = await collector.stop();
		expect(result.status).toBe("truncated");
		expect(result.artifacts[0]?.validJson).toBe(false);

		const budget = createEvidenceBudget(1);
		const profileCollector = createCpuTraceCollector({
			session: new FakeCdp(),
			cpuProfilePath: "profile.json",
			evidenceBudget: budget,
			createSink: sinkFactory([], { value: 0 }),
		});
		await profileCollector.start();
		const capped = await profileCollector.stop();
		expect(capped.status).toBe("truncated");
	});

	it("reports detachment and does not change a clean verdict", async () => {
		const cdp = new FakeCdp();
		const collector = createCpuTraceCollector({
			session: cdp,
			cpuProfilePath: "profile.json",
			createSink: sinkFactory([], { value: 0 }),
		});
		await collector.start();
		cdp.emit("Target.detachedFromTarget", {});
		const result = await collector.stop();
		expect(result.status).toBe("failed");
		expect(result.errors).toContain("CDP session detached during diagnostic collection");
	});

	it("stops allocation sampling and closes its artifact", async () => {
		const cdp = new FakeCdp();
		const closed = { value: 0 };
		const collector = createAllocationCollector({
			session: cdp,
			allocationPath: "allocation.json",
			createSink: sinkFactory([], closed),
		});
		await collector.start();
		const result = await collector.stop();
		expect(result.mode).toBe("allocation");
		expect(result.status).toBe("complete");
		expect(cdp.calls).toContain("HeapProfiler.stopSampling");
		expect(closed.value).toBe(1);
	});

	it("prevents simultaneous allocation and CPU/trace sessions", async () => {
		const cdp = new FakeCdp();
		const contents: string[] = [];
		const cpu = createCpuTraceCollector({
			session: cdp,
			cpuProfilePath: "profile.json",
			createSink: sinkFactory(contents, { value: 0 }),
		});
		const allocation = createAllocationCollector({
			session: cdp,
			allocationPath: "allocation.json",
			createSink: sinkFactory(contents, { value: 0 }),
		});
		await cpu.start();
		await expect(allocation.start()).rejects.toThrow("another diagnostic collector");
		await cpu.stop();
	});
});
