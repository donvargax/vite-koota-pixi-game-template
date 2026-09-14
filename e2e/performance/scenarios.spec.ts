import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import manifestJson from "../../performance/scenarios.json" with { type: "json" };
import { selectScenarios, validateScenarioManifest } from "../../performance/scenarios.ts";
import type { ScenarioDefinition } from "../../performance/contracts.ts";
import type {
	BoundedSampleMetadata,
	FailureVariant,
	NumericSamples,
	WindowRecord,
} from "../../performance/contracts.ts";
import { expect, test } from "./fixtures.ts";

const manifest = validateScenarioManifest(manifestJson);
const fastScenarios = selectScenarios(manifest, "fast");
const outputRoot = process.env.PERF_OUTPUT_DIR ?? join("performance-results", "phase4-fast");

for (const scenario of fastScenarios) {
	test.describe(`${scenario.id} clean measurements`, () => {
		for (let repetition = 0; repetition < scenario.repetitions; repetition++) {
			test.describe(`repetition ${repetition}`, () => {
				test.use({
					scenarioId: scenario.id,
					repetition,
					requestedDurationMs: scenario.sampleMs,
				});
				test(`collects raw repetition ${repetition}`, async ({ performance }, testInfo) => {
					let record = failedWindowRecord(scenario, repetition, "measurement did not complete");
					let summary: unknown = null;
					let thrown: unknown;
					try {
						await performance.startAndReady();
						await performance.page.waitForTimeout(scenario.warmupMs);
						await performance.beginSample();
						performance.scheduleInput(scenario.input, scenario.sampleMs);
						await performance.page.waitForTimeout(scenario.sampleMs);
						record = await performance.endSample();
						summary = await performance.readVisibleSummary();
						expect(record.completion).toBe("completed");
						expect(record.failures).toEqual([]);
						expect(record.rawRafSamples.values.length).toBeGreaterThan(0);
						expect(summary).toMatchObject({ status: "Sample complete", scenarioId: scenario.id });
					} catch (error) {
						thrown = error;
						throw error;
					} finally {
						await writeRawRecord(scenario, repetition, {
							schema: "phase4-raw-measurement",
							schemaVersion: 1,
							mode: "clean",
							scenarioId: scenario.id,
							repetition,
							environment: performance.environment,
							window: record,
							visibleSummary: summary,
							error: thrown instanceof Error ? thrown.message : null,
							testTitle: testInfo.title,
						});
					}
				});
			});
		}
	});
}

async function writeRawRecord(
	scenario: ScenarioDefinition,
	repetition: number,
	value: unknown,
): Promise<void> {
	const directory = join(outputRoot, "measurements");
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, `${scenario.id}-${repetition}.json`),
		`${JSON.stringify(value, null, 2)}\n`,
	);
}

function failedWindowRecord(
	scenario: ScenarioDefinition,
	repetition: number,
	message: string,
): WindowRecord {
	const samples = emptySamples();
	const failure: FailureVariant = {
		kind: "infrastructure-error",
		phase: "scenario",
		message,
		retryable: false,
	};
	return {
		schema: "window",
		schemaVersion: 1,
		scenarioId: scenario.id,
		repetition,
		mode: "clean",
		monotonicStartMs: 0,
		monotonicEndMs: 0,
		actualElapsedMs: 0,
		requestedDurationMs: scenario.sampleMs,
		inputTiming: [],
		rawRafSamples: samples,
		frameCpuWorkSamples: samples,
		phaseAggregates: [],
		longTasks: {
			capability: { supported: false, reason: "measurement did not complete" },
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
		completion: "failed",
		failures: [failure],
	};
}

function emptySamples(): NumericSamples {
	const metadata: BoundedSampleMetadata = {
		sampleCount: 0,
		maximumSamples: 10_000,
		truncated: false,
		droppedSamples: 0,
		firstTimestampMs: null,
		lastTimestampMs: null,
	};
	return { values: [], metadata };
}
