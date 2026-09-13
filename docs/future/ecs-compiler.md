# Future idea: ECS compiler that makes Design 2/3 as fast as Design 1

Status: **DEFERRED**. Entry criterion is profiler evidence of sustained
pressure at 10k+ entities (see the frame-time profiling slice in `TODO.md`),
not elegance. See also `docs/ecs-design.md` for why Design 2 was chosen
without it. Original note from 2026-09-13 below.

## Goal

Keep source ergonomics of Design 2 (Aurelia-style decorators + `resolve()` DI)
and Design 3 (schema + scheduling + snapshots), but compile hot paths down to
Design 1 performance (SoA TypedArrays, cached queries, zero alloc in loop).

Models: Svelte (framework disappears) for full codegen, React Compiler
(auto-memoize queries) for cheap wins.

## What is fast in Design 1

1. SoA TypedArrays: `Position.x[eid]` contiguous.
2. No allocation in loop: cached query arrays, no tuples/iterators/Proxies.
3. Monomorphic access: array index, not `Map.get()` + guards.

## Source -> prod mapping (proposed)

| Source (you write)                    | Prod (compiler emits)                                                 |
| ------------------------------------- | --------------------------------------------------------------------- |
| `@component class Position { x = 0 }` | `Position = { x: Float32Array(CAP), y: ... }` + schema for saves      |
| `@query(Position, Velocity) targets`  | hoisted `queryCache.getOrCreate([0,1])`, `this.targets` -> direct ref |
| `for (const [p,v] of this.targets)`   | `for (i...) { eid=dense[i]; px[eid]... }`                             |
| `spawn(new Position(x))`              | `eid=alloc(); px[eid]=x` (memcpy defaults)                            |
| `e.get/set/has/destroy()`             | direct index / `destroy(eid)`                                         |
| `resolve(IWorld)`                     | direct singleton import in prod, container in dev                     |
| `before/after` DAG literals           | topological sort at build time                                        |

Dev runs uncompiled (Maps, validation). Prod strips checks/allocs. Compiled
output must remain the _only_ storage to avoid dev/prod divergence.

Prior art: `bevy_ecs` derive macros, `becsy` `new Function()` bindings,
`koota` `babel-plugin-inline-functions`.

## What cannot be compiled (keep runtime fallback)

- Dynamic composition: `query(...dynamicList)`, conditional `add()`.
- Dynamic DI scopes: child containers, `resolve(all(...))` plugins.
- `observe(e => closure)` + coroutines capturing locals (stay AoS).
- Name-inferred magic (`e.position` from class name) — forbidden; compiler
  needs explicit `@query(Position)`.

## Pragmatic path

1. Facade over fast core now (Map -> archetype swap, same API). 80% win.
2. TS transformer / Babel plugin for `execute()` loops only (~200 LOC,
   `ts-morph`). Test both modes.
3. Full disappear only if profiler shows query iteration bottleneck at 10k+
   entities (projectiles/particles).

Risk: dual runtime divergence. Mitigate with parity tests.
