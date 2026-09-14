import { createHash } from "node:crypto";
import { spawn as nodeSpawn, execFile as nodeExecFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import type { BuildManifest } from "./contracts.ts";

const execFile = promisify(nodeExecFile);
const DEFAULT_PORT = 4173;
const DEFAULT_PORT_RETRIES = 3;
const DEFAULT_BUILD_TIMEOUT_MS = 120_000;
const DEFAULT_READINESS_TIMEOUT_MS = 30_000;
const DEFAULT_LOG_BYTES = 32 * 1024;
const LOOPBACK_HOST = "127.0.0.1";

export interface ProcessLogs {
	readonly stdout: string;
	readonly stderr: string;
	readonly truncated: boolean;
}

export type InfrastructureStatus = "passed" | "failed" | "timeout" | "unsupported";

export interface BuildResult {
	readonly status: InfrastructureStatus;
	readonly buildId: string;
	readonly outputDirectory: string;
	readonly artifactDirectory: string;
	readonly manifest: BuildManifest | null;
	readonly logs: ProcessLogs;
	readonly exitCode: number | null;
	readonly error: string | null;
}

export interface PreviewResult {
	readonly status: InfrastructureStatus;
	readonly baseUrl: string | null;
	readonly port: number | null;
	readonly logs: ProcessLogs;
	readonly error: string | null;
}

export interface ProcessChild {
	readonly pid?: number;
	readonly stdout?: ProcessOutput;
	readonly stderr?: ProcessOutput;
	on(event: "data", listener: (chunk: unknown) => void): void;
	on(event: "error", listener: (error: Error) => void): void;
	on(event: "exit", listener: (code: number | null, signal: string | null) => void): void;
	kill(signal?: NodeJS.Signals): boolean;
}

export interface ProcessOutput {
	on(event: "data", listener: (chunk: unknown) => void): void;
}

export interface ProcessSpawnOptions {
	readonly cwd: string;
	readonly env: NodeJS.ProcessEnv;
	readonly detached: boolean;
	readonly stdio: ["ignore", "pipe", "pipe"];
}

export interface ProcessFetchResponse {
	readonly status: number;
	readonly text: () => Promise<string>;
}

export interface ProcessSeams {
	readonly spawn?: (
		command: string,
		args: readonly string[],
		options: ProcessSpawnOptions,
	) => ProcessChild;
	readonly fetch?: (url: string) => Promise<ProcessFetchResponse>;
	readonly reservePort?: (preferredPort: number) => Promise<number>;
	readonly sleep?: (milliseconds: number) => Promise<void>;
	readonly readFile?: typeof readFile;
	readonly writeFile?: typeof writeFile;
	readonly copyFile?: typeof copyFile;
	readonly remove?: typeof rm;
}

export interface PerformanceProcessOptions {
	readonly rootDirectory: string;
	readonly buildId: string;
	readonly outputDirectory: string;
	readonly port?: number;
	readonly portRetries?: number;
	readonly buildTimeoutMs?: number;
	readonly readinessTimeoutMs?: number;
	readonly maximumLogBytes?: number;
	readonly seams?: ProcessSeams;
}

export interface OwnedPreviewServer {
	readonly result: PreviewResult;
	readonly stop: () => Promise<void>;
}

export interface PerformanceProcess {
	readonly build: () => Promise<BuildResult>;
	readonly startPreview: () => Promise<OwnedPreviewServer>;
	readonly stop: () => Promise<void>;
}

class ProcessInfrastructureError extends Error {
	readonly status: InfrastructureStatus;
	readonly logs: ProcessLogs;

	constructor(status: InfrastructureStatus, message: string, logs: ProcessLogs = emptyLogs()) {
		super(message);
		this.name = "ProcessInfrastructureError";
		this.status = status;
		this.logs = logs;
	}
}

export function createPerformanceProcess(options: PerformanceProcessOptions): PerformanceProcess {
	assertOptions(options);
	const seams = options.seams ?? {};
	const spawn = seams.spawn ?? defaultSpawn;
	const maximumLogBytes = options.maximumLogBytes ?? DEFAULT_LOG_BYTES;
	let ownedChildren: ProcessChild[] = [];
	let signalHandlersInstalled = false;

	const stop = async (): Promise<void> => {
		const children = ownedChildren;
		ownedChildren = [];
		for (const child of children) await terminateOwnedChild(child);
		removeSignalHandlers();
	};

	const build = async (): Promise<BuildResult> => {
		const outputDirectory = resolve(options.rootDirectory, "dist-performance");
		const artifactDirectory = resolve(options.outputDirectory, "build");
		const logs = createLogBuffer(maximumLogBytes);
		const remove = seams.remove ?? rm;
		await remove(outputDirectory, { recursive: true, force: true });
		await remove(artifactDirectory, { recursive: true, force: true });
		await mkdir(artifactDirectory, { recursive: true });
		const child = spawn(
			"vp",
			["build", "--mode", "performance"],
			spawnOptions(options.rootDirectory, { PERFORMANCE_BUILD_ID: options.buildId }),
		);
		ownedChildren.push(child);
		installSignalHandlers();
		attachLogs(child, logs);
		const outcome = await waitForChild(child, options.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS);
		ownedChildren = ownedChildren.filter((candidate) => candidate !== child);
		if (outcome.timedOut) {
			await terminateOwnedChild(child);
			return {
				status: "timeout",
				buildId: options.buildId,
				outputDirectory,
				artifactDirectory,
				manifest: await preserveBuildArtifacts(options, outputDirectory, artifactDirectory, logs),
				logs: logs.value(),
				exitCode: null,
				error: "performance build timed out",
			};
		}
		const manifest = await preserveBuildArtifacts(
			options,
			outputDirectory,
			artifactDirectory,
			logs,
		);
		if (outcome.error) {
			return {
				status: "failed",
				buildId: options.buildId,
				outputDirectory,
				artifactDirectory,
				manifest,
				logs: logs.value(),
				exitCode: outcome.code,
				error: outcome.error,
			};
		}
		return {
			status: outcome.code === 0 ? "passed" : "failed",
			buildId: options.buildId,
			outputDirectory,
			artifactDirectory,
			manifest,
			logs: logs.value(),
			exitCode: outcome.code,
			error: outcome.code === 0 ? null : `performance build exited with code ${outcome.code}`,
		};
	};

	// fallow-ignore-next-line complexity -- bounded port retry and owned cleanup are one lifecycle boundary.
	const startPreview = async (): Promise<OwnedPreviewServer> => {
		if (process.platform !== "linux") {
			return unavailablePreview("owned process-group cleanup is only supported on Linux");
		}
		const retries = options.portRetries ?? DEFAULT_PORT_RETRIES;
		let lastFailure: PreviewResult | null = null;
		for (let attempt = 0; attempt <= retries; attempt++) {
			const port = await (seams.reservePort ?? reserveLoopbackPort)(
				(options.port ?? DEFAULT_PORT) + attempt,
			);
			const logs = createLogBuffer(maximumLogBytes);
			const child = spawn(
				"vp",
				[
					"preview",
					"--host",
					LOOPBACK_HOST,
					"--port",
					String(port),
					"--strictPort",
					"--outDir",
					"dist-performance",
				],
				spawnOptions(options.rootDirectory),
			);
			ownedChildren.push(child);
			installSignalHandlers();
			attachLogs(child, logs);
			const readiness = await waitForPreview(
				child,
				`http://${LOOPBACK_HOST}:${port}`,
				options.buildId,
				options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
				seams,
			);
			if (readiness.status === "passed") {
				return {
					result: { ...readiness, port, logs: logs.value() },
					stop: async () => {
						ownedChildren = ownedChildren.filter((candidate) => candidate !== child);
						await terminateOwnedChild(child);
						removeSignalHandlersIfIdle();
					},
				};
			}
			ownedChildren = ownedChildren.filter((candidate) => candidate !== child);
			await terminateOwnedChild(child);
			lastFailure = { ...readiness, port, logs: logs.value() };
			if (!readiness.error?.includes("address already in use")) break;
		}
		return {
			result: lastFailure ?? {
				status: "failed",
				baseUrl: null,
				port: null,
				logs: emptyLogs(),
				error: "preview server did not become ready",
			},
			stop: async () => removeSignalHandlersIfIdle(),
		};
	};

	function installSignalHandlers(): void {
		if (signalHandlersInstalled) return;
		const handler = (): void => {
			for (const child of ownedChildren) void terminateOwnedChild(child);
		};
		process.once("SIGINT", handler);
		process.once("SIGTERM", handler);
		signalHandlersInstalled = true;
	}

	function removeSignalHandlers(): void {
		if (!signalHandlersInstalled) return;
		process.removeAllListeners("SIGINT");
		process.removeAllListeners("SIGTERM");
		signalHandlersInstalled = false;
	}

	function removeSignalHandlersIfIdle(): void {
		if (ownedChildren.length === 0) removeSignalHandlers();
	}

	return { build, startPreview, stop };
}

async function reserveLoopbackPort(preferredPort: number): Promise<number> {
	if (!Number.isInteger(preferredPort) || preferredPort < 0 || preferredPort > 65_535)
		throw new ProcessInfrastructureError("failed", "preferred preview port is invalid");
	return new Promise<number>((resolvePort, reject) => {
		const server = createServer();
		server.once("error", (error) => {
			server.close();
			reject(new ProcessInfrastructureError("failed", error.message));
		});
		server.listen(preferredPort, LOOPBACK_HOST, () => {
			const address = server.address();
			const port = typeof address === "object" && address !== null ? address.port : null;
			server.close((error) => {
				if (error || port === null) reject(error ?? new Error("reserved port has no address"));
				else resolvePort(port);
			});
		});
	});
}

// fallow-ignore-next-line complexity -- one manifest boundary hashes and preserves the exact build output.
async function preserveBuildArtifacts(
	options: PerformanceProcessOptions,
	outputDirectory: string,
	artifactDirectory: string,
	logs: LogBuffer,
): Promise<BuildManifest | null> {
	try {
		const files = await listFiles(outputDirectory);
		const outputHashes: Record<string, string> = {};
		const javascriptHashes: Record<string, string> = {};
		const sourceMapHashes: Record<string, string> = {};
		for (const file of files) {
			const relativePath = relative(outputDirectory, file).replaceAll("\\", "/");
			const content = await readFile(file);
			const hash = sha256(content);
			outputHashes[relativePath] = hash;
			if (relativePath.endsWith(".js")) javascriptHashes[relativePath] = hash;
			if (relativePath.endsWith(".map")) sourceMapHashes[relativePath] = hash;
			if (relativePath.endsWith(".js") || relativePath.endsWith(".map")) {
				const destination = join(artifactDirectory, relativePath);
				await mkdir(dirname(destination), { recursive: true });
				await (options.seams?.copyFile ?? copyFile)(file, destination);
			}
		}
		if (files.length === 0) {
			logs.append("stderr", "build output is empty");
			return null;
		}
		const entryFile = files.find((file) => file.endsWith("performance.html")) ?? files[0];
		const manifest: BuildManifest = {
			schema: "build-manifest",
			schemaVersion: 1,
			buildId: options.buildId,
			revision: await gitRevision(options.rootDirectory),
			dirtySourceFingerprint: await sourceFingerprint(options.rootDirectory),
			workloadFingerprint: "unavailable-before-cli-validation",
			optimizedEntryHash: sha256(await readFile(entryFile)),
			optimizedOutputHashes: outputHashes,
			javascriptHashes,
			sourceMapHashes,
			toolVersions: {
				node: process.versions.node,
				vitePlus: "vp",
			},
		};
		const manifestPath = join(artifactDirectory, "build-manifest.json");
		await (options.seams?.writeFile ?? writeFile)(
			manifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`,
			"utf8",
		);
		return manifest;
	} catch (error) {
		logs.append("stderr", `unable to preserve build artifacts: ${errorMessage(error)}`);
		return null;
	}
}

async function sourceFingerprint(rootDirectory: string): Promise<string | null> {
	try {
		const files = [
			...(await listFiles(join(rootDirectory, "src"))),
			...(await listFiles(join(rootDirectory, "performance"))),
			...[
				"index.html",
				"performance.html",
				"vite.config.ts",
				"tsconfig.json",
				"tsconfig.performance.json",
			].map((file) => join(rootDirectory, file)),
		];
		const hash = createHash("sha256");
		for (const file of files.sort()) {
			if ((await stat(file)).isFile()) {
				hash.update(relative(rootDirectory, file));
				hash.update(await readFile(file));
			}
		}
		return hash.digest("hex");
	} catch {
		return null;
	}
}

async function gitRevision(rootDirectory: string): Promise<string> {
	try {
		const result = await execFile("git", ["rev-parse", "HEAD"], { cwd: rootDirectory });
		return result.stdout.trim() || "unversioned";
	} catch {
		return "unversioned";
	}
}

// fallow-ignore-next-line complexity -- readiness must distinguish child exit, transport, timeout, and identity failures.
async function waitForPreview(
	child: ProcessChild,
	baseUrl: string,
	expectedBuildId: string,
	timeoutMs: number,
	seams: ProcessSeams,
): Promise<PreviewResult> {
	const fetcher =
		seams.fetch ?? (globalThis.fetch as unknown as (url: string) => Promise<ProcessFetchResponse>);
	const sleep =
		seams.sleep ??
		((milliseconds: number) =>
			new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
	const deadline = Date.now() + timeoutMs;
	const exitState: { value: { code: number | null; signal: string | null } | null } = {
		value: null,
	};
	let identityMismatch = false;
	child.on("exit", (code, signal) => {
		exitState.value = { code, signal };
	});
	while (Date.now() < deadline) {
		const childExit = exitState.value;
		if (childExit) {
			return {
				status: "failed",
				baseUrl: null,
				port: null,
				logs: emptyLogs(),
				error:
					childExit.code === 1
						? "address already in use"
						: `preview exited with code ${childExit.code}`,
			};
		}
		try {
			const response = await fetcher(`${baseUrl}/performance.html`);
			const html = await response.text();
			if (response.status < 200 || response.status >= 300)
				throw new Error(`preview returned HTTP ${response.status}`);
			const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(
				(match) => match[1],
			);
			const payloads = await Promise.all(
				scripts.map(async (script) => {
					const asset = await fetcher(new URL(script, `${baseUrl}/performance.html`).href);
					return asset.status >= 200 && asset.status < 300 ? asset.text() : "";
				}),
			);
			if (payloads.some((payload) => payload.includes(expectedBuildId)))
				return { status: "passed", baseUrl, port: null, logs: emptyLogs(), error: null };
			identityMismatch = true;
			throw new Error("preview build identity does not match expected build ID");
		} catch {
			await sleep(100);
		}
	}
	if (identityMismatch)
		return {
			status: "failed",
			baseUrl: null,
			port: null,
			logs: emptyLogs(),
			error: "preview build identity does not match expected build ID",
		};
	return {
		status: "timeout",
		baseUrl: null,
		port: null,
		logs: emptyLogs(),
		error: "preview readiness timed out",
	};
}

function unavailablePreview(message: string): OwnedPreviewServer {
	return {
		result: { status: "unsupported", baseUrl: null, port: null, logs: emptyLogs(), error: message },
		stop: async () => undefined,
	};
}

function defaultSpawn(
	command: string,
	args: readonly string[],
	options: ProcessSpawnOptions,
): ProcessChild {
	return nodeSpawn(command, [...args], options) as unknown as ProcessChild;
}

function spawnOptions(
	rootDirectory: string,
	additions: NodeJS.ProcessEnv = {},
): ProcessSpawnOptions {
	return {
		cwd: rootDirectory,
		env: { ...process.env, ...additions },
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	};
}

function attachLogs(child: ProcessChild, logs: LogBuffer): void {
	child.stdout?.on("data", (chunk) => logs.append("stdout", String(chunk)));
	child.stderr?.on("data", (chunk) => logs.append("stderr", String(chunk)));
}

async function waitForChild(
	child: ProcessChild,
	timeoutMs: number,
): Promise<{ code: number | null; error: string | null; timedOut: boolean }> {
	return new Promise((resolveOutcome) => {
		let settled = false;
		const timeout = setTimeout(() => {
			if (!settled) {
				settled = true;
				resolveOutcome({ code: null, error: null, timedOut: true });
			}
		}, timeoutMs);
		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolveOutcome({ code: null, error: error.message, timedOut: false });
		});
		child.on("exit", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolveOutcome({ code, error: null, timedOut: false });
		});
	});
}

async function terminateOwnedChild(child: ProcessChild): Promise<void> {
	if (child.pid === undefined) {
		try {
			child.kill("SIGTERM");
		} catch {
			return;
		}
		return;
	}
	if (process.platform === "linux") {
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch {
			try {
				child.kill("SIGTERM");
			} catch {
				return;
			}
		}
		return;
	}
	try {
		child.kill("SIGTERM");
	} catch {
		return;
	}
}

function assertOptions(options: PerformanceProcessOptions): void {
	if (!options.rootDirectory || !options.outputDirectory || !options.buildId)
		throw new ProcessInfrastructureError(
			"failed",
			"rootDirectory, outputDirectory, and buildId are required",
		);
	if (
		options.portRetries !== undefined &&
		(!Number.isInteger(options.portRetries) || options.portRetries < 0)
	)
		throw new ProcessInfrastructureError("failed", "portRetries must be a non-negative integer");
}

async function listFiles(directory: string): Promise<string[]> {
	try {
		const entries = await readdir(directory, { withFileTypes: true });
		const files: string[] = [];
		for (const entry of entries) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) files.push(...(await listFiles(path)));
			else if (entry.isFile()) files.push(path);
		}
		return files;
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") return [];
		throw error;
	}
}

function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function createLogBuffer(maximumBytes: number): LogBuffer {
	return new LogBuffer(maximumBytes);
}

class LogBuffer {
	private readonly output = { stdout: "", stderr: "" };
	private truncated = false;

	private readonly maximumBytes: number;

	constructor(maximumBytes: number) {
		this.maximumBytes = maximumBytes;
	}

	append(channel: "stdout" | "stderr", value: string): void {
		const remaining = Math.max(
			0,
			this.maximumBytes - Buffer.byteLength(this.output.stdout + this.output.stderr),
		);
		const bounded = Buffer.byteLength(value) <= remaining ? value : value.slice(0, remaining);
		this.output[channel] += bounded;
		if (bounded.length !== value.length) this.truncated = true;
	}

	value(): ProcessLogs {
		return { ...this.output, truncated: this.truncated };
	}
}

function emptyLogs(): ProcessLogs {
	return { stdout: "", stderr: "", truncated: false };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
	return value instanceof Error && "code" in value;
}
