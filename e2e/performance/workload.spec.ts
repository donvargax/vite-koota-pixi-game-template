import { test, expect } from "./fixtures.ts";

const sampleMs = {
	"foes-50": 15_000,
	"bullets-250": 15_000,
	"bullets-1000": 15_000,
} as const;

test("starts and stops the visible benchmark surface", async ({ performance }) => {
	await performance.startAndReady();
	await expect(performance.page.locator("#benchmark-status")).toHaveText("Ready");
	await performance.page.getByRole("button", { name: "Stop", exact: true }).click();
	await expect(performance.page.locator("#benchmark-status")).toHaveText("Stopped");
	const summary = await performance.readVisibleSummary();
	expect(summary.buildId).toBe(process.env.PERF_BUILD_ID);
	expect(summary.error).toBe("");
});

test.describe("invalid scenario", () => {
	test.use({ scenarioId: "not-declared" });
	test("rejects an undeclared scenario visibly", async ({ performance }) => {
		const summary = await performance.readVisibleSummary();
		expect(summary.status).toBe("Error");
		expect(summary.error).toMatch(/unknown scenario/);
	});
});

test.describe("foe workload", () => {
	test.use({ scenarioId: "foes-50" });
	test("keeps exactly 50 foes loaded and advances the ordinary HUD", async ({ performance }) => {
		await performance.startAndReady();
		await expect(performance.page.locator("#count")).toHaveText("50");
		await performance.beginSample();
		await performance.page.waitForTimeout(sampleMs["foes-50"]);
		const record = await performance.endSample();
		const summary = await performance.readVisibleSummary();

		expect(record.failures).toEqual([]);
		expect(summary.status).toBe("Sample complete");
		expect(summary.load).toBe("50 foes / 0 bolts");
		expect(summary.progress).toMatch(/renders, 0 visible bolts/);
		expect(record.rawRafSamples.values.length).toBeGreaterThan(0);
	});
});

for (const scenarioId of ["bullets-250", "bullets-1000"] as const) {
	test.describe(`${scenarioId} workload`, () => {
		test.use({ scenarioId });
		test(`sustains the ${scenarioId} visible load and render progress`, async ({ performance }) => {
			await performance.startAndReady();
			await performance.beginSample();
			await performance.page.waitForTimeout(sampleMs[scenarioId]);
			const record = await performance.endSample();
			const summary = await performance.readVisibleSummary();

			expect(record.failures).toEqual([]);
			expect(summary.status, summary.error).toBe("Sample complete");
			expect(summary.load).toBe(
				scenarioId === "bullets-250" ? "50 foes / 250 bolts" : "200 foes / 1000 bolts",
			);
			expect(summary.progress).toMatch(/renders, (?:200|800|[2-9]\d{2,}|1\d{3,}) visible bolts/);
			expect(record.rawRafSamples.values.length).toBeGreaterThan(0);
			expect(record.actualElapsedMs).toBeGreaterThanOrEqual(14_000);
		});
	});
}
