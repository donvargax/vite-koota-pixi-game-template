import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
	createPerformanceProcess,
	type ProcessChild,
	type ProcessFetchResponse,
	type ProcessOutput,
	type ProcessSeams,
} from "./process.ts";

class FakeOutput implements ProcessOutput {
	private listener: ((chunk: unknown) => void) | undefined;

	on(_event: "data", listener: (chunk: unknown) => void): void {
		this.listener = listener;
	}

	emit(chunk: string): void {
		this.listener?.(chunk);
	}
}

class FakeChild implements ProcessChild {
	readonly stdout = new FakeOutput();
	readonly stderr = new FakeOutput();
	readonly killSignals: string[] = [];
	readonly pid = undefined;
	private readonly listeners = {
		error: [] as ((error: Error) => void)[],
		exit: [] as ((code: number | null, signal: string | null) => void)[],
	};

	on(
		event: "data" | "error" | "exit",
		listener:
			| ((chunk: unknown) => void)
			| ((error: Error) => void)
			| ((code: number | null, signal: string | null) => void),
	): void {
		if (event === "error") this.listeners.error.push(listener as (error: Error) => void);
		if (event === "exit")
			this.listeners.exit.push(listener as (code: number | null, signal: string | null) => void);
	}

	kill(signal = "SIGTERM"): boolean {
		this.killSignals.push(signal);
		return true;
	}

	emitExit(code: number | null, signal: string | null = null): void {
		for (const listener of this.listeners.exit) listener(code, signal);
	}

	emitError(error: Error): void {
		for (const listener of this.listeners.error) listener(error);
	}
}

describe("performance process orchestration", () => {
	it("uses argument arrays, build identity, and copies exact JS/maps", async () => {
		const rootDirectory = await temporaryDirectory();
		const outputDirectory = join(rootDirectory, "run");
		const child = new FakeChild();
		const calls: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
		const seams: ProcessSeams = {
			spawn: (command, args, spawnOptions) => {
				calls.push({ command, args, env: spawnOptions.env });
				void (async () => {
					await mkdir(join(rootDirectory, "dist-performance"), { recursive: true });
					await writeFile(
						join(rootDirectory, "dist-performance", "assets.js"),
						"current-js",
						"utf8",
					);
					await writeFile(
						join(rootDirectory, "dist-performance", "assets.js.map"),
						"current-map",
						"utf8",
					);
					await writeFile(
						join(rootDirectory, "dist-performance", "performance.html"),
						"html",
						"utf8",
					);
					child.stdout.emit("build ok");
					child.emitExit(0);
				})();
				return child;
			},
		};
		const performanceProcess = createPerformanceProcess({
			rootDirectory,
			buildId: "test-build",
			outputDirectory,
			seams,
		});

		const result = await performanceProcess.build();

		expect(result.status).toBe("passed");
		expect(calls[0]).toMatchObject({
			command: "vp",
			args: ["build", "--mode", "performance"],
		});
		expect(calls[0].env.PERFORMANCE_BUILD_ID).toBe("test-build");
		expect(result.manifest?.javascriptHashes["assets.js"]).toBeTruthy();
		expect(result.manifest?.sourceMapHashes["assets.js.map"]).toBeTruthy();
		expect(await readFile(join(outputDirectory, "build", "assets.js"), "utf8")).toBe("current-js");
		expect(await readFile(join(outputDirectory, "build", "assets.js.map"), "utf8")).toBe(
			"current-map",
		);
		expect(result.logs.stdout).toContain("build ok");
	});

	it("retries a bounded occupied preview port without touching the first child again", async () => {
		const rootDirectory = await temporaryDirectory();
		const children: FakeChild[] = [];
		const ports: number[] = [];
		let spawnCount = 0;
		const seams: ProcessSeams = {
			reservePort: async (port) => {
				ports.push(port);
				return port;
			},
			spawn: (_command, args) => {
				const child = new FakeChild();
				children.push(child);
				spawnCount++;
				if (spawnCount === 1) queueMicrotask(() => child.emitExit(1));
				expect(args).toContain("--strictPort");
				return child;
			},
			fetch: async (url) => {
				if (spawnCount === 1) throw new Error("connection refused");
				return responseFor(
					url,
					url.endsWith("performance.html") ? '<script src="/app.js"></script>' : "test-build",
				);
			},
			sleep: async () => undefined,
		};
		const performanceProcess = createPerformanceProcess({
			rootDirectory,
			buildId: "test-build",
			outputDirectory: join(rootDirectory, "run"),
			port: 4100,
			portRetries: 2,
			readinessTimeoutMs: 100,
			seams,
		});

		const preview = await performanceProcess.startPreview();

		expect(preview.result.status).toBe("passed");
		expect(preview.result.port).toBe(4101);
		expect(ports).toEqual([4100, 4101]);
		expect(children[0].killSignals).toEqual(["SIGTERM"]);
		await preview.stop();
		expect(children[1].killSignals).toEqual(["SIGTERM"]);
	});

	it("reports wrong build identity and cleans up a hung child", async () => {
		const rootDirectory = await temporaryDirectory();
		const previewChild = new FakeChild();
		const seams: ProcessSeams = {
			spawn: () => previewChild,
			reservePort: async () => 4100,
			fetch: async (url) => responseFor(url, '<script src="/app.js"></script>'),
			sleep: async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
		};
		const performanceProcess = createPerformanceProcess({
			rootDirectory,
			buildId: "expected-build",
			outputDirectory: join(rootDirectory, "run"),
			readinessTimeoutMs: 5,
			seams,
		});

		const preview = await performanceProcess.startPreview();
		expect(preview.result.status).toBe("failed");
		expect(preview.result.error).toMatch(/build identity/);
		await preview.stop();

		const hungChild = new FakeChild();
		const hungProcess = createPerformanceProcess({
			rootDirectory,
			buildId: "hung-build",
			outputDirectory: join(rootDirectory, "hung-run"),
			buildTimeoutMs: 1,
			seams: { spawn: () => hungChild },
		});
		const build = await hungProcess.build();
		expect(build.status).toBe("timeout");
		expect(hungChild.killSignals).toEqual(["SIGTERM"]);
	});

	it("only terminates owned children", async () => {
		const rootDirectory = await temporaryDirectory();
		const owned = new FakeChild();
		const unrelated = new FakeChild();
		const performanceProcess = createPerformanceProcess({
			rootDirectory,
			buildId: "owned-build",
			outputDirectory: join(rootDirectory, "run"),
			seams: { spawn: () => owned },
		});

		await performanceProcess.stop();

		expect(owned.killSignals).toEqual([]);
		expect(unrelated.killSignals).toEqual([]);
	});
});

async function temporaryDirectory(): Promise<string> {
	return mkdtemp(join(tmpdir(), "terrariavania-process-"));
}

function responseFor(url: string, body: string): ProcessFetchResponse {
	return { status: 200, text: async () => (url.endsWith("app.js") ? body : body) };
}
