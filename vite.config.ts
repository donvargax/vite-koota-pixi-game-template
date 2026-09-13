import { defineConfig } from "vite-plus";

export default defineConfig({
	staged: {
		// Our sources only. Never run format/lint over vendored content:
		// public/assets contains third-party files with misleading
		// extensions (e.g. Tiled .tsx which is XML, not TypeScript).
		"{src,e2e}/**/*.{ts,tsx,js,jsx,json}": "vp check --fix",
		"*.{json,md}": "vp check --fix",
	},
	test: {
		// Playwright specs live in e2e/ and run via `pnpm e2e`, not vitest.
		exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
	},
	fmt: {},
	lint: {
		jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
		rules: { "vite-plus/prefer-vite-plus-imports": "error" },
		options: { typeAware: true, typeCheck: true },
	},
});
