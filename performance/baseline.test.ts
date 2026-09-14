import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentRecord } from "./contracts.ts";
import {
	acceptBaseline,
	readBaseline,
	validateBaseline,
	type BaselineCandidate,
} from "./baseline.ts";

const environment: EnvironmentRecord = {
	schema: "environment",
	schemaVersion: 1,
	nodeVersion: "24.0.0",
	playwrightVersion: "1.0.0",
	chromiumVersion: "1.0.0",
	os: "test",
	architecture: "x64",
	cpuIdentity: "test-cpu",
	runnerClass: null,
	localMachineKey: "machine-a",
	renderer: "webgl",
	backend: "webgl",
	gpuIdentity: null,
	headless: true,
	viewportWidth: 1280,
	viewportHeight: 720,
	devicePixelRatio: 1,
	throttling: "none",
	audioPolicy: "disabled",
	pageVisible: true,
	measuredIdleCadenceMs: null,
};

describe("performance baselines", () => {
	it("reports missing and malformed files without replacing them", async () => {
		const directory = await temporaryDirectory();
		const path = join(directory, "baseline.json");
		expect((await readBaseline(path)).status).toBe("missing");
		await writeFile(path, "{not-json", "utf8");
		const result = await readBaseline(path);
		expect(result.status).toBe("invalid");
		expect(result.baseline).toBeNull();
		expect(result.issues.length).toBeGreaterThan(0);
	});

	it("accepts a complete clean local candidate atomically", async () => {
		const directory = await temporaryDirectory();
		const path = join(directory, "local", "baseline.json");
		const accepted = await acceptBaseline({
			candidate: candidate(),
			destinationPath: path,
			accept: true,
			provenance: "test-run",
		});
		expect(accepted.scope).toBe("local");
		expect(accepted.provenance).toBe("test-run");
		expect((await readBaseline(path)).status).toBe("valid");
		expect(JSON.parse(await readFile(path, "utf8")).scope).toBe("local");
	});

	it("rejects non-clean and incomplete candidates", async () => {
		const directory = await temporaryDirectory();
		const path = join(directory, "baseline.json");
		await expect(
			acceptBaseline({
				candidate: { ...candidate(), measurementMode: "allocation" },
				destinationPath: path,
				accept: true,
			}),
		).rejects.toThrow(/clean/);
		const source = candidate();
		const incomplete: BaselineCandidate = {
			...source,
			comparison: {
				...source.comparison,
				medianRepetitionAggregates: { idle: { frameCpuWorkP95Ms: 1 } },
			},
		};
		await expect(
			acceptBaseline({ candidate: incomplete, destinationPath: path, accept: true }),
		).rejects.toThrow(/required/);
	});

	it("pins local baselines to one environment", async () => {
		const baseline = validateBaseline({
			...candidateToBaselineShape(),
			scope: "local",
		});
		expect(() => validateBaseline(baseline, { environmentCompatibilityKey: "machine-b" })).toThrow(
			/environmentCompatibilityKey/,
		);
	});

	it("requires explicit overwrite authorization and never accepts CI automatically", async () => {
		const directory = await temporaryDirectory();
		const path = join(directory, "baseline.json");
		await acceptBaseline({ candidate: candidate(), destinationPath: path, accept: true });
		await expect(
			acceptBaseline({ candidate: candidate(), destinationPath: path, accept: true }),
		).rejects.toThrow(/overwrite authorization/);
		await expect(
			acceptBaseline({
				candidate: candidate(),
				destinationPath: join(directory, "ci.json"),
				accept: true,
				scope: "ci",
			}),
		).rejects.toThrow(/never automatic/);
		await expect(
			acceptBaseline({
				candidate: candidate(),
				destinationPath: path,
				accept: true,
				overwrite: true,
			}),
		).resolves.toMatchObject({ scope: "local" });
	});
});

async function temporaryDirectory(): Promise<string> {
	return mkdtemp(join(tmpdir(), "terrariavania-baseline-"));
}

