# Aurelia inspiration

This template is not built on Aurelia and does not depend on Aurelia at runtime.
It borrows Aurelia 2's developer experience for game code: plain data classes,
decorators, explicit lifecycle hooks, and typed interfaces instead of framework-
specific base types and stringly-typed APIs. Dependencies are passed through
constructors and composition functions.

## Principle → ECS mapping

| Aurelia 2 principle             | How it appears here                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| Plain classes, no base-type tax | Components are flat-data classes; systems extend a tiny `GameSystem` with optional hooks          |
| Decorators declare intent       | `@component` marks data and `@system({ priority })` records ordering                              |
| Explicit construction           | `World.create` and `createGameSystems` pass queries, ports, and capabilities through constructors |
| Convention over configuration   | Class fields are the schema; a no-field class is a tag; the lifecycle is the three hooks          |
| Explicit over magic             | Queries list their types in `world.query(Position, Velocity)`, never infer them from names        |

## Lifecycle

Game terms, not UI terms. Aurelia has `created/binding/attached/detaching`;
games think in frames, so systems implement any of:

- `initialize()` — once, after scoped construction and before the first update
- `execute(dt)` — every frame, in priority order
- `destroy()` — teardown during `World.dispose()`, in reverse schedule order

## What we deliberately left out

- Templates and data binding — rendering is Pixi sprites synced by
  `pixi-view.ts`, not a DOM diff.
- Router, validation, i18n — game shell concerns live in `main.ts`/HUD.
- Aurelia Kernel itself — this project has no runtime container. If a future
  object graph becomes large enough to revisit that choice, compare it against
  the constructor-visible dependency rule and deterministic ownership first.
- Name-inferred magic (`entity.position` proxies) — rejected during design
  (see `docs/ecs-design.md`): renames would break at runtime with no
  compiler help, and proxies pin the implementation to slow paths.

## Working with it

- Add data: a `@component` class with flat primitive fields (matches koota
  SoA storage; see the compiler note in `docs/future/ecs-compiler.md`).
- Add behavior: a `@system({ priority })` class with constructor parameters for
  its `Query` values and service ports, plus an `execute(dt)` method.
- Read in loops via `Query` tuples (live, write-through). Read once via
  `entity.get()` (snapshot copy — do not mutate it; use `set()`).
- Spawn with instances: `world.spawn(new Position(x, y), new Health(30))`.
- Give every World explicit instances: `World.create((world) =>
createGameSystems(world, input, audio))`.
- Systems that create entities receive a narrow spawn capability in their
  constructor rather than a World locator.
