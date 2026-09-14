import { spawn as nodeSpawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile, copyFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { acceptBaseline, readBaseline, type BaselineCandidate } from "./baseline.ts";
import {
	comparePerformance,
	validateBudgetPolicy,
	type RawMeasurementRecord,
	type BudgetPolicy,
} from "./compare.ts";
import type {
	ComparisonRecord,
	EnvironmentRecord,
	FailureVariant,
	WorkloadRecord,
} from "./contracts.ts";
import { readEvidenceFiles } from "./evidence.ts";
import {
	createPerformanceProcess,
	type OwnedPreviewServer,
	type ProcessLogs,
	type PerformanceProcess,
} from "./process.ts";
import { writePerformanceReport, type ReportEvidence } from "./report.ts";
import {
	expandScenarioMatrix,
	validateScenarioManifest,
	workloadFingerprint,
	type ScenarioManifest,
	type ScenarioSelection,
} from "./scenarios.ts";

const DEFAULT_POLICY = "performance/budgets.json";
const DEFAULT_MANIFEST = "performance/scenarios.json";
const DEFAULT_BASELINE = "performance-baselines.local/baseline.json";
const DEFAULT_OUTPUT_ROOT = "performance-results";
const DEFAULT_COMMAND_TIMEOUT_MS = 15 * 60_000;
const MAX_DIAGNOSTIC_REPLAYS = 8;

export interface CliOptions {
	readonly command: "perf" | "perf:diagnose" | "perf:full" | "perf:baseline";
	readonly collect: boolean;
	readonly policyPath: string;
	readonly baselinePath: string;
	readonly requiredScenariosPath: string;
	readonly outputDirectory: string;
	readonly baselineDirectory: string;
	readonly scenarioIds: readonly string[];
	readonly diagnosticScenario: string | null;
	readonly baselineRunDirectory: string | null;
	readonly accept: boolean;
	readonly help: boolean;
}

export interface CommandResult {
	readonly status: "passed" | "failed" | "timeout";
	readonly exitCode: number | null;
	readonly logs: ProcessLogs;
	readonly error: string | null;
}

export interface CliSeams {
	readonly runCommand?: (
		command: string,
		args: readonly string[],
		options: CommandOptions,
	) => Promise<CommandResult>;
	readonly createProcess?: (
		options: Parameters<typeof createPerformanceProcess>[0],
	) => PerformanceProcess;
	readonly now?: () => number;
}

export interface CommandOptions {
	readonly cwd: string;
	readonly env: NodeJS.ProcessEnv;
	readonly timeoutMs: number;
}

export class CliUsageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CliUsageError";
	}
}

// fallow-ignore-next-line complexity -- the documented CLI grammar is validated at one fail-closed boundary.
export function parseCliArguments(argv: readonly string[]): CliOptions {
	const command = argv[0] ?? "perf";
	if (!isCommand(command)) throw new CliUsageError(`unknown performance command: ${command}`);
	const values = new Map<string, string>();
	const scenarioIds: string[] = [];
	let collect = false;
	let accept = false;
	let help = false;
	for (let index = 1; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--help" || argument === "-h") {
			help = true;
			continue;
		}
		if (argument === "--collect") {
			collect = true;
			continue;
		}
		if (argument === "--accept") {
			accept = true;
			continue;
		}
		if (!argument.startsWith("--")) throw new CliUsageError(`unexpected argument: ${argument}`);
		const name = argument.slice(2);
		const value = argv[++index];
		if (!value || value.startsWith("--")) throw new CliUsageError(`missing value for --${name}`);
		if (
			![
				"policy",
				"baseline",
				"required-scenarios",
				"output",
				"baseline-dir",
				"scenario",
				"from",
			].includes(name)
		)
			throw new CliUsageError(`unknown option: --${name}`);
		if (name === "scenario") scenarioIds.push(...value.split(",").filter(Boolean));
		else values.set(name, value);
	}
	if (!help && command === "perf:baseline" && !values.has("from"))
		throw new CliUsageError("perf:baseline requires --from <run-dir>");
	if (!help && command === "perf:diagnose" && scenarioIds.length !== 1)
		throw new CliUsageError("perf:diagnose requires exactly one --scenario <id>");
	return {
		command,
		collect,
		policyPath: values.get("policy") ?? DEFAULT_POLICY,
		baselinePath:
			values.get("baseline") ??
			join(values.get("baseline-dir") ?? DEFAULT_BASELINE.replace(/\/[^/]+$/, ""), "baseline.json"),
		requiredScenariosPath: values.get("required-scenarios") ?? DEFAULT_MANIFEST,
		outputDirectory: values.get("output") ?? defaultOutputDirectory(),
		baselineDirectory: values.get("baseline-dir") ?? "performance-baselines.local",
		scenarioIds,
		diagnosticScenario: scenarioIds[0] ?? null,
		baselineRunDirectory: values.get("from") ?? null,
		accept,
		help,
	};
}

