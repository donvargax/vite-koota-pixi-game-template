# Aurelia inspiration

This template is not built on Aurelia — it borrows Aurelia 2's developer
experience for game code: plain classes, decorators, and dependency
injection instead of framework-specific base types and stringly-typed APIs.

## Principle → ECS mapping

| Aurelia 2 principle              | How it appears here                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Plain classes, no base-type tax  | Components are undecorated-data classes; systems extend a tiny `GameSystem` with optional hooks only           |
| Decorators declare intent        | `@component` marks data, `@system({ priority })` marks logic + ordering, `@query(...)` wires data access       |
| `resolve()` DI, no manual wiring | `resolve<World>(IWorld)`; systems are container singletons, queries are injected per world on first `update()` |
| Convention over configuration    | Class fields are the schema; a no-field class is a tag; `initialize/execute/destroy` is the whole lifecycle    |
| Explicit over magic              | Queries list their types (`@query(Position, Velocity)`), never inferred from names or proxies                  |

## Lifecycle

Game terms, not UI terms. Aurelia has `created/binding/attached/detaching`;
games think in frames, so systems implement any of:

- `initialize()` — once, DI ready, before the first frame
- `execute(dt)` — every frame, in priority order
- `destroy()` — teardown

## What we deliberately left out

- Templates and data binding — rendering is Pixi sprites synced by
  `pixi-view.ts`, not a DOM diff.
- Router, validation, i18n — game shell concerns live in `main.ts`/HUD.
- Aurelia Kernel itself — the container here is ~20 lines (`singletons`
  map + `resolve()`). If a project outgrows it (scoped containers, `all()`
  resolvers), adopt `@aurelia/kernel` directly; the call sites already use
  the same vocabulary.
- Name-inferred magic (`entity.position` proxies) — rejected during design
  (see `docs/ecs-design.md`): renames would break at runtime with no
  compiler help, and proxies pin the implementation to slow paths.

## Working with it

- Add data: a `@component` class with flat primitive fields (matches koota
  SoA storage; see the compiler note in `docs/future/ecs-compiler.md`).
- Add behavior: a `@singleton() @system({ priority })` class with
  `@query(...)` fields and an `execute(dt)`.
- Read in loops via `Query` tuples (live, write-through). Read once via
  `entity.get()` (snapshot copy — do not mutate it; use `set()`).
- Spawn with instances: `world.spawn(new Position(x, y), new Health(30))`.
- Systems that must create entities (spawners, shooters) resolve the world
  lazily inside the firing branch: `resolve<World>(IWorld)`.
