import { describe, expect, it } from "vite-plus/test";
import { World } from "../ecs/facade.ts";
import { PlayerTag } from "./actors.ts";
import { FloorCorrection, Movement, Platformer } from "./locomotion.ts";
import { Facing, Position, Velocity } from "./spatial.ts";
import { FakeAudio, FakeInput } from "./test-support.ts";

describe("locomotion", () => {
	it("moves players, updates facing, and plays a jump sound from constructor ports", () => {
		const input = new FakeInput();
		const audio = new FakeAudio();
		input.axis = -1;
		input.jumpPressed = true;
		const world = World.create((created) => [
			new Platformer(
				created.query({ position: Position, velocity: Velocity, player: PlayerTag }),
				created.query({ player: PlayerTag, facing: Facing }),
				input,
				audio,
			),
		]);
		world.spawn(new Position(0, 0), new Velocity(), new PlayerTag(), new Facing());

		world.update(0.1);

		const player = [...world.query({ position: Position, velocity: Velocity })][0];
		const facing = [...world.query({ facing: Facing })][0];
		expect(player.components.velocity.y).toBe(380);
		expect(facing.components.facing.x).toBe(-1);
		expect(audio.played).toHaveLength(1);
		world.dispose();
	});

	it("corrects falling entities after movement in the production schedule", () => {
		const input = new FakeInput();
		const audio = new FakeAudio();
		const world = World.create((created) => [
			new Platformer(
				created.query({ position: Position, velocity: Velocity, player: PlayerTag }),
				created.query({ player: PlayerTag, facing: Facing }),
				input,
				audio,
			),
			new Movement(created.query({ position: Position, velocity: Velocity })),
			new FloorCorrection(created.query({ position: Position, velocity: Velocity })),
		]);
		world.spawn(new Position(1, 1), new Velocity(0, -100), new PlayerTag());

		world.update(0.02);

		const { components } = [...world.query({ position: Position, velocity: Velocity })][0];
		expect(components.position.y).toBe(0);
		expect(components.velocity.y).toBe(0);
		world.dispose();
	});
});