export async function runCli(
	argv: readonly string[],
	rootDirectory = process.cwd(),
	seams: CliSeams = {},
): Promise<number> {
	let options: CliOptions;
	try {
		options = parseCliArguments(argv);
	} catch (error) {
		printError(errorMessage(error));
		return 2;
	}
	if (options.help) {
		printHelp();
		return 0;
	}
	try {
		if (options.command === "perf:baseline") return await acceptRunBaseline(options, rootDirectory);
		return await executePerformanceCommand(options, rootDirectory, seams);
	} catch (error) {
		printError(errorMessage(error));
		return 2;
	}
}

// fallow-ignore-next-line complexity -- this is the single lifecycle boundary for build, clean measurement, evidence, report, and cleanup.
async function executePerformanceCommand(
	options: CliOptions,
	rootDirectory: string,
	seams: CliSeams,
): Promise<number> {
	const inputs = await loadAndValidateInputs(options, rootDirectory);
	const outputDirectory = resolve(rootDirectory, options.outputDirectory);
	await mkdir(outputDirectory, { recursive: true });
	const buildId = `${options.command}-${Date.now().toString(36)}`;
	const createProcess = seams.createProcess ?? createPerformanceProcess;
	const performanceProcess = createProcess({
		rootDirectory,
		buildId,
		outputDirectory,
	});
	let comparison: ComparisonRecord | null = null;
	let evidence: ReportEvidence[] = [];
	let measurements: RawMeasurementRecord[] = [];
	let commandFailure: CommandResult | null = null;
	let preview: OwnedPreviewServer | null = null;
	try {
		const prepared = await buildAndPreview(performanceProcess, inputs.fingerprint);
		preview = prepared.preview;
		if (prepared.exitCode !== null) return prepared.exitCode;
		const baseUrl = preview!.result.baseUrl!;
		if (options.command === "perf:diagnose") {
			const diagnosticResult = await runDiagnostic(
				options.diagnosticScenario!,
				"cpu-trace",
				rootDirectory,
				outputDirectory,
				buildId,
				baseUrl,
				seams,
			);
			comparison = emptyComparison(inputs.policy, inputs.matrix, inputs.fingerprint);
			evidence = await evidenceFromArtifacts(
				outputDirectory,
				options.diagnosticScenario!,
				diagnosticResult,
			);
			return diagnosticResult.status === "passed" ? 0 : 2;
		}

		const cleanResult = await runCleanMatrix(
			options,
			inputs.matrix,
			rootDirectory,
			outputDirectory,
			buildId,
			baseUrl,
			seams,
		);
		commandFailure = cleanResult.command;
		measurements = await readRawMeasurements(join(outputDirectory, "measurements"));
		comparison = comparePerformance({
			expectedScenarioMatrix: inputs.matrix,
			rawRecords: measurements,
			policy: inputs.policy,
			workloadFingerprint: inputs.fingerprint,
			policyProvenance: resolvedProvenance(options.policyPath, rootDirectory),
			mode: options.collect ? "collect" : "enforce",
			baseline: options.collect
				? null
				: await readComparisonBaseline(options, rootDirectory, inputs),
		});
		const diagnosticScenarios = scenariosForDiagnostics(
			options,
			comparison,
			inputs.matrix.map(({ scenarioId }) => scenarioId),
			commandFailure,
		);
		for (const scenarioId of diagnosticScenarios) {
			const diagnostic = await runDiagnostic(
				scenarioId,
				"cpu-trace",
				rootDirectory,
				outputDirectory,
				buildId,
				baseUrl,
				seams,
			);
			evidence.push(...(await evidenceFromArtifacts(outputDirectory, scenarioId, diagnostic)));
		}
		if (options.command === "perf:full") {
			for (const scenarioId of diagnosticScenarios.slice(0, MAX_DIAGNOSTIC_REPLAYS)) {
				const diagnostic = await runDiagnostic(
					scenarioId,
					"allocation",
					rootDirectory,
					outputDirectory,
					buildId,
					baseUrl,
					seams,
				);
				evidence.push(...(await evidenceFromArtifacts(outputDirectory, scenarioId, diagnostic)));
			}
		}
		return exitCodeForComparison(comparison, options.collect, commandFailure);
	} finally {
		if (comparison) {
			await writePerformanceReport(
				{
					comparison,
					evidence,
					measurements: measurements.map((record) => ({
						scenarioId: record.scenarioId,
						repetition: record.repetition,
						workloadValid: record.workload.validityStatus === "valid",
						status: record.window.completion,
					})),
				},
				outputDirectory,
			);
		}
		if (preview) await preview.stop();
		await performanceProcess.stop();
	}
}

