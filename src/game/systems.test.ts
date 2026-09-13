import { describe, expect, it } from "vite-plus/test";
import { instanceProvider } from "../ecs/di.ts";
import { World } from "../ecs/design2.ts";
import { FoeTag, Gun, Health, PlayerTag, Position, Projectile, Velocity } from "./components.ts";
import { IAudio, IInput, type AudioPort, type InputPort } from "./contracts.ts";
import {
	BoltHit,
	Death,
	FloorCorrection,
	FoeShamble,
	Movement,
	Platformer,
	Shooting,
	gameSystems,
} from "./systems.ts";

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

function providers(input = new FakeInput(), audio = new FakeAudio()) {
	return {
		input,
		audio,
		providers: [instanceProvider(IInput, input), instanceProvider(IAudio, audio)],
	};
}

describe("game systems", () => {
	it("exports the production systems in schedule order", () => {
		expect(gameSystems).toEqual([
			Platformer,
			FoeShamble,
			Movement,
			FloorCorrection,
			Shooting,
			BoltHit,
			Death,
		]);
	});

	it("moves players, faces guns, and plays a jump sound from scoped input", () => {
		const input = new FakeInput();
		const audio = new FakeAudio();
		input.axis = -1;
		input.jumpPressed = true;
		const world = new World({
			systems: [Platformer],
			providers: providers(input, audio).providers,
		});
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
		const world = new World({
			systems: [Platformer, Movement, FloorCorrection],
			providers: providers(input, audio).providers,
		});
		world.spawn(new Position(1, 1), new Velocity(0, -100), new PlayerTag());

		world.update(0.02);

		const { comps } = [...world.query<[Position, Velocity]>(Position, Velocity)][0];
		expect(comps[0].y).toBe(0);
		expect(comps[1].y).toBe(0);
		world.dispose();
	});

	it("moves foes toward the first player without requiring ports", () => {
		const world = new World({ systems: [FoeShamble] });
		world.spawn(new Position(80, 0), new PlayerTag());
		world.spawn(new Position(-20, 4), new Velocity(0, 10), new FoeTag());

		world.update(0.1);

		const { comps } = [...world.query<[Position, Velocity]>(Position, Velocity)][0];
		expect(comps[0].y).toBe(0);
		expect(comps[1].x).toBe(32);
		world.dispose();
	});

	it("spawns projectiles in the executing World and observes its own input", () => {
		const first = providers();
		const second = providers();
		first.input.shootHeld = true;
		second.input.shootHeld = false;
		const firstWorld = new World({ systems: [Shooting], providers: first.providers });
		const secondWorld = new World({ systems: [Shooting], providers: second.providers });
		firstWorld.spawn(new Position(10, 0), new Gun(0, -1), new PlayerTag());
		secondWorld.spawn(new Position(20, 0), new Gun(), new PlayerTag());

		firstWorld.update(0.01);
		secondWorld.update(0.01);

		expect(firstWorld.query(Projectile).count).toBe(1);
		expect(secondWorld.query(Projectile).count).toBe(0);
		expect(first.audio.played).toHaveLength(1);
		expect(second.audio.played).toHaveLength(0);
		firstWorld.dispose();
		secondWorld.dispose();
	});

	it("applies bolt damage, expires bolts, and plays hit sounds", () => {
		const audio = new FakeAudio();
		const world = new World({
			systems: [BoltHit],
			providers: providers(new FakeInput(), audio).providers,
		});
		world.spawn(new Position(0, 0), new Health(3), new FoeTag());
		world.spawn(new Position(0, 0), new Projectile(2, 1));

		world.update(0.1);

		expect([...world.query<[Health]>(Health)][0].comps[0].value).toBe(1);
		expect(world.query(Projectile).count).toBe(0);
		expect(audio.played).toHaveLength(1);
		world.dispose();
	});

	it("destroys entities with depleted health", () => {
		const world = new World({ systems: [Death] });
		world.spawn(new Health(0));
		world.spawn(new Health(1));

		world.update(0);

		expect(world.query(Health).count).toBe(1);
		world.dispose();
	});

	it("preserves independent cooldown state between Worlds", () => {
		const first = providers();
		const second = providers();
		first.input.shootHeld = true;
		second.input.shootHeld = true;
		const firstWorld = new World({ systems: [Shooting], providers: first.providers });
		const secondWorld = new World({ systems: [Shooting], providers: second.providers });
		firstWorld.spawn(new Position(), new Gun(), new PlayerTag());
		secondWorld.spawn(new Position(), new Gun(), new PlayerTag());

		firstWorld.update(0.01);
		firstWorld.update(0.01);
		secondWorld.update(0.01);

		expect(firstWorld.query(Projectile).count).toBe(1);
		expect(secondWorld.query(Projectile).count).toBe(1);
		firstWorld.dispose();
		secondWorld.dispose();
	});

	it("runs the complete manifest with fake ports", () => {
		const { input, audio, providers: scopedProviders } = providers();
		input.shootHeld = true;
		const world = new World({ systems: gameSystems, providers: scopedProviders });
		world.spawn(new Position(0, 0), new Velocity(), new Health(100), new PlayerTag(), new Gun());

		world.update(0.01);

		expect(world.query(Projectile).count).toBe(1);
		expect(audio.played).toHaveLength(1);
		world.dispose();
	});
});
