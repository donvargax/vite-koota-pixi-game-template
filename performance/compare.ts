import type {
	ComparisonRecord,
	EnvironmentRecord,
	MeasurementMode,
	MetricStatus,
	RepetitionSummary,
	VerdictStatus,
	WindowRecord,
	WorkloadRecord,
} from "./contracts.ts";
import { median, nearestRankPercentile, simulationWallTimeRatio } from "./statistics.ts";

export const PERFORMANCE_METRICS = [
	"frameCpuWorkP95Ms",
	"rawRafP95Ms",
	"simulationWallRatio",
	"heapUsedDeltaBytes",
	"longTaskRate",
] as const;

const EXPECTED_DIRECTIONS: Readonly<Record<PerformanceMetric, BudgetDirection>> = {
	frameCpuWorkP95Ms: "lower-is-better",
	rawRafP95Ms: "lower-is-better",
	simulationWallRatio: "higher-is-better",
	heapUsedDeltaBytes: "informational",
	longTaskRate: "informational",
};

export type PerformanceMetric = (typeof PERFORMANCE_METRICS)[number];
export type BudgetDirection = "higher-is-better" | "lower-is-better" | "informational";

export interface BudgetMetricPolicy {
	readonly metric: PerformanceMetric;
	readonly direction: BudgetDirection;
	readonly required: boolean;
	readonly calibrated: boolean;
	readonly absoluteLimit: number | null;
	readonly relativeThreshold: number | null;
	readonly minimumAbsoluteDelta: number | null;
}

export interface BudgetScenarioPolicy {
	readonly scenarioId: string;
	readonly required: boolean;
}

export interface BudgetPolicy {
	readonly schema: "performance-policy";
	readonly schemaVersion: 1;
	readonly policyVersion: string;
	readonly workloadVersion: string;
	readonly calibrated: boolean;
	readonly environmentPolicy: {
		readonly compatibility: "local-machine" | "runner-class";
		readonly runnerClass: string | null;
	};
	readonly metrics: readonly BudgetMetricPolicy[];
	readonly scenarios: readonly BudgetScenarioPolicy[];
}

class BudgetPolicyError extends Error {
	readonly issues: readonly string[];

	constructor(issues: readonly string[]) {
		super(`Invalid performance budget policy: ${issues.join("; ")}`);
		this.name = "BudgetPolicyError";
		this.issues = issues;
	}
}

export interface RawMeasurementRecord {
	readonly schema: "phase4-raw-measurement";
	readonly schemaVersion: 1;
	readonly mode: MeasurementMode;
	readonly scenarioId: string;
	readonly repetition: number;
	readonly environment: EnvironmentRecord | EnvironmentSnapshotRecord;
	readonly window: WindowRecord;
	readonly workload: WorkloadRecord;
}

export interface EnvironmentSnapshotRecord {
	readonly record: EnvironmentRecord;
	readonly compatibilityKey: string;
}

export interface BaselineComparison {
	readonly schema: "performance-baseline";
	readonly schemaVersion: 1;
	readonly policyVersion: string;
	readonly workloadVersion: string;
	readonly workloadFingerprint: string;
	readonly measurementMode: "clean";
	readonly environmentCompatibilityKey: string;
	readonly aggregates: Readonly<Record<string, Readonly<Record<PerformanceMetric, number | null>>>>;
	readonly provenance: string;
}

export interface ComparisonInput {
	readonly expectedScenarioMatrix: readonly {
		readonly scenarioId: string;
		readonly repetition: number;
	}[];
	readonly rawRecords: readonly RawMeasurementRecord[];
	readonly policy: unknown;
	readonly workloadFingerprint: string;
	readonly policyProvenance: string;
	readonly mode?: "enforce" | "collect";
	readonly baseline?: BaselineComparison | null;
}

