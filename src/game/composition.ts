import type { GameSystem, World } from "../ecs/facade.ts";
import { FoeTag, Health, PlayerTag } from "./actors.ts";
import {
	Aim,
	AimGun,
	AimSystem,
	BoltHit,
	Gun,
	Projectile,
	Shooting,
	type EntitySpawnCapability,
} from "./combat.ts";
import type { AudioPort, InputPort } from "./contracts.ts";
import { DashState, DashSystem } from "./dash.ts";
import { FoeShamble } from "./enemies.ts";
import { FloorCorrection, Movement, Platformer } from "./locomotion.ts";
import { Death } from "./player-life.ts";
import { Facing, Position, Velocity } from "./spatial.ts";

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
