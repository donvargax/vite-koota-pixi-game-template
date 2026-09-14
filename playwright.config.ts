import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

const port = process.env.E2E_PORT ?? "5173";
const baseURL = `http://127.0.0.1:${port}`;

const gameplayDir = defineBddConfig({
	features: "e2e/features/**/*.feature",
	steps: ["e2e/steps/**/*.ts", "e2e/support/fixtures.ts"],
	outputDir: "e2e/.features-gen",
});

export default defineConfig({
	fullyParallel: true,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: [["list"], ["html", { open: "never" }]],
	use: {
		...devices["Desktop Chrome"],
		baseURL,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	snapshotPathTemplate: "{testDir}/../snapshots/{platform}/{arg}{ext}",
	webServer: {
		command: `vp run dev --host 127.0.0.1 --port ${port} --strictPort`,
		url: baseURL,
		reuseExistingServer: !process.env.CI,
	},
	projects: [
		{ name: "gameplay", testDir: gameplayDir },
		{ name: "realtime", testDir: gameplayDir, grep: /@realtime/ },
		{ name: "smoke", testDir: "./e2e", testMatch: "smoke.spec.ts" },
	],
});
