import { describe, expect, it } from "vite-plus/test";
import { World } from "../ecs/facade.ts";
import { FoeTag, Health, PlayerTag } from "../game/actors.ts";
import { Aim, AimGun, Gun, Projectile } from "../game/combat.ts";
import { createGameSystems } from "../game/composition.ts";
import type { AudioPort, InputPort } from "../game/contracts.ts";
import { DashState } from "../game/dash.ts";
import { Sprite } from "../game/presentation.ts";
import { Facing, Position, Velocity } from "../game/spatial.ts";

const dt = 1 / 60;
const warmupTicks = 30;
const measuredTicks = 120;
const sampleCount = 8;

const input: InputPort = {
	moveAxis: () => 0,
	aimAxis: () => ({ x: 0, y: 0 }),
	consumeJumpPressed: () => false,
	consumeDashPressed: () => false,
	isShootHeld: () => false,
};
const audio: AudioPort = { play: () => undefined };

describe.runIf(process.env.RUN_QUERY_BENCHMARK === "1")(
	"ECS query representation benchmark",
	() => {
		it("measures a fixed combat tick workload", () => {
			const timings = Array.from({ length: sampleCount }, () => measureSample());
			const sorted = timings.toSorted((a, b) => a - b);
			const result = {
				variant: process.env.QUERY_VARIANT ?? "unspecified",
				sampleCount,
				warmupTicks,
				measuredTicks,
				medianMs: sorted[Math.floor(sorted.length / 2)],
				p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
				allMs: timings,
			};
			console.log(JSON.stringify(result));
			expect(timings.every(Number.isFinite)).toBe(true);
		}, 30_000);
	},
);

function measureSample(): number {
	const world = World.create((created) => createGameSystems(created, input, audio));
	spawnWorkload(world);
	for (let tick = 0; tick < warmupTicks; tick++) world.update(dt);
	const start = performance.now();
	for (let tick = 0; tick < measuredTicks; tick++) world.update(dt);
	const elapsed = performance.now() - start;
	world.dispose();
	return elapsed;
}

function spawnWorkload(world: World): void {
	world.spawn(
		new Position(0, 0),
		new Velocity(),
		new Health(1_000_000),
		new Sprite("player"),
		new PlayerTag(),
		new Gun(1_000_000),
		new AimGun(1_000_000),
		new Facing(),
		new Aim(),
		new DashState(),
	);
	for (let index = 0; index < 50; index++) {
		world.spawn(
			new Position(-160 + index * 6.4, 0),
			new Velocity(),
			new Health(1_000_000),
			new Sprite("zombie"),
			new FoeTag(),
		);
	}
	for (let index = 0; index < 100; index++) {
		world.spawn(
			new Position(-160 + (index % 50) * 6.4, 100),
			new Velocity(240, 0),
			new Projectile(1, 1_000_000),
			new Sprite("bolt"),
		);
	}
}