// fallow-ignore-next-line complexity -- strict unknown-policy validation keeps every malformed variant fail-closed.
export function validateBudgetPolicy(input: unknown): BudgetPolicy {
	if (!isRecord(input)) throw new BudgetPolicyError(["policy must be an object"]);
	const issues: string[] = [];
	if (input.schema !== "performance-policy") issues.push('schema must be "performance-policy"');
	if (input.schemaVersion !== 1) issues.push("schemaVersion must be 1");
	if (!isNonEmptyString(input.policyVersion)) issues.push("policyVersion must be non-empty");
	if (!isNonEmptyString(input.workloadVersion)) issues.push("workloadVersion must be non-empty");
	if (typeof input.calibrated !== "boolean") issues.push("calibrated must be boolean");
	if (!isRecord(input.environmentPolicy)) {
		issues.push("environmentPolicy must be an object");
	} else {
		if (!isOneOf(input.environmentPolicy.compatibility, ["local-machine", "runner-class"]))
			issues.push("environmentPolicy.compatibility is unsupported");
		if (
			input.environmentPolicy.runnerClass !== null &&
			!isNonEmptyString(input.environmentPolicy.runnerClass)
		)
			issues.push("environmentPolicy.runnerClass must be a non-empty string or null");
	}
	const metrics = validatePolicyMetrics(input.metrics, issues);
	const scenarios = validatePolicyScenarios(input.scenarios, issues);
	if (metrics.length === 0) issues.push("metrics must contain at least one metric");
	if (input.calibrated === true && metrics.some((metric) => metric.required && !metric.calibrated))
		issues.push("calibrated policy requires every required metric to be calibrated");
	if (input.calibrated === false && metrics.some((metric) => metric.calibrated))
		issues.push("uncalibrated policy cannot contain calibrated metrics");
	if (issues.length > 0) throw new BudgetPolicyError(issues);
	return {
		schema: "performance-policy",
		schemaVersion: 1,
		policyVersion: input.policyVersion as string,
		workloadVersion: input.workloadVersion as string,
		calibrated: input.calibrated as boolean,
		environmentPolicy: {
			compatibility: input.environmentPolicy.compatibility as "local-machine" | "runner-class",
			runnerClass: input.environmentPolicy.runnerClass as string | null,
		},
		metrics,
		scenarios,
	};
}

// fallow-ignore-next-line complexity -- each metric variant is validated without permitting permissive defaults.
function validatePolicyMetrics(input: unknown, issues: string[]): BudgetMetricPolicy[] {
	if (!Array.isArray(input)) {
		issues.push("metrics must be an array");
		return [];
	}
	const metrics: BudgetMetricPolicy[] = [];
	const seen = new Set<string>();
	for (const [index, value] of input.entries()) {
		const path = `metrics[${index}]`;
		// fallow-ignore-next-line code-duplication -- repeated unknown-record guards are deliberate fail-closed validation.
		if (!isRecord(value)) {
			issues.push(`${path} must be an object`);
			continue;
		}
		const metric = value.metric;
		if (!isOneOf(metric, PERFORMANCE_METRICS)) {
			issues.push(`${path}.metric is unsupported`);
			continue;
		}
		if (seen.has(metric)) issues.push(`duplicate metric ${metric}`);
		seen.add(metric);
		const direction = value.direction;
		if (!isOneOf(direction, ["higher-is-better", "lower-is-better", "informational"]))
			issues.push(`${path}.direction is unsupported`);
		else if (direction !== EXPECTED_DIRECTIONS[metric])
			issues.push(`${path}.direction is incorrect for ${metric}`);
		if (typeof value.required !== "boolean") issues.push(`${path}.required must be boolean`);
		if (typeof value.calibrated !== "boolean") issues.push(`${path}.calibrated must be boolean`);
		const absoluteLimit = nullableNonNegative(value.absoluteLimit, `${path}.absoluteLimit`, issues);
		const relativeThreshold = nullableNonNegative(
			value.relativeThreshold,
			`${path}.relativeThreshold`,
			issues,
		);
		const minimumAbsoluteDelta = nullableNonNegative(
			value.minimumAbsoluteDelta,
			`${path}.minimumAbsoluteDelta`,
			issues,
		);
		if (direction === "informational" && value.required === true)
			issues.push(`${path} informational metrics cannot be required`);
		if (
			direction === "informational" &&
			(absoluteLimit !== null || relativeThreshold !== null || minimumAbsoluteDelta !== null)
		)
			issues.push(`${path} informational metrics cannot define thresholds`);
		if (
			value.calibrated === false &&
			(absoluteLimit !== null || relativeThreshold !== null || minimumAbsoluteDelta !== null)
		)
			issues.push(`${path} uncalibrated metrics must have null thresholds`);
		if (
			value.calibrated === true &&
			direction !== "informational" &&
			(absoluteLimit === null || relativeThreshold === null || minimumAbsoluteDelta === null)
		)
			issues.push(`${path} calibrated metrics require all thresholds`);
		metrics.push({
			metric,
			direction: isBudgetDirection(direction) ? direction : "informational",
			required: value.required === true,
			calibrated: value.calibrated === true,
			absoluteLimit,
			relativeThreshold,
			minimumAbsoluteDelta,
		});
	}
	return metrics;
}

