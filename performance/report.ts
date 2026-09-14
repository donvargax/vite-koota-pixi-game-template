import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ComparisonRecord, VerdictStatus } from "./contracts.ts";
import type { EvidenceSummary } from "./evidence.ts";

export interface ReportArtifact {
	readonly path: string;
	readonly kind: string;
	readonly status: "available" | "missing" | "unsupported" | "truncated";
	readonly bytes?: number;
}

export interface ReportEvidence {
	readonly scenarioId: string;
	readonly repetition: number;
	readonly mode: "cpu-trace" | "allocation";
	readonly status: "complete" | "unsupported" | "failed" | "truncated";
	readonly reproduction: "reproduced" | "not-reproduced" | "invalid" | "not-run";
	readonly summary?: EvidenceSummary;
	readonly rawCpuPath?: string | null;
	readonly rawTracePath?: string | null;
	readonly rawAllocationPath?: string | null;
	readonly artifacts?: readonly ReportArtifact[];
	readonly errors?: readonly string[];
}

export interface PerformanceReportInput {
	readonly comparison: ComparisonRecord;
	readonly evidence: readonly ReportEvidence[];
	readonly artifacts?: readonly ReportArtifact[];
	readonly measurements?: readonly {
		readonly scenarioId: string;
		readonly repetition: number;
		readonly workloadValid: boolean;
		readonly status: string;
	}[];
}

export interface PerformanceReportOutput {
	readonly reportHtml: string;
	readonly resultsJson: string;
	readonly summaryMarkdown: string;
	readonly artifactManifest: string;
}

export async function writePerformanceReport(
	input: PerformanceReportInput,
	outputDirectory: string,
): Promise<PerformanceReportOutput> {
	const output = renderPerformanceReport(input);
	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeFile(join(outputDirectory, "report.html"), output.reportHtml, "utf8"),
		writeFile(join(outputDirectory, "results.json"), output.resultsJson, "utf8"),
		writeFile(join(outputDirectory, "summary.md"), output.summaryMarkdown, "utf8"),
		writeFile(join(outputDirectory, "artifact-manifest.json"), output.artifactManifest, "utf8"),
	]);
	return output;
}

export function renderPerformanceReport(input: PerformanceReportInput): PerformanceReportOutput {
	const verdict = input.comparison.originalVerdict;
	const artifacts = normalizeArtifacts([
		...(input.artifacts ?? []),
		...input.evidence.flatMap((entry) => entry.artifacts ?? []),
	]);
	const scenarioRows = scenarioRowsFor(input.comparison);
	const evidenceRows = input.evidence.map((entry) => evidenceRow(entry));
	const results = {
		schema: "phase6-results",
		schemaVersion: 1,
		originalVerdict: verdict,
		comparison: input.comparison,
		evidence: evidenceRows,
		artifacts,
	};
	const artifactManifest = {
		schema: "phase6-artifact-manifest",
		schemaVersion: 1,
		artifacts,
	};
	const resultsJson = `${JSON.stringify(results, null, 2)}\n`;
	const artifactManifestJson = `${JSON.stringify(artifactManifest, null, 2)}\n`;
	const summaryMarkdown = renderSummary(input.comparison, scenarioRows, evidenceRows, artifacts);
	const reportHtml = renderHtml(input.comparison, scenarioRows, evidenceRows, artifacts);
	return { reportHtml, resultsJson, summaryMarkdown, artifactManifest: artifactManifestJson };
}

