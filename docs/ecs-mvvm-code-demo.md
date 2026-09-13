# ECS/MVVM code demo

This walkthrough shows the implemented constructor-injection architecture. It
is illustrative rather than a single file that should compile. The production
examples use the same `World.create`, `createGameSystems`, and
`GameViewModel` boundaries as the source.

## The shape at a glance

Game code has four jobs:

1. Components describe model data.
2. Systems update that data through constructor-provided queries and ports.
3. `GameViewModel` coordinates a composed World and exposes commands and
   projections.
4. `main.ts` connects browser adapters, Pixi, and DOM elements to the
   ViewModel.

The dependency direction is one way:

```text
main.ts -> browser adapters -> service contracts
        -> World.create -> createGameSystems -> systems
        -> GameViewModel -> projections -> PixiView and DOM
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

`KeyboardInput` and `HtmlAudio` own their browser listeners and expose
`bind()`/`dispose()` for the composition root. A test can implement the same
interfaces without a DOM.

## Systems use constructor dependencies

`@system` records schedule priority. The composition function creates each
system and passes its queries, service ports, and capabilities explicitly.

```ts
// src/game/systems.ts
import { GameSystem, system, type Query } from "../ecs/design2.ts";
import type { AudioPort, InputPort } from "./contracts.ts";
import { Gun, PlayerTag, Position, Projectile, Sprite, Velocity } from "./components.ts";

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

The complete `createGameSystems(world, input, audio)` function follows the same
pattern for every system:

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

There is no class manifest, and importing a system module does not make an
instance run.

## A World is an isolated model instance

`World.create` creates the backend first and passes that exact World to the
factory. Tests and production use the same construction path.

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

Creating a second World with a second factory creates different system instances
and query objects. Updating either World cannot redirect work into the other.

## GameViewModel coordinates the session

The ViewModel receives its World and ports. It does not construct, locate, or
dispose those dependencies.

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

The ViewModel owns application state such as the player reference and respawn
timers. Its projections contain stable values for the DOM and Pixi, not
`EntityRef`, query proxies, components, or Koota handles.

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

The browser entry point creates adapters, composes the World, constructs the
ViewModel, mounts Pixi, runs one rAF loop, and tears everything down.

```ts
const input = new KeyboardInput();
const audio = new HtmlAudio();
const random: RandomPort = { next: () => Math.random() };
const world = World.create((created) => createGameSystems(created, input, audio));
const model = new GameViewModel({ world, audio, random });
const view = new PixiView();

input.bind();
audio.bind();
model.start();
await view.mount(stage);

function frame(now: number): void {
	model.tick(deltaSeconds(now));
	updateHud(model.getHudProjection());
	view.render(model.getRenderProjection(), now);
	requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

function dispose(): void {
	cancelAnimationFrame(frameId);
	view.dispose();
	model.dispose();
	world.dispose();
	audio.dispose();
	input.dispose();
}
```

The real entry point also rolls back this ownership sequence if asynchronous
Pixi mounting fails.

## System test

A system test selects instances and supplies fake ports. It does not mount the
application.

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
