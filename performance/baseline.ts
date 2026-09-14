import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ComparisonRecord, EnvironmentRecord } from "./contracts.ts";
import { PERFORMANCE_METRICS, type BaselineComparison, type PerformanceMetric } from "./compare.ts";

export interface PerformanceBaseline extends BaselineComparison {
	readonly scope: "local" | "ci";
	readonly environment: EnvironmentRecord;
}

export interface BaselineCandidate {
	readonly schema: "baseline-candidate";
	readonly schemaVersion: 1;
	readonly policyVersion: string;
	readonly workloadVersion: string;
	readonly workloadFingerprint: string;
	readonly measurementMode: "clean";
	readonly environmentCompatibilityKey: string;
	readonly environment: EnvironmentRecord;
	readonly comparison: ComparisonRecord;
	readonly provenance: string;
}

export interface BaselineCompatibilityExpectations {
	readonly policyVersion?: string;
	readonly workloadVersion?: string;
	readonly workloadFingerprint?: string;
	readonly environmentCompatibilityKey?: string;
	readonly measurementMode?: "clean";
}

export interface BaselineReadResult {
	readonly status: "valid" | "missing" | "invalid";
	readonly baseline: PerformanceBaseline | null;
	readonly issues: readonly string[];
}

export interface BaselineAcceptanceOptions extends BaselineCompatibilityExpectations {
	readonly candidate: unknown;
	readonly destinationPath: string;
	readonly accept: boolean;
	readonly scope?: "local" | "ci";
	readonly overwrite?: boolean;
	readonly provenance?: string;
}

class BaselineError extends Error {
	readonly issues: readonly string[];

	constructor(issues: readonly string[]) {
		super(`Invalid performance baseline: ${issues.join("; ")}`);
		this.name = "BaselineError";
		this.issues = issues;
	}
}

export function validateBaseline(
	input: unknown,
	expectations: BaselineCompatibilityExpectations = {},
): PerformanceBaseline {
	if (!isRecord(input)) throw new BaselineError(["baseline must be an object"]);
	const issues: string[] = [];
	if (input.schema !== "performance-baseline") issues.push('schema must be "performance-baseline"');
	if (input.schemaVersion !== 1) issues.push("schemaVersion must be 1");
	if (!isOneOf(input.scope, ["local", "ci"])) issues.push("scope must be local or ci");
	if (!isNonEmptyString(input.policyVersion)) issues.push("policyVersion must be non-empty");
	if (!isNonEmptyString(input.workloadVersion)) issues.push("workloadVersion must be non-empty");
	if (!isNonEmptyString(input.workloadFingerprint))
		issues.push("workloadFingerprint must be non-empty");
	if (input.measurementMode !== "clean") issues.push("measurementMode must be clean");
	if (!isNonEmptyString(input.environmentCompatibilityKey))
		issues.push("environmentCompatibilityKey must be non-empty");
	const environment = validateEnvironment(input.environment, issues);
	const aggregates = validateAggregates(input.aggregates, issues);
	if (!isNonEmptyString(input.provenance)) issues.push("provenance must be non-empty");
	checkExpectations(input, expectations, issues);
	if (issues.length > 0) throw new BaselineError(issues);
	return {
		schema: "performance-baseline",
		schemaVersion: 1,
		scope: input.scope as "local" | "ci",
		policyVersion: input.policyVersion as string,
		workloadVersion: input.workloadVersion as string,
		workloadFingerprint: input.workloadFingerprint as string,
		measurementMode: "clean",
		environmentCompatibilityKey: input.environmentCompatibilityKey as string,
		environment: environment as EnvironmentRecord,
		aggregates,
		provenance: input.provenance as string,
	};
}

export async function readBaseline(
	path: string,
	expectations: BaselineCompatibilityExpectations = {},
): Promise<BaselineReadResult> {
	try {
		const content = await readFile(resolve(path), "utf8");
		try {
			return {
				status: "valid",
				baseline: validateBaseline(JSON.parse(content), expectations),
				issues: [],
			};
		} catch (error) {
			return { status: "invalid", baseline: null, issues: errorIssues(error) };
		}
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT")
			return { status: "missing", baseline: null, issues: [`baseline does not exist: ${path}`] };
		return {
			status: "invalid",
			baseline: null,
			issues: [`unable to read baseline: ${String(error)}`],
		};
	}
}

