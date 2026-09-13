# ECS/MVVM implementation plan

Status: planned

This plan moves the existing ECS facade to World-scoped services and extracts a
headless game ViewModel. It is divided into phases sized for fresh agent
sessions. A phase should fit comfortably in one Luna High session without
requiring context from the conversation that produced this document.

## Source documents

- `docs/ecs-mvvm-design.md` is the design contract. It defines ownership,
  lifetimes, public boundaries, and test levels.
- This file is the execution plan and phase handoff record.
- `docs/ecs-design.md` and `docs/aurelia-ecs.md` explain the original design,
  but they are not authoritative where they conflict with the new design.
- Existing tests describe shipped behavior. New contract tests added by an
  earlier phase become required inputs for every later phase.

## Handoff protocol

Before starting a phase, the agent must read:

1. `AGENTS.md`
2. `docs/ecs-mvvm-design.md`
3. This file, including all completed phase records
4. Tests and production files named by the phase

At the end of a phase, the agent updates the matching row in the phase record.
The record must contain the status, commands run, any failed command, and every
deviation from the design. If no deviation occurred, write `none`. The next
phase must not infer missing work from a diff or chat history.

Do not mark a phase complete while its required verification is failing. A
test-first phase may be red within the session, but its final handoff must be
green.

## Phase record

| Phase                         | Status   | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Deviations   |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1. Scoped ECS core            | Complete | Commands run: `vp test run src/ecs/di.test.ts src/ecs/design2.test.ts` (passed); `vp check` (passed). Failed command: initial `vp check` found formatting and type/lint issues; corrected and rerun successfully.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | none         |
| 2. Browser service ports      | Complete | Commands run: `vp test run src/game/input.test.ts src/game/audio.test.ts` (passed); `vp check` (passed after formatting fix). Failed commands: initial `vp check` found formatting issues and was corrected with `vp check --fix`; an intermediate focused test run failed because a test expected volume `0` instead of the adapter-set `0.25`, then passed after correction; initial `git commit -m "feat: add browser service ports"` hook failed Fallow on intentionally not-yet-consumed Phase 2 exports, then passed after scoped suppressions were added.                                                                                                                         | none         |
| 3. Isolated game systems      | Complete | Commands run: `vp test run src/game/systems.test.ts` (passed); `vp test` (passed); `vp check --fix` (passed); `vp check` (passed); `vp run e2e` (passed). Failed commands: initial `vp check` runs found formatting issues in the plan and systems test, then in the updated plan row; the first commit hook's Playwright smoke test failed because the pre-ViewModel composition root lacked compatibility providers; the next hook's Fallow audit found intentional transitional exports and manifest-driven methods. Formatting was corrected with `vp check --fix`; browser adapter compatibility registration and scoped Fallow suppressions were added, and the smoke test passed. | none         |
| 4. Headless GameViewModel     | Complete | Commands run: `vp test run src/game/game-view-model.test.ts` (passed); `vp test` (passed); `vp check` (passed). Failed commands: initial `vp check` found formatting issues in the two new ViewModel files; initial `vp check --fix` then found three literal-inference type errors after formatting; after updating this row, `vp check` found plan formatting issues; all were corrected and the required commands reran successfully.                                                                                                                                                                                                                                                 | none         |
| 5. Presentation composition   | Planned  | Not run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Not recorded |
| 6. Remove compatibility paths | Planned  | Not run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Not recorded |
| 7. Quality gates              | Planned  | Not run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Not recorded |
| 8. Documentation closeout     | Planned  | Not run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Not recorded |

## Phase 1: scoped ECS core

Recommended model: Luna High

Complexity: medium. This phase changes instance ownership, dependency
resolution, and teardown in the central facade. It should not include gameplay
changes.

Inputs:

- `src/ecs/design2.ts`
- `src/ecs/design2.test.ts`
- The lifecycle and dependency rules in `docs/ecs-mvvm-design.md`
- Koota 0.6.6 public APIs: World `destroy()`, World `has(entity)`, and query
  result `length`

