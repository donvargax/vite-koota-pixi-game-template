import { defineConfig, type UserConfig } from "vite-plus";

const staged = {
	// Our sources only. Never run format/lint over vendored content:
	// public/assets contains third-party files with misleading extensions.
	"{src,e2e,performance}/**/*.{ts,tsx,js,jsx,json}": "vp check --fix",
	"{docs,.github}/**/*.{md,yml,yaml}": "vp check --fix",
	"{package,pnpm-workspace,tsconfig,tsconfig.performance,vite.config,playwright.config}.{json,yaml,ts}":
		"vp check --fix",
};

const test = {
	// Playwright specs live in e2e/ and run via `vp run e2e`, not Vitest.
	exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
	coverage: {
		provider: "v8" as const,
		reporter: ["text", "html"],
		include: [
			"performance/compare.ts",
			"performance/scenarios.ts",
			"performance/statistics.ts",
			"src/ecs/**/*.ts",
			"src/benchmark/workload.ts",
			"src/game/actors.ts",
			"src/game/audio.ts",
			"src/game/browser-runtime.ts",
			"src/game/combat.ts",
			"src/game/composition.ts",
			"src/game/contracts.ts",
			"src/game/dash.ts",
			"src/game/enemies.ts",
			"src/game/game-view-model.ts",
			"src/game/input.ts",
			"src/game/locomotion.ts",
			"src/game/player-life.ts",
			"src/game/pixi-view.ts",
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
};

const fmt = {
	ignorePatterns: [
		"e2e/.features-gen/**",
		"performance-results/**",
		"performance-baselines.local/**",
		"dist-performance/**",
	],
};

const lint: NonNullable<UserConfig["lint"]> = {
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
};

const buildModes = {
	normal: {
		outDir: "dist",
		sourcemap: false,
		input: { index: "index.html" },
		buildId: "normal-build",
	},
	performance: {
		outDir: "dist-performance",
		sourcemap: true,
		input: { index: "index.html", performance: "performance.html" },
		buildId: process.env.PERFORMANCE_BUILD_ID ?? "development-placeholder",
	},
} as const;

export default defineConfig(({ mode }) => {
	const selectedBuild = buildModes[mode === "performance" ? "performance" : "normal"];

	return {
		build: {
			outDir: selectedBuild.outDir,
			sourcemap: selectedBuild.sourcemap,
			minify: "oxc",
			rollupOptions: { input: selectedBuild.input },
		},
		define: {
			"import.meta.env.VITE_PERFORMANCE_BUILD_ID": JSON.stringify(selectedBuild.buildId),
		},
		staged,
		test,
		fmt,
		lint,
	};
});
