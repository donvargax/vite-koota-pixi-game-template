import { GameSystem, system, type Query } from "../ecs/facade.ts";
import { PlayerTag } from "./actors.ts";
import type { AudioPort, InputPort } from "./contracts.ts";
import { SFX } from "./sound-assets.ts";
import { Facing, FLOOR_Y, Position, Velocity } from "./spatial.ts";

// Demo tuning (px, seconds).
const SPEED = 150;
const JUMP_VELOCITY = 380;
const GRAVITY = 1100;

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
