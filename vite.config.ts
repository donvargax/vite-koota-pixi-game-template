import { defineConfig } from "vite-plus";

export default defineConfig({
	staged: {
		// Our sources only. Never run format/lint over vendored content:
		// public/assets contains third-party files with misleading
		// extensions (e.g. Tiled .tsx which is XML, not TypeScript).
		"{src,e2e}/**/*.{ts,tsx,js,jsx,json}": "vp check --fix",
		"{docs,.github}/**/*.{md,yml,yaml}": "vp check --fix",
		"*.{json,md,ts}": "vp check --fix",
	},
	test: {
		// Playwright specs live in e2e/ and run via `vp run e2e`, not vitest.
		exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: [
				"src/ecs/**/*.ts",
				"src/game/audio.ts",
				"src/game/contracts.ts",
				"src/game/game-view-model.ts",
				"src/game/input.ts",
				"src/game/systems.ts",
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
		ignorePatterns: ["e2e/.features-gen/**"],
	},
	lint: {
		// Vendored third-party content: Tiled ships a .tsx that is really XML.
		ignorePatterns: ["public/assets/**", "dist/**", "e2e/.features-gen/**"],
		jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
		rules: { "vite-plus/prefer-vite-plus-imports": "error" },
		overrides: [
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