Work:

- Add `src/ecs/di.ts` and `src/ecs/di.test.ts` for typed service keys,
  instance providers, synchronous construction-context resolution, isolated
  scopes, and scope disposal.
- Rewrite `src/ecs/design2.test.ts` so framework tests declare local components
  and systems instead of importing the game module.
- Extend `src/ecs/design2.ts` with explicit World options for systems and
  providers.
- Give each World its own service scope and system instances.
- Register the executing World as `IWorld` in its scope before constructing
  systems, so field initializers can resolve it.
- Make priority ties deterministic by preserving manifest order.
- Add World disposal. Disposal calls each initialized system's teardown once,
  destroys the Koota World, and rejects later updates.
- Add `EntityRef.isAlive()` and correct the type of reads for absent
  components.
- Stop query counts from constructing component proxies.
- Validate component defaults and spawned values as supported flat data.
- Keep the old global registration path temporarily. Phase 6 removes it after
  all consumers migrate.

Outputs consumed by Phase 2:

- `src/ecs/di.ts` exports the stable provider and resolver contracts.
- `World` accepts explicit systems and providers.
- Multiple Worlds can update alternately without sharing system, query, or DI
  state.
- Core tests no longer load browser or game modules.

Verification:

- `vp test run src/ecs/di.test.ts src/ecs/design2.test.ts`
- `vp check`

## Phase 2: browser service ports

Recommended model: Luna High, although a lower-cost tool-using model is
acceptable if it handles TypeScript tests reliably.

Complexity: low to medium. The behavior is local, but event listener cleanup
and key-edge semantics need careful tests.

Inputs:

- Completed Phase 1 provider contract
- `src/game/input.ts`
- `src/game/audio.ts`
- Input and audio rules in `docs/ecs-mvvm-design.md`

Work:

- Add `src/game/contracts.ts` with input, audio, and random-source interfaces
  and their service keys.
- Add `src/game/input.test.ts` and convert `src/game/input.ts` to a disposable
  keyboard adapter.
- Distinguish edge-triggered jump input from held shooting input.
- Handle repeated keydown events, blur reset, idempotent binding, and listener
  disposal.
- Add `src/game/audio.test.ts` and convert `src/game/audio.ts` to a disposable
  HTML audio adapter.
- Keep audio locked until an actual user gesture occurs.
- Preserve temporary functional wrappers used by the current `main.ts` and
  systems. Phase 6 removes them.

Outputs consumed by Phase 3:

- Stable `InputPort`, `AudioPort`, and `RandomPort` contracts.
- Concrete browser adapters for the composition root.
- Fake port objects can be registered in a World without a DOM.

Verification:

- `vp test run src/game/input.test.ts src/game/audio.test.ts`
- `vp check`

## Phase 3: isolated game systems

Recommended model: Luna High

Complexity: medium. This phase changes system construction and corrects the
simulation order while preserving gameplay.

Inputs:

- Completed Phase 1 World-scoping API
- Completed Phase 2 service contracts
- `src/game/components.ts`
- `src/game/systems.ts`

Work:

- Add `src/game/systems.test.ts` with fake input and audio providers.
- Export the system classes needed for focused tests and export one ordered
  `gameSystems` manifest for production composition.
- Resolve World, input, and audio during scoped system construction. Do not
  resolve dependencies inside `execute()`.
- Remove the production `order` array used by the current acceptance test.
- Test each behavior with only the systems it requires.
- Separate post-movement floor correction so a falling entity cannot remain
  below the floor for a frame.
- Verify that shooting spawns into the World executing the system.
- Preserve current movement, pursuit, cooldown, projectile, damage, death, and
  sound behavior except for the floor-correction bug.

Outputs consumed by Phase 4:

- `gameSystems` is the only production system manifest.
- Systems run under Node with fake ports and no browser globals.
- System behavior is covered independently of Pixi and `main.ts`.

Verification:

- `vp test run src/game/systems.test.ts`
- `vp test`
- `vp check`

