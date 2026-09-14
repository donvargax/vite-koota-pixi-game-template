import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { ComparisonRecord } from "./contracts.ts";
import { renderPerformanceReport, writePerformanceReport, type ReportEvidence } from "./report.ts";

function comparison(overrides: Partial<ComparisonRecord> = {}): ComparisonRecord {
	return {
		schema: "comparison",
		schemaVersion: 1,
		mode: "clean",
		expectedScenarioIds: ["idle<script>"],
		expectedRepetitions: { "idle<script>": 1 },
		receivedCoverage: { "idle<script>": [0] },
		perRepetition: [
			{
				scenarioId: "idle<script>",
				repetition: 0,
				metrics: [
					{
						metric: "frameCpuWorkP95Ms",
						status: "regression",
						direction: "lower-is-better",
						expected: 1,
						received: 4,
						delta: 3,
						relativeDelta: 3,
						reason: "known regression",
					},
				],
				window: {} as ComparisonRecord["perRepetition"][number]["window"],
				workload: {
					schema: "workload",
					schemaVersion: 1,
					scenarioId: "idle<script>",
					repetition: 0,
					beforeSimulationFoes: 0,
					afterSimulationFoes: 0,
					afterMaintenanceFoes: 0,
					beforeSimulationBolts: 0,
					afterSimulationBolts: 0,
					afterMaintenanceBolts: 0,
					projectedOnScreenBolts: 0,
					spawnCount: 0,
					recycleCount: 0,
					removalCount: 0,
					hitCount: 0,
					foeDownCount: 0,
					simulationSeconds: 1,
					rawWallSeconds: 1,
					minimumLoad: 0,
					maximumLoad: 0,
					progressValid: true,
					validityStatus: "valid",
					failures: [],
				},
			},
		],
		medianRepetitionAggregates: { "idle<script>": { frameCpuWorkP95Ms: 4 } },
		baselineProvenance: "/home/user/private/baseline.json",
		policyProvenance: "tracked-policy",
		workloadFingerprint: "workload-fingerprint",
		metricStatuses: [
			{
				metric: "frameCpuWorkP95Ms",
				status: "regression",
				direction: "lower-is-better",
				expected: 1,
				received: 4,
				delta: 3,
				relativeDelta: 3,
				reason: "known regression",
			},
		],
		status: "regression",
		originalVerdict: "regression",
		reasons: ["known regression"],
		...overrides,
	};
}

const evidence: ReportEvidence = {
	scenarioId: "idle<script>",
	repetition: 0,
	mode: "cpu-trace",
	status: "complete",
	reproduction: "not-reproduced",
	rawCpuPath: "/home/user/private/performance-results/run/profile.cpuprofile",
	rawTracePath: "../trace.json",
	summary: {
		mappedCpuSummary: [
			{
				functionName: "knownWork",
				sourceFile: "/home/user/private/src/known.ts",
				line: 4,
				column: 2,
				selfMs: 2,
				totalMs: 3,
			},
		],
		observedEvents: [],
		supportedCapabilities: ["cpu-profile"],
		missingCapabilities: ["chromium-trace"],
		errors: [],
		truncation: null,
		sampleCount: 1,
		eventCount: 0,
		recognizedEventCount: 0,
		overlapAwareDurationMs: 0,
	},
};

describe("performance reports", () => {
	it("escapes HTML, redacts paths, and preserves a regression after replay", () => {
		const output = renderPerformanceReport({
			comparison: comparison(),
			evidence: [evidence],
			artifacts: [
				{ kind: "profile", path: "/home/user/private/profile.cpuprofile", status: "available" },
				{ kind: "trace", path: "/home/user/private/trace.json", status: "missing" },
			],
		});
		expect(output.reportHtml).toContain("idle&lt;script&gt;");
		expect(output.reportHtml).not.toContain("<script>");
		expect(output.reportHtml).toContain("Original clean verdict: <code>regression</code>");
		expect(output.reportHtml).toContain("known.ts");
		expect(output.reportHtml).not.toContain("/home/user/private");
		expect(output.reportHtml).toContain("unsupported");
		expect(output.summaryMarkdown).toContain("not-reproduced");
	});

	it("keeps unbaselined and invalid measurements readable with missing artifacts", () => {
		const output = renderPerformanceReport({
			comparison: comparison({
				status: "unbaselined-collection",
				originalVerdict: "unbaselined-collection",
				perRepetition: [],
			}),
			evidence: [
				{
					scenarioId: "idle",
					repetition: 0,
					mode: "allocation",
					status: "unsupported",
					reproduction: "invalid",
					errors: ["missing required workload"],
				},
			],
			artifacts: [{ kind: "allocation", path: "allocation.json", status: "unsupported" }],
		});
		expect(output.resultsJson).toContain('"originalVerdict": "unbaselined-collection"');
		expect(output.reportHtml).toContain("invalid");
		expect(output.reportHtml).toContain("unsupported");
		expect(output.summaryMarkdown).toContain("unbaselined-collection");
	});

	it("writes the four offline report artifacts", async () => {
		const directory = await mkdtemp(join(tmpdir(), "terrariavania-report-"));
		await writePerformanceReport({ comparison: comparison(), evidence: [] }, directory);
		await expect(readFile(join(directory, "report.html"), "utf8")).resolves.toContain(
			"Performance report",
		);
		await expect(readFile(join(directory, "results.json"), "utf8")).resolves.toContain(
			"phase6-results",
		);
		await expect(readFile(join(directory, "summary.md"), "utf8")).resolves.toContain(
			"Original clean verdict",
		);
		await expect(readFile(join(directory, "artifact-manifest.json"), "utf8")).resolves.toContain(
			"phase6-artifact-manifest",
		);
	});
});
