import { World } from "../ecs/facade.ts";
import { createGameSystems } from "./composition.ts";
import type { AudioPort, InputPort, RandomPort } from "./contracts.ts";
import { GameViewModel, type HudProjection, type RenderProjection } from "./game-view-model.ts";
import { PixiView, type RendererMetadata } from "./pixi-view.ts";

export interface AnimationFramePort {
	now(): number;
	request(callback: (nowMs: number) => void): number;
	cancel(handle: number): void;
}

export interface BrowserRuntimePorts {
	readonly input: InputPort;
	readonly audio: AudioPort;
	readonly random: RandomPort;
}

export interface RuntimeView {
	mount(parent: HTMLElement): Promise<void>;
	render(projection: RenderProjection, nowMs: number): void;
	dispose(): void;
	getRendererMetadata?(): RendererMetadata;
}

export interface RuntimeWorkloadContext {
	readonly world: World;
	readonly model: GameViewModel;
}

export interface RuntimeWorkload {
	beforeSimulation?(dtSeconds: number): void;
	afterSimulation?(dtSeconds: number): void;
	afterRender?(projection: RenderProjection): void;
	dispose?(): void;
}

export type RuntimeWorkloadFactory = (context: RuntimeWorkloadContext) => RuntimeWorkload;

export type RuntimePhaseName =
	| "workload-before"
	| "simulation"
	| "workload-after"
	| "hud"
	| "projection"
	| "render-submission"
	| "after-render";

export interface RuntimeFrameObservation {
	readonly nowMs: number;
	readonly rawElapsedMs: number;
	readonly rawSeconds: number;
	readonly simulationDeltaSeconds: number;
	readonly callbackWorkMs: number;
	readonly phases: Readonly<Record<RuntimePhaseName, number>>;
}

export interface RuntimeObserver {
	onFrame(observation: RuntimeFrameObservation): void;
}

export interface BrowserRuntimeOptions {
	readonly parent: HTMLElement;
	readonly ports: BrowserRuntimePorts;
	readonly createView?: () => RuntimeView;
	readonly animationFrame: AnimationFramePort;
	readonly initialFoePositions?: readonly number[];
	readonly updateHud: (projection: HudProjection) => void;
	readonly createWorkload?: RuntimeWorkloadFactory;
	readonly observer?: RuntimeObserver;
}

export interface BrowserRuntimeController {
	readonly ready: Promise<void>;
	damagePlayer(amount: number): Promise<void>;
	spawnFoe(): Promise<void>;
	dispose(): void;
}

class RuntimeLifecycleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RuntimeLifecycleError";
	}
}

export function createBrowserRuntime(options: BrowserRuntimeOptions): BrowserRuntimeController {
	return new BrowserRuntime(options);
}

class BrowserRuntime implements BrowserRuntimeController {
	readonly ready: Promise<void>;

	private readonly options: BrowserRuntimeOptions;
	private readonly viewFactory: () => RuntimeView;
	private world: World | undefined;
	private model: GameViewModel | undefined;
	private view: RuntimeView | undefined;
	private workload: RuntimeWorkload | undefined;
	private frameHandle: number | undefined;
	private lastFrameNowMs = 0;
	private disposed = false;
	private readyState = false;
	private cleanupComplete = false;

	constructor(options: BrowserRuntimeOptions) {
		this.options = options;
		this.viewFactory = options.createView ?? (() => new PixiView());
		this.ready = this.initialize();
	}

	damagePlayer(amount: number): Promise<void> {
		return this.runAction("damagePlayer", (model) => model.damagePlayer(amount));
	}

