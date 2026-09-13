# Constructor injection migration plan

Status: planned

This plan removes the internal DI container, ambient `resolve()`, runtime
service keys, and query property injection. Required dependencies become
constructor parameters, and the browser composition root wires the object
graph explicitly.

This document supersedes the dependency-injection sections of
`docs/ecs-mvvm-design.md`, `docs/ecs-design.md`, and `docs/aurelia-ecs.md` until
those documents are updated in Phase 5. The completed phase record in
`docs/ecs-mvvm-implementation-plan.md` remains historical evidence and should
not be rewritten.

## Target construction model

No DI framework is needed.

- `main.ts` constructs the browser adapters.
- `World.create(factory)` creates the Koota-backed World, invokes a synchronous
  factory with that World, installs the returned system instances, wires their
  lifecycle, and returns the ready World.
- `createGameSystems(world, input, audio)` is a plain composition function. It
  creates fresh system instances and passes each constructor only the queries,
  ECS capabilities, and service ports it requires.
- `GameViewModel` receives its World, audio port, and random port through its
  constructor. It does not construct or locate them.
- The composition root owns adapters, World, ViewModel, and Pixi view. It
  disposes them explicitly in dependency-safe order.

The target system dependencies are narrow:

| System            | Constructor dependencies                             |
| ----------------- | ---------------------------------------------------- |
| `Platformer`      | player query, gun query, input, audio                |
| `FoeShamble`      | foe query, player query                              |
| `Movement`        | position/velocity query                              |
| `FloorCorrection` | position/velocity query                              |
| `Shooting`        | shooter query, entity-spawn capability, input, audio |
| `BoltHit`         | projectile query, foe query, audio                   |
| `Death`           | health query                                         |

Queries are model views rather than services. Passing them through constructors
removes the remaining hidden property injection from `@query`. `Shooting`
receives only a spawn capability rather than the complete World, so it cannot
turn the World into a general-purpose locator.

`@component` remains because it declares Koota storage metadata. `@system`
may remain because it declares schedule priority only. `@query`, `IWorld`,
service tokens, provider registrations, scopes, and `resolve()` are removed.

## Handoff protocol

Every phase starts by reading:

1. `AGENTS.md`
2. This plan and all completed phase records below
3. `docs/ecs-mvvm-design.md`, with this plan taking precedence for DI and
   construction
4. The source and tests named by the phase

At phase completion, update the matching record with commands run, failures,
and deviations. Write `none` when there was no deviation. Do not begin the next
phase until the current phase's required checks pass.

## Phase record

| Phase                                | Status   | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Deviations   |
| ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1. World composition API             | Complete | Commands run: `vp test run src/ecs/design2.test.ts` (passed; 13 tests); `vp check --fix` (passed); final `vp check` (passed). Failed commands: initial focused test run failed because the temporary constructor path lost query wiring during the new instance-installation refactor; restored legacy wiring and reran successfully. Initial `vp check` found formatting in this record and `src/ecs/design2.test.ts`; the post-record `vp check` found formatting in this record; both were corrected with `vp check --fix`. Initial commit hook reported a stale Fallow suppression on `GameSystem.initialize`; removed the obsolete suppression and reran the checks. | none         |
| 2. Constructor-injected systems      | Complete | Commands run: `vp test run src/game/systems.test.ts src/game/game-view-model.test.ts` (passed; 16 tests); `vp test` (passed; 38 tests); `vp check --fix` (passed); final `vp check` (passed). Failed commands: initial `vp check` found formatting in the three changed TypeScript files; `vp check --fix` then found stale resolver imports and a type-only import after formatting; the post-record `vp check` found formatting in this record; the initial commit hook passed tests, E2E, and formatting but failed Fallow on the transitional service-key exports. All were corrected with scoped suppressions and the commit hook was rerun.                         | none         |
| 3. Bootstrap and ViewModel ownership | Complete | Commands run: `vp test run src/game/game-view-model.test.ts` (passed; 7 tests); `vp test` (passed; 38 tests); `vp run e2e` (passed; 1 test); `vp check` (passed). Failed commands: none.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | none         |
| 4. Delete the DI framework           | Planned  | Not run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Not recorded |
| 5. Documentation and final gates     | Planned  | Not run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Not recorded |

## Phase 1: World composition API

Recommended model: Luna High

Complexity: medium. This phase establishes the construction and failure-cleanup
contract while retaining the current DI path temporarily.

Inputs:

- `src/ecs/design2.ts`
- `src/ecs/design2.test.ts`
- Existing schedule, query, initialization, teardown, and World-isolation
  behavior
- The target construction model in this document

Work:

- Add contract tests for creating a World from a synchronous system-instance
  factory.
- Add `World.create(factory)` or an equivalently named static factory. The
  callback receives the exact World that will execute and own the returned
  systems.
- Permit the callback to create World-bound `Query` objects before system
  installation.
