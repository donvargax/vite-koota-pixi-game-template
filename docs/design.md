# ECS design

This template is not built on Aurelia and does not depend on Aurelia at runtime.
It borrows Aurelia 2's developer experience for game code: plain data classes,
decorators, explicit lifecycle hooks, and typed interfaces instead of framework-
specific base types and stringly-typed APIs. Dependencies are passed through
constructors and composition functions.

## Aurelia inspiration

| Aurelia 2 principle             | How it appears here                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Plain classes, no base-type tax | Components are flat-data classes; systems extend a tiny `GameSystem` with optional hooks                           |
| Decorators declare intent       | `@component` marks data and `@system({ priority })` records ordering                                               |
| Explicit construction           | `World.create` and `createGameSystems` pass queries, ports, and capabilities through constructors                  |
| Convention over configuration   | Class fields are the schema; a no-field class is a tag; the lifecycle is the three hooks                           |
| Explicit over magic             | Queries name their types in `world.query({ position: Position, velocity: Velocity })`, never infer them from names |

The API borrows the shape of Aurelia's developer experience without bringing in
the Aurelia Kernel or a runtime object container. Construction remains visible at
the composition root, where ownership and system order can be inspected.

## Design options

The alternatives were evaluated against `bitECS`, `koota`, `becsy`, and
`miniplex` for the same requirements: TypeScript, renderer independence, and
spawn, destroy, query, and update operations for a 2D metroidvania.

### Design 1: Minimal core

The minimal design exposes `createWorld`, `defineComponent`, `spawn`, `destroy`,
`add/get/has`, `query`, and `update(world, dt, systems)`. Entities are numbers,
storage is `Map<Comp, Map<Entity, data>>`, and systems are pure functions run in
caller order. It is small and easy to test, with `O(n)` queries, but has no
scheduling or lifecycle model. Its shape is closest to `mreinstein/ecs` and
`bitECS`.

### Design 2: Aurelia-inspired facade, chosen

The chosen design uses `@component` classes, `@system({ priority })` metadata,
constructor-injected queries and service ports, and a `World.create(factory)`
composition API. Each World installs its own system instances and query objects.
Koota traits and handles stay behind the ECS facade. Query results expose named
component objects that are write-through proxies over snapshot copies.

### Design 3: Full kit

The full design adds typed schemas, `All/Any/None/Added/Changed/Rel` query
algebra, relations such as `ChildOf` and `Contains`, inherited prefabs,
`CommandBuffer` deferral, fixed and variable timesteps, observers, coroutines,
and schema-driven snapshots with a binary format and migrations. It is closest
to `becsy` plus `bitECS` serialization, but it has a larger interface and a
steeper learning curve.

## Comparison

- **Simplicity:** Design 1 has the smallest surface, Design 2 adds two decorators
  and scoped lifecycle management, and Design 3 adds schemas and scheduling
  algebra.
- **Depth:** Design 2 hides the backend, query wiring, and lifecycle behind a
  small game-facing facade without hiding construction from the composition root.
- **Query model:** Design 1 uses call-site arguments, Design 2 uses named query
  specs such as `{ position: Position, velocity: Velocity }`, and Design 3 uses
  query algebra.
- **Time model:** Designs 1 and 2 use a single `dt`; Design 3 separates fixed and
  variable updates and exposes interpolation state.
- **Performance:** Design 1 is fastest per operation. Design 2 pays for proxies
  and `set()` calls on field writes, which is negligible at the current entity
  counts. Design 3 pays the cost of a larger API and compiler or schema tooling.

## Why Design 2

1. It reads like the framework the team knows while keeping construction and
   ownership inspectable through constructor arguments and explicit composition.
2. Named query specs make system code readable without relying on component
   position. The facade can still move from Koota to archetypes or SoA storage
   without changing game code.
3. The current entity counts are in the hundreds, so Design 1 does not save
   anything the game needs yet. It would push ordering and lifecycle onto every
   caller.
