import { GameSystem, system, type Query, type World } from "../ecs/facade.ts";
import { SFX } from "./assets.ts";
import type { AudioPort, InputPort } from "./contracts.ts";
import {
	Aim,
	AimGun,
	DashState,
	Facing,
	FoeTag,
	Gun,
	Health,
	PlayerTag,
	Position,
	Projectile,
	Sprite,
	Velocity,
} from "./components.ts";

// Demo tuning (px, seconds).
const SPEED = 150;
const JUMP_VELOCITY = 380;
const GRAVITY = 1100;
// fallow-ignore-next-line unused-export
export const FLOOR_Y = 0;
const BOLT_SPEED = 420;
const FIRE_COOLDOWN = 0.22;
const BOLT_RADIUS_SQ = 20 * 20;
const DASH_SPEED = 600;
const DASH_DURATION = 0.18;
const DASH_COOLDOWN = 0.6;

@system({ priority: 6 })
export class Platformer extends GameSystem {
	constructor(
		private readonly players: Query<{
			position: Position;
			velocity: Velocity;
			player: PlayerTag;
		}>,
		private readonly facings: Query<{ player: PlayerTag; facing: Facing }>,
		private readonly input: InputPort,
		private readonly audio: AudioPort,
	) {
		super();
	}

	// fallow-ignore-next-line unused-class-member
	execute(dt: number): void {
		const axis = this.input.moveAxis();
		const jump = this.input.consumeJumpPressed();
		for (const { components } of this.players) {
			stepPlayer(components.position, components.velocity, axis, jump, dt, this.audio);
		}
		for (const { components } of this.facings) facePlayer(components.facing, axis);
	}
}

function stepPlayer(
	pos: Position,
	vel: Velocity,
	axis: number,
	jump: boolean,
	dt: number,
	audio: AudioPort,
): void {
	vel.x = axis * SPEED;
	vel.y -= GRAVITY * dt;
	if (pos.y > FLOOR_Y || vel.y > 0) return;
	pos.y = FLOOR_Y;
	vel.y = 0;
	if (jump) {
		vel.y = JUMP_VELOCITY;
		audio.play(SFX.jump, 0.3);
	}
}

@system({ priority: 11 })
export class FloorCorrection extends GameSystem {
	constructor(private readonly targets: Query<{ position: Position; velocity: Velocity }>) {
		super();
	}

	// fallow-ignore-next-line unused-class-member
	execute(): void {
		for (const { components } of this.targets) {
			const { position: pos, velocity: vel } = components;
			if (pos.y < FLOOR_Y) {
				pos.y = FLOOR_Y;
				vel.y = 0;
			} else if (pos.y === FLOOR_Y && vel.y < 0) {
				vel.y = 0;
			}
		}
	}
}

function facePlayer(facing: Facing, axis: number): void {
	if (axis !== 0) {
		facing.x = axis > 0 ? 1 : -1;
		facing.y = 0;
	}
}

@system({ priority: 10 })
export class Movement extends GameSystem {
	constructor(private readonly targets: Query<{ position: Position; velocity: Velocity }>) {
		super();
	}

	// fallow-ignore-next-line unused-class-member
	execute(dt: number): void {
		for (const { components } of this.targets) {
			const { position: pos, velocity: vel } = components;
			pos.x += vel.x * dt;
			pos.y += vel.y * dt;
		}
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

@system({ priority: 8 })
export class DashSystem extends GameSystem {
	constructor(
		private readonly players: Query<{
			velocity: Velocity;
			facing: Facing;
			dashState: DashState;
			player: PlayerTag;
		}>,
		private readonly input: InputPort,
	) {
		super();
	}

	// fallow-ignore-next-line unused-class-member
	execute(dt: number): void {
		const pressed = this.input.consumeDashPressed();
		for (const { components } of this.players) {
			const { velocity, facing, dashState: state } = components;
			state.cooldown = Math.max(0, state.cooldown - dt);

			if (state.remaining > 0) {
				state.remaining = Math.max(0, state.remaining - dt);
				velocity.x = state.remaining > 0 ? facing.x * DASH_SPEED : 0;
				velocity.y = state.remaining > 0 ? facing.y * DASH_SPEED : 0;
				continue;
			}

			if (pressed && state.cooldown === 0) {
				state.remaining = DASH_DURATION;
				state.cooldown = DASH_COOLDOWN;
				velocity.x = facing.x * DASH_SPEED;
				velocity.y = facing.y * DASH_SPEED;
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

export interface EntitySpawnCapability {
	spawn(...instances: object[]): void;
}

export function createGameSystems(world: World, input: InputPort, audio: AudioPort): GameSystem[] {
	const spawner: EntitySpawnCapability = {
		spawn: (...instances) => {
			world.spawn(...instances);
		},
	};

	return [
		new Platformer(
			world.query({ position: Position, velocity: Velocity, player: PlayerTag }),
			world.query({ player: PlayerTag, facing: Facing }),
			input,
			audio,
		),
		new FoeShamble(
			world.query({ position: Position, velocity: Velocity, foe: FoeTag }),
			world.query({ position: Position, player: PlayerTag }),
		),
		new DashSystem(
			world.query({ velocity: Velocity, facing: Facing, dashState: DashState, player: PlayerTag }),
			input,
		),
		new AimSystem(world.query({ aim: Aim, player: PlayerTag }), input),
		new Movement(world.query({ position: Position, velocity: Velocity })),
		new FloorCorrection(world.query({ position: Position, velocity: Velocity })),
		new Shooting(
			world.query({
				position: Position,
				gun: Gun,
				aimGun: AimGun,
				facing: Facing,
				aim: Aim,
				player: PlayerTag,
			}),
			spawner,
			input,
			audio,
		),
		new BoltHit(
			world.query({ position: Position, projectile: Projectile }),
			world.query({ position: Position, health: Health, foe: FoeTag }),
			audio,
		),
		new Death(world.query({ health: Health })),
	];
}
