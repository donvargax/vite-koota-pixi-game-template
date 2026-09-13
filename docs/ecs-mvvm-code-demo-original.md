# ECS/MVVM code demo

This is an illustrative walkthrough of the target framework API described in
`docs/ecs-mvvm-design.md`. It is not production source and is not expected to
compile as one file. The ECS, service-port, and system examples follow the
implemented Phase 1-3 APIs. The ViewModel and presentation examples show the
intended result of the remaining phases.

## The shape at a glance

Game code has four distinct jobs:

1. Components describe model data.
2. Systems update that data using World-scoped services.
3. `GameViewModel` owns the World and exposes commands and read-only view data.
4. `main.ts` connects browser adapters, Pixi, and DOM elements to the
   ViewModel.

The dependency direction is one way:

```text
main.ts -> browser adapters -> service contracts
       -> PixiView         -> render projection
       -> GameViewModel    -> World -> Koota
                                  -> game systems
```

Neither systems nor `GameViewModel` know that the browser, DOM, or Pixi exists.

## Components are plain model data

Components remain small classes backed by Koota traits through the ECS facade.

```ts
// src/game/components.ts
import { component } from "../ecs/design2.ts";

@component()
export class Position {
	x = 0;
	y = 0;

	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}
}

@component()
export class Velocity {
	x = 0;
	y = 0;

	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}
}

@component()
export class Health {
	constructor(public value = 100) {}
}

@component()
export class PlayerTag {}
```

Components contain state, not browser handles, Pixi objects, callbacks, or
game-loop logic.

## Browser capabilities are ports

Systems consume stable contracts. The composition root chooses the concrete
browser implementations, while tests provide ordinary fake objects.

```ts
// src/game/contracts.ts
import type { Key } from "../ecs/di.ts";

export interface InputPort {
	moveAxis(): number;
	consumeJumpPressed(): boolean;
	isShootHeld(): boolean;
}

export interface AudioPort {
	play(sound: string, volume?: number): void;
}

export interface RandomPort {
	next(): number;
}

export const IInput = Symbol("InputPort") as Key<InputPort>;
export const IAudio = Symbol("AudioPort") as Key<AudioPort>;
export const IRandom = Symbol("RandomPort") as Key<RandomPort>;
```

The keyboard adapter owns event listeners and can remove them. Its public API
still looks like `InputPort`:

```ts
// src/game/input.ts
export class KeyboardInput implements InputPort {
	bind(): void;
	dispose(): void;
	moveAxis(): number;
	consumeJumpPressed(): boolean;
	isShootHeld(): boolean;
}
```

The audio adapter follows the same pattern:

```ts
// src/game/audio.ts
export class HtmlAudio implements AudioPort {
	bind(): void;
	dispose(): void;
	play(sound: string, volume?: number): void;
}
```

## Systems use scoped services and declared queries

`resolve()` runs while a World constructs a system. The resolved dependency is
stored in a field, so `execute()` does not consult process-global state.

```ts
// src/game/systems.ts
import {
	GameSystem,
	IWorld,
	query,
	resolve,
	system,
	type Query,
	type World,
} from "../ecs/design2.ts";
import { IAudio, IInput, type AudioPort, type InputPort } from "./contracts.ts";
import { Gun, PlayerTag, Position, Projectile, Sprite, Velocity } from "./components.ts";

@system({ priority: 12 })
export class Shooting extends GameSystem {
	private readonly world = resolve<World>(IWorld);
	private readonly input = resolve<InputPort>(IInput);
	private readonly audio = resolve<AudioPort>(IAudio);

	@query(Position, Gun, PlayerTag)
	declare shooters: Query<[Position, Gun, PlayerTag]>;

	execute(dt: number): void {
		for (const { comps } of this.shooters) {
			const [position, gun] = comps;
			gun.cooldown -= dt;

			if (!this.input.isShootHeld() || gun.cooldown > 0) continue;

			this.world.spawn(
				new Position(position.x + gun.dir * 18, position.y + 26),
				new Velocity(gun.dir * 420, 0),
				new Projectile(1, 1.4),
				new Sprite("bolt"),
			);

			gun.cooldown = 0.22;
			this.audio.play("shoot", 0.35);
		}
	}
}
```

Production chooses systems explicitly. Importing a module does not decide what
runs in a World.

```ts
// src/game/systems.ts
export const gameSystems = [
	Platformer,
	FoeShamble,
	Movement,
	FloorCorrection,
	Shooting,
	BoltHit,
	Death,
] as const;
```

## A World is an isolated model instance

The same constructor path is used by production and tests. Providers and the
system manifest belong to that World only.

