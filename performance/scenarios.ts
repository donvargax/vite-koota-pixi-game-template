import type {
	AudioPolicy,
	InputEventDeclaration,
	ScenarioCategory,
	ScenarioDefinition,
	ScenarioMembership,
	SchemaVersion,
	ValidityEnvelope,
} from "./contracts.ts";

const SCHEMA_VERSION: SchemaVersion = 1;
const MAX_FOES = 200;
const MAX_BOLTS = 1000;
const MAX_POPULATION_CEILING = 1500;
const MAX_DURATION_MS = 120_000;
const MAX_REPETITIONS = 10;
const SCENARIO_CATEGORIES: readonly ScenarioCategory[] = [
	"idle",
	"movement",
	"firing",
	"stress",
	"lifecycle",
	"self-test",
];
const AUDIO_POLICIES: readonly AudioPolicy[] = ["representative", "synthetic-counting", "disabled"];

export interface ScenarioManifest {
	readonly schema: "scenario-manifest";
	readonly schemaVersion: SchemaVersion;
	readonly workloadVersion: string;
	readonly scenarios: readonly ScenarioDefinition[];
}

export type ScenarioSelection = "fast" | "full" | readonly string[];

export interface ScenarioMatrixEntry {
	readonly scenarioId: string;
	readonly repetition: number;
}

class ScenarioConfigurationError extends Error {
	readonly issues: readonly string[];

	constructor(issues: readonly string[]) {
		super(`Invalid performance scenario configuration: ${issues.join("; ")}`);
		this.name = "ScenarioConfigurationError";
		this.issues = issues;
	}
}

export function validateScenarioManifest(input: unknown): ScenarioManifest {
	if (!isRecord(input)) return invalid(["manifest must be an object"]);
	const issues = manifestHeaderIssues(input);
	if (issues.length > 0) throw new ScenarioConfigurationError(issues);

	const scenarios: ScenarioDefinition[] = [];
	const ids = new Set<string>();
	const scenarioIssues = validateManifestScenarios(
		input.scenarios,
		input.workloadVersion,
		scenarios,
		ids,
	);
	const selectionIssues = manifestSelectionIssues(scenarios);
	if (scenarioIssues.length > 0 || selectionIssues.length > 0) {
		throw new ScenarioConfigurationError([...scenarioIssues, ...selectionIssues]);
	}
	return {
		schema: "scenario-manifest",
		schemaVersion: SCHEMA_VERSION,
		workloadVersion: input.workloadVersion,
		scenarios: Object.freeze(scenarios),
	};
}

export function getScenario(manifest: ScenarioManifest, id: string): ScenarioDefinition {
	const scenario = manifest.scenarios.find((candidate) => candidate.id === id);
	if (!scenario) throw new ScenarioConfigurationError([`unknown scenario selection ${id}`]);
	return scenario;
}

export function selectScenarios(
	manifest: ScenarioManifest,
	selection: ScenarioSelection = "fast",
): readonly ScenarioDefinition[] {
	if (selection === "fast" || selection === "full") {
		const selected = manifest.scenarios.filter((scenario) => scenario.membership[selection]);
		if (selected.length === 0)
			throw new ScenarioConfigurationError([`${selection} selection is empty`]);
		return selected;
	}
	if (selection.length === 0)
		throw new ScenarioConfigurationError(["scenario selection cannot be empty"]);
	const ids = new Set<string>();
	return selection.map((id) => {
		if (ids.has(id)) throw new ScenarioConfigurationError([`duplicate scenario selection ${id}`]);
		ids.add(id);
		return getScenario(manifest, id);
	});
}

export function expandScenarioMatrix(
	manifest: ScenarioManifest,
	selection: ScenarioSelection = "fast",
): readonly ScenarioMatrixEntry[] {
	return selectScenarios(manifest, selection).flatMap((scenario) =>
		Array.from({ length: scenario.repetitions }, (_, repetition) => ({
			scenarioId: scenario.id,
			repetition,
		})),
	);
}

export function workloadFingerprint(
	manifest: ScenarioManifest,
	selection: ScenarioSelection = "full",
): string {
	const selected = selectScenarios(manifest, selection).map((scenario) => ({
		...scenario,
		membership: {
			fast: scenario.membership.fast,
			full: scenario.membership.full,
			baseline: scenario.membership.baseline,
		},
	}));
	return fnv1a(
		canonicalize({
			workloadVersion: manifest.workloadVersion,
			selection,
			scenarios: selected,
		}),
	);
}

