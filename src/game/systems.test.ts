import { describe, expect, it } from "vite-plus/test";
import { World } from "../ecs/design2.ts";
import { FoeTag, Gun, Health, PlayerTag, Position, Projectile, Velocity } from "./components.ts";
import type { AudioPort, InputPort } from "./contracts.ts";
import {
	BoltHit,
	Death,
	FloorCorrection,
	FoeShamble,
	Movement,
	Platformer,
	Shooting,
	createGameSystems,
} from "./systems.ts";
import type { EntitySpawnCapability } from "./systems.ts";

class FakeInput implements InputPort {
	axis = 0;
	jumpPressed = false;
	shootHeld = false;

	moveAxis(): number {
		return this.axis;
	}

	consumeJumpPressed(): boolean {
		const pressed = this.jumpPressed;
		this.jumpPressed = false;
		return pressed;
	}

	isShootHeld(): boolean {
		return this.shootHeld;
	}
}

class FakeAudio implements AudioPort {
	readonly played: Array<{ sound: string; volume: number | undefined }> = [];

	play(sound: string, volume?: number): void {
		this.played.push({ sound, volume });
	}
}

function spawnerFor(world: World): EntitySpawnCapability {
	return { spawn: (...instances) => world.spawn(...instances) };
}

describe("game systems", () => {
	it("moves players, faces guns, and plays a jump sound from constructor ports", () => {
		const input = new FakeInput();
		const audio = new FakeAudio();
		input.axis = -1;
		input.jumpPressed = true;
		const world = World.create((created) => [
			new Platformer(
				created.query(Position, Velocity, PlayerTag),
				created.query(PlayerTag, Gun),
				input,
				audio,
			),
		]);
		world.spawn(new Position(0, 0), new Velocity(), new PlayerTag(), new Gun());

		world.update(0.1);

		const player = [...world.query<[Position, Velocity]>(Position, Velocity)][0];
		const gun = [...world.query<[Gun]>(Gun)][0];
		expect(player.comps[1].y).toBe(380);
		expect(gun.comps[0].dir).toBe(-1);
		expect(audio.played).toHaveLength(1);
		world.dispose();
	});

	it("corrects falling entities after movement in the production schedule", () => {
		const input = new FakeInput();
		const audio = new FakeAudio();
		const world = World.create((created) => [
			new Platformer(
				created.query(Position, Velocity, PlayerTag),
				created.query(PlayerTag, Gun),
				input,
				audio,
			),
			new Movement(created.query(Position, Velocity)),
			new FloorCorrection(created.query(Position, Velocity)),
		]);
		world.spawn(new Position(1, 1), new Velocity(0, -100), new PlayerTag());

		world.update(0.02);

		const { comps } = [...world.query<[Position, Velocity]>(Position, Velocity)][0];
		expect(comps[0].y).toBe(0);
		expect(comps[1].y).toBe(0);
		world.dispose();
	});

	it("moves foes toward the first player without requiring ports", () => {
		const world = World.create((created) => [
			new FoeShamble(created.query(Position, Velocity, FoeTag), created.query(Position, PlayerTag)),
		]);
		world.spawn(new Position(80, 0), new PlayerTag());
		world.spawn(new Position(-20, 4), new Velocity(0, 10), new FoeTag());

		world.update(0.1);

		const { comps } = [...world.query<[Position, Velocity]>(Position, Velocity)][0];
		expect(comps[0].y).toBe(0);
		expect(comps[1].x).toBe(32);
		world.dispose();
	});

	it("spawns projectiles through the executing World's narrow capability", () => {
		const input = new FakeInput();
		const audio = new FakeAudio();
		input.shootHeld = true;
		const world = World.create((created) => [
			new Shooting(created.query(Position, Gun, PlayerTag), spawnerFor(created), input, audio),
		]);
		world.spawn(new Position(10, 0), new Gun(0, -1), new PlayerTag());

		world.update(0.01);

		expect(world.query(Projectile).count).toBe(1);
		expect(audio.played).toHaveLength(1);
		world.dispose();
	});

	it("keeps shooting and query state isolated between two Worlds", () => {
		const firstInput = new FakeInput();
		const secondInput = new FakeInput();
		const firstAudio = new FakeAudio();
		const secondAudio = new FakeAudio();
		firstInput.shootHeld = true;
		secondInput.shootHeld = true;
		const first = World.create((world) => createGameSystems(world, firstInput, firstAudio));
		const second = World.create((world) => createGameSystems(world, secondInput, secondAudio));
		first.spawn(new Position(), new Gun(), new PlayerTag());
		second.spawn(new Position(), new Gun(), new PlayerTag());

		first.update(0.01);
		first.update(0.01);
		second.update(0.01);

		expect(first.query(Projectile).count).toBe(1);
		expect(second.query(Projectile).count).toBe(1);
		first.dispose();
		second.spawn(new Position(10, 0), new Health(1), new FoeTag());
		second.update(0.01);
		expect(second.query(Projectile).count).toBe(1);
		second.dispose();
	});

	it("applies bolt damage, expires bolts, and plays hit sounds", () => {
		const audio = new FakeAudio();
		const world = World.create((created) => [
			new BoltHit(
				created.query(Position, Projectile),
				created.query(Position, Health, FoeTag),
				audio,
			),
		]);
		world.spawn(new Position(0, 0), new Health(3), new FoeTag());
		world.spawn(new Position(0, 0), new Projectile(2, 1));

		world.update(0.1);

		expect([...world.query<[Health]>(Health)][0].comps[0].value).toBe(1);
		expect(world.query(Projectile).count).toBe(0);
		expect(audio.played).toHaveLength(1);
		world.dispose();
	});

	it("destroys entities with depleted health", () => {
		const world = World.create((created) => [new Death(created.query(Health))]);
		world.spawn(new Health(0));
		world.spawn(new Health(1));

		world.update(0);

		expect(world.query(Health).count).toBe(1);
		world.dispose();
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
		const world = World.create((created) => createGameSystems(created, input, audio));
		world.spawn(new Position(0, 0), new Velocity(), new Health(100), new PlayerTag(), new Gun());

		world.update(0.01);

		expect(world.query(Projectile).count).toBe(1);
		expect(audio.played).toHaveLength(1);
		world.dispose();
	});
});
