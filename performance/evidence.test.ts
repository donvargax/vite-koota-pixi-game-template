import { describe, expect, it } from "vite-plus/test";
import { parseEvidence, summarizeCpuProfile, summarizeTrace } from "./evidence.ts";

describe("evidence parsing", () => {
	it("maps generated line and column through the supplied source map", () => {
		const result = parseEvidence({
			cpuProfile: {
				nodes: [
					{
						id: 1,
						callFrame: {
							functionName: "knownWork",
							url: "assets/app.js",
							lineNumber: 0,
							columnNumber: 0,
						},
					},
				],
				samples: [1],
				timeDeltas: [2_000],
			},
			sourceMaps: [
				{
					generatedFile: "assets/app.js",
					map: { version: 3, sources: ["fixture.ts"], names: [], mappings: "AAAA" },
				},
			],
		});
		expect(result.mappedCpuSummary[0]).toMatchObject({
			functionName: "knownWork",
			sourceFile: "assets/fixture.ts",
			line: 1,
			column: 0,
			totalMs: 2,
		});
	});

	it("keeps recursive self and total costs from double-counting a frame", () => {
		const summary = summarizeCpuProfile({
			nodes: [
				{ id: 1, callFrame: { functionName: "root" }, children: [2] },
				{ id: 2, callFrame: { functionName: "recursive" }, children: [3] },
				{ id: 3, callFrame: { functionName: "recursive" } },
			],
			samples: [3],
			timeDeltas: [3_000],
		});
		const recursive = summary.find(({ functionName }) => functionName === "recursive");
		expect(recursive).toMatchObject({ selfMs: 3, totalMs: 3 });
		expect(summary.find(({ functionName }) => functionName === "root")?.totalMs).toBe(3);
	});

	it("uses bounded sample-count weights when time deltas are absent", () => {
		const errors: string[] = [];
		const summary = summarizeCpuProfile(
			{
				nodes: [{ id: 1, callFrame: { functionName: "sampled" } }],
				samples: [1, 1],
			},
			[],
			errors,
		);
		expect(summary[0]?.totalMs).toBe(2);
		expect(errors).toContain("CPU profile has no timeDeltas; sample-count weights are used");
	});

	it("keeps unmapped frames visible and reports malformed profiles", () => {
		const result = parseEvidence({
			cpuProfile: {
				nodes: [
					{
						id: 1,
						callFrame: {
							functionName: "unmapped",
							url: "bundle.js",
							lineNumber: 4,
							columnNumber: 2,
						},
					},
				],
				samples: [1],
			},
			trace: { traceEvents: [] },
		});
		expect(result.mappedCpuSummary[0]).toMatchObject({
			sourceFile: "bundle.js",
			line: 5,
			column: 2,
		});
		expect(result.errors).toContain("CPU profile has no timeDeltas; sample-count weights are used");
		expect(result.missingCapabilities).toContain("chromium-trace");
	});

	it("summarizes recognized GC/render events with overlap-aware duration", () => {
		const summary = summarizeTrace({
			traceEvents: [
				{ name: "Paint", cat: "devtools.timeline", ph: "X", ts: 0, dur: 10_000, pid: 1, tid: 2 },
				{
					name: "DrawFrame",
					cat: "devtools.timeline",
					ph: "X",
					ts: 5_000,
					dur: 10_000,
					pid: 1,
					tid: 2,
				},
				{ name: "V8.GCScavenger", cat: "v8", ph: "X", ts: 30_000, dur: 2_000, pid: 1, tid: 2 },
				{ name: "UnknownTask", cat: "other", ph: "X", ts: 0, dur: 100_000, pid: 1, tid: 2 },
			],
		});
		expect(summary.recognizedEventCount).toBe(3);
		expect(summary.unknownEventCount).toBe(1);
		expect(summary.overlapAwareDurationMs).toBe(17);
		expect(summary.observedEvents.find(({ name }) => name === "Paint")?.durationMs).toBe(10);
	});

	it("marks excessive profiles and traces as truncated without hiding bounded data", () => {
		const result = parseEvidence({
			cpuProfile: {
				nodes: [{ id: 1, callFrame: { functionName: "bounded" } }],
				samples: [1, 1, 1],
				timeDeltas: [1, 1, 1],
			},
			trace: {
				traceEvents: [
					{ name: "Paint", cat: "devtools.timeline", ph: "X", ts: 0, dur: 1 },
					{ name: "Paint", cat: "devtools.timeline", ph: "X", ts: 1, dur: 1 },
				],
			},
			maximumSamples: 1,
			maximumEvents: 1,
		});
		expect(result.truncation).toContain("limit exceeded");
		expect(result.sampleCount).toBe(1);
		expect(result.eventCount).toBe(1);
	});
});
