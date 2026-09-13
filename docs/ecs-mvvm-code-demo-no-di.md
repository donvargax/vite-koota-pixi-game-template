# ECS/MVVM code demo without a DI resolver

This companion walkthrough follows the structure of `ecs-mvvm-code-demo.md`,
but shows the current explicit-composition API in one place for comparison.
The snippets are illustrative rather than one file that should compile. The
production code uses the same `World.create`, `createGameSystems`, and
`GameViewModel` boundaries shown here.

## The shape at a glance

Game code has four jobs:

1. Components describe model data.
2. Systems update that data through constructor-provided queries and ports.
3. `GameViewModel` coordinates a composed World and exposes commands and
   projections.
4. `main.ts` connects browser adapters, Pixi, and DOM elements to the
   ViewModel.

The object graph is assembled at the browser entry point:

```text
main.ts -> KeyboardInput, HtmlAudio, RandomPort
        -> World.create -> createGameSystems -> system instances
        -> GameViewModel -> projections -> PixiView and DOM
```

Systems receive the queries and capabilities they need. `GameViewModel`
receives the World and service ports it needs. Neither class looks up another
object at runtime.

## Components are plain model data

Components remain small classes backed by Koota traits through the ECS facade.

```ts
// src/game/components.ts
import { component } from "../ecs/design2.ts";

@component()
export class Position {
	constructor(
		public x = 0,
		public y = 0,
	) {}
}

@component()
export class Velocity {
	constructor(
		public x = 0,
		public y = 0,
	) {}
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

Systems and the ViewModel consume stable interfaces. The composition root
chooses concrete browser implementations, while tests provide ordinary fake
objects.

```ts
// src/game/contracts.ts
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
```

`KeyboardInput` and `HtmlAudio` own their browser listeners. The composition
root calls `bind()` after construction and `dispose()` during teardown. Tests
can implement the same interfaces without a DOM.

## Systems use constructor dependencies

`@system` records schedule priority. The system constructor receives every
query, port, and capability that its `execute` method uses.

```ts
// src/game/systems.ts
import { GameSystem, system, type Query } from "../ecs/design2.ts";
import { Gun, PlayerTag, Position, Projectile, Sprite, Velocity } from "./components.ts";
import { SFX } from "./sound-assets.ts";
import type { AudioPort, InputPort } from "./contracts.ts";

export interface EntitySpawnCapability {
	spawn(...instances: object[]): void;
}

@system({ priority: 12 })
export class Shooting extends GameSystem {
	constructor(
		private readonly shooters: Query<[Position, Gun, PlayerTag]>,
		private readonly spawner: EntitySpawnCapability,
		private readonly input: InputPort,
		private readonly audio: AudioPort,
	) {
		super();
	}

	execute(dt: number): void {
		for (const { comps } of this.shooters) {
			const [position, gun] = comps;
			gun.cooldown -= dt;
			if (!this.input.isShootHeld() || gun.cooldown > 0) continue;

			this.spawner.spawn(
				new Position(position.x + gun.dir * 18, position.y + 26),
				new Velocity(gun.dir * 420, 0),
				new Projectile(1, 1.4),
				new Sprite("bolt"),
			);
			gun.cooldown = 0.22;
			this.audio.play(SFX.shoot, 0.35);
		}
	}
}
```

The complete `createGameSystems(world, input, audio)` function builds fresh
queries and system instances for each World:

```ts
export function createGameSystems(world: World, input: InputPort, audio: AudioPort): GameSystem[] {
	const spawner: EntitySpawnCapability = {
		spawn: (...instances) => world.spawn(...instances),
	};

	return [
		new Platformer(
			world.query(Position, Velocity, PlayerTag),
			world.query(PlayerTag, Gun),
			input,
			audio,
		),
		new FoeShamble(world.query(Position, Velocity, FoeTag), world.query(Position, PlayerTag)),
		new Movement(world.query(Position, Velocity)),
		new FloorCorrection(world.query(Position, Velocity)),
		new Shooting(world.query(Position, Gun, PlayerTag), spawner, input, audio),
		new BoltHit(world.query(Position, Projectile), world.query(Position, Health, FoeTag), audio),
		new Death(world.query(Health)),
	];
}
```

The World receives system instances from the factory. Importing a system module
does not construct an instance or make it run.

## A World is an isolated model instance

`World.create` creates the ECS backend first and passes that exact World to the
factory. The factory can create queries from it before returning its systems.

```ts
import { World } from "./ecs/design2.ts";
import { HtmlAudio } from "./game/audio.ts";
import type { RandomPort } from "./game/contracts.ts";
import { GameViewModel } from "./game/game-view-model.ts";
import { KeyboardInput } from "./game/input.ts";
import { createGameSystems } from "./game/systems.ts";

const input = new KeyboardInput();
const audio = new HtmlAudio();
const random: RandomPort = { next: () => Math.random() };

