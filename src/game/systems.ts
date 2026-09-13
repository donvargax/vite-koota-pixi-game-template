import { GameSystem, system, type Query, type World } from "../ecs/design2.ts";
import { SFX } from "./assets.ts";
import type { AudioPort, InputPort } from "./contracts.ts";
import {
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

@system({ priority: 6 })
export class Platformer extends GameSystem {
	constructor(
		private readonly players: Query<[Position, Velocity, PlayerTag]>,
		private readonly guns: Query<[PlayerTag, Gun]>,
		private readonly input: InputPort,
		private readonly audio: AudioPort,
	) {
		super();
	}

	// fallow-ignore-next-line unused-class-member
	execute(dt: number): void {
		const axis = this.input.moveAxis();
		const jump = this.input.consumeJumpPressed();
		for (const { comps } of this.players) {
			stepPlayer(comps[0], comps[1], axis, jump, dt, this.audio);
		}
		for (const { comps } of this.guns) faceGun(comps[1], axis);
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
	constructor(private readonly targets: Query<[Position, Velocity]>) {
		super();
	}

	// fallow-ignore-next-line unused-class-member
	execute(): void {
		for (const { comps } of this.targets) {
			const [pos, vel] = comps;
			if (pos.y < FLOOR_Y) {
				pos.y = FLOOR_Y;
				vel.y = 0;
			} else if (pos.y === FLOOR_Y && vel.y < 0) {
				vel.y = 0;
			}
		}
	}
}

function faceGun(gun: Gun, axis: number): void {
	if (axis !== 0) gun.dir = axis > 0 ? 1 : -1;
}

@system({ priority: 10 })
export class Movement extends GameSystem {
	constructor(private readonly targets: Query<[Position, Velocity]>) {
		super();
	}

	// fallow-ignore-next-line unused-class-member
	execute(dt: number): void {
		for (const { comps } of this.targets) {
			const [pos, vel] = comps;
			pos.x += vel.x * dt;
			pos.y += vel.y * dt;
		}
	}
}

@system({ priority: 12 })
export class Shooting extends GameSystem {
	constructor(
		private readonly shooters: Query<[Position, Gun, PlayerTag]>,
		private readonly spawner: EntitySpawnCapability,
		private readonly input: InputPort,
		private readonly audio: AudioPort,
	) {
		super();
	}

	// fallow-ignore-next-line unused-class-member
	execute(dt: number): void {
		for (const { comps } of this.shooters) {
			const [pos, gun] = comps;
			gun.cooldown -= dt;
			if (this.input.isShootHeld() && gun.cooldown <= 0) {
				this.spawner.spawn(
					new Position(pos.x + gun.dir * 18, pos.y + 26),
					new Velocity(gun.dir * BOLT_SPEED, 0),
					new Projectile(1, 1.4),
					new Sprite("bolt"),
				);
				gun.cooldown = FIRE_COOLDOWN;
				this.audio.play(SFX.shoot, 0.35);
			}
		}
	}
}

@system({ priority: 15 })
export class BoltHit extends GameSystem {
	constructor(
		private readonly bolts: Query<[Position, Projectile]>,
		private readonly foes: Query<[Position, Health, FoeTag]>,
		private readonly audio: AudioPort,
	) {
		super();
	}

	// fallow-ignore-next-line
	execute(dt: number): void {
		for (const { entity: bolt, comps } of this.bolts) {
			const [bpos, b] = comps;
			b.life -= dt;
			if (b.life <= 0) {
				bolt.destroy();
				continue;
			}
			for (const { comps: foeComps } of this.foes) {
				const [fpos, hp] = foeComps;
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
		private readonly foes: Query<[Position, Velocity, FoeTag]>,
		private readonly players: Query<[Position, PlayerTag]>,
	) {
		super();
	}

	// fallow-ignore-next-line
	execute(_dt: number): void {
		const hero = this.players.entities[0];
		const heroX = hero ? (hero.get(Position)?.x ?? 0) : 0;
		for (const { comps } of this.foes) {
			const [pos, vel] = comps;
			pos.y = FLOOR_Y;
			const dx = heroX - pos.x;
			vel.x = Math.abs(dx) < 4 ? 0 : Math.sign(dx) * 32;
		}
	}
}

@system({ priority: 20 })
export class Death extends GameSystem {
	constructor(private readonly dying: Query<[Health]>) {
		super();
	}

	// fallow-ignore-next-line unused-class-member
	execute(): void {
		for (const { entity, comps } of this.dying) {
			if (comps[0].value <= 0) entity.destroy();
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
			world.query(Position, Velocity, PlayerTag),
			world.query(PlayerTag, Gun),
			input,
			audio,
		),
		new FoeShamble(world.query(Position, Velocity, FoeTag), world.query(Position, PlayerTag)),
		new Movement(world.query(Position, Velocity)),
		new FloorCorrection(world.query(Position, Velocity)),
		new Shooting(world.query(Position, Gun, PlayerTag), spawner, input, audio),
		new BoltHit(world.query(Position, Projectile), world.query(Position, Health, FoeTag), audio),
		new Death(world.query(Health)),
	];
}
