import { describe, expect, it } from "vite-plus/test";
import { World } from "../ecs/facade.ts";
import { FoeTag } from "../game/actors.ts";
import { createGameSystems } from "../game/composition.ts";
import { GameViewModel } from "../game/game-view-model.ts";
import { FakeAudio, FakeInput } from "../game/test-support.ts";
import { Position } from "../game/spatial.ts";
import manifestJson from "../../performance/scenarios.json";
import { validateScenarioManifest } from "../../performance/scenarios.ts";
import type { ScenarioDefinition } from "../../performance/contracts.ts";
import { createBenchmarkWorkload, type BenchmarkWorkload } from "./workload.ts";

const manifest = validateScenarioManifest(manifestJson);

function scenario(id: string): ScenarioDefinition {
	const found = manifest.scenarios.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`Missing test scenario ${id}`);
	return found;
}

function createSession(
	id: string,
	input = new FakeInput(),
): {
	world: World;
	model: GameViewModel;
	workload: BenchmarkWorkload;
	input: FakeInput;
} {
	const audio = new FakeAudio();
	const world = World.create((created) => createGameSystems(created, input, audio));
	const model = new GameViewModel({
		world,
		audio,
		random: { next: () => 0.5 },
		initialFoePositions: [],
	});
	model.start();
	const workload = createBenchmarkWorkload({ world, model }, { scenario: scenario(id) });
	workload.resetWindow();
	return { world, model, workload, input };
}

function frame(session: ReturnType<typeof createSession>, dtSeconds: number, render = true): void {
	const { model, workload } = session;
	workload.beforeSimulation(dtSeconds);
	model.tick(dtSeconds);
	workload.afterSimulation(dtSeconds);
	if (render) workload.afterRender(model.getRenderProjection());
}

function closeSession(session: ReturnType<typeof createSession>): void {
	session.workload.dispose();
	session.model.dispose();
	session.world.dispose();
}

describe("benchmark workload", () => {
	it("maintains exact declared foe and bolt targets at simulation boundaries", () => {
		const session = createSession("bullets-250");

		frame(session, 0.016);
		const record = session.workload.getWindowRecord(1);

		expect(record.beforeSimulationFoes).toBe(50);
		expect(record.beforeSimulationBolts).toBe(250);
		expect(record.afterMaintenanceFoes).toBe(50);
		expect(record.afterMaintenanceBolts).toBe(250);
		expect(record.maximumLoad).toBeLessThanOrEqual(400);
		closeSession(session);
	});

	it("records lower post-simulation load and recycles finite-life bolts", () => {
		const session = createSession("bullets-250");

		frame(session, 2, false);
		const record = session.workload.getWindowRecord(2);

		expect(record.afterSimulationBolts).toBeLessThan(record.beforeSimulationBolts);
		expect(record.afterMaintenanceBolts).toBe(250);
		expect(record.recycleCount).toBeGreaterThan(0);
		expect(record.removalCount).toBeGreaterThan(0);
		closeSession(session);
	});

	it("keeps exactly 50 foes with normal dual-gun firing input", () => {
		const input = new FakeInput();
		input.shootHeld = true;
		const session = createSession("foes-50", input);

		frame(session, 0.25);
		const foeCount = session.world.query({ position: Position, foe: FoeTag }).count;

		expect(foeCount).toBe(50);
		expect(session.workload.getWindowRecord(1).maximumLoad).toBeLessThanOrEqual(256);
		closeSession(session);
	});

	it("distributes foes through controlled slots and is repeatable for equal steps", () => {
		const first = createSession("foes-50");
		const second = createSession("foes-50");
		frame(first, 0.016, false);
		frame(second, 0.016, false);

		const positions = (session: ReturnType<typeof createSession>) =>
			[...session.world.query({ position: Position, foe: FoeTag })].map(
				({ components }) => components.position.x,
			);
		expect(positions(first)).toEqual(positions(second));
		expect(positions(first).every((x) => x >= -160 && x <= 160)).toBe(true);
		expect(new Set(positions(first)).size).toBe(50);
		closeSession(first);
		closeSession(second);
	});

	it("keeps large workloads bounded without disabling composed systems", () => {
		const input = new FakeInput();
		input.shootHeld = true;
		const session = createSession("bullets-1000", input);

		for (const dt of [0.016, 0.5, 2, 0.25, 1.5]) frame(session, dt, true);
		const record = session.workload.getWindowRecord(5);

		expect(record.maximumLoad).toBeLessThanOrEqual(1250);
		expect(record.afterMaintenanceFoes).toBe(200);
		expect(record.afterMaintenanceBolts).toBe(1000);
		expect(record.projectedOnScreenBolts).toBeGreaterThanOrEqual(800);
		closeSession(session);
	});

	it("fails validity when simulation or render progress is absent", () => {
		const session = createSession("bullets-250");

		frame(session, 0, false);
		const record = session.workload.getWindowRecord(0);

		expect(record.progressValid).toBe(false);
		expect(record.validityStatus).toBe("invalid");
		expect(record.failures.map(({ message }) => message)).toEqual(
			expect.arrayContaining(["simulation progress", "wall-time progress", "render progress"]),
		);
		closeSession(session);
	});
});