- Make the callback return fresh `GameSystem` instances, not constructors or a
  reusable array.
- Sort returned instances by `@system` priority while preserving callback array
  order for equal priorities.
- Wire lifecycle without DI: initialize each installed system once, execute in
  schedule order, and destroy in reverse order.
- If the callback, query creation, or system initialization fails, destroy all
  installed systems and the Koota World before rethrowing the original error.
- Reject asynchronous factories. Constructors and composition must complete
  synchronously before the World is returned.
- Reject reusing one system instance in multiple Worlds.
- Preserve the current constructor/provider path only as a temporary migration
  path for Phase 2.

Output contract consumed by Phase 2:

- A fully usable World exists before system constructors run.
- The system factory can safely call `world.query(...)` and pass the resulting
  handles into constructors.
- World owns installed system lifecycle but does not resolve or construct
  dependencies.
- Current production behavior still compiles through the temporary path.

Required verification:

- `vp test run src/ecs/design2.test.ts`
- `vp check`

## Phase 2: constructor-injected systems

Recommended model: Luna High

Complexity: medium. This phase changes every game system's dependency surface
and its focused tests, but it does not move browser ownership yet.

Inputs:

- Completed Phase 1 system-instance factory
- `src/game/systems.ts`
- `src/game/systems.test.ts`
- `src/game/game-view-model.ts`
- `src/game/game-view-model.test.ts`
- Existing service interfaces in `src/game/contracts.ts`

Work:

- Replace every `resolve()` field with a required constructor parameter.
- Replace every decorated query field with a required constructor query
  parameter.
- Give `Shooting` a narrow spawn capability plus its shooter query, input, and
  audio. Do not inject the complete World unless the narrower capability proves
  impractical and the deviation is recorded.
- Keep stateless tuning constants in the system module rather than injecting
  configuration prematurely.
- Replace the `gameSystems` constructor manifest with
  `createGameSystems(world, input, audio)` or an equivalent plain factory.
- Build all required queries inside that composition function and pass them to
  constructors explicitly.
- Ensure every factory call creates a new set of system instances and queries.
- Update system tests to create Worlds through the Phase 1 API and instantiate
  selected systems directly with fake ports and explicit queries.
- Keep behavior tests for movement, floor correction, shooting into the
  executing World, collision damage, death, scheduling, and two-World
  isolation.
- Update `GameViewModel` temporarily to create its internal World through the
  new factory so production remains functional until Phase 3 moves composition
  to `main.ts`.
- Update ViewModel test helpers for the temporary constructor shape without
  weakening their behavior assertions.

Output contract consumed by Phase 3:

- No game system imports or calls `resolve()`.
- No game system has a framework-assigned property.
- `createGameSystems` is a normal typed function whose parameters expose every
  stable service dependency.
- All system instances and queries are fresh per World.
- The application still boots through the ViewModel's temporary internal
  composition.

Required verification:

- `vp test run src/game/systems.test.ts src/game/game-view-model.test.ts`
- `vp test`
- `vp check`

## Phase 3: bootstrap and ViewModel ownership

Recommended model: Luna High

Complexity: medium. This phase moves the final object graph to the browser
composition root and makes ownership and failure cleanup explicit.

Inputs:

- Completed Phase 2 `createGameSystems`
- `src/main.ts`
- `src/game/game-view-model.ts`
- `src/game/game-view-model.test.ts`
- `src/game/input.ts`, `src/game/audio.ts`, and `src/game/pixi-view.ts`
- `e2e/smoke.spec.ts`

Work:

- Change `GameViewModel` to receive World, audio, random, and optional initial
  foe positions through constructor parameters or one typed constructor options
  object. Do not accept factories, containers, providers, or tokens.
- Remove input from the ViewModel constructor because only systems consume it.
- Remove World construction from `GameViewModel`.
- Define ownership explicitly: bootstrap owns World and adapters;
  `GameViewModel.dispose()` releases only ViewModel-owned state and rejects
  later use.
- Update ViewModel tests to construct fake ports, compose a real World with
  `createGameSystems`, then pass that World into the ViewModel.
- Keep two-ViewModel isolation coverage and add a regression proving disposal
  of one composition does not affect another.
- In `main.ts`, construct input, audio, and random first; create the World with
  `World.create`; construct the ViewModel from that World; then mount Pixi.
- Register teardown before asynchronous mount work can fail, or guard startup
  with rollback that disposes everything already constructed.
- Use dependency-safe teardown order: cancel rAF, dispose Pixi view, dispose
  ViewModel, dispose World and its systems, then dispose audio and input.
- Keep the browser smoke test behavior unchanged unless selectors or visible
  behavior genuinely change.

Output contract consumed by Phase 4:

- `main.ts` is the only production composition root.
- Every stable dependency edge is visible in constructor or factory arguments.
- `GameViewModel` does not create, locate, register, or dispose injected
  dependencies.