## Phase 4: headless GameViewModel

Recommended model: Luna High

Complexity: medium. This phase moves application behavior out of the browser
entry point and defines the ViewModel API used by the next phase.

Inputs:

- Completed Phase 3 `gameSystems` manifest
- `src/main.ts` behavior for initial spawning, damage, respawn,
  reinforcement, HUD values, and hit sounds
- The ViewModel contract in `docs/ecs-mvvm-design.md`

Work:

- Add `src/game/game-view-model.test.ts`.
- Add `src/game/game-view-model.ts` with no imports from Pixi and no access to
  `window`, `document`, `Audio`, `performance`, or rAF.
- Let the ViewModel own the World, player reference, game timers, initial
  spawning, damage and spawn commands, sound decisions, and disposal.
- Inject input, audio, and random providers through construction options.
- Expose immutable HUD and render projections rather than Koota entities.
- Make start and disposal behavior explicit and idempotent.
- Test initial state, commands, ticking, death, delayed respawn, delayed
  reinforcement, deterministic random placement, sounds, projections, and
  disposal.

Outputs consumed by Phase 5:

- A stable `GameViewModel` lifecycle: construct, start, tick, command, read
  projection, dispose.
- A render projection containing every value Pixi needs without exposing the
  World.
- A HUD projection containing display-ready game values without DOM nodes.

Verification:

- `vp test run src/game/game-view-model.test.ts`
- `vp test`
- `vp check`

## Phase 5: presentation composition

Recommended model: Luna High

Complexity: medium. The individual edits are straightforward, but async Pixi
mounting, one-loop ownership, and teardown cross several files.

Inputs:

- Completed Phase 4 ViewModel API and projections
- `src/game/pixi-view.ts`
- `src/main.ts`
- `e2e/smoke.spec.ts`

Work:

- Change `src/game/pixi-view.ts` to mount without a World, render ViewModel
  projections, and dispose its sprites, ticker callback if any, canvas, and
  Pixi application.
- Keep a temporary compatibility overload if needed to prevent a broken
  intermediate build. Phase 6 removes it.
- Reduce `src/main.ts` to composition: create browser adapters, create and
  start the ViewModel, mount Pixi, run one rAF loop, bind DOM commands, render
  projections, and dispose on page teardown.
- Remove spawning, timers, hit detection responses, reinforcement, respawn,
  direct ECS reads, and random game decisions from `main.ts`.
- Update `e2e/smoke.spec.ts` to prove that spawn changes the foe count, damage
  changes HP, the canvas remains visible, and no page error occurs.

Outputs consumed by Phase 6:

- No production consumer requires global DI, functional input/audio wrappers,
  `EntityRef.raw`, or World-driven Pixi synchronization.
- Simulation advances from one owned rAF loop.
- Browser smoke coverage exercises View-to-ViewModel commands.

Verification:

- `vp test`
- `vp run e2e`
- `vp check`

## Phase 6: remove compatibility paths

Recommended model: Luna High

Complexity: low to medium. The deletion surface spans several modules, so the
agent must search all references before removing APIs.

Inputs:

- Completed Phase 5 composition
- Passing unit and E2E suites
- The forbidden dependency directions in `docs/ecs-mvvm-design.md`

Work:

- Remove transitional functional wrappers and global state from
  `src/game/input.ts`.
- Remove transitional functional wrappers and global state from
  `src/game/audio.ts`.
- Remove World imports, ECS queries, independent simulation synchronization,
  and temporary overloads from `src/game/pixi-view.ts`.
- Remove global singleton registration, decorator-time system instances,
  implicit system discovery, public Koota access, and `EntityRef.raw` from
  `src/ecs/design2.ts`.
- Strengthen `src/ecs/design2.test.ts`, `src/game/systems.test.ts`, and
  `src/game/game-view-model.test.ts` with final isolation and disposal
  regressions.
- Search `src` for direct browser dependencies in systems/ViewModel and direct
  Koota dependencies outside the ECS facade.

Outputs consumed by Phase 7:

