import { describe, expect, it } from "vite-plus/test";
import { World } from "../ecs/facade.ts";
import { PlayerTag } from "./actors.ts";
import { DashState, DashSystem } from "./dash.ts";
import { Movement } from "./locomotion.ts";
import { Facing, Position, Velocity } from "./spatial.ts";
import { FakeInput } from "./test-support.ts";

describe("dash", () => {
	it("dashes a player in its facing direction and respects its cooldown", () => {
		const input = new FakeInput();
		input.dashPressed = true;
		const world = World.create((created) => [
			new DashSystem(
				created.query({
					velocity: Velocity,
					facing: Facing,
					dashState: DashState,
					player: PlayerTag,
				}),
				input,
			),
			new Movement(created.query({ position: Position, velocity: Velocity })),
		]);
		world.spawn(new Position(), new Velocity(), new Facing(-1), new DashState(), new PlayerTag());

		world.update(0.1);

		let player = [
			...world.query({ position: Position, velocity: Velocity, dashState: DashState }),
		][0];
		expect(player.components.position.x).toBe(-60);
		expect(player.components.velocity.x).toBe(-600);
		expect(player.components.dashState.remaining).toBeCloseTo(0.18);

		input.dashPressed = true;
		world.update(0.1);
		player = [...world.query({ position: Position, velocity: Velocity, dashState: DashState })][0];
		expect(player.components.position.x).toBe(-120);
		expect(player.components.velocity.x).toBe(-600);

		input.dashPressed = true;
		world.update(0.1);
		player = [...world.query({ position: Position, velocity: Velocity, dashState: DashState })][0];
		expect(player.components.position.x).toBe(-120);
		expect(player.components.velocity.x).toBe(0);
		expect(player.components.dashState.cooldown).toBeCloseTo(0.4);

		world.update(0.5);
		player = [...world.query({ position: Position, velocity: Velocity, dashState: DashState })][0];
		expect(player.components.dashState.cooldown).toBe(0);
		expect(player.components.velocity.x).toBe(0);

		input.dashPressed = true;
		world.update(0.1);
		player = [...world.query({ position: Position, velocity: Velocity, dashState: DashState })][0];
		expect(player.components.position.x).toBe(-180);
		expect(player.components.velocity.x).toBe(-600);
		expect(player.components.dashState.remaining).toBeCloseTo(0.18);
		expect(player.components.dashState.cooldown).toBeCloseTo(0.6);
		world.dispose();
	});
});
