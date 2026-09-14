import { createWorld as createKootaWorld, trait } from "koota";
import type { Entity as KootaEntity, Schema, Trait, World as KootaWorld } from "koota";

// ---------------------------------------------------------------------------
// Components: plain classes + Koota trait backing
// ---------------------------------------------------------------------------

type Ctor<T = object> = new (...args: never[]) => T;
type ComponentSpec = Record<string, Ctor>;
type ComponentsOf<S extends ComponentSpec> = {
	[K in keyof S]: S[K] extends Ctor<infer T> ? T : never;
};

type FlatValue = number | bigint | string | boolean | null | undefined;
type FlatDefaults = Record<string, FlatValue>;

const componentTraits = new Map<Ctor, Trait>();
const componentDefaults = new Map<Ctor, FlatDefaults>();

function isFlatValue(value: unknown): value is FlatValue {
	return (
		value === null ||
		value === undefined ||
		typeof value === "number" ||
		typeof value === "bigint" ||
		typeof value === "string" ||
		typeof value === "boolean"
	);
}

function validateFlatData(ctor: Ctor, values: Record<string, unknown>, source: string): void {
	for (const [key, value] of Object.entries(values)) {
		if (!isFlatValue(value)) {
			throw new Error(`Component ${ctor.name} has unsupported ${source} value for "${key}"`);
		}
	}
}

function defaultsOf(ctor: Ctor): FlatDefaults {
	const defaults = { ...(new (ctor as new () => object)() as FlatDefaults) };
	validateFlatData(ctor, defaults, "default");
	return defaults;
}

export function component(): ClassDecorator {
	return (target: unknown) => {
		const ctor = target as Ctor;
		if (componentTraits.has(ctor)) return;
		const defaults = defaultsOf(ctor);
		componentDefaults.set(ctor, defaults);
		componentTraits.set(
			ctor,
			(Object.keys(defaults).length > 0 ? trait(defaults as Schema) : trait()) as Trait,
		);
	};
}

function traitFor(ctor: Ctor): Trait {
	const t = componentTraits.get(ctor);
	if (!t) throw new Error(`Class ${ctor.name} is missing @component`);
	return t;
}

// ---------------------------------------------------------------------------
// Queries + systems
// ---------------------------------------------------------------------------

export interface SystemOptions {
	priority?: number;
}

export type SystemFactory = (world: World) => readonly GameSystem[];

const systemPriorities = new Map<Function, number>();
const usedSystems = new WeakSet<GameSystem>();
const usedSystemArrays = new WeakSet<object>();

export function system(options: SystemOptions = {}): ClassDecorator {
	return (target: unknown) => {
		const ctor = target as Function;
		const priority = options.priority ?? 0;
		systemPriorities.set(ctor, priority);
	};
}

export abstract class GameSystem {
	initialize?(): void;
	// fallow-ignore-next-line unused-class-member
	execute?(_dt: number): void;
	// fallow-ignore-next-line unused-class-member
	destroy?(): void;
}

// ---------------------------------------------------------------------------
// Entity + Query views
// ---------------------------------------------------------------------------

export class EntityRef {
	constructor(
		private world: World,
		private inner: KootaEntity,
	) {}

	// fallow-ignore-next-line unused-class-member
	get id(): number {
		const maybe = this.inner as unknown as { id?: () => number };
		return typeof maybe.id === "function" ? maybe.id() : Number(this.inner);
	}

	isAlive(): boolean {
		return this.world.isEntityAlive(this.inner);
	}

	/** Read-only snapshot copy. Mutating the result does nothing; use set() or Query tuples to write. */
	get<T extends object>(ctor: Ctor<T>): T | undefined {
		return this.world.readComponent(this.inner, ctor);
	}

	set<T extends object>(ctor: Ctor<T>, patch: Partial<T>): void {
		this.world.writeComponent(this.inner, ctor, patch);
	}

	// fallow-ignore-next-line unused-class-member
	has(ctor: Ctor): boolean {
		return this.world.hasComponent(this.inner, ctor);
	}

	destroy(): void {
		this.inner.destroy();
	}
}

export class Query<T extends object> implements Iterable<{ entity: EntityRef; components: T }> {
	constructor(
		private readonly source: () => EntityRef[],
		private readonly types: readonly (readonly [string, Ctor])[],
	) {}

	*[Symbol.iterator](): Iterator<{ entity: EntityRef; components: T }> {
		for (const ref of this.source()) {
			const components: Record<string, unknown> = {};
			for (const [name, ctor] of this.types) {
				const snap: Record<string | symbol, unknown> = {
					...(ref.get(ctor) as Record<string, unknown> | undefined),
				};
				components[name] = new Proxy(snap, {
					set(target, prop, value) {
						target[prop] = value;
						ref.set(ctor, { [prop]: value } as Record<string, unknown>);
						return true;
					},
				});
			}
			yield { entity: ref, components: components as T };
		}
	}

