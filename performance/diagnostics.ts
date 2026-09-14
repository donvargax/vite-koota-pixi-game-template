import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import type { MeasurementMode } from "./contracts.ts";

const DIAGNOSTIC_DEFAULTS = {
	evidenceWindowMs: 5_000,
	drainTimeoutMs: 30_000,
	maxTraceBytes: 100 * 1024 * 1024,
	maxEvidenceBytes: 500 * 1024 * 1024,
} as const;

type CdpEventListener = (params: unknown) => void;

export interface DiagnosticCdpSession {
	send(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown>;
	on?(event: string, listener: CdpEventListener): void;
	off?(event: string, listener: CdpEventListener): void;
}

export interface DiagnosticArtifactSink {
	write(chunk: Uint8Array): Promise<void>;
	close(): Promise<void>;
}

export type ArtifactKind = "cpu-profile" | "trace" | "allocation";

export interface DiagnosticArtifactResult {
	readonly kind: ArtifactKind;
	readonly path: string | null;
	readonly bytes: number;
	readonly status: "complete" | "failed" | "truncated";
	readonly validJson: boolean;
	readonly errors: readonly string[];
}

export interface DiagnosticResult {
	readonly mode: MeasurementMode;
	readonly status: "complete" | "unsupported" | "failed" | "truncated";
	readonly scope: string;
	readonly availableCategories: readonly string[];
	readonly selectedCategories: readonly string[];
	readonly missingCapabilities: readonly string[];
	readonly artifacts: readonly DiagnosticArtifactResult[];
	readonly errors: readonly string[];
}

export interface EvidenceBudget {
	readonly maximumBytes: number;
	readonly usedBytes: number;
	reserve(bytes: number): boolean;
}

export function createEvidenceBudget(
	maximumBytes = DIAGNOSTIC_DEFAULTS.maxEvidenceBytes,
): EvidenceBudget {
	if (!Number.isInteger(maximumBytes) || maximumBytes < 1)
		throw new Error("maximumBytes must be a positive integer");
	let usedBytes = 0;
	return {
		maximumBytes,
		get usedBytes() {
			return usedBytes;
		},
		reserve: (bytes) => {
			if (!Number.isInteger(bytes) || bytes < 0 || usedBytes + bytes > maximumBytes) return false;
			usedBytes += bytes;
			return true;
		},
	};
}

export interface DiagnosticCollectorOptions {
	readonly session: DiagnosticCdpSession;
	readonly cpuProfilePath?: string;
	readonly tracePath?: string;
	readonly allocationPath?: string;
	readonly createSink?: (kind: ArtifactKind, path: string) => Promise<DiagnosticArtifactSink>;
	readonly evidenceBudget?: EvidenceBudget;
	readonly evidenceWindowMs?: number;
	readonly drainTimeoutMs?: number;
	readonly maxTraceBytes?: number;
}

export interface DiagnosticCollector {
	readonly start: () => Promise<void>;
	readonly stop: () => Promise<DiagnosticResult>;
	readonly run: () => Promise<DiagnosticResult>;
}

export interface AllocationCollector {
	readonly start: () => Promise<void>;
	readonly stop: () => Promise<DiagnosticResult>;
	readonly run: () => Promise<DiagnosticResult>;
}

const DEFAULT_CATEGORIES = [
	"devtools.timeline",
	"disabled-by-default-devtools.timeline",
	"disabled-by-default-devtools.timeline.frame",
	"blink.user_timing",
	"v8",
	"toplevel",
] as const;

const sessionModes = new WeakMap<object, MeasurementMode>();

export function createCpuTraceCollector(options: DiagnosticCollectorOptions): DiagnosticCollector {
	const state: CollectorState = {
		started: false,
		stopped: false,
		cpuStarted: false,
		cpuEnabled: false,
		traceStarted: false,
		availableCategories: [],
		selectedCategories: [],
		missingCapabilities: [],
		traceStream: null,
		traceListener: null,
		detachedListener: null,
		detached: false,
	};
	return createCollector(options, state, "cpu-trace");
}

export function createAllocationCollector(
	options: DiagnosticCollectorOptions,
): AllocationCollector {
	const state: CollectorState = {
		started: false,
		stopped: false,
		cpuStarted: false,
		cpuEnabled: false,
		traceStarted: false,
		availableCategories: [],
		selectedCategories: [],
		missingCapabilities: [],
		traceStream: null,
		traceListener: null,
		detachedListener: null,
		detached: false,
	};
	return createCollector(options, state, "allocation");
}

interface CollectorState {
	started: boolean;
	stopped: boolean;
	cpuStarted: boolean;
	cpuEnabled: boolean;
	traceStarted: boolean;
	availableCategories: string[];
	selectedCategories: string[];
	missingCapabilities: string[];
	traceStream: string | null;
	traceListener: CdpEventListener | null;
	detachedListener: CdpEventListener | null;
	detached: boolean;
}

function createCollector(
	options: DiagnosticCollectorOptions,
	state: CollectorState,
	mode: MeasurementMode,
): DiagnosticCollector {
	const start = async (): Promise<void> => {
		if (state.started) throw new Error("diagnostic collector already started");
		if (sessionModes.has(options.session as object))
			throw new Error("another diagnostic collector is active on this CDP session");
		if (mode === "cpu-trace" && !options.cpuProfilePath && !options.tracePath)
			throw new Error("CPU-trace collector requires a CPU profile or trace path");
		validateOptions(options);
		state.started = true;
		sessionModes.set(options.session as object, mode);
		if (options.session.on) {
			const detached = (): void => {
				state.detached = true;
			};
			options.session.on("Target.detachedFromTarget", detached);
			state.detachedListener = detached;
		}
		try {
			if (mode === "cpu-trace") await startCpuTrace(options, state);
			else await sendRequired(options.session, "HeapProfiler.startSampling", undefined);
		} catch (error) {
			const cleanupErrors = await cleanupStarted(options, state, mode);
			sessionModes.delete(options.session as object);
			throw aggregateError(error, cleanupErrors);
		}
	};

	// fallow-ignore-next-line complexity -- stop must preserve every artifact and cleanup failure independently.
	const stop = async (): Promise<DiagnosticResult> => {
		if (!state.started) throw new Error("diagnostic collector has not started");
		if (state.stopped) throw new Error("diagnostic collector has already stopped");
		state.stopped = true;
		const errors: string[] = [];
		const artifacts: DiagnosticArtifactResult[] = [];
		try {
			if (mode === "cpu-trace") {
				try {
					const cpu = await stopCpuProfile(options, state, errors);
					if (cpu) artifacts.push(cpu);
				} catch (error) {
					errors.push(`CPU profile collection failed: ${errorMessage(error)}`);
					if (options.cpuProfilePath)
						artifacts.push(artifactFailure("cpu-profile", options.cpuProfilePath, errors));
				}
				try {
					const trace = await stopTrace(options, state, errors);
					if (trace) artifacts.push(trace);
				} catch (error) {
					errors.push(`trace collection failed: ${errorMessage(error)}`);
					if (options.tracePath)
						artifacts.push(artifactFailure("trace", options.tracePath, errors));
				}
			} else {
				try {
					const allocation = await stopAllocation(options, errors);
					if (allocation) artifacts.push(allocation);
				} catch (error) {
					errors.push(`allocation collection failed: ${errorMessage(error)}`);
					if (options.allocationPath)
						artifacts.push(artifactFailure("allocation", options.allocationPath, errors));
				}
			}
		} finally {
			if (state.detachedListener && options.session.off)
				options.session.off("Target.detachedFromTarget", state.detachedListener);
			if (state.traceListener && options.session.off)
				options.session.off("Tracing.tracingComplete", state.traceListener);
			sessionModes.delete(options.session as object);
		}
		if (state.detached) errors.push("CDP session detached during diagnostic collection");
		const status = resultStatus(state, artifacts, errors);
		return {
			mode,
			status,
			scope: mode === "cpu-trace" ? "page CDP session" : "page HeapProfiler session",
			availableCategories: state.availableCategories,
			selectedCategories: state.selectedCategories,
			missingCapabilities: state.missingCapabilities,
			artifacts,
			errors,
		};
	};

	return {
		start,
		stop,
		run: async () => {
			await start();
			await delay(options.evidenceWindowMs ?? DIAGNOSTIC_DEFAULTS.evidenceWindowMs);
			return stop();
		},
	};
}

async function startCpuTrace(
	options: DiagnosticCollectorOptions,
	state: CollectorState,
): Promise<void> {
	if (options.session.send === undefined) throw new Error("CDP command transport is unavailable");
	const categories = await discoverCategories(options.session, state);
	if (options.cpuProfilePath) {
		await sendRequired(options.session, "Profiler.enable", undefined);
		state.cpuEnabled = true;
		await sendRequired(options.session, "Profiler.setSamplingInterval", { interval: 1000 });
		await sendRequired(options.session, "Profiler.start", undefined);
		state.cpuStarted = true;
	}
	if (options.tracePath) {
		const traceListener: CdpEventListener = (params) => {
			if (isRecord(params) && typeof params.stream === "string") state.traceStream = params.stream;
		};
		if (!options.session.on)
			throw new UnsupportedDiagnosticError("CDP event transport is unavailable");
		state.traceListener = traceListener;
		options.session.on("Tracing.tracingComplete", traceListener);
		await sendRequired(options.session, "Tracing.start", {
			categories: categories.selected.join(","),
			transferMode: "ReturnAsStream",
		});
		state.traceStarted = true;
	}
}

async function discoverCategories(
	session: DiagnosticCdpSession,
	state: CollectorState,
): Promise<{ selected: string[] }> {
	try {
		const response = await session.send("Tracing.getCategories");
		const available =
			isRecord(response) && Array.isArray(response.categories)
				? response.categories.filter((category): category is string => typeof category === "string")
				: [];
		state.availableCategories = available;
		state.selectedCategories = DEFAULT_CATEGORIES.filter((category) =>
			available.includes(category),
		);
		state.missingCapabilities = DEFAULT_CATEGORIES.filter(
			(category) => !available.includes(category),
		).map((category) => `trace category unavailable: ${category}`);
		if (state.selectedCategories.length === 0)
			throw new UnsupportedDiagnosticError("Chromium exposed no requested trace categories");
		return { selected: state.selectedCategories };
	} catch (error) {
		if (error instanceof UnsupportedDiagnosticError) throw error;
		state.missingCapabilities.push("Tracing.getCategories unavailable");
		state.availableCategories = [];
		state.selectedCategories = [...DEFAULT_CATEGORIES];
		return { selected: state.selectedCategories };
	}
}

async function stopCpuProfile(
	options: DiagnosticCollectorOptions,
	state: CollectorState,
	errors: string[],
): Promise<DiagnosticArtifactResult | null> {
	if (!state.cpuStarted || !options.cpuProfilePath) return null;
	let profile: unknown;
	try {
		const response = await options.session.send("Profiler.stop");
		profile = isRecord(response) && "profile" in response ? response.profile : response;
	} catch (error) {
		errors.push(`Profiler.stop failed: ${errorMessage(error)}`);
	} finally {
		try {
			await options.session.send("Profiler.disable");
		} catch (error) {
			errors.push(`Profiler.disable failed: ${errorMessage(error)}`);
		}
	}
	if (profile === undefined) return artifactFailure("cpu-profile", options.cpuProfilePath, errors);
	return writeJsonArtifact("cpu-profile", options.cpuProfilePath, profile, options, errors);
}

async function stopTrace(
	options: DiagnosticCollectorOptions,
	state: CollectorState,
	errors: string[],
): Promise<DiagnosticArtifactResult | null> {
	if (!state.traceStarted || !options.tracePath) return null;
	let traceError: string | null = null;
	try {
		await options.session.send("Tracing.end");
		if (!state.traceStream)
			await waitForTraceStream(options.session, state, options.drainTimeoutMs);
		if (!state.traceStream) throw new Error("Tracing.tracingComplete did not provide a stream");
		return await drainTrace(options, state, errors);
	} catch (error) {
		traceError = errorMessage(error);
		errors.push(`trace collection failed: ${traceError}`);
		return artifactFailure("trace", options.tracePath, errors);
	} finally {
		if (state.traceStream) {
			try {
				await options.session.send("IO.close", { handle: state.traceStream });
			} catch (error) {
				errors.push(`trace stream close failed: ${errorMessage(error)}`);
			}
		}
	}
}

async function waitForTraceStream(
	session: DiagnosticCdpSession,
	state: CollectorState,
	timeoutMs: number = DIAGNOSTIC_DEFAULTS.drainTimeoutMs,
): Promise<void> {
	if (!session.on || state.traceStream) return;
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			session.off?.("Tracing.tracingComplete", onComplete);
			reject(new Error("Tracing.tracingComplete timed out"));
		}, timeoutMs);
		const onComplete: CdpEventListener = (params) => {
			if (isRecord(params) && typeof params.stream === "string") state.traceStream = params.stream;
			clearTimeout(timer);
			session.off?.("Tracing.tracingComplete", onComplete);
			resolve();
		};
		session.on?.call(session, "Tracing.tracingComplete", onComplete);
	});
}

