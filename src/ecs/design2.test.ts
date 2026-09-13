import { describe, expect, it } from "vite-plus/test";
import {
	GameSystem,
	IWorld,
	World,
	component,
	query,
	resolve,
	system,
	type Query,
} from "./design2.ts";

@component()
class Position {
	x = 0;
	y = 0;

	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}
}

@component()
class Velocity {
	x = 0;
	y = 0;

	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}
}

@component()
class Health {
	value = 100;

	constructor(value = 100) {
		this.value = value;
	}
}

const executionOrder: string[] = [];

@system({ priority: 10 })
class Movement extends GameSystem {
	@query(Position, Velocity)
	declare targets: Query<[Position, Velocity]>;

	execute(dt: number): void {
		executionOrder.push("movement");
		for (const { comps } of this.targets) {
			comps[0].x += comps[1].x * dt;
			comps[0].y += comps[1].y * dt;
		}
	}
}

@system({ priority: 20 })
class Death extends GameSystem {
	@query(Health)
	declare dying: Query<[Health]>;

	execute(): void {
		executionOrder.push("death");
		for (const { entity, comps } of this.dying) {
			if (comps[0].value <= 0) entity.destroy();
		}
	}
}

describe("design2 (scoped ECS)", () => {
	it("moves entities and removes the dead in deterministic priority order", () => {
		executionOrder.length = 0;
		const world = new World({ systems: [Movement, Death] });
		const player = world.spawn(new Position(0, 0), new Velocity(10, 0), new Health(100));
		world.spawn(new Position(0, 0), new Velocity(0, 0), new Health(0));

		world.update(0.5);

		expect(player.get(Position)?.x).toBe(5);
		expect(world.query(Health).count).toBe(1);
		expect(executionOrder).toEqual(["movement", "death"]);
		world.dispose();
	});

	it("preserves manifest order when priorities tie", () => {
		const calls: string[] = [];
		@system({ priority: 1 })
		class First extends GameSystem {
			execute(): void {
				calls.push("first");
			}
		}
		@system({ priority: 1 })
		class Second extends GameSystem {
			execute(): void {
				calls.push("second");
			}
		}

		const world = new World({ systems: [Second, First] });
		world.update(0);

		expect(calls).toEqual(["second", "first"]);
		world.dispose();
	});

	it("resolves the executing World during scoped construction", () => {
		const owners: World[] = [];
		@system()
		class OwnerCapture extends GameSystem {
			private readonly owner = resolve(IWorld);

			execute(): void {
				owners.push(this.owner);
			}
		}

		const first = new World({ systems: [OwnerCapture] });
		const second = new World({ systems: [OwnerCapture] });
		first.update(0);
		second.update(0);

		expect(owners).toEqual([first, second]);
		first.dispose();
		second.dispose();
	});

	it("keeps systems, queries, and providers isolated between Worlds", () => {
		const values: number[] = [];
		@system()
		class ReadsWorld extends GameSystem {
			private readonly owner = resolve(IWorld);

			execute(): void {
				values.push(this.owner.query(Position).count);
			}
		}

		const first = new World({ systems: [ReadsWorld] });
		const second = new World({ systems: [ReadsWorld] });
		first.spawn(new Position(1, 2));
		first.update(0);
		second.update(0);

		expect(values).toEqual([1, 0]);
		first.dispose();
		second.dispose();
	});

	it("reports liveness and absent component reads through the facade", () => {
		const world = new World({ systems: [] });
		const entity = world.spawn(new Position(1, 2));

		expect(entity.isAlive()).toBe(true);
		expect(entity.get(Health)).toBeUndefined();
		expect(entity.has(Health)).toBe(false);
		entity.destroy();
		expect(entity.isAlive()).toBe(false);
		world.dispose();
	});

	it("tears down systems once, in reverse schedule order, and rejects updates", () => {
		const destroyed: string[] = [];
		class First extends GameSystem {
			destroy(): void {
				destroyed.push("first");
			}
		}
		class Second extends GameSystem {
			destroy(): void {
				destroyed.push("second");
			}
		}

		const world = new World({ systems: [First, Second] });
		world.dispose();
		world.dispose();

		expect(destroyed).toEqual(["second", "first"]);
		expect(() => world.update(0)).toThrow(/disposed World/);
	});

	it("rejects unsupported component defaults, constructors, and spawned values", () => {
		expect(() => {
			@component()
			class InvalidDefault {
				value = { nested: true };
			}
			void InvalidDefault;
		}).toThrow(/unsupported default value/);

		expect(() => {
			@component()
			class InvalidConstructor {
				constructor() {
					throw new Error("boom");
				}
			}
			void InvalidConstructor;
		}).toThrow("boom");

		@component()
		class Flat {
			value = 1;
		}
		const invalid = new Flat();
		(invalid as unknown as { value: unknown }).value = { nested: true };
		const world = new World({ systems: [] });

		expect(() => world.spawn(invalid)).toThrow(/unsupported spawned value/);
		world.dispose();
	});
});
