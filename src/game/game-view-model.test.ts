import { describe, expect, it } from "vite-plus/test";
import type { AudioPort, InputPort, RandomPort } from "./contracts.ts";
import { SFX } from "./sound-assets.ts";
import { GameViewModel } from "./game-view-model.ts";

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

class FakeRandom implements RandomPort {
	constructor(private readonly values: number[]) {}

	next(): number {
		return this.values.shift() ?? 0;
	}
}

function createModel(
	values = [0.5],
	initialFoePositions?: readonly number[],
): {
	model: GameViewModel;
	audio: FakeAudio;
	input: FakeInput;
} {
	const input = new FakeInput();
	const audio = new FakeAudio();
	const model = new GameViewModel({
		input,
		audio,
		random: new FakeRandom(values),
		initialFoePositions,
	});
	return { model, audio, input };
}

describe("GameViewModel", () => {
	it("starts idempotently with the player and initial foes", () => {
		const { model } = createModel();

		model.start();
		model.start();

		expect(model.getHudProjection()).toEqual({
			playerHealth: 100,
			foeCount: 3,
			playerX: 0,
		});
		expect(model.getRenderProjection().entities).toHaveLength(4);
		model.dispose();
	});

	it("damages the player and places spawned foes through the random port", () => {
		const { model, audio } = createModel([0.25]);
		model.start();

		model.damagePlayer(25);
		model.spawnFoe();

		expect(model.getHudProjection().playerHealth).toBe(75);
		expect(model.getHudProjection().foeCount).toBe(4);
		expect(model.getRenderProjection().entities.at(-1)).toMatchObject({ kind: "zombie", x: -80 });
		expect(audio.played).toEqual([{ sound: SFX.hurt, volume: 0.5 }]);
		model.dispose();
	});

	it("ticks the World and exposes immutable HUD and render projections", () => {
		const { model, input } = createModel();
		model.start();
		input.axis = 1;

		model.tick(0.1);

		const hud = model.getHudProjection();
		const render = model.getRenderProjection();
		expect(hud.playerX).toBe(15);
		expect(render.entities[0]).toMatchObject({ kind: "player", x: 15, velocityX: 150, facing: 1 });
		expect(Object.isFrozen(hud)).toBe(true);
		expect(Object.isFrozen(render)).toBe(true);
		expect(Object.isFrozen(render.entities)).toBe(true);
		expect(Object.isFrozen(render.entities[0])).toBe(true);
		model.dispose();
	});

	it("respawns after the delayed death timer and records application sounds", () => {
		const { model, audio } = createModel();
		model.start();
		model.damagePlayer(100);
		model.tick(0.1);
		expect(model.getHudProjection().playerHealth).toBe("dead");

		model.tick(2.01);

		expect(model.getHudProjection().playerHealth).toBe(100);
		expect(audio.played.at(-1)).toEqual({ sound: SFX.respawn, volume: 0.5 });
		model.dispose();
	});

	it("reinforces an empty arena only after the delayed timer", () => {
		const { model, audio } = createModel([], []);
		model.start();

		model.tick(3);
		expect(model.getHudProjection().foeCount).toBe(0);
		expect(audio.played).toEqual([]);
		model.tick(0.01);
		expect(model.getHudProjection().foeCount).toBe(2);
		expect(audio.played.at(-1)).toEqual({ sound: SFX.coin, volume: 0.5 });
		model.dispose();
	});

	it("rejects use before start and after idempotent disposal", () => {
		const { model } = createModel();
		expect(() => model.tick(0.1)).toThrow(/must be started/);
		model.start();
		model.dispose();
		model.dispose();
		expect(() => model.tick(0.1)).toThrow(/disposed GameViewModel/);
		expect(() => model.spawnFoe()).toThrow(/disposed GameViewModel/);
	});

	it("keeps World and service state isolated between ViewModels", () => {
		const first = createModel([], []);
		const second = createModel([], []);
		first.model.start();
		second.model.start();
		first.input.axis = 1;

		first.model.tick(0.1);
		second.model.tick(0.1);

		expect(first.model.getHudProjection().playerX).toBe(15);
		expect(second.model.getHudProjection().playerX).toBe(0);
		first.model.dispose();
		second.model.tick(0.1);
		expect(second.model.getHudProjection().playerX).toBe(0);
		second.model.dispose();
	});
});
