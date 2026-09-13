import {
	GameSystem,
	IWorld,
	query,
	resolve,
	system,
	type Query,
	type World,
} from "../ecs/design2.ts";
import { SFX } from "./assets.ts";
import { IAudio, IInput, type AudioPort, type InputPort } from "./contracts.ts";
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
export const FLOOR_Y = 0;
const BOLT_SPEED = 420;
const FIRE_COOLDOWN = 0.22;
const BOLT_RADIUS_SQ = 20 * 20;

@system({ priority: 6 })
export class Platformer extends GameSystem {
	private readonly input = resolve<InputPort>(IInput);
	private readonly audio = resolve<AudioPort>(IAudio);

	@query(Position, Velocity, PlayerTag)
	declare players: Query<[Position, Velocity, PlayerTag]>;
	@query(PlayerTag, Gun)
	declare guns: Query<[PlayerTag, Gun]>;

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
	@query(Position, Velocity)
	declare targets: Query<[Position, Velocity]>;

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
	@query(Position, Velocity)
	declare targets: Query<[Position, Velocity]>;

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
	private readonly world = resolve<World>(IWorld);
	private readonly input = resolve<InputPort>(IInput);
	private readonly audio = resolve<AudioPort>(IAudio);

	@query(Position, Gun, PlayerTag)
	declare shooters: Query<[Position, Gun, PlayerTag]>;

	// fallow-ignore-next-line unused-class-member
	execute(dt: number): void {
		for (const { comps } of this.shooters) {
			const [pos, gun] = comps;
			gun.cooldown -= dt;
			if (this.input.isShootHeld() && gun.cooldown <= 0) {
				this.world.spawn(
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
	private readonly audio = resolve<AudioPort>(IAudio);

	@query(Position, Projectile)
	declare bolts: Query<[Position, Projectile]>;
	@query(Position, Health, FoeTag)
	declare foes: Query<[Position, Health, FoeTag]>;

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
	@query(Position, Velocity, FoeTag)
	declare foes: Query<[Position, Velocity, FoeTag]>;
	@query(Position, PlayerTag)
	declare players: Query<[Position, PlayerTag]>;

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
	@query(Health)
	declare dying: Query<[Health]>;

	// fallow-ignore-next-line unused-class-member
	execute(): void {
		for (const { entity, comps } of this.dying) {
			if (comps[0].value <= 0) entity.destroy();
		}
	}
}

export const gameSystems = [
	Platformer,
	FoeShamble,
	Movement,
	FloorCorrection,
	Shooting,
	BoltHit,
	Death,
] as const;
