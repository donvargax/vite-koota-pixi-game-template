import { describe, expect, it, vi } from "vite-plus/test";
import type { RenderProjection } from "./game-view-model.ts";
import {
	createBrowserRuntime,
	type AnimationFramePort,
	type RuntimeFrameObservation,
	type RuntimeView,
	type RuntimeWorkload,
} from "./browser-runtime.ts";
import { FakeAudio, FakeInput } from "./test-support.ts";

class FakeAnimationFrame implements AnimationFramePort {
	private nextHandle = 1;
	private callback: ((nowMs: number) => void) | undefined;
	private callbackHandle: number | undefined;
	clockMs = 100;
	requestCount = 0;
	cancelled: number[] = [];

	now(): number {
		return ++this.clockMs;
	}

	request(callback: (nowMs: number) => void): number {
		this.requestCount += 1;
		this.callbackHandle = this.nextHandle;
		this.nextHandle += 1;
		this.callback = callback;
		return this.callbackHandle;
	}

	cancel(handle: number): void {
		this.cancelled.push(handle);
		if (handle === this.callbackHandle) this.callback = undefined;
	}

	fire(nowMs: number): void {
		const callback = this.callback;
		this.callback = undefined;
		this.clockMs = nowMs;
		callback?.(nowMs);
	}
}

class FakeView implements RuntimeView {
	readonly mountStarted = vi.fn();
	readonly renderCalls: Array<{ projection: RenderProjection; nowMs: number }> = [];
	readonly dispose = vi.fn();
	private resolveMount!: () => void;
	private rejectMount!: (error: unknown) => void;
	readonly mountPromise = new Promise<void>((resolve, reject) => {
		this.resolveMount = resolve;
		this.rejectMount = reject;
	});

	mount(): Promise<void> {
		this.mountStarted();
		return this.mountPromise;
	}

	resolve(): void {
		this.resolveMount();
	}

	reject(error: unknown): void {
		this.rejectMount(error);
	}

	render(projection: RenderProjection, nowMs: number): void {
		this.renderCalls.push({ projection, nowMs });
	}
}

function createOptions(
	view: FakeView,
	frame: FakeAnimationFrame,
	overrides: Partial<Parameters<typeof createBrowserRuntime>[0]> = {},
) {
	return {
		parent: {} as HTMLElement,
		ports: { input: new FakeInput(), audio: new FakeAudio(), random: { next: () => 0.5 } },
		createView: () => view,
		animationFrame: frame,
		initialFoePositions: [],
		updateHud: vi.fn(),
		...overrides,
	};
}

async function startRuntime(
	overrides: Partial<Parameters<typeof createBrowserRuntime>[0]> = {},
): Promise<{
	runtime: ReturnType<typeof createBrowserRuntime>;
	view: FakeView;
	frame: FakeAnimationFrame;
	updateHud: ReturnType<typeof vi.fn>;
}> {
	const view = new FakeView();
	const frame = new FakeAnimationFrame();
	const updateHud = vi.fn();
	const runtime = createBrowserRuntime(createOptions(view, frame, { updateHud, ...overrides }));
	view.resolve();
	await runtime.ready;
	return { runtime, view, frame, updateHud };
}