// fallow-ignore-next-line complexity -- bounded stream draining keeps truncation and cleanup status explicit.
async function drainTrace(
	options: DiagnosticCollectorOptions,
	state: CollectorState,
	errors: string[],
): Promise<DiagnosticArtifactResult> {
	const path = options.tracePath!;
	const sink = await createSink(options, "trace", path);
	const budget = options.evidenceBudget ?? createEvidenceBudget();
	const maximumBytes = options.maxTraceBytes ?? DIAGNOSTIC_DEFAULTS.maxTraceBytes;
	let bytes = 0;
	let truncated = false;
	let json = "";
	try {
		for (;;) {
			const response = await options.session.send("IO.read", { handle: state.traceStream });
			const data = isRecord(response) && typeof response.data === "string" ? response.data : "";
			const chunk =
				isRecord(response) && response.base64Encoded === true
					? Uint8Array.from(Buffer.from(data, "base64"))
					: new TextEncoder().encode(data);
			if (bytes + chunk.byteLength > maximumBytes || !budget.reserve(chunk.byteLength)) {
				truncated = true;
			} else {
				await sink.write(chunk);
				bytes += chunk.byteLength;
				json += new TextDecoder().decode(chunk);
			}
			const eof = isRecord(response) && response.eof === true;
			if (eof) break;
		}
	} catch (error) {
		errors.push(`trace stream read failed: ${errorMessage(error)}`);
		truncated = true;
	} finally {
		try {
			await sink.close();
		} catch (error) {
			errors.push(`trace artifact close failed: ${errorMessage(error)}`);
		}
	}
	if (truncated) return artifactResult("trace", path, bytes, "truncated", false, errors);
	let validJson = false;
	try {
		JSON.parse(json);
		validJson = true;
	} catch (error) {
		errors.push(`trace artifact is not complete JSON: ${errorMessage(error)}`);
	}
	return artifactResult("trace", path, bytes, validJson ? "complete" : "failed", validJson, errors);
}

