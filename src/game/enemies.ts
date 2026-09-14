import { GameSystem, system, type Query, type World } from "../ecs/facade.ts";
import { FoeTag, Health, PlayerTag } from "./actors.ts";
import type { AudioPort, RandomPort } from "./contracts.ts";
import { Sprite } from "./presentation.ts";
import { SFX } from "./sound-assets.ts";
import { FLOOR_Y, Position, Velocity } from "./spatial.ts";

const RANDOM_FOE_MIN_X = -160;
const RANDOM_FOE_WIDTH = 320;
const REINFORCEMENT_DELAY = 3;

@system({ priority: 7 })
export class FoeShamble extends GameSystem {
	constructor(
		private readonly foes: Query<{ position: Position; velocity: Velocity; foe: FoeTag }>,
		private readonly players: Query<{ position: Position; player: PlayerTag }>,
	) {
		super();
	}

	// fallow-ignore-next-line
	execute(_dt: number): void {
		const hero = this.players.entities[0];
		const heroX = hero ? (hero.get(Position)?.x ?? 0) : 0;
		for (const { components } of this.foes) {
			const { position: pos, velocity: vel } = components;
			pos.y = FLOOR_Y;
			const dx = heroX - pos.x;
			vel.x = Math.abs(dx) < 4 ? 0 : Math.sign(dx) * 32;
		}
	}
}

export class EnemyPopulation {
	private emptyTimer = 0;
	private previousCount: number;

	constructor(
		private readonly world: World,
		private readonly audio: AudioPort,
		private readonly random: RandomPort,
		private readonly initialPositions: readonly number[] = [-140, 120, 190],
	) {
		this.previousCount = initialPositions.length;
	}

	start(): void {
		for (const x of this.initialPositions) this.spawnFoeAt(x);
	}

	spawn(): void {
		this.spawnFoeAt(RANDOM_FOE_MIN_X + this.random.next() * RANDOM_FOE_WIDTH);
	}

	count(): number {
		return this.world.query({ position: Position, foe: FoeTag }).count;
	}

	observe(count: number): void {
		if (count < this.previousCount) this.audio.play(SFX.foeDown, 0.5);
		this.previousCount = count;
	}

	reinforce(count: number, dt: number): void {
		if (count > 0) {
			this.emptyTimer = 0;
			return;
		}
		this.emptyTimer += dt;
		if (this.emptyTimer <= REINFORCEMENT_DELAY) return;
		this.emptyTimer = 0;
		this.spawnFoeAt(-160);
		this.spawnFoeAt(160);
		this.previousCount = 2;
		this.audio.play(SFX.coin, 0.5);
	}

	dispose(): void {
		this.emptyTimer = 0;
	}

	private spawnFoeAt(x: number): void {
		this.world.spawn(
			new Position(x, 0),
			new Velocity(0, 0),
			new Health(3),
			new Sprite("zombie"),
			new FoeTag(),
		);
	}
}