describe("browser runtime", () => {
	it("starts one RAF loop after readiness and excludes asset loading from first-frame dt", async () => {
		const view = new FakeView();
		const frame = new FakeAnimationFrame();
		const tickDeltas: number[] = [];
		const runtime = createBrowserRuntime(
			createOptions(view, frame, {
				createWorkload: () => ({
					afterSimulation: (dt) => tickDeltas.push(dt),
				}),
			}),
		);

		frame.clockMs = 10_000;
		view.resolve();
		await runtime.ready;
		expect(frame.requestCount).toBe(1);

		frame.fire(10_017);
		expect(tickDeltas).toEqual([0.016]);
		expect(frame.requestCount).toBe(2);
		runtime.dispose();
	});

	it("runs the capped simulation delta while retaining raw elapsed time", async () => {
		const observations: RuntimeFrameObservation[] = [];
		const { runtime, frame } = await startRuntime({
			observer: { onFrame: (value) => observations.push(value) },
		});

		frame.fire(1_101);

		expect(observations).toHaveLength(1);
		expect(observations[0]).toMatchObject({
			rawElapsedMs: 1_000,
			rawSeconds: 1,
			simulationDeltaSeconds: 1 / 30,
		});
		runtime.dispose();
	});

	it("runs workload, simulation, projections, render, and observation in order", async () => {
		const order: string[] = [];
		let observation: RuntimeFrameObservation | undefined;
		const observer = {
			onFrame: vi.fn((value: RuntimeFrameObservation) => {
				observation = value;
				order.push("observer");
			}),
		};
		const workload: RuntimeWorkload = {
			beforeSimulation: () => order.push("workload-before"),
			afterSimulation: () => order.push("workload-after"),
			afterRender: () => order.push("after-render"),
		};
		const view = new FakeView();
		const frame = new FakeAnimationFrame();
		const input = new FakeInput();
		input.moveAxis = () => {
			order.push("simulation");
			return 0;
		};
		const updateHud = vi.fn(() => order.push("hud"));
		const runtime = createBrowserRuntime(
			createOptions(view, frame, {
				updateHud,
				ports: { input, audio: new FakeAudio(), random: { next: () => 0.5 } },
				createWorkload: () => workload,
				observer,
			}),
		);
		view.resolve();
		await runtime.ready;
		frame.fire(116);

		expect(order).toEqual([
			"workload-before",
			"simulation",
			"workload-after",
			"hud",
			"after-render",
			"observer",
		]);
		expect(updateHud).toHaveBeenCalledOnce();
		expect(view.renderCalls).toHaveLength(1);
		expect(view.renderCalls[0].projection).toBeDefined();
		expect(observer.onFrame).toHaveBeenCalledOnce();
		expect(observation).toBeDefined();
		expect(Object.values(observation?.phases ?? {}).every((value) => value >= 0)).toBe(true);
		runtime.dispose();
	});

	it("rejects actions before readiness and after disposal", async () => {
		const view = new FakeView();
		const frame = new FakeAnimationFrame();
		const runtime = createBrowserRuntime(createOptions(view, frame));

		await expect(runtime.damagePlayer(25)).rejects.toThrow(/ready/);
		view.resolve();
		await runtime.ready;
		await expect(runtime.damagePlayer(25)).resolves.toBeUndefined();
		runtime.dispose();
		await expect(runtime.spawnFoe()).rejects.toThrow(/disposal/);
	});

	it("rejects readiness and cleans up when mounting fails", async () => {
		const view = new FakeView();
		const frame = new FakeAnimationFrame();
		const runtime = createBrowserRuntime(createOptions(view, frame));
		const error = new Error("mount failed");
		view.reject(error);

		await expect(runtime.ready).rejects.toBe(error);
		expect(view.dispose).toHaveBeenCalledOnce();
	});

	it("rejects readiness when disposed during mounting and still cleans up once", async () => {
		const view = new FakeView();
		const frame = new FakeAnimationFrame();
		const runtime = createBrowserRuntime(createOptions(view, frame));

		runtime.dispose();
		view.resolve();

		await expect(runtime.ready).rejects.toThrow(/disposed during startup/);
		expect(view.dispose).toHaveBeenCalledOnce();
		expect(frame.cancelled).toEqual([]);
	});

	it("attempts every owned cleanup and reports aggregate errors", async () => {
		const view = new FakeView();
		const frame = new FakeAnimationFrame();
		const workloadDispose = vi.fn(() => {
			throw new Error("workload cleanup");
		});
		view.dispose.mockImplementation(() => {
			throw new Error("view cleanup");
		});
		const runtime = createBrowserRuntime(
			createOptions(view, frame, { createWorkload: () => ({ dispose: workloadDispose }) }),
		);
		view.resolve();
		await runtime.ready;

		expect(() => runtime.dispose()).toThrow(AggregateError);
		expect(workloadDispose).toHaveBeenCalledOnce();
		expect(view.dispose).toHaveBeenCalledOnce();
		runtime.dispose();
		expect(view.dispose).toHaveBeenCalledOnce();
	});

	it("does not bind or dispose caller-owned input and audio ports", async () => {
		const input = new FakeInput() as FakeInput & {
			bind: ReturnType<typeof vi.fn>;
			dispose: ReturnType<typeof vi.fn>;
		};
		const audio = new FakeAudio() as FakeAudio & {
			bind: ReturnType<typeof vi.fn>;
			dispose: ReturnType<typeof vi.fn>;
		};
		input.bind = vi.fn();
		input.dispose = vi.fn();
		audio.bind = vi.fn();
		audio.dispose = vi.fn();
		const view = new FakeView();
		const frame = new FakeAnimationFrame();
		const runtime = createBrowserRuntime(
			createOptions(view, frame, { ports: { input, audio, random: { next: () => 0.5 } } }),
		);
		view.resolve();
		await runtime.ready;
		runtime.dispose();

		expect(input.bind).not.toHaveBeenCalled();
		expect(input.dispose).not.toHaveBeenCalled();
		expect(audio.bind).not.toHaveBeenCalled();
		expect(audio.dispose).not.toHaveBeenCalled();
	});
});