function validatePolicyScenarios(input: unknown, issues: string[]): BudgetScenarioPolicy[] {
	if (!Array.isArray(input)) {
		issues.push("scenarios must be an array");
		return [];
	}
	const scenarios: BudgetScenarioPolicy[] = [];
	const seen = new Set<string>();
	for (const [index, value] of input.entries()) {
		const path = `scenarios[${index}]`;
		if (!isRecord(value)) {
			issues.push(`${path} must be an object`);
			continue;
		}
		if (!isNonEmptyString(value.scenarioId)) issues.push(`${path}.scenarioId must be non-empty`);
		else if (seen.has(value.scenarioId))
			issues.push(`duplicate scenario entry ${value.scenarioId}`);
		else seen.add(value.scenarioId);
		if (typeof value.required !== "boolean") issues.push(`${path}.required must be boolean`);
		scenarios.push({
			scenarioId: String(value.scenarioId ?? ""),
			required: value.required === true,
		});
	}
	return scenarios;
}

// fallow-ignore-next-line complexity -- comparison precedence must remain visible in one pure verdict boundary.
export function comparePerformance(input: ComparisonInput): ComparisonRecord {
	const policy = validateBudgetPolicy(input.policy);
	const mode = input.mode ?? "enforce";
	const expected = expectedCoverage(input.expectedScenarioMatrix);
	const coverage = receivedCoverage(input.rawRecords);
	const coverageIssues = coverageIssuesFor(expected, coverage, input.rawRecords);
	const policyIssues = policyIssuesFor(
		policy,
		expected,
		input.rawRecords,
		input.workloadFingerprint,
		mode,
		input.baseline,
	);
	if (coverageIssues.length > 0 || policyIssues.length > 0) {
		return invalidComparison(input, policy, expected, coverage, [
			...coverageIssues,
			...policyIssues,
		]);
	}

	const baseline = input.baseline ?? null;
	const summaries: RepetitionSummary[] = [];
	const aggregates: Record<string, Record<string, number | null>> = {};
	let workloadInvalid = false;
	for (const record of input.rawRecords) {
		const metrics = policy.metrics.map((metric) => metricStatusForRecord(record, metric, baseline));
		if (!isValidWorkload(record)) workloadInvalid = true;
		summaries.push({
			scenarioId: record.scenarioId,
			repetition: record.repetition,
			metrics,
			window: record.window,
			workload: record.workload,
		});
	}
	for (const scenarioId of expected.keys()) {
		const records = input.rawRecords.filter((record) => record.scenarioId === scenarioId);
		aggregates[scenarioId] = {};
		for (const metric of policy.metrics)
			aggregates[scenarioId][metric.metric] = medianMetric(records, metric.metric);
	}

	const metricStatuses = [...expected.keys()].flatMap((scenarioId) =>
		policy.metrics.map((metric) => aggregateMetricStatus(scenarioId, aggregates, metric, baseline)),
	);
	const failedRequiredMetric = metricStatuses.some(
		(status) => status.status === "missing" || status.status === "invalid",
	);
	const capacityFailure = metricStatuses.some(
		(status) => status.metric === "simulationWallRatio" && status.status === "regression",
	);
	const regression = metricStatuses.some((status) => status.status === "regression");
	let status: VerdictStatus;
	const reasons: string[] = [];
	if (workloadInvalid || failedRequiredMetric) {
		status = "workload-invalid";
		if (workloadInvalid) reasons.push("one or more clean repetitions failed workload validity");
		if (failedRequiredMetric) reasons.push("one or more required metrics are missing or invalid");
	} else if (capacityFailure) {
		status = "capacity-failure";
		reasons.push("simulation-to-wall-time capacity metric breached its policy");
	} else if (regression) {
		status = "regression";
		reasons.push("one or more performance metrics breached policy");
	} else if (baseline === null) {
		status = "unbaselined-collection";
		reasons.push("no compatible baseline was supplied");
	} else {
		status = "passed";
		reasons.push("complete clean repetitions satisfy the calibrated policy");
	}
	return {
		schema: "comparison",
		schemaVersion: 1,
		mode: "clean",
		expectedScenarioIds: [...expected.keys()],
		expectedRepetitions: Object.fromEntries(expected),
		receivedCoverage: coverage,
		perRepetition: summaries,
		medianRepetitionAggregates: aggregates,
		baselineProvenance: baseline?.provenance ?? null,
		policyProvenance: input.policyProvenance,
		workloadFingerprint: input.workloadFingerprint,
		metricStatuses,
		status,
		originalVerdict: status,
		reasons,
	};
}

