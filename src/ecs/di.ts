export type Key<T = unknown> = (new (...args: never[]) => T) | symbol | string;

export interface InstanceProvider<T = unknown> {
	key: Key<T>;
	value: T;
}

export function instanceProvider<T>(key: Key<T>, value: T): InstanceProvider<T> {
	return { key, value };
}

type Constructor<T> = new () => T;

export interface Scope {
	register<T>(provider: InstanceProvider<T>): void;
	provide<T>(key: Key<T>, value: T): void;
	resolve<T>(key: Key<T>): T;
	construct<T>(ctor: Constructor<T>): T;
	dispose(): void;
}

class ManagedScope implements Scope {
	private readonly providers = new Map<Key, unknown>();
	private disposed = false;

	constructor(providers: readonly InstanceProvider[]) {
		for (const provider of providers) this.register(provider);
	}

	register<T>(provider: InstanceProvider<T>): void {
		this.ensureUsable();
		if (this.providers.has(provider.key)) {
			throw new Error(`Duplicate service registration for key ${describeKey(provider.key)}`);
		}
		this.providers.set(provider.key, provider.value);
	}

	provide<T>(key: Key<T>, value: T): void {
		this.register(instanceProvider(key, value));
	}

	resolve<T>(key: Key<T>): T {
		this.ensureUsable();
		if (!this.providers.has(key)) {
			throw new Error(`No service registered for key ${describeKey(key)}`);
		}
		return this.providers.get(key) as T;
	}

	construct<T>(ctor: Constructor<T>): T {
		this.ensureUsable();
		constructionScopes.push(this);
		try {
			return new ctor();
		} finally {
			constructionScopes.pop();
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.providers.clear();
	}

	private ensureUsable(): void {
		if (this.disposed) throw new Error("Cannot use a disposed service scope");
	}
}

const constructionScopes: ManagedScope[] = [];

export function createScope(providers: readonly InstanceProvider[] = []): Scope {
	return new ManagedScope(providers);
}

export function resolve<T>(key: Key<T>): T {
	const scope = constructionScopes.at(-1);
	if (!scope) {
		throw new Error(`Cannot resolve ${describeKey(key)} outside a managed construction context`);
	}
	return scope.resolve(key);
}

function describeKey(key: Key): string {
	if (typeof key === "symbol") return key.description ?? key.toString();
	if (typeof key === "string") return key;
	return key.name || "anonymous constructor";
}
