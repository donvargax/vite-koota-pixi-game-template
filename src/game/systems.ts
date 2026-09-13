import { GameSystem, query, singleton, system, type Query } from "../ecs/design2.ts";
import { Health, Position, Velocity } from "./components.ts";

export const order: string[] = [];

@singleton()
@system({ priority: 10 })
export class Movement extends GameSystem {
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
@system({ priority: 20 })
export class Death extends GameSystem {
	@query(Health)
	declare dying: Query<[Health]>;

	execute(): void {
		order.push("death");
		for (const { entity, comps } of this.dying) {
			if (comps[0].value <= 0) entity.destroy();
		}
	}
}