function metricStatusForRecord(
	record: RawMeasurementRecord,
	policy: BudgetMetricPolicy,
	baseline: BaselineComparison | null,
): MetricStatus {
	const received = metricValue(record, policy.metric);
	if (received === null) {
		return {
			metric: policy.metric,
			status: policy.required ? "missing" : "unsupported",
			direction: policy.direction,
			expected: null,
			received: null,
			delta: null,
			relativeDelta: null,
			reason: policy.required ? "required metric is unavailable" : "optional metric is unavailable",
		};
	}
	const expected = baseline?.aggregates[record.scenarioId]?.[policy.metric] ?? null;
	const evaluation = evaluateMetric(received, expected, policy);
	return {
		metric: policy.metric,
		status: evaluation.regression ? "regression" : "passed",
		direction: policy.direction,
		expected,
		received,
		delta: expected === null ? null : received - expected,
		relativeDelta: evaluation.relativeDelta,
		reason: evaluation.reason,
	};
}

// fallow-ignore-next-line complexity -- required and informational aggregate states share one status boundary.
function aggregateMetricStatus(
	scenarioId: string,
	aggregates: Readonly<Record<string, Readonly<Record<string, number | null>>>>,
	policy: BudgetMetricPolicy,
	baseline: BaselineComparison | null,
): MetricStatus {
	const received = aggregates[scenarioId]?.[policy.metric] ?? null;
	if (received === null) {
		return {
			metric: policy.metric,
			status: policy.required ? "missing" : "unsupported",
			direction: policy.direction,
			expected: null,
			received: null,
			delta: null,
			relativeDelta: null,
			reason: policy.required
				? "required aggregate is unavailable"
				: "optional aggregate is unavailable",
		};
	}
	const expectedValue = baseline?.aggregates[scenarioId]?.[policy.metric] ?? null;
	const evaluation = evaluateMetric(received, expectedValue, policy);
	return {
		metric: policy.metric,
		status: evaluation.regression ? "regression" : "passed",
		direction: policy.direction,
		expected: expectedValue,
		received,
		delta: expectedValue === null ? null : received - expectedValue,
		relativeDelta: evaluation.relativeDelta,
		reason: evaluation.reason,
	};
}

// fallow-ignore-next-line complexity -- direction-aware absolute and conjunction rules are intentionally explicit.
function evaluateMetric(
	received: number,
	expected: number | null,
	policy: BudgetMetricPolicy,
): { regression: boolean; relativeDelta: number | null; reason: string | null } {
	const absoluteBreach =
		policy.absoluteLimit !== null &&
		(policy.direction === "higher-is-better"
			? received < policy.absoluteLimit
			: policy.direction === "lower-is-better" && received > policy.absoluteLimit);
	const degradation =
		expected === null
			? null
			: policy.direction === "lower-is-better"
				? received - expected
				: policy.direction === "higher-is-better"
					? expected - received
					: 0;
	const relativeDelta =
		expected === null || expected === 0 || degradation === null
			? null
			: degradation / Math.abs(expected);
	const thresholdBreach =
		degradation !== null &&
		relativeDelta !== null &&
		policy.relativeThreshold !== null &&
		policy.minimumAbsoluteDelta !== null &&
		relativeDelta > policy.relativeThreshold &&
		degradation > policy.minimumAbsoluteDelta;
	return {
		regression: absoluteBreach || thresholdBreach,
		relativeDelta,
		reason: absoluteBreach
			? "absolute policy limit breached"
			: thresholdBreach
				? "relative and minimum absolute degradation thresholds breached"
				: null,
	};
}

