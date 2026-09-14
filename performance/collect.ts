import type {
	BoundedSampleMetadata,
	CapabilityStatus,
	CdpBoundaryObservation,
	FailureVariant,
	LongTaskObservation,
	MeasurementMode,
	NumericSamples,
	PhaseAggregate,
	WindowRecord,
} from "./contracts.ts";

const DEFAULT_MAXIMUM_SAMPLES = 10_000;
const DEFAULT_WATCHDOG_MS = 30_000;

export interface TimingEntry {
	readonly name: string;
	readonly entryType: string;
	readonly startTime: number;
	readonly duration: number;
	readonly detail: unknown;
}

export interface TimingSnapshot {
	readonly entries: readonly TimingEntry[];
	readonly droppedEntries: number;
	readonly supportedEntryTypes: readonly string[];
}

export interface TimingPage {
	evaluate<T, A>(pageFunction: (argument: A) => T, argument: A): Promise<T>;
}

export interface CdpSession {
	send(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface TimingCollectorOptions {
	readonly page: TimingPage;
	readonly cdp: CdpSession;
	readonly scenarioId: string;
	readonly repetition: number;
	readonly requestedDurationMs: number;
	readonly mode?: MeasurementMode;
	readonly maximumSamples?: number;
	readonly watchdogMs?: number;
}

class CollectionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CollectionError";
	}
}

export interface TimingCollector {
	readonly start: () => Promise<void>;
	readonly finish: (completion?: WindowRecord["completion"]) => Promise<WindowRecord>;
	readonly cancel: () => Promise<WindowRecord>;
}

interface CdpMetricValues {
	readonly taskDurationMs: number | null;
	readonly heapUsedBytes: number | null;
}

interface CollectorState {
	startedAtMs: number | null;
	startBoundary: CdpMetricValues | null;
}

export function createTimingCollector(options: TimingCollectorOptions): TimingCollector {
	const maximumSamples = options.maximumSamples ?? DEFAULT_MAXIMUM_SAMPLES;
	const watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS;
	if (!Number.isInteger(maximumSamples) || maximumSamples < 1)
		throw new CollectionError("maximumSamples must be a positive integer");
	if (!Number.isFinite(options.requestedDurationMs) || options.requestedDurationMs <= 0)
		throw new CollectionError("requestedDurationMs must be positive and finite");
	const state: CollectorState = { startedAtMs: null, startBoundary: null };

	return {
		start: async () => {
			if (state.startedAtMs !== null) throw new CollectionError("collector already started");
			await withWatchdog(
				(async () => {
					state.startedAtMs = await options.page.evaluate(markCollectorBoundary, "collector-start");
					await options.cdp.send("Performance.enable");
					state.startBoundary = await readCdpMetrics(options.cdp);
				})(),
				watchdogMs,
				() => new CollectionError("collector start timed out"),
			);
		},
		finish: (completion = "completed") =>
			finishCollection(options, state, completion, maximumSamples, watchdogMs),
		cancel: () => finishCollection(options, state, "cancelled", maximumSamples, watchdogMs),
	};
}

async function finishCollection(
	options: TimingCollectorOptions,
	state: CollectorState,
	completion: WindowRecord["completion"],
	maximumSamples: number,
	watchdogMs: number,
): Promise<WindowRecord> {
	if (state.startedAtMs === null || state.startBoundary === null) {
		throw new CollectionError("collector has not started");
	}
	return withWatchdog(
		(async () => {
			const snapshot = await options.page.evaluate(readTimingSnapshot, maximumSamples);
			const endBoundary = await readCdpMetrics(options.cdp);
			const record = buildWindowRecord(options, state, endBoundary, snapshot, completion);
			await options.page.evaluate(clearConsumedTimingEntries, undefined);
			return record;
		})(),
		watchdogMs,
		() => new CollectionError("collector finish timed out"),
	);
}

function readTimingSnapshot(maximumSamples: number): TimingSnapshot {
	const browserPerformance = (
		globalThis as unknown as {
			performance: {
				getEntries(): readonly {
					name: string;
					entryType: string;
					startTime: number;
					duration: number;
					detail: unknown;
				}[];
			};
		}
	).performance;
	const supportedEntryTypes =
		(
			globalThis as unknown as {
				PerformanceObserver?: { supportedEntryTypes?: readonly string[] };
			}
		).PerformanceObserver?.supportedEntryTypes ?? [];
	const entries = browserPerformance
		.getEntries()
		.filter(
			(entry) =>
				["benchmark-sample-start", "benchmark-sample-end", "benchmark-frame"].includes(
					entry.name,
				) || entry.entryType === "longtask",
		);
	const droppedEntries = Math.max(0, entries.length - maximumSamples);
	const boundedEntries = entries.slice(-maximumSamples).map((entry) => ({
		name: entry.name,
		entryType: entry.entryType,
		startTime: entry.startTime,
		duration: entry.duration,
		detail: entry.detail,
	}));
	return {
		entries: boundedEntries,
		droppedEntries,
		supportedEntryTypes,
	};
}

