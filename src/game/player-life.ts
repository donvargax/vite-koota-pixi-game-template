import { GameSystem, system, type EntityRef, type Query, type World } from "../ecs/facade.ts";
import { Health, PlayerTag } from "./actors.ts";
import { Aim, AimGun, Gun } from "./combat.ts";
import type { AudioPort } from "./contracts.ts";
import { DashState } from "./dash.ts";
import { Sprite } from "./presentation.ts";
import { SFX } from "./sound-assets.ts";
import { Facing, Position, Velocity } from "./spatial.ts";

const RESPAWN_DELAY = 2;

@system({ priority: 20 })
export class Death extends GameSystem {
	constructor(private readonly dying: Query<{ health: Health }>) {
		super();
	}

	// fallow-ignore-next-line unused-class-member
	execute(): void {
		for (const { entity, components } of this.dying) {
			if (components.health.value <= 0) entity.destroy();
		}
	}
}

export class PlayerLife {
	private player: EntityRef | undefined;
	private previousHealth = 100;
	private deadTimer = 0;

	constructor(
		private readonly world: World,
		private readonly audio: AudioPort,
	) {}

	start(): void {
		this.player = this.spawnPlayer();
	}

	damage(amount: number): void {
		if (!this.player?.isAlive()) return;
		const health = this.player.get(Health);
		if (!health) return;
		this.player.set(Health, { value: health.value - amount });
		this.audio.play(SFX.hurt, 0.5);
	}

	read(): { alive: boolean; health: number; x: number | null } {
		const alive = this.player?.isAlive() ?? false;
		return {
			alive,
			health: alive ? (this.player?.get(Health)?.value ?? 0) : 0,
			x: alive ? (this.player?.get(Position)?.x ?? null) : null,
		};
	}

	observe(health: number, alive: boolean): void {
		if (health < this.previousHealth && alive) this.audio.play(SFX.hurt, 0.4);
		this.previousHealth = health;
	}

	respawn(alive: boolean, dt: number): void {
		if (alive) return;
		this.deadTimer += dt;
		if (this.deadTimer <= RESPAWN_DELAY) return;
		this.deadTimer = 0;
		this.player = this.spawnPlayer();
		this.previousHealth = 100;
		this.audio.play(SFX.respawn, 0.5);
	}

	dispose(): void {
		this.player = undefined;
		this.deadTimer = 0;
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
}
