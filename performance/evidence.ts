import { readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import type { MappedCpuSample, ObservedEventSummary } from "./contracts.ts";

const EVIDENCE_DEFAULT_MAX_INPUT_BYTES = 100 * 1024 * 1024;
const EVIDENCE_DEFAULT_MAX_SAMPLES = 1_000_000;
const EVIDENCE_DEFAULT_MAX_EVENTS = 1_000_000;

export interface CpuProfileNode {
	readonly id: number;
	readonly callFrame: {
		readonly functionName?: string;
		readonly url?: string;
		readonly lineNumber?: number;
		readonly columnNumber?: number;
	};
	readonly children?: readonly number[];
}

export interface CpuProfileInput {
	readonly nodes: readonly CpuProfileNode[];
	readonly samples: readonly number[];
	readonly timeDeltas?: readonly number[];
	readonly duration?: number;
}

export interface SourceMapArtifact {
	readonly generatedFile: string;
	readonly map: unknown;
}

export interface TraceEventInput {
	readonly name?: string;
	readonly cat?: string;
	readonly ph?: string;
	readonly ts?: number;
	readonly dur?: number;
	readonly pid?: number;
	readonly tid?: number;
}

export interface TraceInput {
	readonly traceEvents: readonly TraceEventInput[];
}

export interface EvidenceParseOptions {
	readonly sourceMaps?: readonly SourceMapArtifact[];
	readonly maximumInputBytes?: number;
	readonly maximumSamples?: number;
	readonly maximumEvents?: number;
	readonly truncated?: boolean;
}

export interface EvidenceSummary {
	readonly mappedCpuSummary: readonly MappedCpuSample[];
	readonly observedEvents: readonly ObservedEventSummary[];
	readonly supportedCapabilities: readonly string[];
	readonly missingCapabilities: readonly string[];
	readonly errors: readonly string[];
	readonly truncation: string | null;
	readonly sampleCount: number;
	readonly eventCount: number;
	readonly recognizedEventCount: number;
	readonly overlapAwareDurationMs: number;
}

export interface EvidenceFileInput extends EvidenceParseOptions {
	readonly cpuProfilePath?: string;
	readonly tracePath?: string;
}

export async function readEvidenceFiles(options: EvidenceFileInput): Promise<EvidenceSummary> {
	const errors: string[] = [];
	let cpuProfile: unknown;
	let trace: unknown;
	if (options.cpuProfilePath) cpuProfile = await readJson(options.cpuProfilePath, options, errors);
	if (options.tracePath) trace = await readJson(options.tracePath, options, errors);
	return parseEvidence({ ...options, cpuProfile, trace }, errors);
}

export interface ParsedEvidenceInput extends EvidenceParseOptions {
	readonly cpuProfile?: unknown;
	readonly trace?: unknown;
}

// fallow-ignore-next-line complexity -- the parser keeps CPU, trace, capability, and truncation status separate.
export function parseEvidence(
	input: ParsedEvidenceInput,
	initialErrors: readonly string[] = [],
): EvidenceSummary {
	const errors = [...initialErrors];
	const missingCapabilities: string[] = [];
	const supportedCapabilities: string[] = [];
	let mappedCpuSummary: readonly MappedCpuSample[] = [];
	let observedEvents: readonly ObservedEventSummary[] = [];
	let sampleCount = 0;
	let eventCount = 0;
	let recognizedEventCount = 0;
	let overlapAwareDurationMs = 0;
	let truncation = input.truncated ? "input marked truncated" : null;

	if (input.cpuProfile !== undefined) {
		const profile = asCpuProfile(input.cpuProfile, errors);
		if (profile) {
			const bounded = boundSamples(profile, input.maximumSamples ?? EVIDENCE_DEFAULT_MAX_SAMPLES);
			if (bounded.truncated) truncation ??= "CPU profile sample limit exceeded";
			mappedCpuSummary = summarizeCpuProfile(bounded.profile, input.sourceMaps ?? [], errors);
			sampleCount = bounded.profile.samples.length;
			supportedCapabilities.push("cpu-profile");
		} else {
			missingCapabilities.push("cpu-profile");
		}
	} else {
		missingCapabilities.push("cpu-profile");
	}

	if (input.trace !== undefined) {
		const parsedTrace = asTrace(input.trace, errors);
		if (parsedTrace) {
			const bounded = boundEvents(parsedTrace, input.maximumEvents ?? EVIDENCE_DEFAULT_MAX_EVENTS);
			if (bounded.truncated) truncation ??= "trace event limit exceeded";
			const traceSummary = summarizeTrace(bounded.trace);
			observedEvents = traceSummary.observedEvents;
			eventCount = bounded.trace.traceEvents.length;
			recognizedEventCount = traceSummary.recognizedEventCount;
			overlapAwareDurationMs = traceSummary.overlapAwareDurationMs;
			supportedCapabilities.push("chromium-trace");
			if (traceSummary.unknownEventCount > 0)
				missingCapabilities.push(
					`${traceSummary.unknownEventCount} trace events unsupported for summary`,
				);
		} else {
			missingCapabilities.push("chromium-trace");
		}
	} else {
		missingCapabilities.push("chromium-trace");
	}

	return {
		mappedCpuSummary,
		observedEvents,
		supportedCapabilities,
		missingCapabilities,
		errors,
		truncation,
		sampleCount,
		eventCount,
		recognizedEventCount,
		overlapAwareDurationMs,
	};
}

// fallow-ignore-next-line complexity -- stack attribution handles malformed and recursive profile variants explicitly.
export function summarizeCpuProfile(
	profile: CpuProfileInput,
	sourceMaps: readonly SourceMapArtifact[] = [],
	errors: string[] = [],
): readonly MappedCpuSample[] {
	const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
	const parents = new Map<number, number>();
	for (const node of profile.nodes)
		for (const child of node.children ?? []) if (!parents.has(child)) parents.set(child, node.id);
	const aggregates = new Map<string, CpuAggregate>();
	const durations = profile.timeDeltas ?? [];
	if (!profile.timeDeltas)
		errors.push("CPU profile has no timeDeltas; sample-count weights are used");
	for (const [index, sample] of profile.samples.entries()) {
		const durationMs = sampleDurationMs(durations[index], profile.duration, profile.samples.length);
		const stack = stackForSample(sample, parents, nodes);
		if (stack.length === 0) continue;
		const seen = new Set<string>();
		for (const node of stack) {
			const mapped = mapCallFrame(node.callFrame, sourceMaps);
			const key = `${mapped.functionName}\u0000${mapped.sourceFile ?? ""}\u0000${mapped.line ?? ""}\u0000${mapped.column ?? ""}`;
			const aggregate = aggregates.get(key) ?? {
				functionName: mapped.functionName,
				sourceFile: mapped.sourceFile,
				line: mapped.line,
				column: mapped.column,
				selfMs: 0,
				totalMs: 0,
			};
			if (node === stack[0]) aggregate.selfMs += durationMs;
			if (!seen.has(key)) {
				aggregate.totalMs += durationMs;
				seen.add(key);
			}
			aggregates.set(key, aggregate);
		}
	}
	return [...aggregates.values()]
		.sort((left, right) => right.totalMs - left.totalMs || right.selfMs - left.selfMs)
		.map((aggregate) => ({
			...aggregate,
			selfMs: round(aggregate.selfMs),
			totalMs: round(aggregate.totalMs),
		}));
}

export interface TraceSummary {
	readonly observedEvents: readonly ObservedEventSummary[];
	readonly recognizedEventCount: number;
	readonly unknownEventCount: number;
	readonly overlapAwareDurationMs: number;
}

export function summarizeTrace(trace: TraceInput): TraceSummary {
	const recognized: TraceInterval[] = [];
	let unknownEventCount = 0;
	for (const event of trace.traceEvents) {
		const category = event.cat ?? "";
		const name = event.name ?? "";
		if (!isRecognizedEvent(name, category) || event.ph !== "X") {
			unknownEventCount++;
			continue;
		}
		if (!finite(event.ts) || !finite(event.dur) || event.dur < 0) {
			unknownEventCount++;
			continue;
		}
		recognized.push({
			name,
			category,
			processId: integerOrNull(event.pid),
			threadId: integerOrNull(event.tid),
			startMs: event.ts / 1000,
			endMs: (event.ts + event.dur) / 1000,
			durationMs: event.dur / 1000,
		});
	}
	const contributions = overlapContributions(recognized);
	const groups = new Map<string, ObservedEventAccumulator>();
	for (const [index, event] of recognized.entries()) {
		const key = eventKey(event);
		const group = groups.get(key) ?? {
			name: event.name,
			category: event.category,
			processId: event.processId,
			threadId: event.threadId,
			durationMs: 0,
			overlapAwareDurationMs: 0,
		};
		group.durationMs += event.durationMs;
		group.overlapAwareDurationMs += contributions[index] ?? 0;
		groups.set(key, group);
	}
	return {
		observedEvents: [...groups.values()].map((group) => ({
			...group,
			durationMs: round(group.durationMs),
			overlapAwareDurationMs: round(group.overlapAwareDurationMs),
		})),
		recognizedEventCount: recognized.length,
		unknownEventCount,
		overlapAwareDurationMs: round(contributions.reduce((sum, value) => sum + value, 0)),
	};
}

function stackForSample(
	sample: number,
	parents: ReadonlyMap<number, number>,
	nodes: ReadonlyMap<number, CpuProfileNode>,
): CpuProfileNode[] {
	const stack: CpuProfileNode[] = [];
	const seen = new Set<number>();
	let nodeId: number | undefined = sample;
	while (nodeId !== undefined && !seen.has(nodeId)) {
		seen.add(nodeId);
		const node = nodes.get(nodeId);
		if (!node) break;
		stack.push(node);
		nodeId = parents.get(nodeId);
	}
	return stack;
}

// fallow-ignore-next-line complexity -- source-map fallback must preserve every generated frame variant.
function mapCallFrame(
	frame: CpuProfileNode["callFrame"],
	sourceMaps: readonly SourceMapArtifact[],
): MappedCpuSample {
	const functionName = frame.functionName?.trim() || "(anonymous)";
	const generatedFile = normalizePath(frame.url);
	const generatedLine = finite(frame.lineNumber) ? frame.lineNumber + 1 : null;
	const generatedColumn = finite(frame.columnNumber) ? frame.columnNumber : null;
	const sourceMap = sourceMaps.find((candidate) =>
		sameGeneratedFile(candidate.generatedFile, frame.url),
	);
	if (sourceMap && generatedLine !== null && generatedColumn !== null) {
		try {
			const mapped = originalPositionFor(
				new TraceMap(sourceMap.map as never, sourceMap.generatedFile),
				{ line: generatedLine, column: generatedColumn },
			);
			if (mapped.source !== null && mapped.line !== null && mapped.column !== null)
				return {
					functionName,
					sourceFile: normalizePath(mapped.source),
					line: mapped.line,
					column: mapped.column,
					selfMs: 0,
					totalMs: 0,
				};
		} catch {
			// Preserve the generated frame when a malformed map cannot be applied.
		}
	}
	return {
		functionName,
		sourceFile: generatedFile,
		line: generatedLine,
		column: generatedColumn,
		selfMs: 0,
		totalMs: 0,
	};
}

function overlapContributions(intervals: readonly TraceInterval[]): number[] {
	const contributions = intervals.map(() => 0);
	const groups = new Map<string, number[]>();
	for (const [index, interval] of intervals.entries()) {
		const key = `${interval.processId ?? ""}:${interval.threadId ?? ""}`;
		(groups.get(key) ?? groups.set(key, []).get(key)!).push(index);
	}
	for (const indices of groups.values()) {
		const points = [
			...new Set(indices.flatMap((index) => [intervals[index].startMs, intervals[index].endMs])),
		].sort((left, right) => left - right);
		for (let point = 0; point < points.length - 1; point++) {
			const start = points[point];
			const end = points[point + 1];
			const owner = indices.find(
				(index) => intervals[index].startMs <= start && intervals[index].endMs >= end,
			);
			if (owner !== undefined) contributions[owner] += end - start;
		}
	}
	return contributions;
}

interface TraceInterval {
	readonly name: string;
	readonly category: string;
	readonly processId: number | null;
	readonly threadId: number | null;
	readonly startMs: number;
	readonly endMs: number;
	readonly durationMs: number;
}

interface CpuAggregate {
	functionName: string;
	sourceFile: string | null;
	line: number | null;
	column: number | null;
	selfMs: number;
	totalMs: number;
}

interface ObservedEventAccumulator {
	readonly name: string;
	readonly category: string;
	readonly processId: number | null;
	readonly threadId: number | null;
	durationMs: number;
	overlapAwareDurationMs: number;
}

function isRecognizedEvent(name: string, category: string): boolean {
	return (
		/(?:GC|GarbageCollection)/i.test(name) ||
		[
			"Paint",
			"CompositeLayers",
			"DrawFrame",
			"BeginFrame",
			"UpdateLayerTree",
			"RasterTask",
		].includes(name) ||
		(category.split(",").includes("devtools.timeline") &&
			["Paint", "CompositeLayers", "DrawFrame"].includes(name))
	);
}

function eventKey(event: TraceInterval): string {
	return `${event.name}\u0000${event.category}\u0000${event.processId ?? ""}\u0000${event.threadId ?? ""}`;
}

function asCpuProfile(value: unknown, errors: string[]): CpuProfileInput | null {
	if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.samples)) {
		errors.push("CPU profile is malformed");
		return null;
	}
	const nodes = value.nodes.filter(isCpuNode);
	const samples = value.samples.filter(
		(sample): sample is number => Number.isInteger(sample) && sample >= 0,
	);
	if (nodes.length !== value.nodes.length || samples.length !== value.samples.length)
		errors.push("CPU profile contains malformed nodes or samples");
	return {
		nodes,
		samples,
		timeDeltas: Array.isArray(value.timeDeltas)
			? value.timeDeltas.filter((delta): delta is number => finite(delta) && delta >= 0)
			: undefined,
		duration: finite(value.duration) ? value.duration : undefined,
	};
}

