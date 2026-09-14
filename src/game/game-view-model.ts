import type { World } from "../ecs/facade.ts";
import type { AudioPort, RandomPort } from "./contracts.ts";
import { EnemyPopulation } from "./enemies.ts";
import { PlayerLife } from "./player-life.ts";
import { Sprite } from "./presentation.ts";
import { Facing, Position, Velocity } from "./spatial.ts";

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
	private readonly player: PlayerLife;
	private readonly enemies: EnemyPopulation;
	private started = false;
	private disposed = false;

	constructor(options: GameViewModelOptions) {
		this.world = options.world;
		this.player = new PlayerLife(options.world, options.audio);
		this.enemies = new EnemyPopulation(
			options.world,
			options.audio,
			options.random,
			options.initialFoePositions,
		);
	}

	start(): void {
		this.ensureNotDisposed();
		if (this.started) return;
		this.player.start();
		this.enemies.start();
		this.started = true;
	}

	tick(dt: number): void {
		this.ensureStarted();
		this.world.update(dt);
		const { alive, health } = this.player.read();
		const count = this.enemies.count();
		// Observe this frame before either feature creates next-frame actors.
		this.player.observe(health, alive);
		this.enemies.observe(count);
		this.player.respawn(alive, dt);
		this.enemies.reinforce(count, dt);
	}

	damagePlayer(amount: number): void {
		this.ensureStarted();
		this.player.damage(amount);
	}

	spawnFoe(): void {
		this.ensureStarted();
		this.enemies.spawn();
	}

	getHudProjection(): HudProjection {
		this.ensureStarted();
		const { alive, health, x } = this.player.read();
		return Object.freeze({
			playerHealth: alive ? health : "dead",
			foeCount: this.enemies.count(),
			playerX: x,
		});
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
		this.player.dispose();
		this.enemies.dispose();
		this.started = false;
		this.disposed = true;
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
