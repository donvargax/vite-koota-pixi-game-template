import { describe, expect, it } from "vite-plus/test";
import { World } from "../ecs/facade.ts";
import { FoeTag, PlayerTag } from "./actors.ts";
import { FoeShamble } from "./enemies.ts";
import { Position, Velocity } from "./spatial.ts";

describe("enemies", () => {
	it("moves foes toward the first player without requiring ports", () => {
		const world = World.create((created) => [
			new FoeShamble(
				created.query({ position: Position, velocity: Velocity, foe: FoeTag }),
				created.query({ position: Position, player: PlayerTag }),
			),
		]);
		world.spawn(new Position(80, 0), new PlayerTag());
		world.spawn(new Position(-20, 4), new Velocity(0, 10), new FoeTag());

		world.update(0.1);

		const { components } = [...world.query({ position: Position, velocity: Velocity })][0];
		expect(components.position.y).toBe(0);
		expect(components.velocity.x).toBe(32);
		world.dispose();
	});
});
