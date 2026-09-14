import { createHash } from "node:crypto";
import { arch, cpus, hostname, platform, release, version } from "node:os";
import process from "node:process";
import type { EnvironmentRecord } from "./contracts.ts";

type DetectedEnvironmentFields = Omit<
	EnvironmentRecord,
	| "schema"
	| "schemaVersion"
	| "nodeVersion"
	| "os"
	| "architecture"
	| "cpuIdentity"
	| "localMachineKey"
>;

export type EnvironmentInput = Partial<DetectedEnvironmentFields> & {
	readonly localMachineIdentity?: string | null;
};

export interface EnvironmentSnapshot {
	readonly record: EnvironmentRecord;
	readonly compatibilityKey: string;
	readonly provenance: {
		readonly hostKey: string;
		readonly detectedOsVersion: string;
		readonly processVersion: string;
	};
	readonly observed: {
		readonly pageVisible: boolean;
		readonly measuredIdleCadenceMs: number | null;
	};
}

// fallow-ignore-next-line complexity -- one boundary assembles detected, compatibility, and observed data.
export function collectEnvironment(input: EnvironmentInput = {}): EnvironmentSnapshot {
	const isCi = Boolean(process.env.CI);
	const runnerClass =
		input.runnerClass ?? (isCi ? (process.env.PERF_RUNNER_CLASS ?? "ci-unknown") : null);
	const localIdentity = input.localMachineIdentity ?? (isCi ? null : hostname());
	const cpuIdentity = cpus()[0]?.model?.trim() || "unknown-cpu";
	const renderer = input.renderer ?? null;
	const backend = input.backend ?? null;
	const gpuIdentity = input.gpuIdentity ?? null;
	const pageVisible = input.pageVisible ?? true;
	const measuredIdleCadenceMs = input.measuredIdleCadenceMs ?? null;
	const record: EnvironmentRecord = {
		schema: "environment",
		schemaVersion: 1,
		nodeVersion: process.versions.node,
		playwrightVersion: input.playwrightVersion ?? "unknown",
		chromiumVersion: input.chromiumVersion ?? "unknown",
		os: `${platform()} ${release()}`,
		architecture: arch(),
		cpuIdentity,
		runnerClass,
		localMachineKey: localIdentity === null ? null : hashIdentity(`local:${localIdentity}`),
		renderer,
		backend,
		gpuIdentity,
		headless: input.headless ?? true,
		viewportWidth: positiveOrDefault(input.viewportWidth, 1280),
		viewportHeight: positiveOrDefault(input.viewportHeight, 720),
		devicePixelRatio: positiveOrDefault(input.devicePixelRatio, 1),
		throttling: input.throttling ?? "none",
		audioPolicy: input.audioPolicy ?? "disabled",
		pageVisible,
		measuredIdleCadenceMs,
	};
	const compatibilityKey = hashIdentity(
		JSON.stringify({
			nodeVersion: record.nodeVersion,
			playwrightVersion: record.playwrightVersion,
			chromiumVersion: record.chromiumVersion,
			os: record.os,
			architecture: record.architecture,
			cpuIdentity: record.cpuIdentity,
			runnerClass: record.runnerClass,
			localMachineKey: record.localMachineKey,
			renderer,
			backend,
			gpuIdentity,
			headless: record.headless,
			viewportWidth: record.viewportWidth,
			viewportHeight: record.viewportHeight,
			devicePixelRatio: record.devicePixelRatio,
			throttling: record.throttling,
			audioPolicy: record.audioPolicy,
		}),
	);
	return {
		record,
		compatibilityKey,
		provenance: {
			hostKey: hashIdentity(`host:${hostname()}`),
			detectedOsVersion: version(),
			processVersion: process.version,
		},
		observed: { pageVisible, measuredIdleCadenceMs },
	};
}

function hashIdentity(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function positiveOrDefault(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}