export async function acceptBaseline(
	options: BaselineAcceptanceOptions,
): Promise<PerformanceBaseline> {
	if (!options.accept) throw new BaselineError(["explicit acceptance is required"]);
	const scope = options.scope ?? "local";
	if (scope === "ci") throw new BaselineError(["CI baseline acceptance is never automatic"]);
	const candidate = validateCandidate(options.candidate, {
		policyVersion: options.policyVersion,
		workloadVersion: options.workloadVersion,
		workloadFingerprint: options.workloadFingerprint,
		environmentCompatibilityKey: options.environmentCompatibilityKey,
		measurementMode: options.measurementMode,
	});
	const destinationPath = resolve(options.destinationPath);
	const existing = await readBaseline(destinationPath);
	if (existing.status === "valid" && !options.overwrite)
		throw new BaselineError(["baseline exists; overwrite authorization is required"]);
	if (existing.status === "invalid" && !options.overwrite)
		throw new BaselineError([
			"destination contains malformed data; overwrite authorization is required",
		]);
	const baseline: PerformanceBaseline = {
		schema: "performance-baseline",
		schemaVersion: 1,
		scope,
		policyVersion: candidate.policyVersion,
		workloadVersion: candidate.workloadVersion,
		workloadFingerprint: candidate.workloadFingerprint,
		measurementMode: "clean",
		environmentCompatibilityKey: candidate.environmentCompatibilityKey,
		environment: candidate.environment,
		aggregates: candidate.comparison
			.medianRepetitionAggregates as PerformanceBaseline["aggregates"],
		provenance: options.provenance ?? candidate.provenance,
	};
	const temporaryPath = `${destinationPath}.${randomUUID()}.tmp`;
	try {
		await mkdir(dirname(destinationPath), { recursive: true });
		await writeFile(temporaryPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
		await rename(temporaryPath, destinationPath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
	return baseline;
}

// fallow-ignore-next-line complexity -- candidate validation covers provenance, clean mode, and full comparison evidence.
function validateCandidate(
	input: unknown,
	expectations: BaselineCompatibilityExpectations,
): BaselineCandidate {
	if (!isRecord(input)) throw new BaselineError(["candidate must be an object"]);
	const issues: string[] = [];
	if (input.schema !== "baseline-candidate")
		issues.push('candidate schema must be "baseline-candidate"');
	if (input.schemaVersion !== 1) issues.push("candidate schemaVersion must be 1");
	if (!isNonEmptyString(input.policyVersion))
		issues.push("candidate policyVersion must be non-empty");
	if (!isNonEmptyString(input.workloadVersion))
		issues.push("candidate workloadVersion must be non-empty");
	if (!isNonEmptyString(input.workloadFingerprint))
		issues.push("candidate workloadFingerprint must be non-empty");
	if (input.measurementMode !== "clean") issues.push("candidate measurementMode must be clean");
	if (!isNonEmptyString(input.environmentCompatibilityKey))
		issues.push("candidate environmentCompatibilityKey must be non-empty");
	const environment = validateEnvironment(input.environment, issues);
	const comparison = validateComparison(input.comparison, issues);
	if (!isNonEmptyString(input.provenance)) issues.push("candidate provenance must be non-empty");
	if (comparison && comparison.workloadFingerprint !== input.workloadFingerprint)
		issues.push("candidate workload fingerprint must match comparison");
	checkExpectations(input, expectations, issues);
	if (issues.length > 0) throw new BaselineError(issues);
	return {
		schema: "baseline-candidate",
		schemaVersion: 1,
		policyVersion: input.policyVersion as string,
		workloadVersion: input.workloadVersion as string,
		workloadFingerprint: input.workloadFingerprint as string,
		measurementMode: "clean",
		environmentCompatibilityKey: input.environmentCompatibilityKey as string,
		environment: environment as EnvironmentRecord,
		comparison: comparison as ComparisonRecord,
		provenance: input.provenance as string,
	};
}

// fallow-ignore-next-line complexity -- accepted baselines require complete clean comparison evidence.
function validateComparison(input: unknown, issues: string[]): ComparisonRecord | null {
	if (!isRecord(input)) {
		issues.push("candidate comparison must be an object");
		return null;
	}
	if (input.schema !== "comparison") issues.push("candidate comparison schema is unsupported");
	if (input.schemaVersion !== 1) issues.push("candidate comparison schemaVersion must be 1");
	if (input.mode !== "clean") issues.push("candidate comparison must be clean");
	if (input.status !== "passed" || input.originalVerdict !== "passed")
		issues.push("only a passed clean comparison can be accepted");
	if (!isNonEmptyString(input.workloadFingerprint))
		issues.push("comparison workloadFingerprint is required");
	if (!Array.isArray(input.perRepetition) || input.perRepetition.length === 0)
		issues.push("comparison must contain complete repetitions");
	if (!isRecord(input.medianRepetitionAggregates))
		issues.push("comparison aggregates are required");
	if (!Array.isArray(input.metricStatuses)) issues.push("comparison metric statuses are required");
	else if (
		input.metricStatuses.some(
			(status: unknown) =>
				!isRecord(status) ||
				status.status === "regression" ||
				status.status === "missing" ||
				status.status === "invalid",
		)
	)
		issues.push("comparison contains a failed metric status");
	if (Array.isArray(input.perRepetition))
		for (const [index, summary] of input.perRepetition.entries())
			validateSummary(summary, index, issues);
	if (isRecord(input.medianRepetitionAggregates))
		validateAggregates(input.medianRepetitionAggregates, issues);
	validateComparisonCoverage(input, issues);
	return input as unknown as ComparisonRecord;
}

// fallow-ignore-next-line complexity -- coverage validation rejects partial and duplicate baseline scenarios.
function validateComparisonCoverage(input: Record<string, any>, issues: string[]): void {
	if (
		!Array.isArray(input.expectedScenarioIds) ||
		!isRecord(input.expectedRepetitions) ||
		!isRecord(input.receivedCoverage)
	) {
		issues.push("comparison coverage is required");
		return;
	}
	const expectedIds = input.expectedScenarioIds;
	if (
		expectedIds.some((id: unknown) => !isNonEmptyString(id)) ||
		new Set(expectedIds).size !== expectedIds.length
	)
		issues.push("comparison expected scenario IDs must be unique non-empty strings");
	const expectedPairs = new Set<string>();
	for (const scenarioId of expectedIds) {
		const count = input.expectedRepetitions[scenarioId];
		const repetitions = input.receivedCoverage[scenarioId];
		if (!isPositiveInteger(count) || !Array.isArray(repetitions)) {
			issues.push(`comparison coverage is incomplete for ${scenarioId}`);
			continue;
		}
		const required = Array.from({ length: count }, (_, repetition) => repetition);
		if (
			repetitions.length !== required.length ||
			repetitions.some((value: unknown, index: number) => value !== required[index])
		)
			issues.push(`comparison coverage is incomplete for ${scenarioId}`);
		for (const repetition of required) expectedPairs.add(`${scenarioId}:${repetition}`);
	}
	for (const scenarioId of Object.keys(input.receivedCoverage))
		if (!expectedIds.includes(scenarioId))
			issues.push(`comparison has unexpected scenario ${scenarioId}`);
	if (Array.isArray(input.perRepetition)) {
		if (input.perRepetition.length !== expectedPairs.size)
			issues.push("comparison repetition summaries are incomplete");
		const receivedPairs = new Set<string>();
		for (const summary of input.perRepetition)
			if (
				isRecord(summary) &&
				isNonEmptyString(summary.scenarioId) &&
				isNonNegativeInteger(summary.repetition)
			)
				receivedPairs.add(`${summary.scenarioId}:${summary.repetition}`);
		if (
			receivedPairs.size !== input.perRepetition.length ||
			[...receivedPairs].some((pair) => !expectedPairs.has(pair))
		)
			issues.push("comparison repetition summaries contain duplicates or unexpected entries");
	}
}

function validateSummary(input: unknown, index: number, issues: string[]): void {
	if (!isRecord(input)) {
		issues.push(`comparison.perRepetition[${index}] must be an object`);
		return;
	}
	if (!isNonNegativeInteger(input.repetition))
		issues.push(`comparison.perRepetition[${index}] repetition is invalid`);
	validateWindow(input.window, index, issues);
	validateWorkload(input.workload, index, issues);
	if (!Array.isArray(input.metrics))
		issues.push(`comparison.perRepetition[${index}].metrics is required`);
}

function validateWindow(input: unknown, index: number, issues: string[]): void {
	if (!isRecord(input)) {
		issues.push(`comparison.perRepetition[${index}].window is required`);
		return;
	}
	if (input.schema !== "window" || input.mode !== "clean" || input.completion !== "completed")
		issues.push(`comparison.perRepetition[${index}] window is not a completed clean record`);
	if (!Array.isArray(input.failures) || input.failures.length > 0)
		issues.push(`comparison.perRepetition[${index}] window contains failures`);
	validateSamples(
		input.rawRafSamples,
		`comparison.perRepetition[${index}].window.rawRafSamples`,
		issues,
	);
	validateSamples(
		input.frameCpuWorkSamples,
		`comparison.perRepetition[${index}].window.frameCpuWorkSamples`,
		issues,
	);
}

function validateSamples(input: unknown, path: string, issues: string[]): void {
	if (!isRecord(input) || !Array.isArray(input.values) || input.values.length === 0) {
		issues.push(`${path} must contain samples`);
		return;
	}
	if (input.values.some((value: unknown) => !isFiniteNumber(value)))
		issues.push(`${path} contains nonfinite samples`);
	if (
		!isRecord(input.metadata) ||
		input.metadata.truncated !== false ||
		input.metadata.droppedSamples !== 0
	)
		issues.push(`${path} is truncated or dropped samples`);
}

function validateWorkload(input: unknown, index: number, issues: string[]): void {
	if (!isRecord(input)) {
		issues.push(`comparison.perRepetition[${index}].workload is required`);
		return;
	}
	if (
		input.validityStatus !== "valid" ||
		input.progressValid !== true ||
		!Array.isArray(input.failures) ||
		input.failures.length > 0
	)
		issues.push(`comparison.perRepetition[${index}] workload is invalid`);
}

function validateEnvironment(input: unknown, issues: string[]): EnvironmentRecord | null {
	if (!isRecord(input)) {
		issues.push("environment is required");
		return null;
	}
	if (input.schema !== "environment") issues.push("environment schema is unsupported");
	if (input.schemaVersion !== 1) issues.push("environment schemaVersion must be 1");
	return input as unknown as EnvironmentRecord;
}

// fallow-ignore-next-line complexity -- every supported metric is checked explicitly before persistence.
function validateAggregates(
	input: unknown,
	issues: string[],
): Readonly<Record<string, Readonly<Record<PerformanceMetric, number | null>>>> {
	if (!isRecord(input)) {
		issues.push("aggregates must be an object");
		return {};
	}
	const aggregates: Record<string, Record<PerformanceMetric, number | null>> = {};
	for (const [scenarioId, value] of Object.entries(input)) {
		if (!isRecord(value)) {
			issues.push(`aggregates.${scenarioId} must be an object`);
			continue;
		}
		const metricValues = {} as Record<PerformanceMetric, number | null>;
		for (const metric of PERFORMANCE_METRICS) {
			if (!(metric in value)) issues.push(`aggregates.${scenarioId}.${metric} is required`);
			const metricValue = value[metric];
			if (
				metricValue !== null &&
				(!isFiniteNumber(metricValue) || (metric !== "heapUsedDeltaBytes" && metricValue < 0))
			)
				issues.push(`aggregates.${scenarioId}.${metric} must be null or a valid number`);
			metricValues[metric] =
				metricValue === null || !isFiniteNumber(metricValue) ? null : metricValue;
		}
		for (const key of Object.keys(value))
			if (!PERFORMANCE_METRICS.includes(key as PerformanceMetric))
				issues.push(`aggregates.${scenarioId}.${key} is unsupported`);
		aggregates[scenarioId] = metricValues;
	}
	if (Object.keys(aggregates).length === 0)
		issues.push("aggregates must contain at least one scenario");
	return aggregates;
}

function checkExpectations(
	input: Record<string, any>,
	expectations: BaselineCompatibilityExpectations,
	issues: string[],
): void {
	for (const [key, expected] of Object.entries(expectations))
		if (expected !== undefined && input[key] !== expected) issues.push(`${key} is incompatible`);
}

function errorIssues(error: unknown): readonly string[] {
	return error instanceof BaselineError ? error.issues : [String(error)];
}

// fallow-ignore-next-line code-duplication -- this narrow guard is repeated by independent JSON boundaries.
function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
	return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
	return isNonNegativeInteger(value) && value > 0;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
	return typeof value === "string" && values.includes(value as T);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
	return value instanceof Error && "code" in value;
}
