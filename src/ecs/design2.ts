import { createWorld as createKootaWorld, trait } from "koota";
import type { Entity as KootaEntity, Schema, Trait, World as KootaWorld } from "koota";

// ---------------------------------------------------------------------------
// Minimal Aurelia-like DI
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: DI keys are intentionally untyped
export type Key<T = any> = (new (...args: any[]) => T) | symbol | string;

const singletons = new Map<unknown, unknown>();

export function registerSingleton<T>(key: Key<T>, instanceOrCtor: T | (new () => T)): void {
	if (typeof instanceOrCtor === "function" && instanceOrCtor.prototype) {
		singletons.set(key, new (instanceOrCtor as new () => T)());
	} else {
		singletons.set(key, instanceOrCtor);
	}
}

export function resolve<T>(key: Key<T>): T {
	const existing = singletons.get(key);
	if (existing !== undefined) return existing as T;
	throw new Error(`No registration for key ${String(key)}. Did you forget @singleton()?`);
}

export function singleton(): ClassDecorator {
	return (target: unknown) => {
		const ctor = target as new () => unknown;
		if (!singletons.has(ctor)) singletons.set(ctor, new ctor());
	};
}

// ---------------------------------------------------------------------------
// Components: plain classes + koota trait backing
// ---------------------------------------------------------------------------

type Ctor<T = object> = new (...args: never[]) => T;

type FlatDefaults = Record<string, number | bigint | string | boolean | null | undefined>;

const componentTraits = new Map<Ctor, Trait>();
const componentDefaults = new Map<Ctor, FlatDefaults>();

// Design 2 components must be flat primitives (numbers, strings, booleans).
// This matches koota SoA storage and keeps the door open for the compiler
// idea in docs/future/ecs-compiler.md. Complex objects stay out for now.
function defaultsOf(ctor: Ctor): FlatDefaults {
	try {
		return { ...(new (ctor as new () => object)() as FlatDefaults) };
	} catch {
		return {};
	}
}

export function component(): ClassDecorator {
	return (target: unknown) => {
		const ctor = target as Ctor;
		if (componentTraits.has(ctor)) return;
		const defaults = defaultsOf(ctor);
		componentDefaults.set(ctor, defaults);
		// Empty-shape components become tag traits (cast: tags behave like traits at runtime).
		componentTraits.set(
			ctor,
			(Object.keys(defaults).length > 0 ? trait(defaults as Schema) : trait()) as Trait,
		);
	};
}

