import { describe, expect, it } from "vite-plus/test";
import { World } from "../ecs/facade.ts";
import { Health } from "./actors.ts";
import { Death } from "./player-life.ts";

describe("player life", () => {
	it("destroys entities with depleted health", () => {
		const world = World.create((created) => [new Death(created.query({ health: Health }))]);
		world.spawn(new Health(0));
		world.spawn(new Health(1));

		world.update(0);

		expect(world.query({ health: Health }).count).toBe(1);
		world.dispose();
	});
});
