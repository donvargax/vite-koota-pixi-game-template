import {
	GameSystem,
	IWorld,
	query,
	resolve,
	singleton,
	system,
	type Query,
	type World,
} from "../ecs/design2.ts";
import { sfx } from "./audio.ts";
import { SFX } from "./assets.ts";
import { moveAxis, wantsJump, wantsShoot } from "./input.ts";
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

// fallow-ignore-next-line unused-export
export const order: string[] = [];

// Demo tuning (px, seconds).
const SPEED = 150;
const JUMP_VELOCITY = 380;
const GRAVITY = 1100;
export const FLOOR_Y = 0;
const BOLT_SPEED = 420;
const FIRE_COOLDOWN = 0.22;
const BOLT_RADIUS_SQ = 20 * 20;

@singleton()
@system({ priority: 6 })
class Platformer extends GameSystem {
	@query(Position, Velocity, PlayerTag)
	declare players: Query<[Position, Velocity, PlayerTag]>;
	@query(PlayerTag, Gun)
	declare guns: Query<[PlayerTag, Gun]>;

	execute(dt: number): void {
		const axis = moveAxis();
		const jump = wantsJump();
		for (const { comps } of this.players) stepPlayer(comps[0], comps[1], axis, jump, dt);
		for (const { comps } of this.guns) faceGun(comps[1], axis);
	}
}

function stepPlayer(pos: Position, vel: Velocity, axis: number, jump: boolean, dt: number): void {
	vel.x = axis * SPEED;
	vel.y -= GRAVITY * dt;
	if (pos.y > FLOOR_Y || vel.y > 0) return;
	pos.y = FLOOR_Y;
	vel.y = 0;
	if (jump) {
		vel.y = JUMP_VELOCITY;
		sfx(SFX.jump, 0.3);
	}
}

function faceGun(gun: Gun, axis: number): void {
	if (axis !== 0) gun.dir = axis > 0 ? 1 : -1;
}

@singleton()
@system({ priority: 10 })
class Movement extends GameSystem {
	@query(Position, Velocity)
	declare targets: Query<[Position, Velocity]>;

	execute(dt: number): void {
		order.push("movement");
		for (const { comps } of this.targets) {
			const [pos, vel] = comps;
			pos.x += vel.x * dt;
			pos.y += vel.y * dt;
		}
	}
}

@singleton()
@system({ priority: 12 })
class Shooting extends GameSystem {
	@query(Position, Gun, PlayerTag)
	declare shooters: Query<[Position, Gun, PlayerTag]>;

	execute(dt: number): void {
		for (const { comps } of this.shooters) {
			const [pos, gun] = comps;
			gun.cooldown -= dt;
			if (wantsShoot() && gun.cooldown <= 0) {
				// Lazy world access: only needed when actually firing, so
				// unit tests without an IWorld registration still pass.
				const w = resolve<World>(IWorld);
				w.spawn(
					new Position(pos.x + gun.dir * 18, pos.y + 26),
					new Velocity(gun.dir * BOLT_SPEED, 0),
					new Projectile(1, 1.4),
					new Sprite("bolt"),
				);
				gun.cooldown = FIRE_COOLDOWN;
				sfx(SFX.shoot, 0.35);
			}
		}
	}
}

@singleton()
@system({ priority: 15 })
class BoltHit extends GameSystem {
	@query(Position, Projectile)
	declare bolts: Query<[Position, Projectile]>;
	@query(Position, Health, FoeTag)
	declare foes: Query<[Position, Health, FoeTag]>;

	// fallow-ignore-next-line complexity
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
					sfx(SFX.hit, 0.4);
					bolt.destroy();
					break;
				}
			}
		}
	}
}

@singleton()
@system({ priority: 7 })
class FoeShamble extends GameSystem {
	@query(Position, Velocity, FoeTag)
	declare foes: Query<[Position, Velocity, FoeTag]>;
	@query(Position, PlayerTag)
	declare players: Query<[Position, PlayerTag]>;

	// fallow-ignore-next-line complexity
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

@singleton()
@system({ priority: 20 })
class Death extends GameSystem {
	@query(Health)
	declare dying: Query<[Health]>;

	execute(): void {
		order.push("death");
		for (const { entity, comps } of this.dying) {
			if (comps[0].value <= 0) entity.destroy();
		}
	}
}

// Value-use for the type checker: systems self-register via the @system
// decorator (side-effect import), so no other module names them.
void Platformer;
void Movement;
void Shooting;
void BoltHit;
void FoeShamble;
void Death;