function traitFor(ctor: Ctor) {
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

interface QueryMeta {
	types: Ctor[];
}

const queryMeta = new Map<object, Map<string | symbol, QueryMeta>>();
const systemRegistry: { ctor: Ctor<GameSystem>; priority: number }[] = [];

export function query(...types: Ctor[]): PropertyDecorator {
	// biome-ignore lint/suspicious/noExplicitAny: legacy decorator interop
	return (target: any, propertyKey: string | symbol) => {
		let perInstance = queryMeta.get(target);
		if (!perInstance) {
			perInstance = new Map();
			queryMeta.set(target, perInstance);
		}
		perInstance.set(propertyKey, { types });
	};
}

export function system(options: SystemOptions = {}): ClassDecorator {
	return (target: unknown) => {
		const ctor = target as Ctor<GameSystem>;
		if (!systemRegistry.some((s) => s.ctor === ctor)) {
			systemRegistry.push({ ctor, priority: options.priority ?? 0 });
		}
		if (!singletons.has(ctor)) singletons.set(ctor, new ctor());
	};
}

export abstract class GameSystem {
	initialize?(): void;
	execute?(_dt: number): void;
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

	get id(): number {
		// Koota entities expose id(); fall back to numeric coercion.
		const maybe = this.inner as unknown as { id?: () => number };
		return typeof maybe.id === "function" ? maybe.id() : Number(this.inner);
	}

	/** Read-only snapshot copy. Mutating the result does nothing; use set() or Query tuples to write. */
	get<T extends object>(ctor: Ctor<T>): T {
		return this.world.readComponent(this.inner, ctor);
	}

	set<T extends object>(ctor: Ctor<T>, patch: Partial<T>): void {
		this.world.writeComponent(this.inner, ctor, patch);
	}

	has(ctor: Ctor): boolean {
		return this.world.hasComponent(this.inner, ctor);
	}

	destroy(): void {
		this.inner.destroy();
	}

	get raw(): KootaEntity {
		return this.inner;
	}
}

export class Query<T extends object[]> implements Iterable<{ entity: EntityRef; comps: T }> {
	constructor(
		private world: World,
		private types: Ctor[],
	) {}

	*[Symbol.iterator](): Iterator<{ entity: EntityRef; comps: T }> {
		const traits = this.types.map(traitFor);
		// Koota records are only live *during* an updateEach callback, and
		// entity.get() returns a snapshot copy, so neither can back a lazy
		// for...of directly. Instead each comp is a snapshot Proxy that
		// writes through to entity.set() per field (set merges partials).
		// Reads are fresh per entity per loop; the future compiler in
		// docs/future/ecs-compiler.md replaces this with direct SoA access.
		const entities = this.world.koota.query(...traits);
		for (const e of entities) {
			const ref = new EntityRef(this.world, e);
			const comps = this.types.map((ctor) => {
				const t = traitFor(ctor);
				const snap: Record<string | symbol, unknown> = {
					...(e.get(t) as Record<string, unknown>),
				};
				return new Proxy(snap, {
					set(target, prop, value) {
						target[prop] = value;
						e.set(t, { [prop]: value } as Record<string, unknown>);
						return true;
					},
				});
			}) as T;
			yield { entity: ref, comps };
		}
	}

	get entities(): EntityRef[] {
		return [...this].map((r) => r.entity);
	}

	get count(): number {
		return this.entities.length;
	}
}

// ---------------------------------------------------------------------------
// World (4 methods by design)
// ---------------------------------------------------------------------------

export const IWorld = Symbol("IWorld");

export class World {
	readonly koota: KootaWorld;
	private systems: GameSystem[] = [];
	private initialized = false;

	constructor() {
		this.koota = createKootaWorld();
	}

	spawn(...instances: object[]): EntityRef {
		const args = instances.map((inst) => {
			const ctor = (inst as object).constructor as Ctor;
			const t = traitFor(ctor) as unknown as (
				values?: FlatDefaults,
			) => Parameters<KootaWorld["spawn"]>[number];
			const data: FlatDefaults = {};
			for (const [k, v] of Object.entries(inst)) data[k] = v as FlatDefaults[string];
			return Object.keys(data).length > 0 ? t(data) : traitFor(ctor);
		});
		const e = this.koota.spawn(...args);
		return new EntityRef(this, e);
	}

	destroy(ref: EntityRef): void {
		ref.destroy();
	}

	query<T extends object[]>(...ctors: Ctor[]): Query<T> {
		return new Query<T>(this, ctors as Ctor[]);
	}

	update(dt: number): void {
		this.ensureWired();
		for (const s of this.systems) s.execute?.(dt);
	}

	readComponent<T extends object>(e: KootaEntity, ctor: Ctor<T>): T {
		return e.get(traitFor(ctor)) as T;
	}

	writeComponent<T extends object>(e: KootaEntity, ctor: Ctor<T>, patch: Partial<T>): void {
		e.set(traitFor(ctor), patch);
	}

	hasComponent(e: KootaEntity, ctor: Ctor): boolean {
		return e.has(traitFor(ctor));
	}

	private ensureWired(): void {
		if (this.initialized) return;
		const ordered = [...systemRegistry].sort((a, b) => a.priority - b.priority);
		this.systems = ordered.map(({ ctor }) => {
			let instance = singletons.get(ctor) as GameSystem | undefined;
			if (!instance) {
				instance = new ctor();
				singletons.set(ctor, instance);
			}
			// Wire @query fields to live Query views.
			const metas = queryMeta.get(ctor.prototype);
			if (metas) {
				for (const [key, meta] of metas) {
					(instance as Record<string | symbol, unknown>)[key] = new Query(this, meta.types);
				}
			}
			instance.initialize?.();
			return instance;
		});
		this.initialized = true;
	}
}
