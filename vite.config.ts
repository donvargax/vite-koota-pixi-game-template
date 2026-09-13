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
		// Playwright specs live in e2e/ and run via `pnpm e2e`, not vitest.
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
	fmt: {},
	lint: {
		// Vendored third-party content: Tiled ships a .tsx that is really XML.
		ignorePatterns: ["public/assets/**", "dist/**"],
		jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
		rules: { "vite-plus/prefer-vite-plus-imports": "error" },
		options: { typeAware: true, typeCheck: true },
	},
});