```ts
import { instanceProvider } from "./ecs/di.ts";
import { World } from "./ecs/design2.ts";
import { IAudio, IInput } from "./game/contracts.ts";
import { gameSystems } from "./game/systems.ts";

const world = new World({
	systems: gameSystems,
	providers: [instanceProvider(IInput, input), instanceProvider(IAudio, audio)],
});

world.spawn(new Position(0, 40), new Velocity(), new Health(), new PlayerTag());
world.update(1 / 60);
world.dispose();
```

Creating a second World with different providers creates different system
instances and query objects. Updating either World cannot redirect work into
the other.

## GameViewModel owns the game session

The ViewModel turns the mutable ECS model into a small command and projection
API. The exact implementation may differ during Phase 4, but the boundary
should look like this.

```ts
// src/game/game-view-model.ts
import { instanceProvider } from "../ecs/di.ts";
import { World, type EntityRef } from "../ecs/design2.ts";
import {
	FoeTag,
	Gun,
	Health,
	PlayerTag,
	Position,
	Sprite as SpriteComponent,
	Velocity,
} from "./components.ts";
import { IAudio, IInput, type AudioPort, type InputPort, type RandomPort } from "./contracts.ts";
import { gameSystems } from "./systems.ts";

export interface HudProjection {
	hp: number | "dead";
	foes: number;
	playerX: number | null;
}

export interface RenderableProjection {
	id: number;
	kind: string;
	x: number;
	y: number;
	velocityX: number;
	airborne: boolean;
}

export interface GameViewModelOptions {
	input: InputPort;
	audio: AudioPort;
	random: RandomPort;
}

export class GameViewModel {
	private readonly world: World;
	private player: EntityRef | undefined;
	private started = false;
	private disposed = false;
	private deadFor = 0;
	private emptyFor = 0;

	constructor(private readonly options: GameViewModelOptions) {
		this.world = new World({
			systems: gameSystems,
			providers: [instanceProvider(IInput, options.input), instanceProvider(IAudio, options.audio)],
		});
	}

	start(): void {
		if (this.started) return;
		this.started = true;
		this.player = this.spawnPlayer();
		this.spawnFoe(-140);
		this.spawnFoe(120);
		this.spawnFoe(190);
	}

	tick(dt: number): void {
		this.assertRunning();
		this.world.update(dt);
		this.updateRespawn(dt);
		this.updateReinforcement(dt);
	}

	damagePlayer(amount: number): void {
		if (!this.player?.isAlive()) return;
		const health = this.player.get(Health);
		if (health) this.player.set(Health, { value: health.value - amount });
	}

	spawnRandomFoe(): void {
		const x = -160 + this.options.random.next() * 320;
		this.spawnFoe(x);
	}

	get hud(): HudProjection {
		const alive = this.player?.isAlive() ?? false;
		const health = alive ? this.player?.get(Health)?.value : undefined;
		const position = alive ? this.player?.get(Position) : undefined;

		return {
			hp: health ?? "dead",
			foes: this.world.query(FoeTag).count,
			playerX: position?.x ?? null,
		};
	}

	get renderables(): readonly RenderableProjection[] {
		return [
			...this.world.query<[Position, SpriteComponent, Velocity]>(
				Position,
				SpriteComponent,
				Velocity,
			),
		].map(({ entity, comps: [position, sprite, velocity] }) => ({
			id: entity.id,
			kind: sprite.texture,
			x: position.x,
			y: position.y,
			velocityX: velocity.x,
			airborne: position.y > 1,
		}));
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.world.dispose();
	}

	private spawnPlayer(): EntityRef {
		return this.world.spawn(
			new Position(0, 40),
			new Velocity(),
			new Health(100),
			new SpriteComponent("player"),
			new PlayerTag(),
			new Gun(),
		);
	}

	private spawnFoe(x: number): void {
		this.world.spawn(
			new Position(x, 0),
			new Velocity(),
			new Health(3),
			new SpriteComponent("zombie"),
			new FoeTag(),
		);
	}

	private updateRespawn(dt: number): void {
		// Owns the existing delayed-respawn rule from main.ts.
	}

	private updateReinforcement(dt: number): void {
		// Owns the existing delayed-reinforcement rule from main.ts.
	}

	private assertRunning(): void {
		if (!this.started || this.disposed) throw new Error("Game session is not running");
	}
}
```

The private World is deliberate. A view can ask what to draw or display, but
it cannot mutate arbitrary components.

## Pixi consumes render projections

Pixi keeps a small retained-view cache keyed by stable entity ID. It does not
query the World.

