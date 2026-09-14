import {
	test as base,
	expect,
	type BrowserContext,
	type Page,
	type TestInfo,
} from "@playwright/test";
import manifestJson from "../../performance/scenarios.json" with { type: "json" };
import { collectEnvironment, type EnvironmentSnapshot } from "../../performance/environment.ts";
import { createTimingCollector, type TimingCollector } from "../../performance/collect.ts";
import type {
	InputSchedule,
	InputTimingObservation,
	WindowRecord,
} from "../../performance/contracts.ts";
import { getScenario, validateScenarioManifest } from "../../performance/scenarios.ts";

const baseURL = process.env.PERF_BASE_URL ?? "";
const viewport = { width: 1280, height: 720 };
const manifest = validateScenarioManifest(manifestJson);

export interface PerformanceSession {
	readonly page: Page;
	readonly context: BrowserContext;
	readonly scenarioId: string;
	readonly environment: EnvironmentSnapshot;
	readonly collector: TimingCollector;
	readonly browserErrors: readonly string[];
	startAndReady(): Promise<void>;
	beginSample(): Promise<void>;
	scheduleInput(schedule: InputSchedule, durationMs: number): void;
	endSample(): Promise<WindowRecord>;
	readVisibleSummary(): Promise<VisibleBenchmarkSummary>;
}

export interface VisibleBenchmarkSummary {
	readonly status: string;
	readonly buildId: string;
	readonly scenarioId: string;
	readonly renderer: string;
	readonly load: string;
	readonly progress: string;
	readonly error: string;
}

interface PerformanceOptions {
	scenarioId: string;
	repetition: number;
	requestedDurationMs: number;
}

interface PerformanceFixtures {
	performance: PerformanceSession;
}

export const test = base.extend<PerformanceFixtures & PerformanceOptions>({
	scenarioId: ["idle", { option: true }],
	repetition: [0, { option: true }],
	requestedDurationMs: [1, { option: true }],
	// fallow-ignore-next-line complexity -- fixture lifecycle owns setup, collection, attachment, and cleanup.
	performance: async ({ browser, scenarioId, repetition, requestedDurationMs }, use, testInfo) => {
		if (!baseURL) throw new Error("PERF_BASE_URL must identify the production performance preview");
		const expectedBuildId = process.env.PERF_BUILD_ID;
		if (!expectedBuildId)
			throw new Error("PERF_BUILD_ID must identify the production performance build");
		const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
		const page = await context.newPage();
		const browserErrors: string[] = [];
		page.on("pageerror", (error) => browserErrors.push(error.message));
		const collector = createTimingCollector({
			page,
			cdp: await context.newCDPSession(page),
			scenarioId,
			repetition,
			requestedDurationMs,
			watchdogMs: scenarioId === "bullets-1000" ? 120_000 : 30_000,
		});
		const audioPolicy = (() => {
			try {
				return getScenario(manifest, scenarioId).audio;
			} catch {
				return "disabled" as const;
			}
		})();
		const scheduler = createInputScheduler(page);
		let collectorStarted = false;
		let collectorFinished = false;
		let finalRecord: WindowRecord | undefined;
		try {
			await page.goto(`${baseURL}/performance.html?scenario=${encodeURIComponent(scenarioId)}`, {
				waitUntil: "load",
			});
			await expect(page.locator("#benchmark-build")).toHaveText(expectedBuildId);
			await expect(page.locator("#stage")).toBeVisible();
			await use({
				page,
				context,
				scenarioId,
				environment: collectEnvironment({
					playwrightVersion: process.env.PLAYWRIGHT_VERSION ?? "unknown",
					chromiumVersion: browser.version(),
					viewportWidth: viewport.width,
					viewportHeight: viewport.height,
					devicePixelRatio: 1,
					audioPolicy,
				}),
				collector,
				browserErrors,
				startAndReady: async () => {
					await clickVisibleControl(page, "benchmark-start");
					await expect(page.locator("#benchmark-status")).toHaveText("Ready", { timeout: 30_000 });
					const canvas = page.locator("#stage canvas");
					await expect(canvas).toBeVisible({ timeout: 30_000 });
				},
				beginSample: async () => {
					await collector.start();
					collectorStarted = true;
					await clickVisibleControl(page, "benchmark-begin");
					scheduler.arm();
				},
				scheduleInput: (schedule, durationMs) => {
					scheduler.schedule(schedule, durationMs);
				},
				endSample: async () => {
					await scheduler.cancel();
					await clickVisibleControl(page, "benchmark-end");
					finalRecord = { ...(await collector.finish()), inputTiming: scheduler.timings };
					collectorFinished = true;
					return finalRecord;
				},
				readVisibleSummary: () => readVisibleSummary(page),
			});
		} finally {
			if (collectorStarted && !collectorFinished) {
				try {
					await scheduler.cancel();
					finalRecord = await collector.cancel();
				} catch (error) {
					browserErrors.push(error instanceof Error ? error.message : String(error));
				}
			}
			if (finalRecord) {
				await attachJson(testInfo, "raw-window.json", finalRecord);
			}
			if (browserErrors.length > 0) {
				await testInfo.attach("browser-errors.txt", {
					body: browserErrors.join("\n"),
					contentType: "text/plain",
				});
			}
			await context.close();
		}
	},
});