function renderHtml(
	comparison: ComparisonRecord,
	rows: readonly ScenarioRow[],
	evidence: readonly EvidenceRow[],
	artifacts: readonly ReportArtifact[],
): string {
	const verdict = comparison.originalVerdict;
	const scenarioHtml = rows
		.map(
			(row) =>
				`<tr><td>${escapeHtml(row.scenarioId)}</td><td>${escapeHtml(row.verdict)}</td><td>${escapeHtml(
					row.workload,
				)}</td><td>${escapeHtml(row.metrics)}</td></tr>`,
		)
		.join("");
	const evidenceHtml = evidence
		.map(
			(row) =>
				`<li><strong>${escapeHtml(row.scenarioId)} #${row.repetition}</strong>: ${escapeHtml(
					row.status,
				)} / ${escapeHtml(row.reproduction)}${row.links}${
					row.summary
						? `<details><summary>source and event summary</summary><pre>${escapeHtml(JSON.stringify(row.summary, null, 2))}</pre></details>`
						: ""
				}</li>`,
		)
		.join("");
	const artifactHtml = artifacts
		.map((artifact) =>
			artifact.status === "available"
				? `<li><a href="${escapeAttribute(artifact.path)}">${escapeHtml(artifact.kind)}</a> (${escapeHtml(
						artifact.status,
					)})</li>`
				: `<li>${escapeHtml(artifact.kind)}: ${escapeHtml(artifact.status)}</li>`,
		)
		.join("");
	return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Performance report</title>
<style>body{font:14px system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#202124}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:.45rem;text-align:left}code{word-break:break-all}.status{font-size:1.25rem;font-weight:700}</style>
<h1>Performance report</h1>
<p class="status">Original clean verdict: <code>${escapeHtml(verdict)}</code></p>
<p>Diagnostic replay is evidence only. It cannot replace the original verdict.</p>
<h2>Scenarios</h2>
<table><thead><tr><th>Scenario</th><th>Verdict</th><th>Workload</th><th>Metrics</th></tr></thead><tbody>${scenarioHtml}</tbody></table>
<h2>Diagnostics</h2>
<p>Partial, unsupported, failed, and non-reproduced replays remain visible here.</p>
<ul>${evidenceHtml || "<li>No diagnostic replay was run.</li>"}</ul>
<h2>Artifacts</h2>
<ul>${artifactHtml || "<li>No artifacts were recorded.</li>"}</ul>
<h2>Viewing raw evidence</h2>
<p>Open <code>.cpuprofile</code> in Chrome DevTools Performance, and open trace JSON in a compatible Perfetto or Chrome tracing viewer. This report contains no custom profiler UI and performs no network requests.</p>
</html>
`;
}

function renderSummary(
	comparison: ComparisonRecord,
	rows: readonly ScenarioRow[],
	evidence: readonly EvidenceRow[],
	artifacts: readonly ReportArtifact[],
): string {
	const scenarioLines = rows.map(
		(row) => `| ${row.scenarioId} | ${row.verdict} | ${row.workload} | ${row.metrics} |`,
	);
	const evidenceLines = evidence.map(
		(row) => `| ${row.scenarioId} | ${row.repetition} | ${row.status} | ${row.reproduction} |`,
	);
	return [
		"# Performance report",
		"",
		`Original clean verdict: **${comparison.originalVerdict}**`,
		"",
		"Diagnostic replay is evidence only and never changes the original verdict.",
		"",
		"## Scenarios",
		"",
		"| Scenario | Verdict | Workload | Metrics |",
		"| --- | --- | --- | --- |",
		...scenarioLines,
		"",
		"## Diagnostics",
		"",
		"| Scenario | Repetition | Status | Reproduction |",
		"| --- | ---: | --- | --- |",
		...(evidenceLines.length > 0 ? evidenceLines : ["| none | - | not-run | not-run |"]),
		"",
		"## Artifacts",
		"",
		...(artifacts.length > 0
			? artifacts.map(
					(artifact) =>
						`- ${artifact.kind}: ${artifact.status}${artifact.status === "available" ? ` ([open](${artifact.path}))` : ""}`,
				)
			: ["- none recorded"]),
		"",
		"Import `.cpuprofile` in Chrome DevTools and trace JSON in Perfetto or a compatible Chrome tracing viewer. The report is static and offline.",
		"",
	].join("\n");
}

interface ScenarioRow {
	readonly scenarioId: string;
	readonly verdict: string;
	readonly workload: string;
	readonly metrics: string;
}

interface EvidenceRow {
	readonly scenarioId: string;
	readonly repetition: number;
	readonly status: string;
	readonly reproduction: string;
	readonly links: string;
	readonly summary: EvidenceSummary | null;
}

function scenarioRowsFor(comparison: ComparisonRecord): readonly ScenarioRow[] {
	return comparison.expectedScenarioIds.map((scenarioId) => {
		const statuses = comparison.metricStatuses.filter(
			(status) => status.metric && status.status === "regression",
		);
		const scenarioStatuses =
			statuses.length > 0 ? statuses.map(({ metric }) => metric).join(", ") : "no regression";
		const workload = comparison.perRepetition
			.filter((summary) => summary.scenarioId === scenarioId)
			.every(({ workload }) => workload.validityStatus === "valid" && workload.progressValid)
			? "valid"
			: "invalid";
		return {
			scenarioId,
			verdict: verdictForScenario(comparison, scenarioId),
			workload,
			metrics: scenarioStatuses,
		};
	});
}

function verdictForScenario(comparison: ComparisonRecord, scenarioId: string): VerdictStatus {
	const statuses = comparison.perRepetition
		.filter((summary) => summary.scenarioId === scenarioId)
		.flatMap(({ metrics }) => metrics);
	if (statuses.some((status) => status.status === "regression")) return "regression";
	if (statuses.some((status) => status.status === "invalid" || status.status === "missing"))
		return "workload-invalid";
	return comparison.originalVerdict === "unbaselined-collection"
		? "unbaselined-collection"
		: "passed";
}

function evidenceRow(entry: ReportEvidence): EvidenceRow {
	const paths = [entry.rawCpuPath, entry.rawTracePath, entry.rawAllocationPath]
		.filter((path): path is string => typeof path === "string")
		.map((path) => ` <a href="${escapeAttribute(safeRelativePath(path))}">artifact</a>`)
		.join("");
	return {
		scenarioId: entry.scenarioId,
		repetition: entry.repetition,
		status: entry.status,
		reproduction: entry.reproduction,
		links: paths,
		summary: entry.summary ? sanitizeEvidenceSummary(entry.summary) : null,
	};
}

function normalizeArtifacts(artifacts: readonly ReportArtifact[]): readonly ReportArtifact[] {
	const seen = new Set<string>();
	return artifacts.flatMap((artifact) => {
		const normalized = { ...artifact, path: safeRelativePath(artifact.path) };
		const key = `${normalized.kind}:${normalized.path}`;
		if (seen.has(key)) return [];
		seen.add(key);
		return [normalized];
	});
}

function safeRelativePath(path: string): string {
	let normalized = path.replaceAll("\\", "/");
	if (/^(?:[A-Za-z]:\/|\/)/.test(normalized)) {
		const knownRoot = ["performance-results/", "dist-performance/", "src/", "e2e/"].find((root) => {
			const index = normalized.indexOf(root);
			if (index < 0) return false;
			normalized = normalized.slice(index);
			return true;
		});
		if (!knownRoot) normalized = normalized.split("/").at(-1) ?? "missing-artifact";
	}
	normalized = normalized.replace(/^\/+/, "");
	const segments = normalized
		.split("/")
		.filter((segment) => segment !== ".." && segment !== "." && segment.length > 0);
	return segments.join("/") || "missing-artifact";
}

function sanitizeEvidenceSummary(summary: EvidenceSummary): EvidenceSummary {
	return {
		...summary,
		mappedCpuSummary: summary.mappedCpuSummary.map((sample) => ({
			...sample,
			sourceFile: sample.sourceFile ? safeSourcePath(sample.sourceFile) : null,
		})),
		errors: summary.errors.map((error) => redactPathText(error)),
	};
}

function safeSourcePath(path: string): string {
	const normalized = path.replaceAll("\\", "/");
	const sourceIndex = normalized.lastIndexOf("/src/");
	return sourceIndex >= 0 ? normalized.slice(sourceIndex + 1) : safeRelativePath(normalized);
}

function redactPathText(value: string): string {
	return value.replaceAll(process.cwd().replaceAll("\\", "/"), "<project>");
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replaceAll("`", "&#96;");
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