async function stopAllocation(
	options: DiagnosticCollectorOptions,
	errors: string[],
): Promise<DiagnosticArtifactResult | null> {
	if (!options.allocationPath) return null;
	let profile: unknown;
	try {
		const response = await options.session.send("HeapProfiler.stopSampling");
		profile = isRecord(response) && "profile" in response ? response.profile : response;
	} catch (error) {
		errors.push(`HeapProfiler.stopSampling failed: ${errorMessage(error)}`);
	}
	if (profile === undefined) return artifactFailure("allocation", options.allocationPath, errors);
	return writeJsonArtifact("allocation", options.allocationPath, profile, options, errors);
}

// fallow-ignore-next-line complexity -- startup cleanup must attempt every partially-created CDP resource.
async function cleanupStarted(
	options: DiagnosticCollectorOptions,
	state: CollectorState,
	mode: MeasurementMode,
): Promise<readonly Error[]> {
	const errors: Error[] = [];
	if (mode === "cpu-trace" && state.traceStarted)
		await attempt(() => options.session.send("Tracing.end"), errors);
	if (mode === "cpu-trace" && state.cpuStarted)
		await attempt(() => options.session.send("Profiler.stop"), errors);
	if (mode === "cpu-trace" && state.cpuEnabled)
		await attempt(() => options.session.send("Profiler.disable"), errors);
	if (mode === "allocation")
		await attempt(() => options.session.send("HeapProfiler.stopSampling"), errors);
	if (state.traceStream)
		await attempt(() => options.session.send("IO.close", { handle: state.traceStream }), errors);
	if (state.traceListener && options.session.off)
		options.session.off("Tracing.tracingComplete", state.traceListener);
	if (state.detachedListener && options.session.off)
		options.session.off("Target.detachedFromTarget", state.detachedListener);
	return errors;
}

