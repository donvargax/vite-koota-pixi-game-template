import { component, GameSystem, system, type Query } from "../ecs/facade.ts";
import { PlayerTag } from "./actors.ts";
import type { InputPort } from "./contracts.ts";
import { Facing, Velocity } from "./spatial.ts";

const DASH_SPEED = 600;
const DASH_DURATION = 0.18;
const DASH_COOLDOWN = 0.6;

@component()
export class DashState {
	remaining = 0;
	cooldown = 0;

	constructor(remaining = 0, cooldown = 0) {
		this.remaining = remaining;
		this.cooldown = cooldown;
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