- Final public framework surface with no compatibility branch.
- The only direct Koota import is in the ECS implementation.
- Browser APIs exist only in adapters and the composition root.

Verification:

- `vp test`
- `vp run e2e`
- `vp check`
- `vp run audit`

## Phase 7: quality gates

Recommended model: Luna High for the first attempt. A lower-cost tool-using
model is suitable once the expected Vite+ configuration is known.

Complexity: low to medium. Configuration changes are small, but CI must use
the project's Vite+ commands rather than substituting standard Vite commands.

Inputs:

- Final source and test layout from Phase 6
- `AGENTS.md` Vite+ instructions
- Existing `package.json`, `tsconfig.json`, `vite.config.ts`, and Playwright
  configuration

Work:

- Expand `tsconfig.json` coverage to include E2E and root TypeScript config
  files without weakening source checks.
- Add a coverage script to `package.json`; no new dependency is required.
- Configure V8 coverage in `vite.config.ts` for ECS, systems, ports, and the
  ViewModel. Exclude browser composition and asset manifests.
- Measure the first coverage baseline before choosing thresholds.
- Add `.github/workflows/ci.yml` using the documented Node version and Vite+
  install/check/test/build commands, Fallow, and Playwright.
- Verify that staged-file patterns cover the changed source, tests, root
  TypeScript files, and nested project documentation without touching vendored
  assets.

Outputs consumed by Phase 8:

- Reproducible local and CI commands.
- Recorded coverage thresholds based on the implemented test suite.
- All source and tool TypeScript files participate in type checking.

Verification:

- `vp check`
- `vp test`
- `vp run test:coverage`
- `vp build`
- `vp run audit`
- `vp run e2e`

## Phase 8: documentation closeout

Recommended model: a lower-cost writing-capable model. Use Luna High if the
model must inspect code to verify every statement.

Complexity: low. This phase changes documentation only and must describe the
implemented state, not the migration history.

Inputs:

- Completed Phase 7 source, tests, and command output
- `docs/ecs-mvvm-design.md`
- Current `README.md`, `docs/ecs-design.md`, `docs/aurelia-ecs.md`,
  `docs/future/ecs-compiler.md`, and `TODO.md`

Work:

- Update `README.md` with the Model/ViewModel/View split, explicit system
  manifest, World-scoped services, teardown, test styles, and final commands.
- Update `docs/ecs-design.md` so the chosen design includes explicit system
  registration, per-World instances, lifecycle, and backend encapsulation.
- Update `docs/aurelia-ecs.md` to describe scoped construction and explain that
  Aurelia remains an API influence rather than a runtime dependency.
- Correct stale Koota and query-shape claims in
  `docs/future/ecs-compiler.md`, including its future-dated note.
- Reorder `TODO.md`: fixed timestep, tile collision, edge input and coyote
  time, melee and hit-stop, relations and inventory, prefabs, stable schemas
  and snapshots, game-state scheduling, content, profiling, then any compiler
  spike justified by measurements.
- Mark this plan complete and record final verification in the phase table.

Final outputs:

- Documentation agrees with the shipped API and tests.
- The next gameplay slice can start without depending on this conversation.
- `docs/ecs-mvvm-design.md` remains the architectural source of truth until a
  later decision replaces it.

Verification:

- Check every named path and command against the repository.
- `vp check`
- Confirm all eight phase records are complete and contain no unresolved
  deviation.

## Dependency chain

Phase 1 defines World and DI ownership. Phase 2 builds service contracts on
that ownership. Phase 3 consumes those contracts in systems. Phase 4 consumes
the system manifest and exposes stable projections. Phase 5 binds those
projections to Pixi and the DOM. Only then can Phase 6 delete compatibility
paths. Phase 7 configures checks against the final source layout, and Phase 8
documents what actually shipped.

Do not move fixed timestep, tile collision, coyote time, relations, snapshots,
or other TODO features into these phases. Their correct order belongs in the
revised backlog, but implementing them would expand this refactor and weaken
its handoff boundaries.
