import { readFile } from "node:fs/promises";
import manifestJson from "../../performance/scenarios.json" with { type: "json" };
import type { Page, TestInfo } from "@playwright/test";
import {
	createAllocationCollector,
	createCpuTraceCollector,
	type DiagnosticCollector,
	type DiagnosticResult,
} from "../../performance/diagnostics.ts";
import { readEvidenceFiles } from "../../performance/evidence.ts";
import { getScenario, validateScenarioManifest } from "../../performance/scenarios.ts";
import { expect, test } from "./fixtures.ts";

const manifest = validateScenarioManifest(manifestJson);
const scenarioId = process.env.PERF_DIAGNOSTIC_SCENARIO ?? "idle";
const diagnosticMode = process.env.PERF_DIAGNOSTIC_MODE ?? "cpu-trace";
const scenario = getScenario(manifest, scenarioId);

test.describe.configure({ mode: "serial" });

// fallow-ignore-next-line complexity -- the replay test owns setup, bounded collection, validation, and attachments.
test("collects bounded diagnostic evidence without changing clean verdicts", async ({
	performance,
}, testInfo) => {
	const mode = diagnosticMode === "allocation" ? "allocation" : "cpu-trace";
	const outputPrefix = testInfo.outputPath(`diagnostics/${scenarioId}`);
	const profilePath = mode === "cpu-trace" ? `${outputPrefix}.cpuprofile` : undefined;
	const tracePath = mode === "cpu-trace" ? `${outputPrefix}.trace.json` : undefined;
	const allocationPath = mode === "allocation" ? `${outputPrefix}.allocation.json` : undefined;
	const cdp = await performance.context.newCDPSession(performance.page);
	const collector: DiagnosticCollector =
		mode === "allocation"
			? createAllocationCollector({
					session: cdp,
					allocationPath,
				})
			: createCpuTraceCollector({
					session: cdp,
					cpuProfilePath: profilePath,
					tracePath,
				});
	let started = false;
	let stopped = false;
	let diagnosticResult: DiagnosticResult | undefined;
	try {
		await navigateToScenario(performance.page, scenarioId);
		await performance.startAndReady();
		await performance.page.waitForTimeout(scenario.warmupMs);
		await collector.start();
		started = true;
		if (mode === "allocation") {
			await runAllocationWindows(performance.page);
		} else {
			await runDiagnosticWindow(performance.page, scenario.sampleMs);
		}
		diagnosticResult = await collector.stop();
		stopped = true;
		await attachDiagnosticArtifacts(
			testInfo,
			diagnosticResult,
			profilePath,
			tracePath,
			allocationPath,
		);
		await testInfo.attach("diagnostic-status.json", {
			body: JSON.stringify(
				{
					mode,
					scenarioId,
					seed: scenario.seed,
					workloadFingerprint: "declared-manifest",
					result: diagnosticResult,
				},
				null,
				2,
			),
			contentType: "application/json",
		});
		const summary = await performance.readVisibleSummary();
		expect(summary.scenarioId).toBe(scenarioId);
		expect(summary.error).toBe("");
		expect(summary.status).toMatch(/Sample complete|Sampling/);
		expect(diagnosticResult.mode).toBe(mode);
		expect(diagnosticResult.status).not.toBe("truncated");
	} finally {
		if (started && !stopped) {
			try {
				diagnosticResult = await collector.stop();
				await attachDiagnosticArtifacts(
					testInfo,
					diagnosticResult,
					profilePath,
					tracePath,
					allocationPath,
				);
			} catch (error) {
				await testInfo.attach("diagnostic-cleanup-error.txt", {
					body: error instanceof Error ? error.message : String(error),
					contentType: "text/plain",
				});
			}
		}
	}
});

