import { describe, expect, it } from "vite-plus/test";
import { World } from "../ecs/facade.ts";
import { FoeTag, Health, PlayerTag } from "./actors.ts";
import { Aim, AimGun, Gun, Projectile } from "./combat.ts";
import { createGameSystems } from "./composition.ts";
import { DashState } from "./dash.ts";
import { Facing, Position, Velocity } from "./spatial.ts";
import { FakeAudio, FakeInput } from "./test-support.ts";

describe("game systems", () => {
	it("keeps shooting and query state isolated between two Worlds", () => {
		const firstInput = new FakeInput();
		const secondInput = new FakeInput();
		const firstAudio = new FakeAudio();
		const secondAudio = new FakeAudio();
		firstInput.shootHeld = true;
		secondInput.shootHeld = true;
		const first = World.create((world) => createGameSystems(world, firstInput, firstAudio));
		const second = World.create((world) => createGameSystems(world, secondInput, secondAudio));
		const playerComponents = [new Gun(), new AimGun(), new Facing(), new Aim(), new PlayerTag()];
		first.spawn(new Position(), new Velocity(), ...playerComponents);
		second.spawn(
			new Position(),
			new Velocity(),
			new Gun(),
			new AimGun(),
			new Facing(),
			new Aim(),
			new PlayerTag(),
		);

		first.update(0.01);
		first.update(0.01);
		second.update(0.01);

		expect(first.query({ projectile: Projectile }).count).toBe(2);
		expect(second.query({ projectile: Projectile }).count).toBe(2);
		first.dispose();
		second.spawn(new Position(10, 0), new Health(1), new FoeTag());
		second.update(0.01);
		expect(second.query({ projectile: Projectile }).count).toBe(1);
		second.dispose();
	});

	it("creates fresh systems and queries for every factory call", () => {
		const firstInput = new FakeInput();
		const secondInput = new FakeInput();
		const firstAudio = new FakeAudio();
		const secondAudio = new FakeAudio();
		let firstSystems: ReturnType<typeof createGameSystems> | undefined;
		let secondSystems: ReturnType<typeof createGameSystems> | undefined;
		const first = World.create((world) => {
			firstSystems = createGameSystems(world, firstInput, firstAudio);
			return firstSystems;
		});
		const second = World.create((world) => {
			secondSystems = createGameSystems(world, secondInput, secondAudio);
			return secondSystems;
		});

		expect(firstSystems).not.toBe(secondSystems);
		expect(firstSystems?.[0]).not.toBe(secondSystems?.[0]);
		first.dispose();
		second.dispose();
	});

	it("runs the complete system factory with fake ports", () => {
		const input = new FakeInput();
		const audio = new FakeAudio();
		input.shootHeld = true;
		input.dashPressed = true;
		const world = World.create((created) => createGameSystems(created, input, audio));
		world.spawn(
			new Position(0, 0),
			new Velocity(),
			new Health(100),
			new PlayerTag(),
			new Gun(),
			new AimGun(),
			new Facing(),
			new Aim(),
			new DashState(),
		);

		world.update(0.01);

		expect(world.query({ projectile: Projectile }).count).toBe(2);
		expect([...world.query({ velocity: Velocity })][0].components.velocity.x).toBe(600);
		expect(audio.played).toHaveLength(2);
		world.dispose();
	});
});