// fallow-ignore-next-line complexity -- the metric mapping is the single source of wire metric extraction.
function metricValue(record: RawMeasurementRecord, metric: PerformanceMetric): number | null {
	if (record.window.completion !== "completed" || record.window.failures.length > 0) return null;
	switch (metric) {
		case "frameCpuWorkP95Ms":
			return finitePercentile(record.window.frameCpuWorkSamples.values, 0.95);
		case "rawRafP95Ms":
			return finitePercentile(record.window.rawRafSamples.values, 0.95);
		case "simulationWallRatio":
			return validNumber(record.workload.rawWallSeconds) &&
				validNumber(record.workload.simulationSeconds) &&
				record.workload.rawWallSeconds > 0 &&
				record.workload.simulationSeconds >= 0
				? simulationWallTimeRatio(record.workload.simulationSeconds, record.workload.rawWallSeconds)
						.ratio
				: null;
		case "heapUsedDeltaBytes":
			return validNumber(record.window.cdp.heapUsedDeltaBytes)
				? record.window.cdp.heapUsedDeltaBytes
				: null;
		case "longTaskRate":
			return record.window.longTasks.count !== null && record.window.actualElapsedMs > 0
				? record.window.longTasks.count / (record.window.actualElapsedMs / 1000)
				: null;
	}
}

function medianMetric(
	records: readonly RawMeasurementRecord[],
	metric: PerformanceMetric,
): number | null {
	const values = records
		.map((record) => metricValue(record, metric))
		.filter((value): value is number => value !== null);
	return values.length === records.length && values.length > 0 ? median(values) : null;
}

function finitePercentile(values: readonly number[], percentile: number): number | null {
	return values.length > 0 && values.every(validNumber)
		? nearestRankPercentile(values, percentile)
		: null;
}

function isValidWorkload(record: RawMeasurementRecord): boolean {
	return (
		record.workload.validityStatus === "valid" &&
		record.workload.progressValid &&
		record.window.completion === "completed" &&
		record.window.failures.length === 0 &&
		record.window.rawRafSamples.values.length > 0 &&
		record.window.frameCpuWorkSamples.values.length > 0 &&
		!record.window.rawRafSamples.metadata.truncated &&
		!record.window.frameCpuWorkSamples.metadata.truncated
	);
}

function expectedCoverage(
	matrix: readonly { readonly scenarioId: string; readonly repetition: number }[],
): Map<string, number> {
	const result = new Map<string, number>();
	for (const entry of matrix)
		result.set(entry.scenarioId, Math.max(result.get(entry.scenarioId) ?? 0, entry.repetition + 1));
	return result;
}

function receivedCoverage(records: readonly RawMeasurementRecord[]): Record<string, number[]> {
	const result: Record<string, number[]> = {};
	for (const record of records) (result[record.scenarioId] ??= []).push(record.repetition);
	for (const repetitions of Object.values(result)) repetitions.sort((left, right) => left - right);
	return result;
}

function coverageIssuesFor(
	expected: ReadonlyMap<string, number>,
	coverage: Readonly<Record<string, readonly number[]>>,
	records: readonly RawMeasurementRecord[],
): string[] {
	const issues: string[] = [];
	for (const [scenarioId, repetitions] of expected) {
		const actual = coverage[scenarioId] ?? [];
		const required = Array.from({ length: repetitions }, (_, repetition) => repetition);
		if (
			actual.length !== required.length ||
			actual.some((value, index) => value !== required[index])
		)
			issues.push(`${scenarioId} requires exactly repetitions ${required.join(",")}`);
	}
	for (const scenarioId of Object.keys(coverage))
		if (!expected.has(scenarioId)) issues.push(`unexpected scenario ${scenarioId}`);
	if (records.some((record) => record.mode !== "clean"))
		issues.push("comparison requires clean measurements");
	return issues;
}

