import { describe, expect, it } from "vite-plus/test";
import {
	longFrameRate,
	mean,
	median,
	nearestRankPercentile,
	simulationWallTimeRatio,
	StatisticsError,
	summarizeSamples,
	validateFiniteSamples,
} from "./statistics.ts";

describe("performance statistics", () => {
	it("uses nearest-rank indexing for percentiles", () => {
		const samples = [9, 1, 7, 3, 5];
		expect(nearestRankPercentile(samples, 0.5)).toBe(5);
		expect(nearestRankPercentile(samples, 0.95)).toBe(9);
		expect(nearestRankPercentile(samples, 0.99)).toBe(9);
	});

	it("summarizes one sample and reports p50 separately from the mean", () => {
		expect(summarizeSamples([4], "ms")).toEqual({
			unit: "ms",
			sampleCount: 1,
			mean: 4,
			median: 4,
			p50: 4,
			p95: 4,
			p99: 4,
		});
		expect(mean([1, 2, 9])).toBe(4);
		expect(median([1, 2, 9])).toBe(2);
	});

	it("rejects empty, insufficient, and nonfinite samples", () => {
		expect(() => validateFiniteSamples([])).toThrow(StatisticsError);
		expect(() => validateFiniteSamples([1], 2)).toThrow(/at least 2/);
		expect(() => validateFiniteSamples([1, Number.NaN])).toThrow(/finite/);
		expect(() => nearestRankPercentile([1], 1.1)).toThrow(/between 0 and 1/);
	});

	it("normalizes long frames by actual elapsed time", () => {
		expect(longFrameRate([10, 50, 51, 90], 2000)).toEqual({
			unit: "long-frames/second",
			count: 3,
			elapsedMs: 2000,
			rate: 1.5,
		});
		expect(longFrameRate([49.99, 50], 1000).count).toBe(1);
	});

	it("keeps raw frame counts and unequal repetition lengths independent", () => {
		const short = summarizeSamples([1, 3], "ms");
		const long = summarizeSamples([1, 3, 5, 7], "ms");
		expect(short.sampleCount).toBe(2);
		expect(long.sampleCount).toBe(4);
		expect(short.mean).toBe(2);
		expect(long.mean).toBe(4);
	});

	it("calculates capped simulation-to-wall ratio without using frame count", () => {
		expect(simulationWallTimeRatio(6, 8)).toEqual({
			unit: "ratio",
			simulationSeconds: 6,
			wallSeconds: 8,
			ratio: 0.75,
		});
		expect(() => simulationWallTimeRatio(6, 0)).toThrow(/wallSeconds/);
		expect(() => longFrameRate([1], Number.POSITIVE_INFINITY)).toThrow(/elapsedMs/);
	});
});
