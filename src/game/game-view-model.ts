import { EntityRef, World } from "../ecs/design2.ts";
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
	Sprite,
	Velocity,
} from "./components.ts";
import type { AudioPort, RandomPort } from "./contracts.ts";
import { SFX } from "./sound-assets.ts";

const INITIAL_FOE_POSITIONS = [-140, 120, 190] as const;
const RANDOM_FOE_MIN_X = -160;
const RANDOM_FOE_WIDTH = 320;
const RESPAWN_DELAY = 2;
const REINFORCEMENT_DELAY = 3;

export interface GameViewModelOptions {
	readonly world: World;
	readonly audio: AudioPort;
	readonly random: RandomPort;
	readonly initialFoePositions?: readonly number[];
}

export interface HudProjection {
	readonly playerHealth: number | "dead";
	readonly foeCount: number;
	readonly playerX: number | null;
}

export type RenderAnimation = "idle" | "walk" | "jump" | "projectile";

export interface RenderEntityProjection {
	readonly id: number;
	readonly kind: string;
	readonly x: number;
	readonly y: number;
	readonly velocityX: number;
	readonly velocityY: number;
	readonly facing: number;
	readonly animation: RenderAnimation;
}

export interface RenderProjection {
	readonly entities: readonly RenderEntityProjection[];
}

export class GameViewModel {
	private readonly world: World;
	private player: EntityRef | undefined;
	private started = false;
	private disposed = false;
	private deadTimer = 0;
	private emptyTimer = 0;
	private previousHealth = 100;
	private previousFoeCount: number = INITIAL_FOE_POSITIONS.length;
	private readonly initialFoePositions: readonly number[];

	constructor(private readonly options: GameViewModelOptions) {
		this.initialFoePositions = options.initialFoePositions ?? INITIAL_FOE_POSITIONS;
		this.previousFoeCount = this.initialFoePositions.length;
		this.world = options.world;
	}

	start(): void {
		this.ensureNotDisposed();
		if (this.started) return;
		this.player = this.spawnPlayer();
		for (const x of this.initialFoePositions) this.spawnFoeAt(x);
		this.started = true;
	}

	tick(dt: number): void {
		this.ensureStarted();
		this.world.update(dt);

		const alive = this.player?.isAlive() ?? false;
		const health = alive ? (this.player?.get(Health)?.value ?? 0) : 0;
		const foeCount = this.foeCount();
		this.playStateSounds(health, foeCount, alive);
		this.updateRespawn(alive, dt);
		this.updateReinforcements(foeCount, dt);
	}

	damagePlayer(amount: number): void {
		this.ensureStarted();
		if (!this.player?.isAlive()) return;
		const health = this.player.get(Health);
		if (!health) return;
		this.player.set(Health, { value: health.value - amount });
		this.options.audio.play(SFX.hurt, 0.5);
	}

	spawnFoe(): void {
		this.ensureStarted();
		this.spawnFoeAt(RANDOM_FOE_MIN_X + this.options.random.next() * RANDOM_FOE_WIDTH);
	}

	getHudProjection(): HudProjection {
		this.ensureStarted();
		const alive = this.player?.isAlive() ?? false;
		const playerX = alive ? (this.player?.get(Position)?.x ?? null) : null;
		const projection = {
			playerHealth: alive ? (this.player?.get(Health)?.value ?? 0) : ("dead" as const),
			foeCount: this.foeCount(),
			playerX,
		};
		return Object.freeze(projection);
	}

	getRenderProjection(): RenderProjection {
		this.ensureStarted();
		const entities: RenderEntityProjection[] = [];
		for (const { entity, components } of this.world.query({
			position: Position,
			sprite: Sprite,
			velocity: Velocity,
		})) {
			const { position, sprite, velocity } = components;
			const airborne = position.y > 1;
			const facing = entity.get(Facing)?.x ?? (velocity.x < 0 ? -1 : 1);
			entities.push(
				Object.freeze({
					id: entity.id,
					kind: sprite.texture,
					x: position.x,
					y: position.y,
					velocityX: velocity.x,
					velocityY: velocity.y,
					facing,
					animation: animationFor(sprite.texture, velocity.x, airborne),
				}),
			);
		}
		return Object.freeze({ entities: Object.freeze(entities) });
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.player = undefined;
		this.deadTimer = 0;
		this.emptyTimer = 0;
	}

	private spawnPlayer(): EntityRef {
		return this.world.spawn(
			new Position(0, 40),
			new Velocity(0, 0),
			new Health(100),
			new Sprite("player"),
			new PlayerTag(),
			new Gun(),
			new AimGun(),
			new Facing(),
			new Aim(),
			new DashState(),
		);
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

	private foeCount(): number {
		return this.world.query({ position: Position, foe: FoeTag }).count;
	}

	private playStateSounds(health: number, foeCount: number, alive: boolean): void {
		if (health < this.previousHealth && alive) this.options.audio.play(SFX.hurt, 0.4);
		if (foeCount < this.previousFoeCount) this.options.audio.play(SFX.foeDown, 0.5);
		this.previousHealth = health;
		this.previousFoeCount = foeCount;
	}

	private updateRespawn(alive: boolean, dt: number): void {
		if (alive) return;
		this.deadTimer += dt;
		if (this.deadTimer <= RESPAWN_DELAY) return;
		this.deadTimer = 0;
		this.player = this.spawnPlayer();
		this.previousHealth = 100;
		this.options.audio.play(SFX.respawn, 0.5);
	}

	private updateReinforcements(foeCount: number, dt: number): void {
		if (foeCount > 0) {
			this.emptyTimer = 0;
			return;
		}
		this.emptyTimer += dt;
		if (this.emptyTimer <= REINFORCEMENT_DELAY) return;
		this.emptyTimer = 0;
		this.spawnFoeAt(-160);
		this.spawnFoeAt(160);
		this.previousFoeCount = 2;
		this.options.audio.play(SFX.coin, 0.5);
	}

	private ensureStarted(): void {
		this.ensureNotDisposed();
		if (!this.started) throw new Error("GameViewModel must be started before use");
	}

	private ensureNotDisposed(): void {
		if (this.disposed) throw new Error("Cannot use a disposed GameViewModel");
	}
}

function animationFor(kind: string, velocityX: number, airborne: boolean): RenderAnimation {
	if (kind === "bolt") return "projectile";
	if (airborne) return "jump";
	return Math.abs(velocityX) > 10 ? "walk" : "idle";
}
