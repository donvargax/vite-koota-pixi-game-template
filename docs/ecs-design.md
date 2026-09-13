# ECS design: three options, one choice

Evaluated against `bitECS`, `koota`, `becsy`, and `miniplex` (survey notes
in chat history; API details verified via DeepWiki). Three interface shapes
were designed in parallel from the same requirements (TypeScript,
renderer-agnostic, spawn/destroy/query/update for a 2D metroidvania).

## Design 1 — Minimal core (functions, 0-method World)

`createWorld`, `defineComponent`, `spawn`, `destroy`, `add/get/has`,
`query`, `update(world, dt, systems)`. Entities are numbers, storage is
`Map<Comp, Map<Entity, data>>`, systems are pure functions run in caller
order. ~120 lines, trivially testable, `O(n)` queries, no scheduling or
events. Closest to `mreinstein/ecs` / `bitECS` philosophy.

## Design 2 — Aurelia-inspired (decorators + explicit composition) ✅ chosen

`@component` classes, `@system({ priority })` metadata,
constructor-injected queries and service ports, and a `World.create(factory)`
composition API. Each World installs its own system instances and query objects.
Koota traits and handles stay behind the ECS facade; query tuples are write-through
proxies over snapshot copies.

## Design 3 — Full kit (schema + scheduling + saves)

`defineComponent` with typed schemas, `All/Any/None/Added/Changed/Rel`
query algebra, relations (`ChildOf`, `Contains`), prefabs with inheritance,
`CommandBuffer` deferral, fixed/variable timestep split, observers,
coroutines, schema-driven snapshots + binary format + migrations. Closest
to `becsy` + `bitECS` serialization.

## Comparison

- **Simplicity**: 1 (functions) < 2 (2 decorators) < 3 (schema + DAG).
- **Depth** (small interface hiding real machinery): 2 wins for its size —
  the facade hides the backend, DI, query wiring, and lifecycle.
- **Biggest divergence**: where queries live — call-site args (1), constructor
  args (2), query algebra (3) — and the time model: single `dt`
  (1, 2) vs split fixed/variable + `alpha` (3).
- **Performance today**: 1 is fastest per op; 2 pays proxy + `set()` per
  field write (negligible at our entity counts); 3 pays a learning curve.

## Why Design 2

1. Reads like the framework the team knows (Aurelia), while constructor
   arguments and explicit composition keep construction and ownership inspectable.
2. Explicit queries keep the door open: the facade can swap Koota for
   archetypes or SoA later without changing game code, and the deferred
   compiler (`docs/future/ecs-compiler.md`) targets this syntax.
3. Design 1 saves nothing we need yet (entity counts are in the hundreds)
   and pushes ordering and lifecycle onto every caller. Design 3 is the right
   _second_ system; its pieces are sliced in `TODO.md` instead of bought up
   front.

## Implemented boundary

- Production exports `createGameSystems(world, input, audio)`. Importing a system
  module does not register an instance or make it run.
- `World.create(factory)` creates one Koota backend and installs the fresh system
  instances returned by that factory. Priority ties preserve factory order.
- `initialize()` runs during construction, `execute(dt)` runs during updates,
  and `dispose()` invokes `destroy()` once in reverse schedule order.
- `EntityRef`, `Query`, and component declarations are the game-facing API.
  Koota is imported only by `src/ecs/design2.ts`.
- The backend can therefore change without exposing Koota entities or query
  internals to systems, the ViewModel, views, or tests.

## Deferred, not discarded

- **Full-kit features** → `TODO.md` slices (prefabs, save snapshots,
  fixed-timestep physics).
- **SoA compiler** → `docs/future/ecs-compiler.md`, marked DEFERRED with an
  entry criterion (profiler evidence at 10k+ entities). Do not start it
  on elegance grounds; start it on numbers.
