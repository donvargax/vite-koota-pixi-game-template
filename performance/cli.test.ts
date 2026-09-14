import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import manifestJson from "./scenarios.json" with { type: "json" };
import type { EnvironmentRecord, ScenarioDefinition } from "./contracts.ts";
import { runCli, type CliSeams, type CommandResult } from "./cli.ts";
import type { PerformanceProcess } from "./process.ts";
import { validateScenarioManifest, workloadFingerprint } from "./scenarios.ts";

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
	localMachineKey: "test-machine",
	renderer: "software",
	backend: "software",
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

describe("performance CLI", () => {
	it("parses public flags and rejects recursive diagnosis", async () => {
		const help = await runCli(["perf", "--help"]);
		expect(help).toBe(0);
		const invalid = await runCli(["perf:diagnose", "--scenario", "idle", "--unknown", "x"]);
		expect(invalid).toBe(2);
	});

	it("collects without a baseline, preserving an unbaselined report", async () => {
		const fixture = await createFixture();
		const result = await runFixture(fixture, ["perf", "--collect"]);

		expect(result.code).toBe(0);
		expect(result.diagnosticCalls).toHaveLength(0);
		expect(await readFile(join(fixture.output, "results.json"), "utf8")).toContain(
			"unbaselined-collection",
		);
	});

	it("compares a passing run without accepting its baseline", async () => {
		const fixture = await createFixture();
		await writeBaseline(fixture.baseline, 1, fixture.fingerprint);
		const result = await runFixture(fixture, ["perf", "--baseline", fixture.baseline]);

		expect(result.code).toBe(0);
		expect(result.diagnosticCalls).toHaveLength(0);
		expect(await readFile(fixture.baseline, "utf8")).toContain('"scope":"local"');
	});

	it("keeps raw files after measurement failure and automatically replays a regression", async () => {
		const fixture = await createFixture({ frameValue: 5 });
		await writeBaseline(fixture.baseline, 1, fixture.fingerprint);
		const result = await runFixture(fixture, ["perf", "--baseline", fixture.baseline], {
			measurementStatus: "failed",
		});

		expect(result.code).toBe(1);
		expect(result.diagnosticCalls).toHaveLength(1);
		expect(result.rawRecords).toBe(1);
		expect(await readFile(join(fixture.output, "report.html"), "utf8")).toContain(
			"Original clean verdict",
		);
	});

	it("runs CPU and allocation evidence for a passing full command", async () => {
		const fixture = await createFixture();
		await writeBaseline(fixture.baseline, 1, fixture.fullFingerprint);
		const result = await runFixture(fixture, ["perf:full", "--baseline", fixture.baseline]);

		expect(result.code).toBe(0);
		expect(result.diagnosticModes).toEqual(["cpu-trace", "allocation"]);
	});

	it("keeps the original regression exit code when diagnostics fail", async () => {
		const fixture = await createFixture({ frameValue: 5 });
		await writeBaseline(fixture.baseline, 1, fixture.fingerprint);
		const result = await runFixture(fixture, ["perf", "--baseline", fixture.baseline], {
			diagnosticStatus: "failed",
		});

		expect(result.code).toBe(1);
		expect(result.diagnosticCalls).toHaveLength(1);
	});
});

interface Fixture {
	root: string;
	output: string;
	policy: string;
	manifest: string;
	baseline: string;
	frameValue: number;
	fingerprint: string;
	fullFingerprint: string;
}

interface RunResult {
	readonly code: number;
	readonly diagnosticCalls: readonly string[];
	readonly diagnosticModes: readonly string[];
	readonly rawRecords: number;
}

async function createFixture(overrides: { readonly frameValue?: number } = {}): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "terrariavania-cli-"));
	const output = join(root, "run");
	const candidatePerformanceDirectory = join(root, "performance");
	const policy = join(root, "policy.json");
	const manifest = join(root, "manifest.json");
	const baseline = join(root, "baseline.json");
	const scenario = manifestJson as { scenarios: ScenarioDefinition[]; workloadVersion: string };
	const manifestValue = {
		schema: "scenario-manifest",
		schemaVersion: 1,
		workloadVersion: scenario.workloadVersion,
		scenarios: [{ ...scenario.scenarios[0], repetitions: 1 }],
	};
	await mkdir(candidatePerformanceDirectory, { recursive: true });
	await writeFile(
		join(candidatePerformanceDirectory, "scenarios.json"),
		JSON.stringify(manifestValue),
	);
	await writeFile(manifest, JSON.stringify(manifestValue));
	await writeFile(policy, JSON.stringify(testPolicy(scenario.workloadVersion)));
	const validatedManifest = validateScenarioManifest(manifestValue);
	return {
		root,
		output,
		policy,
		manifest,
		baseline,
		frameValue: overrides.frameValue ?? 1,
		fingerprint: workloadFingerprint(validatedManifest, "fast"),
		fullFingerprint: workloadFingerprint(validatedManifest, "full"),
	};
}