async function loadAndValidateInputs(
	options: CliOptions,
	rootDirectory: string,
): Promise<{
	manifest: ScenarioManifest;
	policy: BudgetPolicy;
	matrix: ReturnType<typeof expandScenarioMatrix>;
	fingerprint: string;
}> {
	const manifest = validateScenarioManifest(
		await readJson(resolve(rootDirectory, DEFAULT_MANIFEST)),
	);
	const requiredManifest = validateScenarioManifest(
		await readJson(resolve(rootDirectory, options.requiredScenariosPath)),
	);
	const policy = validateBudgetPolicy(await readJson(resolve(rootDirectory, options.policyPath)));
	const selection: ScenarioSelection =
		options.scenarioIds.length > 0
			? options.scenarioIds
			: options.command === "perf:full"
				? "full"
				: "fast";
	const matrix = expandScenarioMatrix(requiredManifest, selection);
	const fingerprint = workloadFingerprint(requiredManifest, selection);
	if (policy.workloadVersion !== requiredManifest.workloadVersion)
		throw new CliUsageError("policy and required scenario workload versions differ");
	if (manifest.workloadVersion !== requiredManifest.workloadVersion)
		throw new CliUsageError("bundled and trusted scenario workload versions differ");
	return { manifest, policy, matrix, fingerprint };
}

async function buildAndPreview(
	performanceProcess: PerformanceProcess,
	fingerprint: string,
): Promise<{ readonly preview: OwnedPreviewServer | null; readonly exitCode: number | null }> {
	const build = await performanceProcess.build();
	if (build.status !== "passed")
		return { preview: null, exitCode: infrastructureExit(build.status, build.error) };
	await updateBuildFingerprint(build.artifactDirectory, fingerprint);
	const preview = await performanceProcess.startPreview();
	if (preview.result.status !== "passed")
		return { preview, exitCode: infrastructureExit(preview.result.status, preview.result.error) };
	return { preview, exitCode: null };
}

async function runCleanMatrix(
	options: CliOptions,
	matrix: readonly { readonly scenarioId: string; readonly repetition: number }[],
	rootDirectory: string,
	outputDirectory: string,
	buildId: string,
	baseUrl: string,
	seams: CliSeams,
): Promise<{ command: CommandResult }> {
	const scenarioIds = [...new Set(matrix.map(({ scenarioId }) => scenarioId))];
	const environment = {
		PERF_BASE_URL: baseUrl,
		PERF_BUILD_ID: buildId,
		PERF_OUTPUT_DIR: outputDirectory,
		PERF_SCENARIO_SET: options.command === "perf:full" ? "full" : "fast",
		PERF_REQUIRED_SCENARIOS: options.requiredScenariosPath,
	};
	const command = seams.runCommand ?? runCommand;
	const validity = await command(
		"vp",
		["exec", "playwright", "test", "--config=playwright.performance.config.ts", "workload.spec.ts"],
		{
			cwd: rootDirectory,
			env: { ...process.env, ...environment },
			timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
		},
	);
	const cleanResults: CommandResult[] = [];
	for (const scenarioId of scenarioIds) {
		cleanResults.push(
			await command(
				"vp",
				[
					"exec",
					"playwright",
					"test",
					"--config=playwright.performance.config.ts",
					"scenarios.spec.ts",
				],
				{
					cwd: rootDirectory,
					env: { ...process.env, ...environment, PERF_SCENARIO_SELECTION: scenarioId },
					timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
				},
			),
		);
	}
	const failed = cleanResults.find(({ status }) => status !== "passed");
	return { command: failed ?? validity };
}

