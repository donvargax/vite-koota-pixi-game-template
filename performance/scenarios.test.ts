import { describe, expect, it } from "vite-plus/test";
import manifestJson from "./scenarios.json";
import {
	expandScenarioMatrix,
	getScenario,
	selectScenarios,
	validateScenarioManifest,
	workloadFingerprint,
} from "./scenarios.ts";

function copyManifest(): Record<string, unknown> {
	return structuredClone(manifestJson) as Record<string, unknown>;
}

function scenariosOf(manifest: Record<string, unknown>): Array<Record<string, unknown>> {
	return manifest.scenarios as Array<Record<string, unknown>>;
}

describe("performance scenarios", () => {
	it("accepts the complete declared manifest and creates the expected matrices", () => {
		const manifest = validateScenarioManifest(manifestJson);

		expect(manifest.scenarios).toHaveLength(8);
		expect(selectScenarios(manifest, "fast").map(({ id }) => id)).toEqual([
			"idle",
			"movement",
			"firing",
			"foes-50",
		]);
		expect(selectScenarios(manifest, "full")).toHaveLength(7);
		expect(expandScenarioMatrix(manifest, "fast")).toHaveLength(12);
		expect(expandScenarioMatrix(manifest, "full")).toHaveLength(21);
		expect(getScenario(manifest, "bullets-1000").targets).toMatchObject({ foes: 200, bolts: 1000 });
		expect(workloadFingerprint(manifest, "fast")).toMatch(/^[0-9a-f]{8}$/);
	});

	it("rejects duplicate IDs", () => {
		const input = copyManifest();
		scenariosOf(input)[1].id = "idle";

		expect(() => validateScenarioManifest(input)).toThrow(/duplicate scenario id idle/);
	});

	it("rejects nonfinite or out-of-range numbers", () => {
		const input = copyManifest();
		scenariosOf(input)[0].sampleMs = -1;

		expect(() => validateScenarioManifest(input)).toThrow(
			/sampleMs must be a positive bounded integer/,
		);
	});

	it("rejects unknown and duplicate selections", () => {
		const manifest = validateScenarioManifest(manifestJson);

		expect(() => selectScenarios(manifest, ["missing"])).toThrow(
			/unknown scenario selection missing/,
		);
		expect(() => selectScenarios(manifest, ["idle", "idle"])).toThrow(
			/duplicate scenario selection idle/,
		);
	});

	it("rejects oversized populations", () => {
		const input = copyManifest();
		const targets = scenariosOf(input)[0].targets as Record<string, unknown>;
		targets.bolts = 1001;

		expect(() => validateScenarioManifest(input)).toThrow(
			/targets.bolts must be an integer from 0 through 1000/,
		);
	});

	it("rejects contradictory timing schedules", () => {
		const input = copyManifest();
		const scenario = scenariosOf(input)[1];
		const schedule = scenario.input as Record<string, unknown>;
		schedule.events = [
			{ atMs: 0, kind: "keydown", key: "ArrowRight" },
			{ atMs: 8000, kind: "keyup", key: "ArrowRight" },
		];

		expect(() => validateScenarioManifest(input)).toThrow(
			/events\[1\]\.atMs must be before sample end/,
		);
	});

	it("rejects a missing load envelope", () => {
		const input = copyManifest();
		delete scenariosOf(input)[0].validity;

		expect(() => validateScenarioManifest(input)).toThrow(/validity is required/);
	});

	it("rejects a validity envelope that changes the declared target", () => {
		const input = copyManifest();
		const validity = scenariosOf(input)[2].validity as Record<string, unknown>;
		validity.afterMaintenanceBolts = 39;

		expect(() => validateScenarioManifest(input)).toThrow(/bolt targets must match targets.bolts/);
	});

	it("rejects malformed manifests before executing any workload", () => {
		expect(() => validateScenarioManifest(null)).toThrow(/manifest must be an object/);
		const input = copyManifest();
		input.schema = "wrong";
		input.schemaVersion = 2;
		input.workloadVersion = "";
		input.scenarios = "wrong";

		expect(() => validateScenarioManifest(input)).toThrow(/schema must be/);
	});

	it("rejects malformed scenario declarations", () => {
		const input = copyManifest();
		const invalid = scenariosOf(input)[0];
		invalid.id = "Bad ID";
		invalid.schema = "wrong";
		invalid.schemaVersion = 2;
		invalid.workloadVersion = "";
		invalid.category = "unknown";
		invalid.seed = 1.5;
		invalid.targets = null;
		invalid.layout = null;
		invalid.input = null;
		invalid.audio = "unknown";
		invalid.warmupMs = 0;
		invalid.sampleMs = 0;
		invalid.repetitions = 0;
		invalid.membership = null;
		invalid.validity = null;

		expect(() => validateScenarioManifest(input)).toThrow(/id must be/);
	});

	it("rejects a workload version mismatch and empty membership selections", () => {
		const mismatch = copyManifest();
		scenariosOf(mismatch)[0].workloadVersion = "other-version";
		expect(() => validateScenarioManifest(mismatch)).toThrow(/must match manifest workloadVersion/);

		const empty = copyManifest();
		empty.scenarios = [];
		expect(() => validateScenarioManifest(empty)).toThrow(
			/scenarios must contain at least one scenario/,
		);
	});

	it("rejects invalid target and layout values", () => {
		const input = copyManifest();
		const invalid = scenariosOf(input)[2];
		const targets = invalid.targets as Record<string, unknown>;
		targets.foes = -1;
		targets.bolts = 1001;
		targets.upperLaneBoltRatio = 2;
		targets.finiteBoltLifeSeconds = 0;
		targets.boltVelocityMin = 0;
		targets.boltVelocityMax = 0;
		targets.boltDamage = 0;
		const layout = invalid.layout as Record<string, unknown>;
		layout.version = "";
		layout.pattern = "";
		layout.worldMinX = 10;
		layout.worldMaxX = -10;
		layout.groundY = 0;
		layout.boltUpperLaneY = 1;
		layout.boltGroundLaneY = Number.NaN;

		expect(() => validateScenarioManifest(input)).toThrow(/targets/);
	});

	it("rejects invalid input events and held-key declarations", () => {
		const input = copyManifest();
		const schedule = scenariosOf(input)[1].input as Record<string, unknown>;
		schedule.origin = "warmup";
		schedule.maxLatenessMs = -1;
		schedule.events = [
			null,
			{ atMs: 8000, kind: "keydown", key: "ArrowRight" },
			{ atMs: 10, kind: "unknown", key: "" },
			{ atMs: 5, kind: "keydown", key: "ArrowRight" },
			{ atMs: 6, kind: "keydown", key: "ArrowRight" },
		];
		schedule.heldKeys = ["", "ArrowRight", "ArrowRight"];

		expect(() => validateScenarioManifest(input)).toThrow(/input/);
	});

	it("rejects contradictory membership and validity envelopes", () => {
		const membershipInput = copyManifest();
		const selfTest = scenariosOf(membershipInput)[0];
		selfTest.category = "self-test";
		selfTest.membership = { fast: true, full: true, baseline: true };
		expect(() => validateScenarioManifest(membershipInput)).toThrow(/self-test/);

		const validityInput = copyManifest();
		const invalid = scenariosOf(validityInput)[2];
		invalid.membership = { fast: false, full: false, baseline: true };
		const validity = invalid.validity as Record<string, unknown>;
		validity.beforeSimulationFoes = 9;
		validity.afterSimulationFoes = 20;
		validity.afterMaintenanceFoes = 8;
		validity.beforeSimulationBolts = 39;
		validity.afterSimulationBolts = 40;
		validity.afterMaintenanceBolts = 38;
		validity.projectedVisibleBoltsMinimum = 41;
		validity.hardPopulationCeiling = 1;
		validity.minimumSimulationSeconds = 100;
		validity.minimumWallSeconds = 100;
		validity.minimumSuccessfulRenderCount = 0;
		expect(() => validateScenarioManifest(validityInput)).toThrow(/membership/);
	});

	it("rejects an empty explicit selection", () => {
		const manifest = validateScenarioManifest(manifestJson);
		expect(() => selectScenarios(manifest, [])).toThrow(/selection cannot be empty/);
	});
});
