import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentRecord } from "./contracts.ts";
import {
	comparePerformance,
	validateBudgetPolicy,
	type BaselineComparison,
	type BudgetPolicy,
	type RawMeasurementRecord,
} from "./compare.ts";

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
	localMachineKey: "machine",
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

const policy = makePolicy();

describe("performance comparison", () => {
	it("rejects unsupported policy shapes and malformed calibration", () => {
		expect(() => validateBudgetPolicy({})).toThrow(/schema/);
		expect(() =>
			validateBudgetPolicy({ ...policy, metrics: [{ ...policy.metrics[0], metric: "unknown" }] }),
		).toThrow(/unsupported/);
		expect(() =>
			validateBudgetPolicy({
				...policy,
				metrics: [{ ...policy.metrics[0], calibrated: false, absoluteLimit: 1 }],
			}),
		).toThrow(/uncalibrated/);
		expect(() =>
			validateBudgetPolicy({
				...policy,
				metrics: [{ ...policy.metrics[0], direction: "higher-is-better" }],
			}),
		).toThrow(/incorrect/);
	});

	it("requires unique scenario entries and complete repetition coverage", () => {
		const duplicatePolicy = {
			...policy,
			scenarios: [...policy.scenarios, { scenarioId: "idle", required: true }],
		};
		expect(() => validateBudgetPolicy(duplicatePolicy)).toThrow(/duplicate scenario/);
		const result = compare({
			expectedScenarioMatrix: [
				{ scenarioId: "idle", repetition: 0 },
				{ scenarioId: "idle", repetition: 1 },
			],
			rawRecords: [record(10, 0)],
		});
		expect(result.status).toBe("infrastructure-failure");
		expect(result.reasons[0]).toMatch(/requires exactly/);
		expect(
			compare({
				expectedScenarioMatrix: [{ scenarioId: "idle", repetition: 0 }],
				rawRecords: [record(10, 0), record(10, 0)],
			}).status,
		).toBe("infrastructure-failure");
	});

	it("requires both relative and minimum absolute degradation thresholds", () => {
		expect(compareWithValue(11).status).toBe("passed");
		expect(compareWithValue(10.5).status).toBe("passed");
		expect(compareWithValue(11.1).status).toBe("regression");
	});

	it("uses an absolute limit for a zero baseline without dividing by zero", () => {
		const zeroPolicy = makePolicy({ frameCpuWorkP95Ms: { absoluteLimit: 0 } });
		const result = compare({
			policy: zeroPolicy,
			baseline: baseline({ frameCpuWorkP95Ms: 0 }),
			rawRecords: [record(1, 0)],
		});
		expect(result.status).toBe("regression");
		expect(result.metricStatuses[0]?.relativeDelta).toBeNull();
	});

	it("applies the inverse direction to simulation/wall-time ratio", () => {
		expect(compareRatio(0.71).status).toBe("passed");
		expect(compareRatio(0.69).status).toBe("capacity-failure");
	});

	it("does not let a dropped sample pass as a performance result", () => {
		const source = record(10, 0);
		const dropped: RawMeasurementRecord = {
			...source,
			window: {
				...source.window,
				rawRafSamples: {
					...source.window.rawRafSamples,
					metadata: { ...source.window.rawRafSamples.metadata, truncated: true },
				},
			},
		};
		expect(compare({ rawRecords: [dropped] }).status).toBe("workload-invalid");
	});

	it("keeps failed workload and capacity statuses distinct", () => {
		const source = record(10, 0);
		const invalid: RawMeasurementRecord = {
			...source,
			workload: { ...source.workload, validityStatus: "invalid" },
		};
		expect(compare({ rawRecords: [invalid] }).status).toBe("workload-invalid");
		expect(compareRatio(0.2).status).toBe("capacity-failure");
	});

	it("reports an explicit unbaselined collection without comparing samples", () => {
		const uncalibrated = makePolicy({ calibrated: false });
		const result = compare({ policy: uncalibrated, baseline: null, mode: "collect" });
		expect(result.status).toBe("unbaselined-collection");
		expect(result.originalVerdict).toBe("unbaselined-collection");
		expect(compare({ policy: uncalibrated, baseline: null, mode: "enforce" }).status).toBe(
			"infrastructure-failure",
		);
	});

	it("rejects incompatible baseline policy and environment provenance", () => {
		expect(
			compare({
				baseline: { ...baseline(), policyVersion: "other" },
			}).status,
		).toBe("infrastructure-failure");
		expect(
			compare({
				baseline: { ...baseline(), environmentCompatibilityKey: "other-machine" },
			}).status,
		).toBe("infrastructure-failure");
	});
});