function candidate(): BaselineCandidate {
	return {
		schema: "baseline-candidate",
		schemaVersion: 1,
		policyVersion: "phase-5-test",
		workloadVersion: "phase-3-workloads-1",
		workloadFingerprint: "workload",
		measurementMode: "clean",
		environmentCompatibilityKey: "machine-a",
		environment,
		comparison: {
			schema: "comparison",
			schemaVersion: 1,
			mode: "clean",
			expectedScenarioIds: ["idle"],
			expectedRepetitions: { idle: 1 },
			receivedCoverage: { idle: [0] },
			perRepetition: [summary()],
			medianRepetitionAggregates: aggregates(),
			baselineProvenance: null,
			policyProvenance: "test-policy",
			workloadFingerprint: "workload",
			metricStatuses: metrics(),
			status: "passed",
			originalVerdict: "passed",
			reasons: [],
		},
		provenance: "candidate-run",
	};
}

function candidateToBaselineShape() {
	const value = candidate();
	return {
		schema: "performance-baseline" as const,
		schemaVersion: 1 as const,
		scope: "local" as const,
		policyVersion: value.policyVersion,
		workloadVersion: value.workloadVersion,
		workloadFingerprint: value.workloadFingerprint,
		measurementMode: "clean" as const,
		environmentCompatibilityKey: value.environmentCompatibilityKey,
		environment: value.environment,
		aggregates: value.comparison.medianRepetitionAggregates,
		provenance: value.provenance,
	};
}

function aggregates() {
	return {
		idle: {
			frameCpuWorkP95Ms: 1,
			rawRafP95Ms: 16,
			simulationWallRatio: 0.8,
			heapUsedDeltaBytes: null,
			longTaskRate: null,
		},
	};
}

function metrics() {
	return ["frameCpuWorkP95Ms", "rawRafP95Ms", "simulationWallRatio"].map((metric) => ({
		metric,
		status: "passed" as const,
		direction:
			metric === "simulationWallRatio"
				? ("higher-is-better" as const)
				: ("lower-is-better" as const),
		expected: 1,
		received: 1,
		delta: 0,
		relativeDelta: 0,
		reason: null,
	}));
}

function summary() {
	return {
		scenarioId: "idle",
		repetition: 0,
		metrics: metrics(),
		window: {
			schema: "window" as const,
			schemaVersion: 1 as const,
			scenarioId: "idle",
			repetition: 0,
			mode: "clean" as const,
			monotonicStartMs: 0,
			monotonicEndMs: 1000,
			actualElapsedMs: 1000,
			requestedDurationMs: 1000,
			inputTiming: [],
			rawRafSamples: { values: [16], metadata: sampleMetadata() },
			frameCpuWorkSamples: { values: [1], metadata: sampleMetadata() },
			phaseAggregates: [],
			longTasks: {
				capability: { supported: false, reason: "test" },
				count: null,
				durationMs: null,
			},
			cdp: {
				taskDurationMs: null,
				heapUsedBytes: null,
				taskDurationDeltaMs: null,
				heapUsedDeltaBytes: null,
			},
			capabilityStatuses: {},
			completion: "completed" as const,
			failures: [],
		},
		workload: {
			schema: "workload" as const,
			schemaVersion: 1 as const,
			scenarioId: "idle",
			repetition: 0,
			beforeSimulationFoes: 0,
			afterSimulationFoes: 0,
			afterMaintenanceFoes: 0,
			beforeSimulationBolts: 0,
			afterSimulationBolts: 0,
			afterMaintenanceBolts: 0,
			projectedOnScreenBolts: 0,
			spawnCount: 0,
			recycleCount: 0,
			removalCount: 0,
			hitCount: 0,
			foeDownCount: 0,
			simulationSeconds: 0.8,
			rawWallSeconds: 1,
			minimumLoad: 0,
			maximumLoad: 0,
			progressValid: true,
			validityStatus: "valid" as const,
			failures: [],
		},
	};
}

function sampleMetadata() {
	return {
		sampleCount: 1,
		maximumSamples: 100,
		truncated: false,
		droppedSamples: 0,
		firstTimestampMs: 0,
		lastTimestampMs: 0,
	};
}