function asTrace(value: unknown, errors: string[]): TraceInput | null {
	const events =
		isRecord(value) && Array.isArray(value.traceEvents)
			? value.traceEvents.filter(isTraceEvent)
			: Array.isArray(value)
				? value.filter(isTraceEvent)
				: [];
	if (!isRecord(value) && !Array.isArray(value)) errors.push("Chromium trace is malformed");
	if (events.length === 0) errors.push("Chromium trace contains no events");
	return events.length > 0 ? { traceEvents: events } : null;
}

function boundSamples(
	profile: CpuProfileInput,
	maximumSamples: number,
): { profile: CpuProfileInput; truncated: boolean } {
	return profile.samples.length <= maximumSamples
		? { profile, truncated: false }
		: {
				profile: {
					...profile,
					samples: profile.samples.slice(0, maximumSamples),
					timeDeltas: profile.timeDeltas?.slice(0, maximumSamples),
				},
				truncated: true,
			};
}

function boundEvents(
	trace: TraceInput,
	maximumEvents: number,
): { trace: TraceInput; truncated: boolean } {
	return trace.traceEvents.length <= maximumEvents
		? { trace, truncated: false }
		: { trace: { traceEvents: trace.traceEvents.slice(0, maximumEvents) }, truncated: true };
}

async function readJson(
	path: string,
	options: EvidenceParseOptions,
	errors: string[],
): Promise<unknown> {
	try {
		const resolved = resolve(path);
		const content = await readFile(resolved, "utf8");
		const maximumBytes = options.maximumInputBytes ?? EVIDENCE_DEFAULT_MAX_INPUT_BYTES;
		if (Buffer.byteLength(content) > maximumBytes) {
			errors.push(`${basename(resolved)} exceeds the bounded evidence input limit`);
			return undefined;
		}
		return JSON.parse(content);
	} catch (error) {
		errors.push(`unable to read evidence ${relative(process.cwd(), path)}: ${errorMessage(error)}`);
		return undefined;
	}
}

function sampleDurationMs(
	value: number | undefined,
	totalDuration: number | undefined,
	sampleCount: number,
): number {
	if (finite(value)) return value / 1000;
	return finite(totalDuration) && totalDuration >= 0 && sampleCount > 0
		? totalDuration / sampleCount / 1000
		: 1;
}

function sameGeneratedFile(left: string, right: string | undefined): boolean {
	return normalizePath(left) === normalizePath(right);
}

function normalizePath(value: string | undefined | null): string | null {
	if (!value) return null;
	return value
		.replace(/^https?:\/\/[^/]+\//, "")
		.replace(/^file:\/\//, "")
		.replaceAll("\\", "/")
		.replace(/^.*?\/dist-performance\//, "");
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function integerOrNull(value: number | undefined): number | null {
	return value !== undefined && Number.isInteger(value) ? value : null;
}

function finite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isCpuNode(value: unknown): value is CpuProfileNode {
	return isRecord(value) && Number.isInteger(value.id) && isRecord(value.callFrame);
}

function isTraceEvent(value: unknown): value is TraceEventInput {
	return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