async function runDiagnostic(
	scenarioId: string,
	mode: "cpu-trace" | "allocation",
	rootDirectory: string,
	outputDirectory: string,
	buildId: string,
	baseUrl: string,
	seams: CliSeams,
): Promise<CommandResult> {
	const command = seams.runCommand ?? runCommand;
	return command(
		"vp",
		[
			"exec",
			"playwright",
			"test",
			"--config=playwright.performance.config.ts",
			"diagnostics.spec.ts",
		],
		{
			cwd: rootDirectory,
			env: {
				...process.env,
				PERF_BASE_URL: baseUrl,
				PERF_BUILD_ID: buildId,
				PERF_OUTPUT_DIR: outputDirectory,
				PERF_DIAGNOSTIC_SCENARIO: scenarioId,
				PERF_DIAGNOSTIC_MODE: mode,
			},
			timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
		},
	);
}

async function readRawMeasurements(directory: string): Promise<RawMeasurementRecord[]> {
	const files = await jsonFiles(directory);
	const records: RawMeasurementRecord[] = [];
	for (const file of files) {
		try {
			const value = await readJson(file);
			if (!isRecord(value) || value.schema !== "phase4-raw-measurement") continue;
			records.push(normalizeRawRecord(value));
		} catch {
			continue;
		}
	}
	return records;
}

function normalizeRawRecord(value: Record<string, any>): RawMeasurementRecord {
	if (isRecord(value.workload)) return value as unknown as RawMeasurementRecord;
	const window = value.window as RawMeasurementRecord["window"];
	return {
		...value,
		workload: invalidWorkload(
			String(value.scenarioId ?? window?.scenarioId ?? "unknown"),
			Number(value.repetition ?? window?.repetition ?? 0),
			"raw measurement did not include a workload record",
		),
	} as RawMeasurementRecord;
}

function invalidWorkload(scenarioId: string, repetition: number, message: string): WorkloadRecord {
	const failure: FailureVariant = {
		kind: "workload-invalid",
		phase: "cli",
		message,
		retryable: false,
	};
	return {
		schema: "workload",
		schemaVersion: 1,
		scenarioId,
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
		simulationSeconds: 0,
		rawWallSeconds: 0,
		minimumLoad: 0,
		maximumLoad: 0,
		progressValid: false,
		validityStatus: "invalid",
		failures: [failure],
	};
}

function scenariosForDiagnostics(
	options: CliOptions,
	comparison: ComparisonRecord,
	selectedScenarioIds: readonly string[],
	commandFailure: CommandResult | null,
): readonly string[] {
	if (options.command === "perf:full") return selectedScenarioIds.slice(0, MAX_DIAGNOSTIC_REPLAYS);
	const affected = comparison.perRepetition
		.filter(({ metrics }) => metrics.some((metric) => metric.status === "regression"))
		.map(({ scenarioId }) => scenarioId);
	const uniqueAffected = [...new Set(affected)];
	if (uniqueAffected.length > 0) return uniqueAffected.slice(0, MAX_DIAGNOSTIC_REPLAYS);
	if (commandFailure?.status !== "passed" || comparison.status === "workload-invalid")
		return selectedScenarioIds.slice(0, 1);
	return [];
}

async function evidenceFromArtifacts(
	outputDirectory: string,
	scenarioId: string,
	command: CommandResult,
): Promise<ReportEvidence[]> {
	const diagnosticsDirectory = resolve(outputDirectory, "diagnostics", scenarioId);
	await mkdir(diagnosticsDirectory, { recursive: true });
	const sourceDirectory = resolve("test-results/performance");
	if (await exists(sourceDirectory)) await copyDirectory(sourceDirectory, diagnosticsDirectory);
	const files = await jsonFiles(diagnosticsDirectory);
	const profile = files.find((file) => file.endsWith(".cpuprofile"));
	const trace = files.find((file) => file.endsWith(".trace.json"));
	const allocation = files.find((file) => file.endsWith(".allocation.json"));
	const mode = allocation ? "allocation" : "cpu-trace";
	const summary = await readEvidenceFiles({
		cpuProfilePath: profile,
		tracePath: trace,
	});
	return [
		{
			scenarioId,
			repetition: 0,
			mode,
			status: command.status === "passed" ? "complete" : "failed",
			reproduction: command.status === "passed" ? "reproduced" : "not-reproduced",
			summary,
			rawCpuPath: profile ? relative(outputDirectory, profile) : null,
			rawTracePath: trace ? relative(outputDirectory, trace) : null,
			rawAllocationPath: allocation ? relative(outputDirectory, allocation) : null,
			errors: command.error ? [command.error] : [],
		},
	];
}

