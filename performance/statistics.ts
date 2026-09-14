export interface SampleSummary {
	readonly unit: string;
	readonly sampleCount: number;
	readonly mean: number;
	readonly median: number;
	readonly p50: number;
	readonly p95: number;
	readonly p99: number;
}

export interface RateSummary {
	readonly unit: string;
	readonly count: number;
	readonly elapsedMs: number;
	readonly rate: number;
}

export interface RatioSummary {
	readonly unit: "ratio";
	readonly simulationSeconds: number;
	readonly wallSeconds: number;
	readonly ratio: number;
}

export class StatisticsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StatisticsError";
	}
}

export function validateFiniteSamples(
	samples: readonly number[],
	minimumSamples = 1,
): readonly number[] {
	if (!Number.isInteger(minimumSamples) || minimumSamples < 1) {
		throw new StatisticsError("minimumSamples must be a positive integer");
	}
	if (samples.length < minimumSamples) {
		throw new StatisticsError(
			`expected at least ${minimumSamples} samples, received ${samples.length}`,
		);
	}
	if (samples.some((sample) => !Number.isFinite(sample))) {
		throw new StatisticsError("samples must contain only finite numbers");
	}
	return samples;
}

export function nearestRankPercentile(samples: readonly number[], percentile: number): number {
	validateFiniteSamples(samples);
	if (!Number.isFinite(percentile) || percentile < 0 || percentile > 1) {
		throw new StatisticsError("percentile must be finite and between 0 and 1");
	}
	const sorted = [...samples].sort((left, right) => left - right);
	const rank = Math.max(1, Math.ceil(percentile * sorted.length));
	return sorted[rank - 1];
}

export function mean(samples: readonly number[]): number {
	validateFiniteSamples(samples);
	return samples.reduce((total, sample) => total + sample, 0) / samples.length;
}

export function median(samples: readonly number[]): number {
	validateFiniteSamples(samples);
	const sorted = [...samples].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function summarizeSamples(samples: readonly number[], unit: string): SampleSummary {
	if (unit.length === 0) throw new StatisticsError("unit must be non-empty");
	validateFiniteSamples(samples);
	return {
		unit,
		sampleCount: samples.length,
		mean: mean(samples),
		median: median(samples),
		p50: nearestRankPercentile(samples, 0.5),
		p95: nearestRankPercentile(samples, 0.95),
		p99: nearestRankPercentile(samples, 0.99),
	};
}

export function longFrameRate(
	frameDurationsMs: readonly number[],
	elapsedMs: number,
	thresholdMs = 50,
): RateSummary {
	validateFiniteSamples(frameDurationsMs);
	validatePositiveFinite(elapsedMs, "elapsedMs");
	validatePositiveFinite(thresholdMs, "thresholdMs");
	const count = frameDurationsMs.filter((duration) => duration >= thresholdMs).length;
	return { unit: "long-frames/second", count, elapsedMs, rate: count / (elapsedMs / 1000) };
}

export function simulationWallTimeRatio(
	simulationSeconds: number,
	wallSeconds: number,
): RatioSummary {
	validateNonNegativeFinite(simulationSeconds, "simulationSeconds");
	validatePositiveFinite(wallSeconds, "wallSeconds");
	return {
		unit: "ratio",
		simulationSeconds,
		wallSeconds,
		ratio: simulationSeconds / wallSeconds,
	};
}

function validatePositiveFinite(value: number, name: string): void {
	if (!Number.isFinite(value) || value <= 0)
		throw new StatisticsError(`${name} must be positive and finite`);
}

function validateNonNegativeFinite(value: number, name: string): void {
	if (!Number.isFinite(value) || value < 0)
		throw new StatisticsError(`${name} must be non-negative and finite`);
}