input.bind();
audio.bind();
const world = World.create((created) => createGameSystems(created, input, audio));
const game = new GameViewModel({ world, audio, random });

game.start();
game.tick(1 / 60);
game.dispose();
world.dispose();
audio.dispose();
input.dispose();
```

Creating a second World with a second factory creates different system
instances and query objects. Updating either World cannot redirect work into the
other.

## GameViewModel coordinates the session

The ViewModel receives its World and ports. It owns session state, but not the
dependencies passed to it.

```ts
// src/game/game-view-model.ts
export interface GameViewModelOptions {
	readonly world: World;
	readonly audio: AudioPort;
	readonly random: RandomPort;
	readonly initialFoePositions?: readonly number[];
}

export class GameViewModel {
	constructor(private readonly options: GameViewModelOptions) {}

	start(): void;
	tick(dt: number): void;
	damagePlayer(amount: number): void;
	spawnFoe(): void;
	getHudProjection(): HudProjection;
	getRenderProjection(): RenderProjection;
	dispose(): void;
}
```

`dispose()` releases ViewModel-owned state and marks the instance unusable. It
does not dispose the World, audio adapter, or random port. The composition root
owns those objects and disposes them separately.

The projections contain stable values for the DOM and Pixi, not `EntityRef`,
query proxies, components, or Koota handles.

## Pixi consumes projections

`PixiView` does not query the World or advance simulation. It mounts a Pixi
application, renders a `RenderProjection`, and disposes its sprites and canvas.

```ts
const view = new PixiView();
await view.mount(document.querySelector("#stage")!);
view.render(game.getRenderProjection(), performance.now());
view.dispose();
```

## `main.ts` owns composition

The browser entry point creates the adapters, composes the World, constructs the
ViewModel, mounts Pixi, runs the frame loop, and owns teardown.

```ts
const stage = document.querySelector<HTMLElement>("#stage")!;
const input = new KeyboardInput();
const audio = new HtmlAudio();
const random: RandomPort = { next: () => Math.random() };

let disposed = false;
let frameHandle: number | undefined;
let world: World | undefined;
let model: GameViewModel | undefined;
let view: PixiView | undefined;

function dispose(): void {
	if (disposed) return;
	disposed = true;
	if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
	view?.dispose();
	model?.dispose();
	world?.dispose();
	audio.dispose();
	input.dispose();
}

try {
	window.addEventListener("pagehide", dispose, { once: true });
	input.bind();
	audio.bind();
	world = World.create((created) => createGameSystems(created, input, audio));
	model = new GameViewModel({ world, audio, random });
	model.start();
	view = new PixiView();
	await view.mount(stage);
	frameHandle = requestAnimationFrame(frame);
} catch (error) {
	dispose();
	throw error;
}

function frame(now: number): void {
	if (disposed) return;
	model?.tick(1 / 60);
	if (model && view) view.render(model.getRenderProjection(), now);
	frameHandle = requestAnimationFrame(frame);
}
```

The `try`/`catch` rolls back objects that were already constructed if binding,
World creation, or asynchronous Pixi mounting fails. Teardown runs in
dependency-safe order: frame, Pixi view, ViewModel, World, audio, then input.

## System test

A system test selects the instance it needs and supplies fake ports. It does
not mount the application.

```ts
it("spawns a projectile in the executing World", () => {
	const input = new FakeInput();
	const audio = new FakeAudio();
	input.shootHeld = true;

	const world = World.create((created) => [
		new Shooting(
			created.query(Position, Gun, PlayerTag),
			{ spawn: (...instances) => created.spawn(...instances) },
			input,
			audio,
		),
	]);

	world.spawn(new Position(10, 0), new Gun(), new PlayerTag());
	world.update(0.01);

	expect(world.query(Projectile).count).toBe(1);
	expect(audio.played).toEqual([{ sound: SFX.shoot, volume: 0.35 }]);
	world.dispose();
});
```

The test builds the exact World that executes `Shooting`, so the query and
spawn capability are tied to the same ECS instance.

## ViewModel test

A ViewModel test composes a real World with fake ports and drives commands and
time directly.

```ts
it("respawns the player after two seconds", () => {
	const input = new FakeInput();
	const audio = new FakeAudio();
	const random = new SequenceRandom([0.5]);
	const world = World.create((created) => createGameSystems(created, input, audio));
	const game = new GameViewModel({ world, audio, random });

	game.start();
	game.damagePlayer(100);
	game.tick(0);

	expect(game.getHudProjection().playerHealth).toBe("dead");

	game.tick(1);
	game.tick(1.01);

	expect(game.getHudProjection().playerHealth).toBe(100);
	expect(audio.played).toContainEqual({ sound: SFX.respawn, volume: 0.5 });
	game.dispose();
	world.dispose();
});
```

This test has no canvas, page, fake timers, or module mocking. Its inputs are
commands, service fakes, and explicit simulation deltas. Its outputs are
projections and recorded effects.
