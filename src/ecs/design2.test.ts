// Design 2 acceptance test: Aurelia-style ECS over koota.
import { describe, expect, it } from "vite-plus/test";
import { World } from "./design2.ts";
import { Health, Position, Velocity } from "../game/components.ts";
import { order } from "../game/systems.ts";
import "../game/systems.ts";

describe("design2 (Aurelia-style)", () => {
	it("moves entities and removes the dead, in priority order", () => {
		order.length = 0;
		const world = new World();
		const player = world.spawn(new Position(0, 0), new Velocity(10, 0), new Health(100));
		world.spawn(new Position(0, 0), new Velocity(0, 0), new Health(0));

		world.update(0.5);

		expect(player.get(Position).x).toBe(5);
		expect(world.query(Health).count).toBe(1);
		expect(order).toEqual(["movement", "death"]);
	});

	it("exposes has/set round-trip", () => {
		const world = new World();
		// NOTE: systems are singletons wired per-World; use a fresh world with no
		// update() call so query wiring from the previous test is untouched.
		const e = world.spawn(new Position(1, 2));
		expect(e.has(Velocity)).toBe(false);
		expect(e.get(Position)).toMatchObject({ x: 1, y: 2 });
		e.set(Position, { x: 9 });
		expect(e.get(Position).x).toBe(9);
	});
});