4. Design 3 is a reasonable second system. Its pieces are tracked in `TODO.md`
   instead of being adopted up front.

## Lifecycle

Game terms replace UI lifecycle terms. Systems can implement any of these hooks:

- `initialize()` runs once after scoped construction and before the first update.
- `execute(dt)` runs every frame in priority order.
- `destroy()` runs during `World.dispose()`, in reverse schedule order.

Priority ties preserve the order returned by the composition function.

## Implemented boundary

- Production exports `createGameSystems(world, input, audio)`. Importing a system
  module does not register an instance or make it run.
- `World.create(factory)` creates one Koota backend and installs the fresh system
  instances returned by that factory.
- `World.query(spec)` accepts a named component spec. For example,
  `world.query({ position: Position, velocity: Velocity })` yields
  `components.position` and `components.velocity`; the result type is derived
  from the spec.
- `EntityRef`, `Query`, and component declarations are the game-facing API.
  Koota is imported only by `src/ecs/design2.ts`.
- `entity.get()` returns a snapshot copy. Use `entity.set()` or the live named
  query components to write state.
- The backend can change without exposing Koota entities or storage internals to
  systems, the ViewModel, views, or tests.

## Application layers

The application has three layers:

- The ECS World is the model. It owns entities, components, named queries, and
  systems.
- `GameViewModel` coordinates application behavior around the World. It exposes
  commands and immutable HUD and render projections.
- Pixi, DOM code, keyboard listeners, HTML audio, and the animation frame loop
  are view-side adapters assembled by `main.ts`.

The ViewModel does not expose the World to views or dispose it. The composition
root owns the World and the browser adapters. `main.ts` does not contain game
rules, spawning rules, health rules, or ECS queries.

## Dependency and test boundaries

The ECS facade is the only module that imports Koota. Components use the facade's
decorators, systems use components and service contracts, and the ViewModel uses
the facade, components, and service contracts. Views consume projections rather
than World queries or Koota handles.

The tests use the same construction boundaries as production:

- ECS contract tests cover components, named query construction, scheduling,
  lifecycle, validation, entity behavior, and World isolation.
- System tests compose a selected set of systems with fake input and audio ports.
- ViewModel tests compose a real World with fake service ports and assert
  immutable projections and recorded effects.
- Playwright covers browser composition, DOM, and Pixi wiring; it does not
  replace the lower-level tests.

## What we deliberately left out

- Templates and data binding. Rendering is Pixi sprites synced by `pixi-view.ts`,
  not a DOM diff.
- Router, validation, and i18n. Game shell concerns live in `main.ts` and the
  HUD.
- Aurelia Kernel itself. The project has no runtime container. If the object
  graph becomes large enough to revisit that choice, compare it against the
  constructor-visible dependency rule and deterministic ownership first.
- Name-inferred magic such as `entity.position`. Component names are supplied by
  the query spec, so renames remain visible to the compiler and do not pin the
  facade to runtime name inference.

## Working with the design

- Add data with a `@component` class containing flat primitive fields. This keeps
  the component compatible with the current Koota-backed storage.
- Add behavior with a `@system({ priority })` class whose constructor receives
  named `Query` values, service ports, and any narrow capabilities it needs.
- Read and write in loops through named query components. Read once with
  `entity.get()` and write through `entity.set()`.
- Spawn with component instances such as
  `world.spawn(new Position(x, y), new Health(30))`.
- Create every World explicitly with
  `World.create((world) => createGameSystems(world, input, audio))`.
- Systems that create entities receive a narrow spawn capability instead of a
  World locator.

## Deferred, not discarded

- **Full-kit features:** prefabs, save snapshots, and fixed-timestep physics are
  tracked as `TODO.md` slices.
- **SoA compiler:** `docs/future/ecs-compiler.md` is marked DEFERRED. Its entry
  criterion is profiler evidence of sustained pressure at 10k or more entities,
  not elegance. Start it on numbers, not on the appeal of a second abstraction.