function canonicalize(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
	if (!isRecord(value)) return JSON.stringify(value);
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
		.join(",")}}`;
}

function validateScenario(input: unknown, path: string): ScenarioDefinition {
	if (!isRecord(input)) throw new ScenarioConfigurationError([`${path} must be an object`]);
	const issues = scenarioShapeIssues(input, path);
	if (issues.length > 0) throw new ScenarioConfigurationError(issues);

	const id = input.id as string;
	const targets = validateTargets(input.targets, path);
	const layout = validateLayout(input.layout, path);
	const sampleMs = input.sampleMs as number;
	const warmupMs = input.warmupMs as number;
	const schedule = validateInput(input.input, sampleMs, path);
	const membership = validateMembership(input.membership, input.category, path);
	const validity = validateValidity(input.validity, targets, sampleMs, warmupMs, path);
	return {
		schema: "scenario",
		schemaVersion: SCHEMA_VERSION,
		workloadVersion: input.workloadVersion,
		id,
		category: input.category,
		seed: input.seed,
		targets,
		layout,
		audio: input.audio,
		input: schedule,
		warmupMs,
		sampleMs,
		repetitions: input.repetitions,
		membership,
		validity,
	};
}

function manifestHeaderIssues(input: Record<string, unknown>): string[] {
	return issuesFromChecks([
		[input.schema !== "scenario-manifest", 'schema must be "scenario-manifest"'],
		[input.schemaVersion !== SCHEMA_VERSION, "schemaVersion must be 1"],
		[!isNonEmptyString(input.workloadVersion), "workloadVersion must be non-empty"],
		[!Array.isArray(input.scenarios), "scenarios must be an array"],
	]);
}

function validateManifestScenarios(
	values: readonly unknown[],
	workloadVersion: unknown,
	scenarios: ScenarioDefinition[],
	ids: Set<string>,
): string[] {
	const issues: string[] = [];
	for (const [index, value] of values.entries()) {
		try {
			const scenario = validateScenario(value, `scenarios[${index}]`);
			if (ids.has(scenario.id))
				throw new ScenarioConfigurationError([`duplicate scenario id ${scenario.id}`]);
			if (scenario.workloadVersion !== workloadVersion) {
				throw new ScenarioConfigurationError([
					`${scenario.id}.workloadVersion must match manifest workloadVersion`,
				]);
			}
			ids.add(scenario.id);
			scenarios.push(scenario);
		} catch (error) {
			if (error instanceof ScenarioConfigurationError) issues.push(...error.issues);
			else issues.push(`${index}: invalid scenario`);
		}
	}
	return issues;
}

function manifestSelectionIssues(scenarios: readonly ScenarioDefinition[]): string[] {
	return issuesFromChecks([
		[scenarios.length === 0, "scenarios must contain at least one scenario"],
		[!scenarios.some(({ membership }) => membership.fast), "fast selection is empty"],
		[!scenarios.some(({ membership }) => membership.full), "full selection is empty"],
	]);
}

function scenarioShapeIssues(input: Record<string, unknown>, path: string): string[] {
	return [
		...scenarioIdentityIssues(input, path),
		...scenarioReferenceIssues(input, path),
		...scenarioTimingIssues(input, path),
	];
}

function scenarioIdentityIssues(input: Record<string, unknown>, path: string): string[] {
	return issuesFromChecks([
		[
			!isNonEmptyString(input.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(input.id)),
			`${path}.id must be a kebab-case string`,
		],
		[input.schema !== "scenario", `${path}.schema must be "scenario"`],
		[input.schemaVersion !== SCHEMA_VERSION, `${path}.schemaVersion must be 1`],
		[!isNonEmptyString(input.workloadVersion), `${path}.workloadVersion must be non-empty`],
		[!isOneOf(input.category, SCENARIO_CATEGORIES), `${path}.category is unsupported`],
		[
			!isFiniteNumber(input.seed) || !Number.isInteger(input.seed),
			`${path}.seed must be an integer`,
		],
		[!isOneOf(input.audio, AUDIO_POLICIES), `${path}.audio is unsupported`],
	]);
}

function scenarioReferenceIssues(input: Record<string, unknown>, path: string): string[] {
	return issuesFromChecks([
		[!isRecord(input.targets), `${path}.targets is required`],
		[!isRecord(input.layout), `${path}.layout is required`],
		[!isRecord(input.input), `${path}.input is required`],
		[!isRecord(input.membership), `${path}.membership is required`],
		[!isRecord(input.validity), `${path}.validity is required`],
	]);
}

function scenarioTimingIssues(input: Record<string, unknown>, path: string): string[] {
	return issuesFromChecks([
		[
			!isPositiveInteger(input.warmupMs) || input.warmupMs > MAX_DURATION_MS,
			`${path}.warmupMs must be a positive bounded integer`,
		],
		[
			!isPositiveInteger(input.sampleMs) || input.sampleMs > MAX_DURATION_MS,
			`${path}.sampleMs must be a positive bounded integer`,
		],
		[
			!isPositiveInteger(input.repetitions) || input.repetitions > MAX_REPETITIONS,
			`${path}.repetitions must be between 1 and ${MAX_REPETITIONS}`,
		],
	]);
}

function validateTargets(
	input: Record<string, unknown>,
	path: string,
): ScenarioDefinition["targets"] {
	const issues: string[] = [];
	const foes = boundedInteger(input.foes, 0, MAX_FOES, `${path}.targets.foes`, issues);
	const bolts = boundedInteger(input.bolts, 0, MAX_BOLTS, `${path}.targets.bolts`, issues);
	const ratio = boundedNumber(
		input.upperLaneBoltRatio,
		0,
		1,
		`${path}.targets.upperLaneBoltRatio`,
		issues,
	);
	const life = positiveNumber(
		input.finiteBoltLifeSeconds,
		`${path}.targets.finiteBoltLifeSeconds`,
		issues,
	);
	const velocityMin = positiveNumber(
		input.boltVelocityMin,
		`${path}.targets.boltVelocityMin`,
		issues,
	);
	const velocityMax = positiveNumber(
		input.boltVelocityMax,
		`${path}.targets.boltVelocityMax`,
		issues,
	);
	const damage = positiveNumber(input.boltDamage, `${path}.targets.boltDamage`, issues);
	if (velocityMax < velocityMin) issues.push(`${path}.targets velocity max must be at least min`);
	if (issues.length > 0) throw new ScenarioConfigurationError(issues);
	return {
		foes,
		bolts,
		upperLaneBoltRatio: ratio,
		finiteBoltLifeSeconds: life,
		boltVelocityMin: velocityMin,
		boltVelocityMax: velocityMax,
		boltDamage: damage,
	};
}

function validateLayout(
	input: Record<string, unknown>,
	path: string,
): ScenarioDefinition["layout"] {
	const issues: string[] = [];
	const strings = ["version", "pattern"];
	for (const key of strings)
		if (!isNonEmptyString(input[key])) issues.push(`${path}.layout.${key} must be non-empty`);
	const worldMinX = finiteNumber(input.worldMinX, `${path}.layout.worldMinX`, issues);
	const worldMaxX = finiteNumber(input.worldMaxX, `${path}.layout.worldMaxX`, issues);
	const groundY = finiteNumber(input.groundY, `${path}.layout.groundY`, issues);
	const upperLaneBoltY = finiteNumber(
		input.boltUpperLaneY,
		`${path}.layout.boltUpperLaneY`,
		issues,
	);
	const groundLaneBoltY = finiteNumber(
		input.boltGroundLaneY,
		`${path}.layout.boltGroundLaneY`,
		issues,
	);
	if (worldMaxX <= worldMinX) issues.push(`${path}.layout world bounds must be increasing`);
	if (upperLaneBoltY <= groundY + 20)
		issues.push(`${path}.layout upper bolt lane must clear collision radius`);
	if (issues.length > 0) throw new ScenarioConfigurationError(issues);
	return {
		version: input.version as string,
		pattern: input.pattern as string,
		worldMinX,
		worldMaxX,
		groundY,
		boltUpperLaneY: upperLaneBoltY,
		boltGroundLaneY: groundLaneBoltY,
	};
}

function validateInput(
	input: Record<string, unknown>,
	sampleMs: number,
	path: string,
): ScenarioDefinition["input"] {
	const headerIssues = inputHeaderIssues(input, path);
	if (headerIssues.length > 0) throw new ScenarioConfigurationError(headerIssues);
	const latenessIssues: string[] = [];
	const maxLatenessMs = boundedNumber(
		input.maxLatenessMs,
		0,
		5000,
		`${path}.input.maxLatenessMs`,
		latenessIssues,
	);
	const eventResult = validateInputEvents(input.events as unknown[], sampleMs, path);
	const declaredHeldKeys = input.heldKeys as unknown[];
	const heldKeys = declaredHeldKeys.filter(isNonEmptyString);
	const heldKeyIssues =
		heldKeys.length === declaredHeldKeys.length && new Set(heldKeys).size === heldKeys.length
			? []
			: [`${path}.input.heldKeys must contain unique non-empty keys`];
	const issues = [...latenessIssues, ...eventResult.issues, ...heldKeyIssues];
	if (issues.length > 0) throw new ScenarioConfigurationError(issues);
	return { origin: "sample-start", events: eventResult.events, maxLatenessMs, heldKeys };
}

function inputHeaderIssues(input: Record<string, unknown>, path: string): string[] {
	return issuesFromChecks([
		[input.origin !== "sample-start", `${path}.input.origin must be "sample-start"`],
		[!Array.isArray(input.events), `${path}.input.events must be an array`],
		[!Array.isArray(input.heldKeys), `${path}.input.heldKeys must be an array`],
	]);
}

function validateInputEvents(
	declaredEvents: readonly unknown[],
	sampleMs: number,
	path: string,
): { events: InputEventDeclaration[]; issues: string[] } {
	const events: InputEventDeclaration[] = [];
	const issues: string[] = [];
	const keys = new Set<string>();
	let previousAtMs = -1;
	for (const [index, value] of declaredEvents.entries()) {
		const result = validateInputEvent(value, index, sampleMs, path, previousAtMs);
		issues.push(...result.issues);
		if (result.atMs !== null) previousAtMs = result.atMs;
		if (result.event) {
			const eventKey = `${result.event.key}:${result.event.kind}`;
			if (keys.has(eventKey)) issues.push(`${path}.input.events duplicates ${eventKey}`);
			keys.add(eventKey);
			events.push(result.event);
		}
	}
	return { events, issues };
}

function validateInputEvent(
	value: unknown,
	index: number,
	sampleMs: number,
	path: string,
	previousAtMs: number,
): { event: InputEventDeclaration | null; atMs: number | null; issues: string[] } {
	if (!isRecord(value))
		return {
			event: null,
			atMs: null,
			issues: [`${path}.input.events[${index}] must be an object`],
		};
	const atMs = value.atMs;
	const kind = value.kind;
	const key = value.key;
	const validAtMs = isNonNegativeInteger(atMs) && atMs < sampleMs;
	const validKind = isOneOf(kind, ["keydown", "keyup"] as const);
	const validKey = isNonEmptyString(key);
	const issues = issuesFromChecks([
		[!validAtMs, `${path}.input.events[${index}].atMs must be before sample end`],
		[!validKind, `${path}.input.events[${index}].kind is unsupported`],
		[!validKey, `${path}.input.events[${index}].key must be non-empty`],
		[validAtMs && atMs < previousAtMs, `${path}.input.events must be ordered by atMs`],
	]);
	return {
		event: validAtMs && validKind && validKey ? { atMs, kind, key } : null,
		atMs: isNonNegativeInteger(atMs) ? atMs : null,
		issues,
	};
}

function validateMembership(
	input: Record<string, unknown>,
	category: unknown,
	path: string,
): ScenarioMembership {
	const typeIssues = issuesFromChecks(
		(["fast", "full", "baseline"] as const).map(
			(key) =>
				[typeof input[key] !== "boolean", `${path}.membership.${key} must be boolean`] as const,
		),
	);
	if (typeIssues.length > 0) throw new ScenarioConfigurationError(typeIssues);
	const membership = {
		fast: input.fast,
		full: input.full,
		baseline: input.baseline,
	} as ScenarioMembership;
	const issues = membershipConsistencyIssues(membership, category, path);
	if (issues.length > 0) throw new ScenarioConfigurationError(issues);
	return membership;
}

function membershipConsistencyIssues(
	membership: ScenarioMembership,
	category: unknown,
	path: string,
): string[] {
	return issuesFromChecks([
		[
			category === "self-test" && (membership.fast || membership.full || membership.baseline),
			`${path}.self-test cannot be a fast, full, or baseline scenario`,
		],
		[
			category !== "self-test" && !membership.fast && !membership.full,
			`${path} must belong to fast or full`,
		],
		[membership.baseline && !membership.full, `${path}.baseline requires full membership`],
	]);
}

function validateValidity(
	input: Record<string, unknown>,
	targets: ScenarioDefinition["targets"],
	sampleMs: number,
	warmupMs: number,
	path: string,
): ValidityEnvelope {
	const issues: string[] = [];
	const names = [
		"beforeSimulationFoes",
		"afterSimulationFoes",
		"afterMaintenanceFoes",
		"beforeSimulationBolts",
		"afterSimulationBolts",
		"afterMaintenanceBolts",
		"projectedVisibleBoltsMinimum",
		"hardPopulationCeiling",
	] as const;
	const values = Object.fromEntries(
		names.map((name) => [
			name,
			boundedInteger(input[name], 0, MAX_POPULATION_CEILING, `${path}.validity.${name}`, issues),
		]),
	) as Record<(typeof names)[number], number>;
	const minimumSimulationSeconds = positiveNumber(
		input.minimumSimulationSeconds,
		`${path}.validity.minimumSimulationSeconds`,
		issues,
	);
	const minimumWallSeconds = positiveNumber(
		input.minimumWallSeconds,
		`${path}.validity.minimumWallSeconds`,
		issues,
	);
	const minimumSuccessfulRenderCount = positiveInteger(
		input.minimumSuccessfulRenderCount,
		`${path}.validity.minimumSuccessfulRenderCount`,
		issues,
	);
	issues.push(
		...validityConsistencyIssues(
			values,
			targets,
			minimumSimulationSeconds,
			minimumWallSeconds,
			sampleMs,
			warmupMs,
			path,
		),
	);
	if (issues.length > 0) throw new ScenarioConfigurationError(issues);
	return {
		...values,
		minimumSimulationSeconds,
		minimumWallSeconds,
		minimumSuccessfulRenderCount,
	};
}

function validityConsistencyIssues(
	values: Record<string, number>,
	targets: ScenarioDefinition["targets"],
	minimumSimulationSeconds: number,
	minimumWallSeconds: number,
	sampleMs: number,
	warmupMs: number,
	path: string,
): string[] {
	return issuesFromChecks([
		[
			values.beforeSimulationFoes !== targets.foes || values.afterMaintenanceFoes !== targets.foes,
			`${path}.validity foe targets must match targets.foes`,
		],
		[
			values.beforeSimulationBolts !== targets.bolts ||
				values.afterMaintenanceBolts !== targets.bolts,
			`${path}.validity bolt targets must match targets.bolts`,
		],
		[
			values.afterSimulationFoes > values.beforeSimulationFoes ||
				values.afterSimulationBolts > values.beforeSimulationBolts,
			`${path}.validity afterSimulation counts cannot exceed beforeSimulation counts`,
		],
		[
			values.projectedVisibleBoltsMinimum > targets.bolts,
			`${path}.validity projected visibility cannot exceed bolt target`,
		],
		[
			values.hardPopulationCeiling < targets.foes + targets.bolts,
			`${path}.validity hard ceiling is below target population`,
		],
		[
			minimumSimulationSeconds > sampleMs / 1000,
			`${path}.validity minimum simulation time exceeds sample window`,
		],
		[
			minimumWallSeconds > (sampleMs + warmupMs) / 1000,
			`${path}.validity minimum wall time exceeds declared window`,
		],
	]);
}

function invalid(issues: readonly string[]): never {
	throw new ScenarioConfigurationError(issues);
}

function issuesFromChecks(checks: readonly (readonly [boolean, string])[]): string[] {
	return checks.filter(([invalidCheck]) => invalidCheck).map(([, message]) => message);
}

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

function boundedInteger(
	value: unknown,
	min: number,
	max: number,
	label: string,
	issues: string[],
): number {
	if (!isNonNegativeInteger(value) || value < min || value > max)
		issues.push(`${label} must be an integer from ${min} through ${max}`);
	return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

function boundedNumber(
	value: unknown,
	min: number,
	max: number,
	label: string,
	issues: string[],
): number {
	if (!isFiniteNumber(value) || value < min || value > max)
		issues.push(`${label} must be finite and from ${min} through ${max}`);
	return isFiniteNumber(value) ? value : 0;
}

function finiteNumber(value: unknown, label: string, issues: string[]): number {
	if (!isFiniteNumber(value)) issues.push(`${label} must be finite`);
	return isFiniteNumber(value) ? value : 0;
}

function positiveNumber(value: unknown, label: string, issues: string[]): number {
	if (!isFiniteNumber(value) || value <= 0) issues.push(`${label} must be finite and positive`);
	return isFiniteNumber(value) ? value : 0;
}

function positiveInteger(value: unknown, label: string, issues: string[]): number {
	if (!isPositiveInteger(value)) issues.push(`${label} must be a positive integer`);
	return isPositiveInteger(value) ? value : 1;
}

function fnv1a(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}
