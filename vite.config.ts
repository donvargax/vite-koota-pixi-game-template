import { defineConfig } from "vite-plus";

export default defineConfig({
	staged: {
		// Code and text only: never run format/lint over vendored binaries
		// (public/assets) or other binary blobs.
		"*.{ts,tsx,js,jsx,json,md}": "vp check --fix",
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
