import { describe, expect, it } from "vite-plus/test";
import { World } from "../ecs/facade.ts";
import {
	Aim,
	AimGun,
	DashState,
	FoeTag,
	Facing,
	Gun,
	Health,
	PlayerTag,
	Position,
	Projectile,
	Velocity,
} from "./components.ts";
import type { AudioPort, Direction2D, InputPort } from "./contracts.ts";
import {
	AimSystem,
	BoltHit,
	DashSystem,
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
	aim: Direction2D = { x: 0, y: 0 };
	jumpPressed = false;
	shootHeld = false;
	dashPressed = false;

	moveAxis(): number {
		return this.axis;
	}

	aimAxis(): Direction2D {
		return this.aim;
	}

	consumeJumpPressed(): boolean {
		const pressed = this.jumpPressed;
		this.jumpPressed = false;
		return pressed;
	}

	isShootHeld(): boolean {
		return this.shootHeld;
	}

	consumeDashPressed(): boolean {
		const pressed = this.dashPressed;
		this.dashPressed = false;
		return pressed;
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
		world.dispose();
	});

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

	it("applies bolt damage, expires bolts, and plays hit sounds", () => {
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

	it("destroys entities with depleted health", () => {
		const world = World.create((created) => [new Death(created.query({ health: Health }))]);
		world.spawn(new Health(0));
		world.spawn(new Health(1));

		world.update(0);

		expect(world.query({ health: Health }).count).toBe(1);
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