async function updateBuildFingerprint(
	artifactDirectory: string,
	fingerprint: string,
): Promise<void> {
	const path = join(artifactDirectory, "build-manifest.json");
	if (!(await exists(path))) return;
	const manifest = await readJson(path);
	if (isRecord(manifest)) {
		await writeFile(
			path,
			`${JSON.stringify({ ...manifest, workloadFingerprint: fingerprint }, null, 2)}\n`,
			"utf8",
		);
	}
}

async function readComparisonBaseline(
	options: CliOptions,
	rootDirectory: string,
	inputs: { readonly policy: BudgetPolicy; readonly fingerprint: string },
) {
	const result = await readBaseline(resolve(rootDirectory, options.baselinePath), {
		policyVersion: inputs.policy.policyVersion,
		workloadVersion: inputs.policy.workloadVersion,
		workloadFingerprint: inputs.fingerprint,
	});
	return result.status === "valid" ? result.baseline : null;
}

async function acceptRunBaseline(options: CliOptions, rootDirectory: string): Promise<number> {
	if (!options.accept) throw new CliUsageError("perf:baseline requires --accept");
	const runDirectory = resolve(rootDirectory, options.baselineRunDirectory!);
	const results = await readJson(join(runDirectory, "results.json"));
	if (!isRecord(results) || !isRecord(results.comparison))
		throw new CliUsageError("run has no comparison results");
	const comparison = results.comparison as ComparisonRecord;
	const measurements = await readRawMeasurements(join(runDirectory, "measurements"));
	const first = measurements[0];
	if (!first) throw new CliUsageError("run has no raw measurement environment");
	const environment = environmentRecord(first.environment);
	const candidate: BaselineCandidate = {
		schema: "baseline-candidate",
		schemaVersion: 1,
		policyVersion: basename(String(comparison.policyProvenance)),
		workloadVersion: "unknown",
		workloadFingerprint: comparison.workloadFingerprint,
		measurementMode: "clean",
		environmentCompatibilityKey: environmentCompatibilityKey(first.environment),
		environment,
		comparison,
		provenance: runDirectory,
	};
	await acceptBaseline({
		candidate,
		destinationPath: resolve(
			rootDirectory,
			options.baselinePath || join(options.baselineDirectory, "baseline.json"),
		),
		accept: true,
	});
	return 0;
}

function emptyComparison(
	policy: BudgetPolicy,
	matrix: ReturnType<typeof expandScenarioMatrix>,
	fingerprint: string,
): ComparisonRecord {
	return comparePerformance({
		expectedScenarioMatrix: matrix,
		rawRecords: [],
		policy,
		workloadFingerprint: fingerprint,
		policyProvenance: "diagnosis-only",
		mode: "collect",
	});
}

function environmentRecord(value: RawMeasurementRecord["environment"]): EnvironmentRecord {
	return "record" in value ? value.record : value;
}

function environmentCompatibilityKey(value: RawMeasurementRecord["environment"]): string {
	return "compatibilityKey" in value
		? value.compatibilityKey
		: JSON.stringify({ ...value, schema: undefined, schemaVersion: undefined });
}

// fallow-ignore-next-line complexity -- status precedence maps every comparison outcome to the public exit contract.
function exitCodeForComparison(
	comparison: ComparisonRecord,
	collect: boolean,
	commandFailure: CommandResult | null,
): number {
	if (comparison.status === "regression" || comparison.status === "capacity-failure") return 1;
	if (comparison.status === "workload-invalid" || comparison.status === "infrastructure-failure")
		return 2;
	if (collect && comparison.status === "unbaselined-collection")
		return commandFailure?.status === "passed" ? 0 : 2;
	if (comparison.status === "unbaselined-collection") return 2;
	return commandFailure?.status === "passed" ? 0 : 2;
}

