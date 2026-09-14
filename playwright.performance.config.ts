import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PERF_BASE_URL;
if (!baseURL) throw new Error("PERF_BASE_URL must identify the production performance preview");

export default defineConfig({
	testDir: "e2e/performance",
	testMatch: "**/*.spec.ts",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 180_000,
	forbidOnly: true,
	reporter: [["list"], ["html", { outputFolder: "playwright-report/performance", open: "never" }]],
	outputDir: "test-results/performance",
	use: {
		...devices["Desktop Chrome"],
		baseURL,
		viewport: { width: 1280, height: 720 },
		deviceScaleFactor: 1,
		trace: "off",
		video: "off",
		screenshot: "off",
	},
	projects: [{ name: "performance", testMatch: "**/*.spec.ts" }],
});