	get entities(): EntityRef[] {
		return this.source();
	}

	get count(): number {
		return this.source().length;
	}
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export class World {
	readonly #koota: KootaWorld;
	private systems: GameSystem[] = [];
	private disposed = false;

	static create(factory: SystemFactory): World {
		const world = new World();

		try {
			const result = factory(world) as unknown;
			if (isPromiseLike(result)) {
				void Promise.resolve(result).catch(() => undefined);
				throw new Error("World.create() requires a synchronous system factory");
			}
			if (!Array.isArray(result)) {
				throw new Error("World.create() factory must return a system instance array");
			}
			if (usedSystemArrays.has(result)) {
				throw new Error("World.create() requires a fresh system instance array");
			}
			usedSystemArrays.add(result);
			world.installInstances(result);
			return world;
		} catch (error) {
			world.cleanup();
			throw error;
		}
	}

	private constructor() {
		this.#koota = createKootaWorld({});
	}

	spawn(...instances: object[]): EntityRef {
		this.ensureNotDisposed();
		const args = instances.map((inst) => {
			if (inst === null || typeof inst !== "object") {
				throw new Error("World.spawn() accepts component instances only");
			}
			const ctor = (inst as object).constructor as Ctor;
			const defaults = componentDefaults.get(ctor);
			if (!defaults) {
				traitFor(ctor);
				throw new Error(`Class ${ctor.name} is missing component defaults`);
			}
			const data = { ...(inst as FlatDefaults) };
			validateFlatData(ctor, data, "spawned");
			for (const key of Object.keys(data)) {
				if (!Object.hasOwn(defaults, key)) {
					throw new Error(`Component ${ctor.name} has unsupported spawned field "${key}"`);
				}
			}
			const t = traitFor(ctor) as unknown as (
				values?: FlatDefaults,
			) => Parameters<KootaWorld["spawn"]>[number];
			return Object.keys(data).length > 0 ? t(data) : traitFor(ctor);
		});
		const e = this.#koota.spawn(...args);
		return new EntityRef(this, e);
	}

	// fallow-ignore-next-line unused-class-member
	destroy(ref: EntityRef): void {
		ref.destroy();
	}

	query<const S extends ComponentSpec>(spec: S): Query<ComponentsOf<S>> {
		this.ensureNotDisposed();
		const entries = Object.entries(spec) as [string, Ctor][];
		const traits = entries.map(([, ctor]) => traitFor(ctor));
		return new Query<ComponentsOf<S>>(() => {
			this.ensureNotDisposed();
			return this.#koota.query(...traits).map((entity) => new EntityRef(this, entity));
		}, entries);
	}

	update(dt: number): void {
		this.ensureNotDisposed();
		for (const system of this.systems) system.execute?.(dt);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		let firstError: unknown;
		for (const system of [...this.systems].reverse()) {
			try {
				system.destroy?.();
			} catch (error) {
				firstError ??= error;
			}
		}
		this.systems = [];
		this.#koota.destroy();
		if (firstError) throw firstError;
	}

	readComponent<T extends object>(e: KootaEntity, ctor: Ctor<T>): T | undefined {
		return e.get(traitFor(ctor)) as T | undefined;
	}

	writeComponent<T extends object>(e: KootaEntity, ctor: Ctor<T>, patch: Partial<T>): void {
		e.set(traitFor(ctor), patch);
	}

	hasComponent(e: KootaEntity, ctor: Ctor): boolean {
		return this.isEntityAlive(e) && e.has(traitFor(ctor));
	}

	isEntityAlive(e: KootaEntity): boolean {
		return !this.disposed && this.#koota.has(e);
	}

	private installInstances(instances: readonly GameSystem[]): void {
		const seenInstances = new Set<GameSystem>();
		const ordered = instances
			.map((instance, manifestIndex) => {
				if (!(instance instanceof GameSystem)) {
					throw new Error("World.create() factory must return GameSystem instances");
				}
				if (seenInstances.has(instance) || usedSystems.has(instance)) {
					throw new Error("A GameSystem instance cannot be installed in multiple Worlds");
				}
				seenInstances.add(instance);
				return {
					instance,
					priority: systemPriorities.get(instance.constructor) ?? 0,
					manifestIndex,
				};
			})
			.sort((a, b) => a.priority - b.priority || a.manifestIndex - b.manifestIndex);

		for (const { instance } of ordered) {
			usedSystems.add(instance);
			this.systems.push(instance);
			instance.initialize?.();
		}
	}

	private cleanup(): void {
		if (this.disposed) return;
		try {
			this.dispose();
		} catch {
			// Preserve the factory or initialization error that caused cleanup.
		}
	}

	private ensureNotDisposed(): void {
		if (this.disposed) throw new Error("Cannot use a disposed World");
	}
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		"then" in value &&
		typeof value.then === "function"
	);
}