// fallow-ignore-next-line complexity -- compatibility and calibration checks must fail closed before aggregation.
function policyIssuesFor(
	policy: BudgetPolicy,
	expected: ReadonlyMap<string, number>,
	records: readonly RawMeasurementRecord[],
	workloadFingerprint: string,
	mode: "enforce" | "collect",
	baseline: BaselineComparison | null | undefined,
): string[] {
	const issues: string[] = [];
	const requiredScenarioIds = new Set(
		policy.scenarios.filter(({ required }) => required).map(({ scenarioId }) => scenarioId),
	);
	for (const scenarioId of expected.keys())
		if (!requiredScenarioIds.has(scenarioId))
			issues.push(`scenario ${scenarioId} has no required policy entry`);
	if (mode === "enforce" && !policy.calibrated)
		issues.push("enforcing comparison requires calibrated policy");
	if (policy.calibrated && policy.metrics.some((metric) => metric.required && !metric.calibrated))
		issues.push("calibrated policy has an uncalibrated required metric");
	if (baseline !== null && baseline !== undefined) {
		if (baseline.measurementMode !== "clean")
			issues.push("baseline must contain clean measurements");
		if (baseline.workloadFingerprint !== workloadFingerprint)
			issues.push("baseline workload fingerprint is incompatible");
		if (baseline.policyVersion !== policy.policyVersion)
			issues.push("baseline policy version is incompatible");
		if (baseline.workloadVersion !== policy.workloadVersion)
			issues.push("baseline workload version is incompatible");
		for (const [scenarioId] of expected) {
			const aggregate = baseline.aggregates[scenarioId];
			if (!aggregate) {
				issues.push(`baseline is missing scenario ${scenarioId}`);
				continue;
			}
			for (const metric of policy.metrics)
				if (metric.required && aggregate[metric.metric] === null)
					issues.push(`baseline is missing required metric ${scenarioId}.${metric.metric}`);
		}
		for (const record of records) {
			if (
				environmentCompatibilityKey(record.environment) !== baseline.environmentCompatibilityKey
			) {
				issues.push("baseline environment is incompatible");
				break;
			}
		}
	}
	return issues;
}

function environmentCompatibilityKey(environment: RawMeasurementRecord["environment"]): string {
	return "compatibilityKey" in environment
		? environment.compatibilityKey
		: JSON.stringify({
				nodeVersion: environment.nodeVersion,
				playwrightVersion: environment.playwrightVersion,
				chromiumVersion: environment.chromiumVersion,
				os: environment.os,
				architecture: environment.architecture,
				cpuIdentity: environment.cpuIdentity,
				runnerClass: environment.runnerClass,
				localMachineKey: environment.localMachineKey,
				renderer: environment.renderer,
				backend: environment.backend,
				gpuIdentity: environment.gpuIdentity,
				headless: environment.headless,
				viewportWidth: environment.viewportWidth,
				viewportHeight: environment.viewportHeight,
				devicePixelRatio: environment.devicePixelRatio,
				throttling: environment.throttling,
				audioPolicy: environment.audioPolicy,
			});
}

function invalidComparison(
	input: ComparisonInput,
	policy: BudgetPolicy,
	expected: ReadonlyMap<string, number>,
	coverage: Readonly<Record<string, readonly number[]>>,
	reasons: readonly string[],
): ComparisonRecord {
	return {
		schema: "comparison",
		schemaVersion: 1,
		mode: "clean",
		expectedScenarioIds: [...expected.keys()],
		expectedRepetitions: Object.fromEntries(expected),
		receivedCoverage: coverage,
		perRepetition: [],
		medianRepetitionAggregates: {},
		baselineProvenance: input.baseline?.provenance ?? null,
		policyProvenance: input.policyProvenance,
		workloadFingerprint: input.workloadFingerprint,
		metricStatuses: policy.metrics.map((metric) => ({
			metric: metric.metric,
			status: "invalid",
			direction: metric.direction,
			expected: null,
			received: null,
			delta: null,
			relativeDelta: null,
			reason: "comparison input is invalid",
		})),
		status: "infrastructure-failure",
		originalVerdict: "infrastructure-failure",
		reasons,
	};
}

function nullableNonNegative(value: unknown, path: string, issues: string[]): number | null {
	if (value === null) return null;
	if (!validNumber(value) || value < 0) {
		issues.push(`${path} must be null or a finite non-negative number`);
		return null;
	}
	return value;
}

// fallow-ignore-next-line code-duplication -- this narrow guard is repeated by independent JSON boundaries.
function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function validNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
	return typeof value === "string" && values.includes(value as T);
}

function isBudgetDirection(value: unknown): value is BudgetDirection {
	return isOneOf(value, ["higher-is-better", "lower-is-better", "informational"]);
}