function compare(overrides: Partial<Parameters<typeof comparePerformance>[0]> = {}) {
	return comparePerformance({
		expectedScenarioMatrix: [{ scenarioId: "idle", repetition: 0 }],
		rawRecords: [record(10, 0)],
		policy,
		workloadFingerprint: "workload",
		policyProvenance: "test-policy",
		baseline: baseline(),
		...overrides,
	});
}

function compareWithValue(value: number) {
	return compare({ rawRecords: [record(value, 0)] });
}

function compareRatio(value: number) {
	return compare({ rawRecords: [record(10, 0, value)] });
}

function record(frameP95: number, repetition: number, ratio = 0.8): RawMeasurementRecord {
	const samples = { values: [frameP95], metadata: sampleMetadata() };
	return {
		schema: "phase4-raw-measurement",
		schemaVersion: 1,
		mode: "clean",
		scenarioId: "idle",
		repetition,
		environment: { record: environment, compatibilityKey: "machine" },
		window: {
			schema: "window",
			schemaVersion: 1,
			scenarioId: "idle",
			repetition,
			mode: "clean",
			monotonicStartMs: 0,
			monotonicEndMs: 1000,
			actualElapsedMs: 1000,
			requestedDurationMs: 1000,
			inputTiming: [],
			rawRafSamples: { values: [16], metadata: sampleMetadata() },
			frameCpuWorkSamples: samples,
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
			completion: "completed",
			failures: [],
		},
		workload: {
			schema: "workload",
			schemaVersion: 1,
			scenarioId: "idle",
			repetition,
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
			simulationSeconds: ratio * 1,
			rawWallSeconds: 1,
			minimumLoad: 0,
			maximumLoad: 0,
			progressValid: true,
			validityStatus: "valid",
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

function baseline(
	overrides: Partial<BaselineComparison["aggregates"][string]> = {},
): BaselineComparison {
	return {
		schema: "performance-baseline",
		schemaVersion: 1,
		policyVersion: "phase-5-test",
		workloadVersion: "phase-3-workloads-1",
		workloadFingerprint: "workload",
		measurementMode: "clean",
		environmentCompatibilityKey: "machine",
		aggregates: {
			idle: {
				frameCpuWorkP95Ms: 10,
				rawRafP95Ms: 16,
				simulationWallRatio: 0.8,
				heapUsedDeltaBytes: null,
				longTaskRate: null,
				...overrides,
			},
		},
		provenance: "baseline.json",
	};
}

// fallow-ignore-next-line complexity -- the fixture enumerates calibrated and uncalibrated policy variants.
function makePolicy(
	overrides: {
		calibrated?: boolean;
		frameCpuWorkP95Ms?: Partial<BudgetPolicy["metrics"][number]>;
	} = {},
): BudgetPolicy {
	const calibrated = overrides.calibrated ?? true;
	return {
		schema: "performance-policy",
		schemaVersion: 1,
		policyVersion: "phase-5-test",
		workloadVersion: "phase-3-workloads-1",
		calibrated,
		environmentPolicy: { compatibility: "local-machine", runnerClass: null },
		metrics: [
			{
				metric: "frameCpuWorkP95Ms",
				direction: "lower-is-better",
				required: true,
				calibrated,
				absoluteLimit: calibrated ? 100 : null,
				relativeThreshold: calibrated ? 0.1 : null,
				minimumAbsoluteDelta: calibrated ? 1 : null,
				...overrides.frameCpuWorkP95Ms,
			},
			{
				metric: "rawRafP95Ms",
				direction: "lower-is-better",
				required: true,
				calibrated,
				absoluteLimit: calibrated ? 100 : null,
				relativeThreshold: calibrated ? 0.1 : null,
				minimumAbsoluteDelta: calibrated ? 1 : null,
			},
			{
				metric: "simulationWallRatio",
				direction: "higher-is-better",
				required: true,
				calibrated,
				absoluteLimit: calibrated ? 0.5 : null,
				relativeThreshold: calibrated ? 0.1 : null,
				minimumAbsoluteDelta: calibrated ? 0.1 : null,
			},
		],
		scenarios: [{ scenarioId: "idle", required: true }],
	};
}
