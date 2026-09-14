import { describe, expect, it } from "vite-plus/test";
import { World } from "../ecs/facade.ts";
import { FoeTag, Health, PlayerTag } from "./actors.ts";
import {
	Aim,
	AimGun,
	AimSystem,
	BoltHit,
	Gun,
	Projectile,
	Shooting,
	type EntitySpawnCapability,
} from "./combat.ts";
import { Facing, Position, Velocity } from "./spatial.ts";
import { FakeAudio, FakeInput } from "./test-support.ts";

function spawnerFor(world: World): EntitySpawnCapability {
	return { spawn: (...instances) => world.spawn(...instances) };
}

describe("combat", () => {
	it("normalizes independent WASD aim across the full circle", () => {
		const input = new FakeInput();
		input.aim = { x: 1, y: 1 };
		const world = World.create((created) => [
			new AimSystem(created.query({ aim: Aim, player: PlayerTag }), input),
		]);
		world.spawn(new Aim(), new PlayerTag());

		world.update(0.1);

		const { components } = [...world.query({ aim: Aim })][0];
		expect(components.aim.x).toBeCloseTo(Math.SQRT1_2);
		expect(components.aim.y).toBeCloseTo(Math.SQRT1_2);
		world.dispose();
	});

	it("spawns projectiles through the executing World's narrow capability", () => {
		const input = new FakeInput();
		const audio = new FakeAudio();
		input.shootHeld = true;
		const world = World.create((created) => [
			new Shooting(
				created.query({
					position: Position,
					gun: Gun,
					aimGun: AimGun,
					facing: Facing,
					aim: Aim,
					player: PlayerTag,
				}),
				spawnerFor(created),
				input,
				audio,
			),
		]);
		world.spawn(
			new Position(10, 0),
			new Gun(),
			new AimGun(),
			new Facing(-1),
			new Aim(0, 1),
			new PlayerTag(),
		);

		world.update(0.01);

		expect(world.query({ projectile: Projectile }).count).toBe(2);
		expect(
			[...world.query({ velocity: Velocity })].map(({ components }) => components.velocity),
		).toEqual(
			expect.arrayContaining([
				{ x: -420, y: 0 },
				{ x: 0, y: 420 },
			]),
		);
		expect(audio.played).toHaveLength(2);
		world.dispose();
	});

	it("applies bolt damage, removes bolts on hit, and plays hit sounds", () => {
		const audio = new FakeAudio();
		const world = World.create((created) => [
			new BoltHit(
				created.query({ position: Position, projectile: Projectile }),
				created.query({ position: Position, health: Health, foe: FoeTag }),
				audio,
			),
		]);
		world.spawn(new Position(0, 0), new Health(3), new FoeTag());
		world.spawn(new Position(0, 0), new Projectile(2, 1));

		world.update(0.1);

		expect([...world.query({ health: Health })][0].components.health.value).toBe(1);
		expect(world.query({ projectile: Projectile }).count).toBe(0);
		expect(audio.played).toHaveLength(1);
		world.dispose();
	});

	it("expires bolts before collision without damaging foes or playing hit sounds", () => {
		const audio = new FakeAudio();
		const world = World.create((created) => [
			new BoltHit(
				created.query({ position: Position, projectile: Projectile }),
				created.query({ position: Position, health: Health, foe: FoeTag }),
				audio,
			),
		]);
		world.spawn(new Position(0, 0), new Health(3), new FoeTag());
		world.spawn(new Position(0, 0), new Projectile(2, 0.1));

		world.update(0.1);

		expect(world.query({ projectile: Projectile }).count).toBe(0);
		expect([...world.query({ health: Health })][0].components.health.value).toBe(3);
		expect(audio.played).toHaveLength(0);
		world.dispose();
	});
});
