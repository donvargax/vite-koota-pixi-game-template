import { createWorld as createKootaWorld, trait } from "koota";
import type { Entity as KootaEntity, Schema, Trait, World as KootaWorld } from "koota";
import { createScope, resolve as resolveScoped, type InstanceProvider, type Key } from "./di.ts";

export { type InstanceProvider, type Key } from "./di.ts";

// ---------------------------------------------------------------------------
// Temporary compatibility registration
// ---------------------------------------------------------------------------

const singletons = new Map<unknown, unknown>();

export function registerSingleton<T>(key: Key<T>, instanceOrCtor: T | (new () => T)): void {
	if (typeof instanceOrCtor === "function" && instanceOrCtor.prototype) {
		singletons.set(key, new (instanceOrCtor as new () => T)());
	} else {
		singletons.set(key, instanceOrCtor);
	}
}

export function resolve<T>(key: Key<T>): T {
	try {
		return resolveScoped(key);
	} catch (error) {
		if (singletons.has(key)) return singletons.get(key) as T;
		throw error;
	}
}

// fallow-ignore-next-line unused-export
export function singleton(): ClassDecorator {
	return (target: unknown) => {
		const ctor = target as new () => unknown;
		if (!singletons.has(ctor)) singletons.set(ctor, new ctor());
	};
}

// ---------------------------------------------------------------------------
// Components: plain classes + Koota trait backing
// ---------------------------------------------------------------------------

type Ctor<T = object> = new (...args: never[]) => T;

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

export interface WorldOptions {
	systems?: readonly SystemConstructor[];
	providers?: readonly InstanceProvider[];
}

export type SystemConstructor = new () => GameSystem;

interface QueryMeta {
	types: Ctor[];
}

const queryMeta = new Map<object, Map<string | symbol, QueryMeta>>();
const systemRegistry: { ctor: SystemConstructor; priority: number; manifestIndex: number }[] = [];
const systemPriorities = new Map<SystemConstructor, number>();

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
		const ctor = target as SystemConstructor;
		const priority = options.priority ?? 0;
		systemPriorities.set(ctor, priority);
		if (!systemRegistry.some((entry) => entry.ctor === ctor)) {
			systemRegistry.push({ ctor, priority, manifestIndex: systemRegistry.length });
		}
	};
}

export abstract class GameSystem {
	// fallow-ignore-next-line unused-class-member
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

	/** Temporary compatibility access for consumers migrating to EntityRef methods. */
	// fallow-ignore-next-line unused-class-member
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
		const entities = this.world.koota.query(...traits);
		for (const e of entities) {
			const ref = new EntityRef(this.world, e);
			const comps = this.types.map((ctor) => {
				const t = traitFor(ctor);
				const snap: Record<string | symbol, unknown> = {
					...(e.get(t) as Record<string, unknown> | undefined),
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
		const traits = this.types.map(traitFor);
		return this.world.koota.query(...traits).map((entity) => new EntityRef(this.world, entity));
	}

	// fallow-ignore-next-line unused-class-member
	get count(): number {
		const traits = this.types.map(traitFor);
		return this.world.koota.query(...traits).length;
	}
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export const IWorld: Key<World> = Symbol("IWorld");

export class World {
	readonly koota: KootaWorld;
	private readonly scope;
	private systems: GameSystem[] = [];
	private disposed = false;

	constructor(options: WorldOptions = {}) {
		this.koota = createKootaWorld({});
		this.scope = createScope(options.providers ?? []);
		this.scope.provide(IWorld, this);

		const manifest = options.systems ?? systemRegistry;
		const ordered = manifest
			.map((entry, manifestIndex) => {
				const ctor = "ctor" in entry ? entry.ctor : entry;
				return {
					ctor,
					priority: "priority" in entry ? entry.priority : (systemPriorities.get(ctor) ?? 0),
					manifestIndex: "manifestIndex" in entry ? entry.manifestIndex : manifestIndex,
				};
			})
			.sort((a, b) => a.priority - b.priority || a.manifestIndex - b.manifestIndex);

		try {
			for (const { ctor } of ordered) {
				const instance = this.scope.construct(ctor);
				this.wireQueries(instance, ctor);
				this.systems.push(instance);
				instance.initialize?.();
			}
		} catch (error) {
			this.dispose();
			throw error;
		}
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
		const e = this.koota.spawn(...args);
		return new EntityRef(this, e);
	}

	// fallow-ignore-next-line unused-class-member
	destroy(ref: EntityRef): void {
		ref.destroy();
	}

	query<T extends object[]>(...ctors: Ctor[]): Query<T> {
		this.ensureNotDisposed();
		return new Query<T>(this, ctors);
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
		this.scope.dispose();
		this.koota.destroy();
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
		return !this.disposed && this.koota.has(e);
	}

	private wireQueries(instance: GameSystem, ctor: SystemConstructor): void {
		const metas = queryMeta.get(ctor.prototype);
		if (!metas) return;
		for (const [key, meta] of metas) {
			(instance as Record<string | symbol, unknown>)[key] = new Query(this, meta.types);
		}
	}

	private ensureNotDisposed(): void {
		if (this.disposed) throw new Error("Cannot use a disposed World");
	}
}
