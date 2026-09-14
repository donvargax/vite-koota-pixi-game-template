import { component, GameSystem, system, type Query } from "../ecs/facade.ts";
import { FoeTag, Health, PlayerTag } from "./actors.ts";
import type { AudioPort, InputPort } from "./contracts.ts";
import { Sprite } from "./presentation.ts";
import { SFX } from "./sound-assets.ts";
import { Facing, Position, Velocity } from "./spatial.ts";

const BOLT_SPEED = 420;
const FIRE_COOLDOWN = 0.22;
const BOLT_RADIUS_SQ = 20 * 20;

@component()
export class Gun {
	cooldown = 0;
	constructor(cooldown = 0) {
		this.cooldown = cooldown;
	}
}

@component()
export class AimGun {
	cooldown = 0;
	constructor(cooldown = 0) {
		this.cooldown = cooldown;
	}
}

@component()
export class Aim {
	x = 1;
	y = 0;

	constructor(x = 1, y = 0) {
		this.x = x;
		this.y = y;
	}
}

@component()
export class Projectile {
	damage = 1;
	life = 1;
	constructor(damage = 1, life = 1) {
		this.damage = damage;
		this.life = life;
	}
}

@system({ priority: 12 })
export class Shooting extends GameSystem {
	constructor(
		private readonly shooters: Query<{
			position: Position;
			gun: Gun;
			aimGun: AimGun;
			facing: Facing;
			aim: Aim;
			player: PlayerTag;
		}>,
		private readonly spawner: EntitySpawnCapability,
		private readonly input: InputPort,
		private readonly audio: AudioPort,
	) {
		super();
	}

	// fallow-ignore-next-line unused-class-member
	execute(dt: number): void {
		for (const { components } of this.shooters) {
			const { position: pos, gun, aimGun, facing, aim } = components;
			gun.cooldown -= dt;
			aimGun.cooldown -= dt;
			if (!this.input.isShootHeld()) continue;

			if (gun.cooldown <= 0) {
				this.spawner.spawn(
					new Position(pos.x + facing.x * 18, pos.y + 26 + facing.y * 18),
					new Velocity(facing.x * BOLT_SPEED, facing.y * BOLT_SPEED),
					new Projectile(1, 1.4),
					new Sprite("bolt"),
				);
				gun.cooldown = FIRE_COOLDOWN;
				this.audio.play(SFX.shoot, 0.35);
			}

			if (aimGun.cooldown <= 0) {
				this.spawner.spawn(
					new Position(pos.x + aim.x * 18, pos.y + 10 + aim.y * 18),
					new Velocity(aim.x * BOLT_SPEED, aim.y * BOLT_SPEED),
					new Projectile(1, 1.4),
					new Sprite("bolt"),
				);
				aimGun.cooldown = FIRE_COOLDOWN;
				this.audio.play(SFX.shoot, 0.35);
			}
		}
	}
}

@system({ priority: 15 })
export class BoltHit extends GameSystem {
	constructor(
		private readonly bolts: Query<{ position: Position; projectile: Projectile }>,
		private readonly foes: Query<{ position: Position; health: Health; foe: FoeTag }>,
		private readonly audio: AudioPort,
	) {
		super();
	}

	// fallow-ignore-next-line
	execute(dt: number): void {
		for (const { entity: bolt, components } of this.bolts) {
			const { position: bpos, projectile: b } = components;
			b.life -= dt;
			if (b.life <= 0) {
				bolt.destroy();
				continue;
			}
			for (const { components } of this.foes) {
				const { position: fpos, health: hp } = components;
				const dx = fpos.x - bpos.x;
				const dy = fpos.y - bpos.y;
				if (dx * dx + dy * dy < BOLT_RADIUS_SQ) {
					hp.value -= b.damage;
					this.audio.play(SFX.hit, 0.4);
					bolt.destroy();
					break;
				}
			}
		}
	}
}

@system({ priority: 9 })
export class AimSystem extends GameSystem {
	constructor(
		private readonly players: Query<{ aim: Aim; player: PlayerTag }>,
		private readonly input: InputPort,
	) {
		super();
	}

	// fallow-ignore-next-line unused-class-member
	execute(): void {
		const axis = this.input.aimAxis();
		const length = Math.hypot(axis.x, axis.y);
		if (length === 0) return;
		for (const { components } of this.players) {
			components.aim.x = axis.x / length;
			components.aim.y = axis.y / length;
		}
	}
}

export interface EntitySpawnCapability {
	spawn(...instances: object[]): void;
}
