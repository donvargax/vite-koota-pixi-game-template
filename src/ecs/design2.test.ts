import { describe, expect, it } from "vite-plus/test";
import { GameSystem, World, component, system, type Query } from "./design2.ts";

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
	constructor(private readonly targets: Query<{ position: Position; velocity: Velocity }>) {
		super();
	}

	execute(dt: number): void {
		executionOrder.push("movement");
		for (const { components } of this.targets) {
			components.position.x += components.velocity.x * dt;
			components.position.y += components.velocity.y * dt;
		}
	}
}

@system({ priority: 20 })
class Death extends GameSystem {
	constructor(private readonly dying: Query<{ health: Health }>) {
		super();
	}

	execute(): void {
		executionOrder.push("death");
		for (const { entity, components } of this.dying) {
			if (components.health.value <= 0) entity.destroy();
		}
	}
}

describe("design2 (scoped ECS)", () => {
	it("creates a World before composing system instances and queries", () => {
		let factoryWorld: World | undefined;
		const positions: number[] = [];

		@system()
		class ReadsPositions extends GameSystem {
			constructor(private readonly targets: Query<{ position: Position }>) {
				super();
			}

			execute(): void {
				for (const { components } of this.targets) positions.push(components.position.x);
			}
		}

		const world = World.create((created) => {
			factoryWorld = created;
			return [new ReadsPositions(created.query({ position: Position }))];
		});
		world.spawn(new Position(7, 0));
		world.update(0);

		expect(factoryWorld).toBe(world);
		expect(positions).toEqual([7]);
		world.dispose();
	});

	it("sorts factory instances and tears them down in reverse order", () => {
		const calls: string[] = [];

		@system({ priority: 20 })
		class Second extends GameSystem {
			initialize(): void {
				calls.push("second-init");
			}

			execute(): void {
				calls.push("second-execute");
			}

			destroy(): void {
				calls.push("second-destroy");
			}
		}

		@system({ priority: 10 })
		class First extends GameSystem {
			initialize(): void {
				calls.push("first-init");
			}

			execute(): void {
				calls.push("first-execute");
			}

			destroy(): void {
				calls.push("first-destroy");
			}
		}

		const world = World.create(() => [new Second(), new First()]);
		world.update(0);
		world.dispose();

		expect(calls).toEqual([
			"first-init",
			"second-init",
			"first-execute",
			"second-execute",
			"second-destroy",
			"first-destroy",
		]);
	});

	it("cleans up installed instances while preserving an initialization failure", () => {
		const destroyed: string[] = [];
		const failure = new Error("initialization failed");

		class First extends GameSystem {
			destroy(): void {
				destroyed.push("first");
			}
		}

		class Failing extends GameSystem {
			initialize(): void {
				throw failure;
			}

			destroy(): void {
				destroyed.push("failing");
			}
		}

		expect(() => World.create(() => [new First(), new Failing()])).toThrow(failure);
		expect(destroyed).toEqual(["failing", "first"]);
	});

	it("cleans up when factory query creation fails", () => {
		class Unregistered {}
		let createdWorld: World | undefined;

		expect(() =>
			World.create((world) => {
				createdWorld = world;
				world.query({ unregistered: Unregistered });
				return [];
			}),
		).toThrow(/missing @component/);

		expect(() => createdWorld?.query({ position: Position })).toThrow(/disposed World/);
	});

	it("rejects asynchronous factories, constructors, reused arrays, and instances", () => {
		const asyncFactory = (async () => []) as unknown as (world: World) => readonly GameSystem[];
		expect(() => World.create(asyncFactory)).toThrow(/synchronous/);

		class Reusable extends GameSystem {}
		const reusable = new Reusable();
		const systems = [reusable];
		const first = World.create(() => systems);
		first.dispose();

		expect(() => World.create(() => [reusable])).toThrow(/multiple Worlds/);
		expect(() => World.create(() => systems)).toThrow(/fresh system instance array/);

		class ConstructorSystem extends GameSystem {}
		expect(() => World.create(() => [ConstructorSystem as unknown as GameSystem])).toThrow(
			/GameSystem instances/,
		);
	});

	it("moves entities and removes the dead in deterministic priority order", () => {
		executionOrder.length = 0;
		const world = World.create((created) => [
			new Movement(created.query({ position: Position, velocity: Velocity })),
			new Death(created.query({ health: Health })),
		]);
		const player = world.spawn(new Position(0, 0), new Velocity(10, 0), new Health(100));
		world.spawn(new Position(0, 0), new Velocity(0, 0), new Health(0));

		world.update(0.5);

		expect(player.get(Position)?.x).toBe(5);
		expect(world.query({ health: Health }).count).toBe(1);
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

		const world = World.create(() => [new Second(), new First()]);
		world.update(0);

		expect(calls).toEqual(["second", "first"]);
		world.dispose();
	});

	it("does not discover decorated systems without an explicit manifest", () => {
		const calls: string[] = [];
		@system()
		class Undeclared extends GameSystem {
			execute(): void {
				calls.push("undeclared");
			}
		}
		void Undeclared;

		const world = World.create(() => []);
		world.update(0);

		expect(calls).toEqual([]);
		world.dispose();
	});

	it("keeps systems and explicit queries isolated between Worlds", () => {
		const values: number[] = [];
		@system()
		class ReadsWorld extends GameSystem {
			constructor(private readonly positions: Query<{ position: Position }>) {
				super();
			}

			execute(): void {
				values.push(this.positions.count);
			}
		}

		const first = World.create((created) => [
			new ReadsWorld(created.query({ position: Position })),
		]);
		const second = World.create((created) => [
			new ReadsWorld(created.query({ position: Position })),
		]);
		first.spawn(new Position(1, 2));
		first.update(0);
		second.update(0);

		expect(values).toEqual([1, 0]);
		first.dispose();
		second.dispose();
	});

	it("reports liveness and absent component reads through the facade", () => {
		const world = World.create(() => []);
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

		const world = World.create(() => [new First(), new Second()]);
		world.dispose();
		world.dispose();

		expect(destroyed).toEqual(["second", "first"]);
		expect(() => world.update(0)).toThrow(/disposed World/);
		expect(() => world.spawn(new Position())).toThrow(/disposed World/);
		expect(() => world.query({ position: Position })).toThrow(/disposed World/);
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
		const world = World.create(() => []);

		expect(() => world.spawn(invalid)).toThrow(/unsupported spawned value/);
		world.dispose();
	});
});
