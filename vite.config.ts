import { defineConfig } from "vite-plus";

export default defineConfig({
	staged: {
		// Our sources only. Never run format/lint over vendored content:
		// public/assets contains third-party files with misleading
		// extensions (e.g. Tiled .tsx which is XML, not TypeScript).
		"{src,e2e,performance}/**/*.{ts,tsx,js,jsx,json}": "vp check --fix",
		"{docs,.github}/**/*.{md,yml,yaml}": "vp check --fix",
		"{package,pnpm-workspace,tsconfig,tsconfig.performance,vite.config,playwright.config}.{json,yaml,ts}":
			"vp check --fix",
	},
	test: {
		// Playwright specs live in e2e/ and run via `vp run e2e`, not vitest.
		exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: [
				"performance/compare.ts",
				"performance/scenarios.ts",
				"performance/statistics.ts",
				"src/ecs/**/*.ts",
				"src/benchmark/workload.ts",
				"src/game/actors.ts",
				"src/game/audio.ts",
				"src/game/combat.ts",
				"src/game/composition.ts",
				"src/game/contracts.ts",
				"src/game/dash.ts",
				"src/game/enemies.ts",
				"src/game/game-view-model.ts",
				"src/game/input.ts",
				"src/game/locomotion.ts",
				"src/game/player-life.ts",
				"src/game/presentation.ts",
				"src/game/spatial.ts",
			],
			exclude: ["**/*.test.ts"],
			thresholds: {
				statements: 90,
				branches: 75,
				functions: 90,
				lines: 90,
			},
		},
	},
	fmt: {
		ignorePatterns: [
			"e2e/.features-gen/**",
			"performance-results/**",
			"performance-baselines.local/**",
			"dist-performance/**",
		],
	},
	lint: {
		// Vendored third-party content: Tiled ships a .tsx that is really XML.
		ignorePatterns: [
			"public/assets/**",
			"dist/**",
			"e2e/.features-gen/**",
			"performance-results/**",
			"performance-baselines.local/**",
			"dist-performance/**",
		],
		jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
		rules: { "vite-plus/prefer-vite-plus-imports": "error" },
		overrides: [
			{
				files: [
					"src/benchmark/workload.ts",
					"src/ecs/**/*.ts",
					"src/game/{locomotion,dash,combat,enemies,player-life,actors,spatial,presentation,composition,game-view-model,contracts,sound-assets}.ts",
				],
				excludeFiles: ["**/*.test.ts", "**/*.spec.ts"],
				rules: {
					"no-restricted-imports": [
						"error",
						{
							patterns: [
								{
									regex: "(^|/)(assets|audio|input|pixi-view|browser-runtime)(\\.[cm]?[jt]sx?)?$",
									message: "Headless modules must use ports, not browser adapters.",
								},
								{
									group: ["pixi.js", "pixi.js/**"],
									message: "Keep Pixi imports in browser adapters.",
								},
							],
						},
					],
					"no-restricted-globals": [
						"error",
						{
							checkGlobalObject: true,
							globals: [
								"window",
								"document",
								"self",
								"navigator",
								"location",
								"requestAnimationFrame",
								"cancelAnimationFrame",
								"addEventListener",
								"removeEventListener",
								"Audio",
								"AudioContext",
								"Image",
								"localStorage",
								"sessionStorage",
							],
						},
					],
				},
			},
			{
				files: ["e2e/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
				rules: {
					"no-restricted-imports": [
						"error",
						{
							patterns: [
								{
									// Match src path segments in relative and absolute imports.
									regex: "(^|/)src(/|$)",
									message: "E2E tests must use the browser, not import production src modules.",
								},
							],
						},
					],
				},
			},
		],
		options: { typeAware: true, typeCheck: true },
	},
});