```ts
// src/game/pixi-view.ts
import * as PIXI from "pixi.js";
import type { RenderableProjection } from "./game-view-model.ts";

export class PixiView {
	private app: PIXI.Application | undefined;
	private readonly nodes = new Map<number, PIXI.Sprite>();

	async mount(parent: HTMLElement): Promise<void> {
		this.app = new PIXI.Application();
		await this.app.init({ resizeTo: parent });
		parent.appendChild(this.app.canvas);
	}

	render(items: readonly RenderableProjection[], nowMs: number): void {
		const alive = new Set<number>();

		for (const item of items) {
			alive.add(item.id);
			const node = this.getOrCreateNode(item.id);
			node.position.set(toScreenX(item.x), toScreenY(item.y));
			node.texture = this.pickTexture(item, nowMs);
		}

		for (const [id, node] of this.nodes) {
			if (alive.has(id)) continue;
			node.destroy();
			this.nodes.delete(id);
		}
	}

	dispose(): void {
		for (const node of this.nodes.values()) node.destroy();
		this.nodes.clear();
		this.app?.destroy(true);
		this.app = undefined;
	}

	private getOrCreateNode(id: number): PIXI.Sprite {
		// Create once and reuse until the projection omits this ID.
	}

	private pickTexture(item: RenderableProjection, nowMs: number): PIXI.Texture {
		// Select a texture from visual state only.
	}
}
```

Rendering remains imperative internally. The projection boundary provides the
useful part of data binding without adding a second scene-graph framework.

## main.ts only composes and binds

The browser entry point creates concrete adapters and binds projections to
views. It contains no entity-spawning or respawn rules.

```ts
// src/main.ts
const input = new KeyboardInput();
const audio = new HtmlAudio();
const random: RandomPort = { next: () => Math.random() };
const game = new GameViewModel({ input, audio, random });
const view = new PixiView();

input.bind();
audio.bind();
game.start();
await view.mount(document.querySelector("#stage")!);

document.querySelector("#hurt")!.addEventListener("click", () => {
	game.damagePlayer(25);
});

document.querySelector("#spawn")!.addEventListener("click", () => {
	game.spawnRandomFoe();
});

let previous = performance.now();
let frameId = 0;

function frame(now: number): void {
	const dt = Math.min((now - previous) / 1000, 1 / 30);
	previous = now;

	game.tick(dt);
	view.render(game.renderables, now);
	renderHud(game.hud);
	frameId = requestAnimationFrame(frame);
}

frameId = requestAnimationFrame(frame);

window.addEventListener("pagehide", () => {
	cancelAnimationFrame(frameId);
	view.dispose();
	game.dispose();
	input.dispose();
	audio.dispose();
});
```

Later, fixed-timestep work can replace the body of this loop without changing
systems, the ViewModel command API, or either view.

## Framework-level system test

A system test selects one system and supplies fake ports. It does not mount the
application.

```ts
// src/game/systems.test.ts
it("spawns a projectile in the executing World", () => {
	const input = new FakeInput();
	const audio = new FakeAudio();
	input.shootHeld = true;

	const world = new World({
		systems: [Shooting],
		providers: [instanceProvider(IInput, input), instanceProvider(IAudio, audio)],
	});

	world.spawn(new Position(10, 0), new Gun(), new PlayerTag());
	world.update(0.01);

	expect(world.query(Projectile).count).toBe(1);
	expect(audio.played).toEqual([{ sound: SFX.shoot, volume: 0.35 }]);
	world.dispose();
});
```

## MVVM-style game test

A ViewModel test drives commands and time directly. It observes the same
projections used by the DOM and Pixi.

```ts
// src/game/game-view-model.test.ts
it("respawns the player after two seconds", () => {
	const input = new FakeInput();
	const audio = new FakeAudio();
	const random = new SequenceRandom([0.5]);
	const game = new GameViewModel({ input, audio, random });

	game.start();
	game.damagePlayer(100);
	game.tick(0);

	expect(game.hud.hp).toBe("dead");

	game.tick(1);
	game.tick(1.01);

	expect(game.hud.hp).toBe(100);
	expect(audio.played).toContainEqual({ sound: SFX.respawn, volume: 0.5 });
	game.dispose();
});
```

This test has no canvas, page, event dispatch, fake timers, or module mocking.
Its inputs are commands, service fakes, and explicit simulation deltas. Its
outputs are projections and recorded effects.

## What adding a feature looks like

For a dash ability:

1. Add flat model state such as `DashState` to `components.ts`.
2. Add dash input to `InputPort` and both its keyboard and fake adapters.
3. Add a focused `DashSystem` and tests using a World with only its required
   systems.
4. Add `DashSystem` to `gameSystems` at the intended priority.
5. Add visual dash state to `RenderableProjection` only if Pixi needs it.
6. Add a ViewModel command only if the dash can also be initiated by a menu,
   replay, AI driver, or another application-level caller.

The feature does not require changes to Koota integration, Pixi ownership, or
the browser composition model.
