import { describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
	type Deferred = { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void };

	const state: {
		apps: FakeApplication[];
		initDeferreds: Deferred[];
		texturePromise: Promise<Record<string, object>>;
	} = {
		apps: [],
		initDeferreds: [],
		texturePromise: Promise.resolve({}),
	};

	function deferred(): Deferred {
		let resolve!: () => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<void>((resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		});
		return { promise, resolve, reject };
	}

	class FakeApplication {
		readonly canvas = {};
		readonly renderer = { name: "WebGL" };
		readonly stage = { addChild: vi.fn() };
		readonly ticker = { stop: vi.fn() };
		readonly render = vi.fn();
		readonly init = vi.fn(() => {
			const pending = deferred();
			state.initDeferreds.push(pending);
			return pending.promise;
		});
		readonly destroy = vi.fn();

		constructor() {
			state.apps.push(this);
		}
	}

	class FakeSprite {
		readonly position = { set: vi.fn() };
		readonly anchor = { set: vi.fn() };
		readonly scale = { set: vi.fn() };
		width = 0;
		height = 0;
		blendMode = "normal";
		texture: object;

		constructor(texture: object) {
			this.texture = texture;
		}

		destroy = vi.fn();
	}

	return {
		FakeApplication,
		FakeSprite,
		loadTextures: vi.fn(() => state.texturePromise),
		state,
		deferred,
	};
});

vi.mock("pixi.js", () => ({ Application: mocks.FakeApplication, Sprite: mocks.FakeSprite }));
vi.mock("./assets.ts", () => ({ loadTextures: mocks.loadTextures }));

import { PixiView } from "./pixi-view.ts";

function parent(): { element: HTMLElement; appendChild: ReturnType<typeof vi.fn> } {
	const appendChild = vi.fn();
	return { element: { appendChild } as unknown as HTMLElement, appendChild };
}

function resetMocks(): void {
	mocks.state.apps.length = 0;
	mocks.state.initDeferreds.length = 0;
	mocks.state.texturePromise = Promise.resolve({
		player_idle: {},
		player_walk1: {},
		player_walk2: {},
		player_jump: {},
		player_hurt: {},
		zombie_walk1: {},
		zombie_walk2: {},
		bolt: {},
		tile_top: {},
		tile_fill: {},
		sky: {},
	});
	mocks.loadTextures.mockClear();
}

describe("PixiView lifecycle", () => {
	it("does not attach a late canvas after disposal during app initialization", async () => {
		resetMocks();
		const view = new PixiView();
		const host = parent();
		const mounting = view.mount(host.element);
		const app = mocks.state.apps[0];

		view.dispose();
		mocks.state.initDeferreds[0].resolve();

		await expect(mounting).resolves.toBeUndefined();
		expect(host.appendChild).not.toHaveBeenCalled();
		expect(app.destroy).toHaveBeenCalledOnce();
		expect(app.stage.addChild).not.toHaveBeenCalled();
		expect(app.render).not.toHaveBeenCalled();
	});

	it("does not build or render a stage after disposal during texture loading", async () => {
		resetMocks();
		const textures = mocks.deferred();
		mocks.state.texturePromise = textures.promise.then(() => ({ sky: {} }));
		const view = new PixiView();
		const host = parent();
		const mounting = view.mount(host.element);
		mocks.state.initDeferreds[0].resolve();
		await Promise.resolve();
		const app = mocks.state.apps[0];

		view.dispose();
		textures.resolve();

		await expect(mounting).resolves.toBeUndefined();
		expect(host.appendChild).toHaveBeenCalledOnce();
		expect(app.destroy).toHaveBeenCalledOnce();
		expect(app.stage.addChild).not.toHaveBeenCalled();
		expect(app.render).not.toHaveBeenCalled();
	});

	it("destroys the owned application when initialization rejects", async () => {
		resetMocks();
		const view = new PixiView();
		const mounting = view.mount(parent().element);
		const app = mocks.state.apps[0];
		const failure = new Error("renderer init failed");
		mocks.state.initDeferreds[0].reject(failure);

		await expect(mounting).rejects.toBe(failure);
		expect(app.destroy).toHaveBeenCalledOnce();
	});

	it("makes disposal idempotent after a successful mount", async () => {
		resetMocks();
		const view = new PixiView();
		const mounting = view.mount(parent().element);
		const app = mocks.state.apps[0];
		mocks.state.initDeferreds[0].resolve();
		await mounting;

		view.dispose();
		view.dispose();

		expect(app.ticker.stop).toHaveBeenCalledOnce();
		expect(app.destroy).toHaveBeenCalledOnce();
	});

	it("refuses a concurrent mount", async () => {
		resetMocks();
		const view = new PixiView();
		const first = view.mount(parent().element);

		await expect(view.mount(parent().element)).rejects.toThrow(/mount/i);
		view.dispose();
		mocks.state.initDeferreds[0].resolve();
		await first;

		expect(mocks.state.apps).toHaveLength(1);
	});

	it("reports selected renderer metadata without creating another graphics context", async () => {
		resetMocks();
		const view = new PixiView();
		const mounting = view.mount(parent().element);
		mocks.state.initDeferreds[0].resolve();
		await mounting;

		expect(view.getRendererMetadata()).toEqual({ renderer: "WebGL", backend: null, gpu: null });
		expect(mocks.state.apps).toHaveLength(1);
		view.render({ entities: [] }, 0);
		expect(mocks.state.apps[0].render).toHaveBeenCalledOnce();
		view.dispose();
	});
});