- No production path needs provider arrays or runtime service keys.
- Startup and mount failure cannot leak a World, listeners, Pixi resources, or
  a scheduled frame.

Required verification:

- `vp test run src/game/game-view-model.test.ts`
- `vp test`
- `vp run e2e`
- `vp check`

## Phase 4: delete the DI framework

Recommended model: Luna High

Complexity: low to medium. Most edits are deletions, but they touch the core
types and completed architecture tests.

Inputs:

- Completed Phase 3 with zero production provider registrations
- `src/ecs/design2.ts`
- `src/ecs/design2.test.ts`
- `src/ecs/di.ts`
- `src/ecs/di.test.ts`
- `src/game/contracts.ts`
- `.fallowrc.json`

Work:

- Remove the temporary constructor/provider path from World.
- Make the system-instance factory the only World construction path.
- Remove `InstanceProvider`, `Key`, scopes, `IWorld`, and the re-exported
  `resolve()` API from `src/ecs/design2.ts`.
- Remove `@query`, query metadata, and query property wiring after confirming
  no source or test uses them.
- Keep the public `world.query(...)` API used during explicit composition.
- Change service contracts to TypeScript interfaces only; remove `IInput`,
  `IAudio`, and `IRandom` runtime symbols.
- Delete `src/ecs/di.ts` and `src/ecs/di.test.ts`.
- Remove obsolete Fallow ignored exports from `.fallowrc.json`.
- Rewrite ECS contract tests around instance factories, explicit query
  construction, schedule order, lifecycle, factory failure cleanup, instance
  reuse rejection, and World isolation.
- Search the whole repository for `resolve`, `createScope`, `instanceProvider`,
  `InstanceProvider`, `Key`, `IWorld`, `IInput`, `IAudio`, `IRandom`, and
  `@query`. Every DI-related occurrence must be gone outside historical text
  awaiting Phase 5.

Output contract consumed by Phase 5:

- The application has no DI framework, container, resolver, provider, service
  key, ambient construction context, or property injection.
- World manages ECS storage, system scheduling, and lifecycle only.
- Required service dependencies are constructor-visible.
- Required model views and capabilities are constructor-visible.

Required verification:

- `vp test run src/ecs/design2.test.ts src/game/systems.test.ts src/game/game-view-model.test.ts`
- `vp test`
- `vp run test:coverage`
- `vp check`
- `vp build`
- `vp run audit`
- `vp run e2e`

## Phase 5: documentation and final gates

Recommended model: Luna High because the documentation must be checked against
the final source rather than rewritten mechanically.

Complexity: low to medium. Runtime work is complete; this phase reconciles all
examples and architectural claims.

Inputs:

- Completed Phase 4 source and test results
- `README.md`
- `docs/ecs-design.md`
- `docs/aurelia-ecs.md`
- `docs/ecs-mvvm-design.md`
- `docs/ecs-mvvm-code-demo.md`
- `docs/future/ecs-compiler.md`
- `docs/ecs-mvvm-implementation-plan.md`
- This plan

Work:

- Update `README.md` to describe constructor injection, explicit composition,
  system instance factories, and the absence of a DI container.
- Update `docs/ecs-design.md` so Design 2 retains plain classes and declarative
  component/system metadata without claiming scoped resolver DI.
- Update `docs/aurelia-ecs.md` to state precisely what remains Aurelia-inspired
  and why constructor injection was chosen over `resolve()`.
- Update `docs/ecs-mvvm-design.md` to replace its dependency-scope section with
  the final constructor and ownership model.
- Update `docs/ecs-mvvm-code-demo.md` so every example uses the final API and
  manual composition.
- Update `docs/future/ecs-compiler.md` to remove resolver and injected-query
  assumptions from proposed compiler mappings.
- Add a short supersession note to
  `docs/ecs-mvvm-implementation-plan.md`; preserve its completed phase records
  as historical evidence.
- Mark this plan complete with exact verification results and any accepted
  deviations.
- Confirm documentation contains no current-tense recommendation for service
  locators, ambient resolution, or property injection.

Final verification:

- `vp check`
- `vp test`
- `vp run test:coverage`
- `vp build`
- `vp run audit`
- `vp run e2e`
- Repository search confirms no runtime DI symbols or deleted DI paths remain.

## Dependency chain

Phase 1 must land first because it breaks the World/system construction cycle
without global state. Phase 2 can then move every system dependency into a
constructor while the ViewModel temporarily preserves application startup.
Phase 3 transfers composition and ownership to bootstrap. Only after that path
is proven can Phase 4 remove the old container and property-wiring machinery.
Phase 5 documents the final implementation rather than an intermediate state.

Do not add Aurelia Kernel or another DI package during this migration. If a
future object graph becomes large enough to justify a container, evaluate it
against constructor injection, explicit registration, deterministic scopes,
and the rule that application code cannot call the container.