async function writeJsonArtifact(
	kind: ArtifactKind,
	path: string,
	value: unknown,
	options: DiagnosticCollectorOptions,
	errors: string[],
): Promise<DiagnosticArtifactResult> {
	const bytes = new TextEncoder().encode(`${JSON.stringify(value)}\n`);
	const budget = options.evidenceBudget ?? createEvidenceBudget();
	if (!budget.reserve(bytes.byteLength)) {
		errors.push(`${kind} artifact exceeded the total evidence limit`);
		return artifactFailure(kind, path, errors, "truncated");
	}
	const sink = await createSink(options, kind, path);
	try {
		await sink.write(bytes);
		await sink.close();
		return artifactResult(kind, path, bytes.byteLength, "complete", true, errors);
	} catch (error) {
		errors.push(`${kind} artifact write failed: ${errorMessage(error)}`);
		try {
			await sink.close();
		} catch (closeError) {
			errors.push(`${kind} artifact close failed: ${errorMessage(closeError)}`);
		}
		return artifactFailure(kind, path, errors);
	}
}

async function createSink(
	options: DiagnosticCollectorOptions,
	kind: ArtifactKind,
	path: string,
): Promise<DiagnosticArtifactSink> {
	if (options.createSink) return options.createSink(kind, path);
	return createFileArtifactSink(path);
}