function markCollectorBoundary(name: string): number {
	const browserPerformance = (
		globalThis as unknown as {
			performance: { now(): number; mark(markName: string): void };
		}
	).performance;
	const now = browserPerformance.now();
	browserPerformance.mark(`performance-${name}`);
	return now;
}

function clearConsumedTimingEntries(): void {
	const browserPerformance = (
		globalThis as unknown as {
			performance: { clearMarks(name?: string): void };
		}
	).performance;
	for (const name of [
		"benchmark-sample-start",
		"benchmark-sample-end",
		"benchmark-frame",
		"performance-collector-start",
	]) {
		browserPerformance.clearMarks(name);
	}
}

export function withWatchdog<T>(
	operation: Promise<T>,
	timeoutMs: number,
	onTimeout: () => Error,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => reject(onTimeout()), timeoutMs);
		operation.then(
			(value) => {
				clearTimeout(timeout);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timeout);
				reject(error);
			},
		);
	});
}

// fallow-ignore-next-line complexity -- one boundary must preserve all raw failure and capability fields.
function buildWindowRecord(
	options: TimingCollectorOptions,
	state: CollectorState,
	endBoundary: CdpMetricValues,
	snapshot: TimingSnapshot,
	completion: WindowRecord["completion"],
): WindowRecord {
	const starts = snapshot.entries.filter((entry) => entry.name === "benchmark-sample-start");
	const ends = snapshot.entries.filter((entry) => entry.name === "benchmark-sample-end");
	const start = starts.at(-1)?.startTime ?? null;
	const end = ends.at(-1)?.startTime ?? null;
	const frameEntries = snapshot.entries.filter((entry) => entry.name === "benchmark-frame");
	const frames = frameEntries
		.map((entry) => asRuntimeFrame(entry.detail))
		.filter((frame): frame is RuntimeFrame => frame !== null);
	const failures: FailureVariant[] = [];
	if (start === null) failures.push(failure("missing sample start boundary", "boundaries"));
	if (end === null) failures.push(failure("missing sample end boundary", "boundaries"));
	if (frameEntries.length !== frames.length)
		failures.push(failure("runtime frame entries were malformed", "runtime-observation"));
	if (snapshot.droppedEntries > 0)
		failures.push(failure("timing entries exceeded the bounded collector buffer", "collection"));
	if (frames.length === 0)
		failures.push(failure("no runtime frame samples were collected", "collection"));
	const monotonicStartMs = start ?? state.startedAtMs ?? 0;
	const monotonicEndMs = end ?? monotonicStartMs;
	const actualElapsedMs = Math.max(0, monotonicEndMs - monotonicStartMs);
	const rawRafValues = frames.map(({ rawElapsedMs }) => rawElapsedMs);
	const callbackValues = frames.map(({ callbackWorkMs }) => callbackWorkMs);
	const cdp = cdpObservation(
		state.startBoundary ?? { taskDurationMs: null, heapUsedBytes: null },
		endBoundary,
	);
	return {
		schema: "window",
		schemaVersion: 1,
		scenarioId: options.scenarioId,
		repetition: options.repetition,
		mode: options.mode ?? "clean",
		monotonicStartMs,
		monotonicEndMs,
		actualElapsedMs,
		requestedDurationMs: options.requestedDurationMs,
		inputTiming: [],
		rawRafSamples: numericSamples(
			rawRafValues,
			options.maximumSamples ?? DEFAULT_MAXIMUM_SAMPLES,
			snapshot.droppedEntries,
			frameEntries.map(({ startTime }) => startTime),
		),
		frameCpuWorkSamples: numericSamples(
			callbackValues,
			options.maximumSamples ?? DEFAULT_MAXIMUM_SAMPLES,
			snapshot.droppedEntries,
			frameEntries.map(({ startTime }) => startTime),
		),
		phaseAggregates: phaseAggregates(frames, options.maximumSamples ?? DEFAULT_MAXIMUM_SAMPLES),
		longTasks: longTaskObservation(snapshot),
		cdp,
		capabilityStatuses: {
			longtask: longTaskObservation(snapshot).capability,
			"cdp-task-duration": capability(cdp.taskDurationDeltaMs !== null, "TaskDuration unavailable"),
			"cdp-heap": capability(cdp.heapUsedDeltaBytes !== null, "JSHeapUsedSize unavailable"),
		},
		completion,
		failures,
	};
}