function infrastructureExit(status: string, error: string | null): number {
	printError(`${status}: ${error ?? "performance infrastructure failed"}`);
	return 2;
}

async function runCommand(
	command: string,
	args: readonly string[],
	options: CommandOptions,
): Promise<CommandResult> {
	const child = nodeSpawn(command, [...args], {
		cwd: options.cwd,
		env: options.env,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let truncated = false;
	const maximumBytes = 32 * 1024;
	const append = (channel: "stdout" | "stderr", chunk: unknown): void => {
		const value = String(chunk);
		const used = Buffer.byteLength(stdout + stderr);
		const remaining = Math.max(0, maximumBytes - used);
		const bounded = Buffer.byteLength(value) <= remaining ? value : value.slice(0, remaining);
		if (channel === "stdout") stdout += bounded;
		else stderr += bounded;
		if (bounded.length !== value.length) truncated = true;
	};
	child.stdout?.on("data", (chunk) => append("stdout", chunk));
	child.stderr?.on("data", (chunk) => append("stderr", chunk));
	return new Promise<CommandResult>((resolveResult) => {
		let settled = false;
		const finish = (result: CommandResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolveResult({ ...result, logs: { stdout, stderr, truncated } });
		};
		const timer = setTimeout(() => {
			try {
				if (child.pid && process.platform === "linux") process.kill(-child.pid, "SIGTERM");
				else child.kill("SIGTERM");
			} catch {
				child.kill("SIGTERM");
			}
			finish({
				status: "timeout",
				exitCode: null,
				logs: { stdout, stderr, truncated },
				error: "command timed out",
			});
		}, options.timeoutMs);
		child.once("error", (error) =>
			finish({ status: "failed", exitCode: null, logs: EMPTY_LOGS, error: error.message }),
		);
		child.once("exit", (code) =>
			finish({
				status: code === 0 ? "passed" : "failed",
				exitCode: code,
				logs: EMPTY_LOGS,
				error: code === 0 ? null : `command exited with code ${code}`,
			}),
		);
	});
}

async function jsonFiles(directory: string): Promise<string[]> {
	if (!(await exists(directory))) return [];
	const entries = await readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await jsonFiles(path)));
		else if (entry.isFile() && entry.name.endsWith(".json")) files.push(path);
	}
	return files;
}

async function copyDirectory(source: string, destination: string): Promise<void> {
	const entries = await readdir(source, { withFileTypes: true });
	await mkdir(destination, { recursive: true });
	for (const entry of entries) {
		const from = join(source, entry.name);
		const to = join(destination, entry.name);
		if (entry.isDirectory()) await copyDirectory(from, to);
		else if (entry.isFile()) {
			await mkdir(dirname(to), { recursive: true });
			await copyFile(from, to);
		}
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

function resolvedProvenance(path: string, rootDirectory: string): string {
	return resolve(rootDirectory, path);
}

function defaultOutputDirectory(): string {
	return join(
		DEFAULT_OUTPUT_ROOT,
		`run-${new Date()
			.toISOString()
			.replaceAll(/[^0-9]/g, "")
			.slice(0, 14)}`,
	);
}

function isCommand(value: string): value is CliOptions["command"] {
	return ["perf", "perf:diagnose", "perf:full", "perf:baseline"].includes(value);
}

const EMPTY_LOGS: ProcessLogs = { stdout: "", stderr: "", truncated: false };

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : Object.prototype.toString.call(error);
}

function printError(message: string): void {
	process.stderr.write(`${message}\n`);
}

function printHelp(): void {
	process.stdout.write(
		`Usage: node performance/cli.ts <command> [options]\n\nCommands:\n  perf             Measure the fast scenario set and diagnose failures\n  perf:diagnose    Force CPU/trace evidence for --scenario <id>\n  perf:full        Measure all scenarios and collect diagnostics/allocation evidence\n  perf:baseline    Accept a valid local candidate with --from <run-dir> --accept\n\nOptions:\n  --collect\n  --policy <path> --baseline <path> --required-scenarios <path>\n  --output <dir> --baseline-dir <dir> --scenario <id>\n`,
	);
}

if (
	!process.env.VITEST &&
	process.argv[1] &&
	resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
)
	void runCli(process.argv.slice(2)).then((code) => {
		process.exitCode = code;
	});