test("self-test artifacts are parseable and source-map linked", async ({
	performance,
}, testInfo) => {
	test.skip(
		scenarioId !== "diagnostic-self-test" || diagnosticMode === "allocation",
		"the source-map self-test requires PERF_DIAGNOSTIC_SCENARIO=diagnostic-self-test and CPU tracing",
	);
	const selfTest = getScenario(manifest, "diagnostic-self-test");
	expect(selfTest.membership.fast).toBe(false);
	expect(selfTest.membership.full).toBe(false);
	expect(selfTest.membership.baseline).toBe(false);
	const outputPrefix = testInfo.outputPath("diagnostics/diagnostic-self-test");
	const profilePath = `${outputPrefix}.cpuprofile`;
	const tracePath = `${outputPrefix}.trace.json`;
	const cdp = await performance.context.newCDPSession(performance.page);
	const collector = createCpuTraceCollector({
		session: cdp,
		cpuProfilePath: profilePath,
		tracePath,
	});
	await navigateToScenario(performance.page, "diagnostic-self-test");
	await performance.startAndReady();
	await performance.page.waitForTimeout(selfTest.warmupMs);
	await collector.start();
	await runDiagnosticWindow(performance.page, selfTest.sampleMs);
	const result = await collector.stop();
	await attachDiagnosticArtifacts(testInfo, result, profilePath, tracePath, undefined);
	const generatedFile = process.env.PERF_GENERATED_ENTRY;
	const sourceMapPath = process.env.PERF_SOURCE_MAP_PATH;
	if (!generatedFile || !sourceMapPath)
		throw new Error(
			"PERF_GENERATED_ENTRY and PERF_SOURCE_MAP_PATH are required for the source-map self-test",
		);
	const sourceMap = JSON.parse(await readFile(sourceMapPath, "utf8")) as unknown;
	const evidence = await readEvidenceFiles({
		cpuProfilePath: profilePath,
		tracePath,
		sourceMaps: [{ generatedFile, map: sourceMap }],
	});
	expect(result.status).toBe("complete");
	expect(result.artifacts.every((artifact) => artifact.validJson)).toBe(true);
	expect(evidence.sampleCount).toBeGreaterThan(0);
	expect(evidence.eventCount).toBeGreaterThan(0);
	expect(evidence.mappedCpuSummary.some((sample) => sample.sourceFile !== null)).toBe(true);
	expect(evidence.errors).not.toContain("CPU profile is malformed");
});

async function navigateToScenario(page: Page, selectedScenarioId: string): Promise<void> {
	const baseURL = process.env.PERF_BASE_URL;
	if (!baseURL) throw new Error("PERF_BASE_URL must identify the production performance preview");
	await page.goto(
		`${baseURL}/performance.html?scenario=${encodeURIComponent(selectedScenarioId)}`,
		{
			waitUntil: "load",
		},
	);
}

async function runDiagnosticWindow(page: Page, durationMs: number): Promise<void> {
	await clickVisibleControl(page, "benchmark-begin");
	await scheduleDeclaredInput(page, durationMs);
	await page.waitForTimeout(5_000);
	await clickVisibleControl(page, "benchmark-end");
}

async function runAllocationWindows(page: Page): Promise<void> {
	await clickVisibleControl(page, "benchmark-begin");
	const windowMs = Math.max(1_000, Math.ceil((scenario.validity.minimumWallSeconds * 1_000) / 4));
	try {
		for (const active of [true, false, true, false]) {
			if (active) await page.keyboard.down("ArrowRight");
			await page.waitForTimeout(windowMs);
			if (active) await page.keyboard.up("ArrowRight");
		}
	} finally {
		await page.keyboard.up("ArrowRight").catch(() => undefined);
	}
	await clickVisibleControl(page, "benchmark-end");
}

async function scheduleDeclaredInput(page: Page, durationMs: number): Promise<void> {
	const origin = performance.now();
	const heldKeys = new Set<string>();
	const timers: ReturnType<typeof setTimeout>[] = [];
	try {
		for (const event of scenario.input.events) {
			if (event.atMs >= durationMs) continue;
			const timer = setTimeout(
				async () => {
					if (event.kind === "keydown") {
						await page.keyboard.down(event.key);
						heldKeys.add(event.key);
					} else {
						await page.keyboard.up(event.key);
						heldKeys.delete(event.key);
					}
				},
				Math.max(0, event.atMs - (performance.now() - origin)),
			);
			timers.push(timer);
		}
		await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
	} finally {
		for (const timer of timers) clearTimeout(timer);
		for (const key of heldKeys) await page.keyboard.up(key);
	}
}

async function clickVisibleControl(page: Page, id: string): Promise<void> {
	await page.evaluate((controlId) => {
		const button = document.getElementById(controlId);
		if (!(button instanceof HTMLButtonElement))
			throw new Error(`missing benchmark control ${controlId}`);
		if (button.disabled || button.getClientRects().length === 0)
			throw new Error(`benchmark control ${controlId} is unavailable`);
		button.click();
	}, id);
}

async function attachDiagnosticArtifacts(
	testInfo: TestInfo,
	result: DiagnosticResult,
	profilePath: string | undefined,
	tracePath: string | undefined,
	allocationPath: string | undefined,
): Promise<void> {
	for (const [name, path] of [
		["cpu-profile", profilePath],
		["trace", tracePath],
		["allocation", allocationPath],
	] as const) {
		if (path) {
			const artifact = result.artifacts.find((entry) => entry.kind === name);
			if (artifact && artifact.status !== "failed") await testInfo.attach(`${name}.json`, { path });
		}
	}
}