interface RuntimeFrame {
	readonly rawElapsedMs: number;
	readonly callbackWorkMs: number;
	readonly phases: Readonly<Record<string, number>>;
}

function asRuntimeFrame(detail: unknown): RuntimeFrame | null {
	if (!isRecord(detail)) return null;
	const rawElapsedMs = detail.rawElapsedMs;
	const callbackWorkMs = detail.callbackWorkMs;
	const phases = detail.phases;
	if (!isFiniteNumber(rawElapsedMs) || !isFiniteNumber(callbackWorkMs) || !isRecord(phases))
		return null;
	const numericPhases: Record<string, number> = {};
	for (const [name, value] of Object.entries(phases)) {
		if (!isFiniteNumber(value)) return null;
		numericPhases[name] = value;
	}
	return { rawElapsedMs, callbackWorkMs, phases: numericPhases };
}

function phaseAggregates(
	frames: readonly RuntimeFrame[],
	maximumSamples: number,
): PhaseAggregate[] {
	const names = new Set(frames.flatMap((frame) => Object.keys(frame.phases)));
	return [...names].sort().map((name) => {
		const values = frames.map((frame) => frame.phases[name] ?? 0);
		return {
			name,
			samples: numericSamples(values, maximumSamples, 0),
			totalMs: values.reduce((sum, value) => sum + value, 0),
		};
	});
}

function numericSamples(
	values: readonly number[],
	maximumSamples: number,
	droppedSamples: number,
	timestamps: readonly number[] = [],
): NumericSamples {
	const metadata: BoundedSampleMetadata = {
		sampleCount: values.length,
		maximumSamples,
		truncated: droppedSamples > 0,
		droppedSamples,
		firstTimestampMs: timestamps[0] ?? null,
		lastTimestampMs: timestamps.at(-1) ?? null,
	};
	return { values, metadata };
}

function longTaskObservation(snapshot: TimingSnapshot): LongTaskObservation {
	const entries = snapshot.entries.filter((entry) => entry.entryType === "longtask");
	const supported = snapshot.supportedEntryTypes.includes("longtask");
	return {
		capability: capability(supported, "Long Task entries unavailable"),
		count: supported ? entries.length : null,
		durationMs: supported ? entries.reduce((sum, entry) => sum + entry.duration, 0) : null,
	};
}

function cdpObservation(start: CdpMetricValues, end: CdpMetricValues): CdpBoundaryObservation {
	const taskDurationDeltaMs =
		start.taskDurationMs !== null && end.taskDurationMs !== null
			? Math.max(0, end.taskDurationMs - start.taskDurationMs)
			: null;
	const heapUsedDeltaBytes =
		start.heapUsedBytes !== null && end.heapUsedBytes !== null
			? end.heapUsedBytes - start.heapUsedBytes
			: null;
	return {
		taskDurationMs: end.taskDurationMs,
		heapUsedBytes: end.heapUsedBytes,
		taskDurationDeltaMs,
		heapUsedDeltaBytes,
	};
}

async function readCdpMetrics(cdp: CdpSession): Promise<CdpMetricValues> {
	try {
		const response = await cdp.send("Performance.getMetrics");
		const metrics = isRecord(response) && Array.isArray(response.metrics) ? response.metrics : [];
		const taskDuration = metrics.find(({ name }) => name === "TaskDuration")?.value;
		const heapUsed = metrics.find(({ name }) => name === "JSHeapUsedSize")?.value;
		return {
			taskDurationMs: isFiniteNumber(taskDuration) ? taskDuration * 1000 : null,
			heapUsedBytes: isFiniteNumber(heapUsed) ? heapUsed : null,
		};
	} catch {
		return { taskDurationMs: null, heapUsedBytes: null };
	}
}

function capability(supported: boolean, reason: string): CapabilityStatus {
	return { supported, reason: supported ? null : reason };
}

function failure(message: string, phase: string): FailureVariant {
	return { kind: "missing-required-metric", phase, message, retryable: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}