	spawnFoe(): Promise<void> {
		return this.runAction("spawnFoe", (model) => model.spawnFoe());
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.frameHandle !== undefined) {
			this.options.animationFrame.cancel(this.frameHandle);
			this.frameHandle = undefined;
		}
		const errors = this.cleanupOwned();
		if (errors.length > 0) throw new AggregateError(errors, "Browser runtime cleanup failed");
	}

	private async initialize(): Promise<void> {
		try {
			const { input, audio, random } = this.options.ports;
			this.world = World.create((world) => createGameSystems(world, input, audio));
			this.model = new GameViewModel({
				world: this.world,
				audio,
				random,
				initialFoePositions: this.options.initialFoePositions,
			});
			this.model.start();
			this.view = this.viewFactory();
			this.workload = this.options.createWorkload?.({ world: this.world, model: this.model });
			await this.view.mount(this.options.parent);
			if (this.disposed) throw new RuntimeLifecycleError("Runtime was disposed during startup");
			this.readyState = true;
			this.lastFrameNowMs = this.options.animationFrame.now();
			this.scheduleFrame();
		} catch (error) {
			const cleanupErrors = this.cleanupOwned();
			if (cleanupErrors.length > 0) {
				throw new AggregateError([error, ...cleanupErrors], "Browser runtime startup failed");
			}
			throw error;
		}
	}

	private runAction(name: string, action: (model: GameViewModel) => void): Promise<void> {
		if (this.disposed) {
			return Promise.reject(new RuntimeLifecycleError(`${name} is unavailable after disposal`));
		}
		if (!this.readyState || !this.model) {
			return Promise.reject(new RuntimeLifecycleError(`${name} requires a ready runtime`));
		}
		try {
			action(this.model);
			return Promise.resolve();
		} catch (error) {
			return Promise.reject(error);
		}
	}

	private scheduleFrame(): void {
		if (this.disposed || !this.readyState) return;
		this.frameHandle = this.options.animationFrame.request((nowMs) => {
			this.frameHandle = undefined;
			this.runFrame(nowMs);
		});
	}

	private runFrame(nowMs: number): void {
		if (this.disposed || !this.model || !this.view) return;
		const observer = this.options.observer;
		const callbackStartMs = observer ? this.options.animationFrame.now() : 0;
		const rawElapsedMs = Math.max(0, nowMs - this.lastFrameNowMs);
		const rawSeconds = rawElapsedMs / 1000;
		const simulationDeltaSeconds = Math.min(rawSeconds, 1 / 30);
		this.lastFrameNowMs = nowMs;
		const phases = this.emptyPhases();
		const measure = (name: RuntimePhaseName, work: () => void): void => {
			if (!observer) {
				work();
				return;
			}
			const started = this.options.animationFrame.now();
			work();
			phases[name] = this.options.animationFrame.now() - started;
		};

		try {
			measure("workload-before", () => this.workload?.beforeSimulation?.(simulationDeltaSeconds));
			measure("simulation", () => this.model?.tick(simulationDeltaSeconds));
			measure("workload-after", () => this.workload?.afterSimulation?.(simulationDeltaSeconds));
			measure("hud", () => this.options.updateHud(this.model!.getHudProjection()));
			let projection!: RenderProjection;
			measure("projection", () => {
				projection = this.model!.getRenderProjection();
			});
			measure("render-submission", () => this.view!.render(projection, nowMs));
			measure("after-render", () => this.workload?.afterRender?.(projection));
			if (observer) {
				observer.onFrame({
					nowMs,
					rawElapsedMs,
					rawSeconds,
					simulationDeltaSeconds,
					callbackWorkMs: this.options.animationFrame.now() - callbackStartMs,
					phases,
				});
			}
		} finally {
			this.scheduleFrame();
		}
	}

	private emptyPhases(): Record<RuntimePhaseName, number> {
		return {
			"workload-before": 0,
			simulation: 0,
			"workload-after": 0,
			hud: 0,
			projection: 0,
			"render-submission": 0,
			"after-render": 0,
		};
	}

	private cleanupOwned(): Error[] {
		if (this.cleanupComplete) return [];
		this.cleanupComplete = true;
		this.readyState = false;
		const view = this.view;
		const model = this.model;
		const workload = this.workload;
		const world = this.world;
		this.view = undefined;
		this.model = undefined;
		this.workload = undefined;
		this.world = undefined;
		const errors: Error[] = [];
		for (const cleanup of [
			() => workload?.dispose?.(),
			() => view?.dispose(),
			() => model?.dispose(),
			() => world?.dispose(),
		]) {
			try {
				cleanup();
			} catch (error) {
				errors.push(error instanceof Error ? error : new Error(String(error)));
			}
		}
		return errors;
	}
}