function validateOptions(options: DiagnosticCollectorOptions): void {
	for (const [name, value] of [
		["evidenceWindowMs", options.evidenceWindowMs],
		["drainTimeoutMs", options.drainTimeoutMs],
		["maxTraceBytes", options.maxTraceBytes],
	] as const)
		if (value !== undefined && (!Number.isInteger(value) || value < 1))
			throw new Error(`${name} must be a positive integer`);
}

async function createFileArtifactSink(path: string): Promise<DiagnosticArtifactSink> {
	await mkdir(dirname(path), { recursive: true });
	const handle = await open(path, "w");
	return {
		write: async (chunk) => {
			await handle.write(chunk);
		},
		close: async () => {
			await handle.close();
		},
	};
}

async function sendRequired(
	session: DiagnosticCdpSession,
	method: string,
	params?: Readonly<Record<string, unknown>>,
): Promise<unknown> {
	try {
		return await session.send(method, params);
	} catch (error) {
		throw new Error(`${method} failed: ${errorMessage(error)}`);
	}
}

async function attempt(operation: () => Promise<unknown>, errors: Error[]): Promise<void> {
	try {
		await operation();
	} catch (error) {
		errors.push(asError(error));
	}
}

function resultStatus(
	state: CollectorState,
	artifacts: readonly DiagnosticArtifactResult[],
	errors: readonly string[],
): DiagnosticResult["status"] {
	if (artifacts.some((artifact) => artifact.status === "truncated")) return "truncated";
	if (errors.length > 0 || artifacts.some((artifact) => artifact.status === "failed"))
		return "failed";
	if (state.missingCapabilities.length > 0 && state.selectedCategories.length === 0)
		return "unsupported";
	return "complete";
}

function artifactFailure(
	kind: ArtifactKind,
	path: string,
	errors: readonly string[],
	status: "failed" | "truncated" = "failed",
): DiagnosticArtifactResult {
	return artifactResult(kind, path, 0, status, false, errors);
}

function artifactResult(
	kind: ArtifactKind,
	path: string,
	bytes: number,
	status: DiagnosticArtifactResult["status"],
	validJson: boolean,
	errors: readonly string[],
): DiagnosticArtifactResult {
	return { kind, path, bytes, status, validJson, errors: [...errors] };
}

function aggregateError(primary: unknown, cleanupErrors: readonly Error[]): Error {
	if (cleanupErrors.length === 0) return asError(primary);
	return new AggregateError(
		[asError(primary), ...cleanupErrors],
		"diagnostic startup cleanup failed",
	);
}

function delay(milliseconds: number): Promise<void> {
	if (!Number.isFinite(milliseconds) || milliseconds < 0)
		return Promise.reject(new Error("evidenceWindowMs must be non-negative"));
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(error: unknown): string {
	return asError(error).message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

class UnsupportedDiagnosticError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnsupportedDiagnosticError";
	}
}
