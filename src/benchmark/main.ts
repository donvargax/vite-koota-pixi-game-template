import manifestJson from "../../performance/scenarios.json";
import { getScenario, validateScenarioManifest } from "../../performance/scenarios.ts";
import type { ScenarioDefinition } from "../../performance/contracts.ts";
import { HtmlAudio } from "../game/audio.ts";
import {
	createBrowserRuntime,
	type BrowserRuntimeController,
	type RuntimeFrameObservation,
	type RuntimeView,
} from "../game/browser-runtime.ts";
import type { HudProjection } from "../game/game-view-model.ts";
import { KeyboardInput } from "../game/input.ts";
import { PixiView } from "../game/pixi-view.ts";
import { createBenchmarkWorkload, type BenchmarkWorkload } from "./workload.ts";

const manifest = validateScenarioManifest(manifestJson);
const buildId = import.meta.env.VITE_PERFORMANCE_BUILD_ID ?? "development-placeholder";
const stage = document.querySelector<HTMLElement>("#stage")!;
const statusEl = document.querySelector<HTMLElement>("#benchmark-status")!;
const errorEl = document.querySelector<HTMLElement>("#benchmark-error")!;
const buildEl = document.querySelector<HTMLElement>("#benchmark-build")!;
const scenarioEl = document.querySelector<HTMLElement>("#benchmark-scenario")!;
const rendererEl = document.querySelector<HTMLElement>("#benchmark-renderer")!;
const loadEl = document.querySelector<HTMLElement>("#benchmark-load")!;
const progressEl = document.querySelector<HTMLElement>("#benchmark-progress")!;
const hpEl = document.querySelector<HTMLElement>("#hp")!;
const countEl = document.querySelector<HTMLElement>("#count")!;
const pxEl = document.querySelector<HTMLElement>("#px")!;
const startButton = document.querySelector<HTMLButtonElement>("#benchmark-start")!;
const beginButton = document.querySelector<HTMLButtonElement>("#benchmark-begin")!;
const endButton = document.querySelector<HTMLButtonElement>("#benchmark-end")!;
const stopButton = document.querySelector<HTMLButtonElement>("#benchmark-stop")!;

const scenarioId = new URLSearchParams(location.search).get("scenario") ?? "idle";
let scenario: ScenarioDefinition | undefined;
try {
	scenario = getScenario(manifest, scenarioId);
} catch (error) {
	showError(error);
	startButton.disabled = true;
}

const input = new KeyboardInput();
const audio = new HtmlAudio();
const animationFrame = {
	now: performance.now.bind(performance),
	request: globalThis.requestAnimationFrame.bind(globalThis),
	cancel: globalThis.cancelAnimationFrame.bind(globalThis),
};

let runtime: BrowserRuntimeController | undefined;
let view: RuntimeView | undefined;
let workload: BenchmarkWorkload | undefined;
let sampling = false;
let stopped = false;
let sampleStartMs = 0;
let sampleFrameCount = 0;
let finalRecord: ReturnType<BenchmarkWorkload["getWindowRecord"]> | undefined;
let lastTelemetryFrame = -Infinity;

buildEl.textContent = buildId;
scenarioEl.textContent = scenarioId;
setControls("idle");

const onStart = (): void => {
	if (scenario && !runtime && !stopped) void start();
};
startButton.addEventListener("click", onStart);
beginButton.addEventListener("click", onBegin);
endButton.addEventListener("click", endSample);
stopButton.addEventListener("click", stop);
window.addEventListener("pagehide", stop, { once: true });

async function start(): Promise<void> {
	clearError();
	setStatus("Starting...");
	input.bind();
	audio.bind();
	try {
		await startRuntime();
		showReady();
	} catch (error) {
		showError(error);
		stop();
	}
}

async function startRuntime(): Promise<void> {
	runtime = createRuntime();
	await runtime.ready;
}

function createRuntime(): BrowserRuntimeController {
	return createBrowserRuntime({
		parent: stage,
		ports: { input, audio, random: { next: () => Math.random() } },
		animationFrame,
		initialFoePositions: [],
		createView: () => {
			view = new PixiView();
			return view;
		},
		updateHud,
		createWorkload: createWorkloadAdapter,
		observer: { onFrame },
	});
}

function createWorkloadAdapter(context: Parameters<typeof createBenchmarkWorkload>[0]) {
	const adapter = createBenchmarkWorkload(context, { scenario: scenario! });
	workload = adapter;
	return {
		beforeSimulation: adapter.beforeSimulation.bind(adapter),
		afterSimulation: adapter.afterSimulation.bind(adapter),
		afterRender: (projection: Parameters<NonNullable<typeof adapter.afterRender>>[0]) => {
			adapter.afterRender(projection);
			if (sampleFrameCount - lastTelemetryFrame >= 15) {
				lastTelemetryFrame = sampleFrameCount;
				updateTelemetry(adapter.getWindowRecord(elapsedSampleSeconds()));
			}
		},
		dispose: adapter.dispose.bind(adapter),
	};
}

