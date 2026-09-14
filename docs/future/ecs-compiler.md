# Future idea: ECS compiler that makes Design 2/3 as fast as Design 1

Status: **DEFERRED**. Entry criterion is profiler evidence of sustained
pressure at 10k+ entities (see the frame-time profiling slice in `TODO.md`),
not elegance. See also `docs/design.md` for why Design 2 was chosen
without it. This remains a design note, not an implementation commitment.

## Goal

Keep the source ergonomics of Design 2 (Aurelia-inspired decorators and
constructor-visible dependencies) and Design 3 (schema + scheduling + snapshots),
but compile hot paths down to Design 1 performance (SoA TypedArrays, cached
queries, zero alloc in loop).

Models: Svelte (framework disappears) for full codegen, React Compiler
(auto-memoize queries) for cheap wins.

## What is fast in Design 1

1. SoA TypedArrays: `Position.x[eid]` contiguous.
2. No allocation in loop: cached query arrays, no tuples/iterators/Proxies.
3. Monomorphic access: array index, not `Map.get()` + guards.

## Source -> prod mapping (proposed)

| Source (you write)                                                        | Prod (compiler emits)                                            |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `@component class Position { x = 0 }`                                     | `Position = { x: Float32Array(CAP), y: ... }` + schema for saves |
| `constructor(targets: Query<{ position: Position; velocity: Velocity }>)` | hoisted query cache, with the same facade query shape            |
| `for (const { components: { position: p, velocity: v } } of targets)`     | `for (i...) { eid=dense[i]; px[eid]... }`                        |
| `world.spawn(new Position(x))`                                            | `eid=alloc(); px[eid]=x` (memcpy defaults)                       |
| `entity.get/set/has/destroy()`                                            | direct index / `destroy(eid)`                                    |
| `createGameSystems(world, input, audio)`                                  | specialized instance construction and query setup                |
| `before/after` DAG literals                                               | topological sort at build time                                   |

The current runtime is a validated Koota-backed facade. A future compiler may
strip checks and allocations in a production backend, but compiled output must
remain the _only_ storage to avoid dev/prod divergence. Koota entities and
backend query shapes must not leak through the facade.

Prior art: `bevy_ecs` derive macros, `becsy` `new Function()` bindings,
`koota` `babel-plugin-inline-functions`.

## What cannot be compiled (keep runtime fallback)

- Dynamic composition: runtime-built query specs, conditional `add()`.
- Dynamic composition: runtime-selected system graphs and query type lists stay
  on the runtime fallback path.
- `observe(e => closure)` + coroutines capturing locals (stay AoS).
- Name-inferred magic (`e.position` from class name) is forbidden; the compiler
  needs explicit named query specs and must preserve the facade boundary.

## Pragmatic path

1. Keep the facade over the current Koota backend; a backend swap must preserve
   the same public API.
2. TS transformer / Babel plugin for `execute()` loops only (~200 LOC,
   `ts-morph`). Test both modes.
3. Full disappear only if profiler shows query iteration bottleneck at 10k+
   entities (projectiles/particles).

Risk: dual runtime divergence. Mitigate with parity tests.