async function runFixture(
	fixture: Fixture,
	args: readonly string[],
	options: {
		readonly measurementStatus?: CommandResult["status"];
		readonly diagnosticStatus?: CommandResult["status"];
	} = {},
): Promise<RunResult> {
	const diagnosticCalls: string[] = [];
	const diagnosticModes: string[] = [];
	let rawRecords = 0;
	const processController: PerformanceProcess = {
		build: async () => ({
			status: "passed",
			buildId: "test-build",
			outputDirectory: join(fixture.root, "dist-performance"),
			artifactDirectory: join(fixture.output, "build"),
			manifest: null,
			logs: { stdout: "", stderr: "", truncated: false },
			exitCode: 0,
			error: null,
		}),
		startPreview: async () => ({
			result: {
				status: "passed",
				baseUrl: "http://127.0.0.1:4999",
				port: 4999,
				logs: { stdout: "", stderr: "", truncated: false },
				error: null,
			},
			stop: async () => undefined,
		}),
		stop: async () => undefined,
	};
	const seams: CliSeams = {
		createProcess: () => processController,
		runCommand: async (_command, commandArgs, commandOptions) => {
			if (commandArgs.includes("diagnostics.spec.ts")) {
				diagnosticCalls.push(commandOptions.env.PERF_DIAGNOSTIC_SCENARIO ?? "unknown");
				diagnosticModes.push(commandOptions.env.PERF_DIAGNOSTIC_MODE ?? "unknown");
				return commandResult(options.diagnosticStatus ?? "passed");
			}
			if (commandArgs.includes("scenarios.spec.ts")) {
				await mkdir(join(fixture.output, "measurements"), { recursive: true });
				await writeFile(
					join(fixture.output, "measurements", "idle-0.json"),
					JSON.stringify(rawRecord(fixture.frameValue)),
				);
				rawRecords++;
				return commandResult(options.measurementStatus ?? "passed");
			}
			return commandResult("passed");
		},
	};
	const code = await runCli(
		[
			...args,
			"--policy",
			fixture.policy,
			"--required-scenarios",
			fixture.manifest,
			"--output",
			fixture.output,
		],
		fixture.root,
		seams,
	);
	return { code, diagnosticCalls, diagnosticModes, rawRecords };
}

async function writeBaseline(path: string, frameValue: number, fingerprint: string): Promise<void> {
	await writeFile(
		path,
		JSON.stringify({
			schema: "performance-baseline",
			schemaVersion: 1,
			scope: "local",
			policyVersion: "test-policy",
			workloadVersion: "phase-3-workloads-1",
			workloadFingerprint: fingerprint,
			measurementMode: "clean",
			environmentCompatibilityKey: "machine",
			environment,
			aggregates: {
				idle: {
					frameCpuWorkP95Ms: frameValue,
					rawRafP95Ms: 16,
					simulationWallRatio: 0.8,
					heapUsedDeltaBytes: null,
					longTaskRate: null,
				},
			},
			provenance: "test-baseline",
		}),
	);
}

function rawRecord(frameValue: number): unknown {
	const samples = { values: [frameValue], metadata: sampleMetadata() };
	return {
		schema: "phase4-raw-measurement",
		schemaVersion: 1,
		mode: "clean",
		scenarioId: "idle",
		repetition: 0,
		environment: { record: environment, compatibilityKey: "machine" },
		window: {
			schema: "window",
			schemaVersion: 1,
			scenarioId: "idle",
			repetition: 0,
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
			validityStatus: "valid",
			failures: [],
		},
	};
}

function testPolicy(workloadVersion: string): unknown {
	return {
		schema: "performance-policy",
		schemaVersion: 1,
		policyVersion: "test-policy",
		workloadVersion,
		calibrated: true,
		environmentPolicy: { compatibility: "local-machine", runnerClass: null },
		metrics: [
			["frameCpuWorkP95Ms", "lower-is-better", 2],
			["rawRafP95Ms", "lower-is-better", 100],
			["simulationWallRatio", "higher-is-better", 0.5],
		].map(([metric, direction, absoluteLimit]) => ({
			metric,
			direction,
			required: true,
			calibrated: true,
			absoluteLimit,
			relativeThreshold: 0.1,
			minimumAbsoluteDelta: 0.1,
		})),
		scenarios: [{ scenarioId: "idle", required: true }],
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

function commandResult(status: CommandResult["status"]): CommandResult {
	return {
		status,
		exitCode: status === "passed" ? 0 : 1,
		logs: { stdout: "", stderr: "", truncated: false },
		error: status === "passed" ? null : "test command failed",
	};
}