function showReady(): void {
	const metadata = view?.getRendererMetadata?.();
	rendererEl.textContent = metadata?.renderer ?? "unavailable";
	setStatus("Ready");
	setControls("ready");
}

function onBegin(): void {
	beginSample();
}

function beginSample(): void {
	prepareSample();
}

function prepareSample(): void {
	clearError();
	workload!.resetWindow();
	sampling = true;
	sampleFrameCount = 0;
	lastTelemetryFrame = -Infinity;
	sampleStartMs = performance.now();
	clearSampleMarks();
	setStatus("Sampling");
	setControls("sampling");
}

function clearSampleMarks(): void {
	performance.clearMarks("benchmark-frame");
	performance.clearMarks("benchmark-sample-start");
	performance.clearMarks("benchmark-sample-end");
	performance.mark("benchmark-sample-start");
}

function endSample(): void {
	if (!workload || !sampling || finalRecord) return;
	const elapsedSeconds = Math.max(0, (performance.now() - sampleStartMs) / 1000);
	sampling = false;
	finalRecord = workload.getWindowRecord(elapsedSeconds);
	performance.mark("benchmark-sample-end", { detail: finalRecord });
	showFinalRecord(finalRecord);
}

function showFinalRecord(record: ReturnType<BenchmarkWorkload["getWindowRecord"]>): void {
	updateTelemetry(record);
	if (!record.progressValid)
		errorEl.textContent = record.failures.map(({ message }) => message).join(", ");
	setStatus(record.progressValid ? "Sample complete" : "Sample invalid");
	setControls("complete");
}

function stop(): void {
	if (stopped) return;
	stopped = true;
	removeListeners();
	if (sampling) endSample();
	disposeResource(() => runtime?.dispose());
	disposeResource(() => workload?.dispose());
	runtime = undefined;
	workload = undefined;
	view = undefined;
	audio.dispose();
	input.dispose();
	setStatus("Stopped");
	setControls("stopped");
}

function removeListeners(): void {
	startButton.removeEventListener("click", onStart);
	beginButton.removeEventListener("click", onBegin);
	endButton.removeEventListener("click", endSample);
	stopButton.removeEventListener("click", stop);
	window.removeEventListener("pagehide", stop);
}

function disposeResource(cleanup: () => void): void {
	try {
		cleanup();
	} catch (error) {
		showError(error);
	}
}

function onFrame(observation: RuntimeFrameObservation): void {
	if (!sampling || sampleFrameCount >= 10_000) return;
	sampleFrameCount++;
	performance.mark("benchmark-frame", {
		detail: {
			nowMs: observation.nowMs,
			rawElapsedMs: observation.rawElapsedMs,
			rawSeconds: observation.rawSeconds,
			simulationDeltaSeconds: observation.simulationDeltaSeconds,
			callbackWorkMs: observation.callbackWorkMs,
			phases: observation.phases,
		},
	});
}

function updateHud(projection: HudProjection): void {
	hpEl.textContent = String(projection.playerHealth);
	countEl.textContent = String(projection.foeCount);
	pxEl.textContent = projection.playerX === null ? "unavailable" : projection.playerX.toFixed(1);
}

function updateTelemetry(record: ReturnType<BenchmarkWorkload["getWindowRecord"]>): void {
	loadEl.textContent = `${record.afterMaintenanceFoes} foes / ${record.afterMaintenanceBolts} bolts`;
	progressEl.textContent = `${sampleFrameCount} renders, ${record.projectedOnScreenBolts} visible bolts`;
}

function elapsedSampleSeconds(): number {
	return sampling
		? Math.max(0, (performance.now() - sampleStartMs) / 1000)
		: (finalRecord?.rawWallSeconds ?? 0);
}

function setStatus(status: string): void {
	statusEl.textContent = status;
}

function setControls(state: "idle" | "ready" | "sampling" | "complete" | "stopped"): void {
	startButton.disabled = state !== "idle";
	beginButton.disabled = state !== "ready";
	endButton.disabled = state !== "sampling";
	stopButton.disabled = state === "idle" || state === "stopped";
}

function clearError(): void {
	errorEl.textContent = "";
}

function showError(error: unknown): void {
	errorEl.textContent = error instanceof Error ? error.message : String(error);
	setStatus("Error");
}