export { expect };

export interface PerformanceInputScheduler {
	readonly timings: readonly InputTimingObservation[];
	arm(): void;
	schedule(schedule: InputSchedule, durationMs: number): void;
	cancel(): Promise<void>;
}

function createInputScheduler(page: Page): PerformanceInputScheduler {
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const timings: InputTimingObservation[] = [];
	const heldKeys = new Set<string>();
	let originMs = 0;
	let cancelled = false;

	return {
		get timings() {
			return timings;
		},
		arm: () => {
			originMs = performance.now();
			cancelled = false;
		},
		schedule: (schedule, durationMs) => {
			for (const event of schedule.events) {
				if (event.atMs >= durationMs) continue;
				const timer = setTimeout(
					() => {
						timers.delete(timer);
						if (cancelled) return;
						void deliverInput(page, event, originMs, timings, heldKeys);
					},
					Math.max(0, event.atMs - (performance.now() - originMs)),
				);
				timers.add(timer);
			}
		},
		cancel: async () => {
			cancelled = true;
			for (const timer of timers) clearTimeout(timer);
			timers.clear();
			for (const key of heldKeys) {
				try {
					await page.keyboard.up(key);
				} finally {
					heldKeys.delete(key);
				}
			}
		},
	};
}

async function deliverInput(
	page: Page,
	event: InputSchedule["events"][number],
	originMs: number,
	timings: InputTimingObservation[],
	heldKeys: Set<string>,
): Promise<void> {
	const scheduledAtMs = originMs + event.atMs;
	const deliveredAtMs = performance.now();
	try {
		if (event.kind === "keydown") {
			await page.keyboard.down(event.key);
			heldKeys.add(event.key);
		} else {
			await page.keyboard.up(event.key);
			heldKeys.delete(event.key);
		}
		timings.push({
			scheduledAtMs,
			deliveredAtMs,
			latenessMs: Math.max(0, deliveredAtMs - scheduledAtMs),
			kind: event.kind,
			key: event.key,
		});
	} catch {
		timings.push({
			scheduledAtMs,
			deliveredAtMs: null,
			latenessMs: null,
			kind: event.kind,
			key: event.key,
		});
	}
}

async function readVisibleSummary(page: Page): Promise<VisibleBenchmarkSummary> {
	return page.evaluate(() => {
		const text = (id: string): string => document.getElementById(id)?.textContent?.trim() ?? "";
		return {
			status: text("benchmark-status"),
			buildId: text("benchmark-build"),
			scenarioId: text("benchmark-scenario"),
			renderer: text("benchmark-renderer"),
			load: text("benchmark-load"),
			progress: text("benchmark-progress"),
			error: text("benchmark-error"),
		};
	});
}

async function clickVisibleControl(page: Page, id: string): Promise<void> {
	await page.evaluate((controlId) => {
		const button = document.getElementById(controlId);
		if (!(button instanceof HTMLButtonElement))
			throw new Error(`missing benchmark control ${controlId}`);
		const style = getComputedStyle(button);
		if (
			style.visibility === "hidden" ||
			style.display === "none" ||
			button.getClientRects().length === 0
		) {
			throw new Error(`benchmark control ${controlId} is not visible`);
		}
		if (button.disabled) throw new Error(`benchmark control ${controlId} is disabled`);
		button.click();
	}, id);
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
	await testInfo.attach(name, {
		body: JSON.stringify(value, null, 2),
		contentType: "application/json",
	});
}
