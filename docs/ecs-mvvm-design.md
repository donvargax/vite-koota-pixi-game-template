# ECS and headless ViewModel design

Status: accepted and implemented

## Context

Terrariavania wraps Koota with an Aurelia-inspired API: component classes,
decorated systems, explicit query construction, and constructor-visible service
ports. Pixi renders the game, while Vite+, Vitest, and Playwright provide the
build and test toolchain.

The syntax is a good fit for the project, but the ownership model must remain
explicit. Systems and queries belong to one World and are passed to constructors.
Input and audio reach systems through interfaces, and `main.ts` contains only
composition and browser binding.

This design keeps the existing programming style and changes the boundaries
underneath it.

## Decision

The game uses three application layers:

- The ECS World is the model. It owns entities, components, queries, and
  systems.
- `GameViewModel` owns application behavior around the World. It exposes
  commands and immutable projections for rendering and HUD binding.
- Pixi, DOM code, keyboard listeners, HTML audio, and rAF are view-side
  adapters assembled in `main.ts`.

Each World has its own system instances and queries. Decorators store metadata
only; they do not create instances or establish process-global runtime state.
Production and tests both use explicit system-instance factories.

## Goals

- Test game rules under Node without Pixi, a canvas, audio playback, keyboard
  events, or a running browser.
- Allow multiple Worlds to run alternately without sharing queries, systems, or
  lifecycle state.
- Keep components and systems as plain TypeScript classes.
- Keep query construction and priority metadata visible at the composition site
  and system class.
- Hide Koota behind the ECS facade so game code does not depend on Koota
  entity handles or World internals.
- Give every owned resource an explicit teardown path.
- Preserve the current demo behavior while correcting World isolation, audio
  unlocking, and one-frame floor penetration.
- Leave clean extension points for fixed timestep, relations, snapshots, and
  game-state scheduling.

## Non-goals

- Replacing Koota.
- Adding Aurelia, `@aurelia/kernel`, or `@aurelia/testing` as runtime
  dependencies.
- Implementing data binding or an observable UI framework.
- Implementing fixed timestep, tile collision, coyote time, relations,
  snapshots, prefabs, menus, or other backlog features during this refactor.
- Building the deferred ECS compiler.
- Making every system a pure function. Systems may hold constructor-provided
  service references and lifecycle state.

## Model boundary

The ECS facade is the only module allowed to import Koota. Game components,
systems, the ViewModel, views, and tests use facade types.

A World owns:

- One Koota World.
- The system instances returned by its factory.
- The query objects captured by those instances.
- Initialization and disposal state.

The public World surface supports spawning, destroying entities, querying,
updating, and disposing. The factory receives the World before system
installation, so it can build World-bound queries and capabilities without a
general-purpose locator.

`EntityRef` exposes the stable operations game code needs: identity, liveness,
component presence, component reads and writes, and entity destruction. It
does not expose the underlying Koota entity. Reads account for absent
components instead of asserting that every requested component exists.

Component classes remain flat data. Registration rejects unsupported default
or spawned values rather than silently creating storage that violates the
facade contract. A constructor failure is an error, not evidence that the
component is a tag.

## Construction model

`World.create(factory)` creates the Koota-backed World and invokes a synchronous
factory with that exact World. The factory creates fresh system instances and
passes each one only the queries, service ports, and capabilities it needs.
`createGameSystems(world, input, audio)` is the production composition function.

Construction proceeds in this order:

1. Create the Koota World.
2. Invoke the synchronous system factory with the new World.
3. Sort the returned instances by `@system` priority, preserving factory order
   for ties.
4. Initialize the installed systems once.

If the factory or initialization fails, `World.create` destroys initialized
systems and the Koota World before rethrowing the original error. An asynchronous
factory and reuse of a system instance or instance array are errors.

## Systems and scheduling

The system decorator records scheduling metadata on the class. It does not
instantiate the class and does not add it to a mutable global registry.

The game exports `createGameSystems(world, input, audio)`. Tests can return a
smaller set of instances to execute one behavior or a short pipeline. World
creation preserves factory order when two systems have the same priority, which
makes the schedule deterministic without adding a dependency graph.

World initialization follows the construction order above. System constructors
receive their queries and ports directly; no property wiring or ambient
resolution occurs.

An update invokes each initialized system once with the supplied delta. An
update after disposal is an error.

World disposal invokes every initialized system's teardown once in reverse
schedule order and destroys the Koota World. Repeated disposal is safe and does
no additional work.

The current flat floor correction runs after movement. This prevents a
falling entity from remaining below the floor until the next frame and leaves
a clear replacement point for tile collision.

## Service ports

Systems and the ViewModel depend on contracts rather than browser modules.

The input contract provides:

- A horizontal movement axis.
- A consumable jump-pressed edge.
- Held shooting state.

The keyboard adapter owns its listener registrations. It ignores repeated
keydown events for edge detection, clears state on blur, binds once, and can
remove every listener it added.

The audio contract accepts a sound identifier or URL and volume. The browser
adapter remains locked until a real pointer or keyboard gesture occurs.
Playback rejection never interrupts simulation. The adapter can remove its
unlock listeners during teardown.

The random-source contract returns the next unit-interval value. Production
uses the platform random source; tests use a deterministic sequence. Random
placement decisions belong to the ViewModel rather than `main.ts`.

## GameViewModel

`GameViewModel` is a headless application coordinator. The composition root
passes it the game World, but it does not expose that World to the view or own
its disposal.

Its responsibilities are:

- Use the supplied World and the audio and random service ports.
- Spawn the initial player and foes.
- Advance simulation when given a delta.
- Implement commands such as damaging the player and spawning a foe.
- Track respawn and reinforcement timers.
- Decide when application-level sounds should play.
- Produce immutable HUD and render projections.
- Release its own state and reject later updates. World disposal remains the
  composition root's responsibility.

Starting is explicit and idempotent. Construction alone does not attach
browser listeners or schedule frames. The composition root controls when the
ViewModel starts and ticks.

The HUD projection contains display-ready state for player health, foe count,
and player position. It does not contain DOM nodes or mutable components.

The render projection contains stable entity identity, visual kind, position,
velocity or facing information, and the state needed to select an animation.
It does not contain `EntityRef`, query proxies, components, or Koota handles.
The projection may allocate at the current entity scale; profiling must
justify a more complex representation.

## View and composition

`PixiView` consumes render projections. It does not query the World and does
not advance simulation. Its lifecycle consists of asynchronous mounting,
rendering supplied state, and disposal.

`main.ts` is the composition root. It may access browser APIs and is
responsible for:

- Constructing keyboard, audio, and random adapters.
- Constructing and starting `GameViewModel`.
- Mounting `PixiView`.
- Owning the single rAF loop that advances the ViewModel and renders its latest
  projection.
- Updating DOM text from the HUD projection.
- Translating button clicks into ViewModel commands.
- Cancelling the frame and disposing all owned objects during page teardown.

No game timer, spawning rule, health rule, or ECS query belongs in `main.ts`.
Pixi's internal rendering machinery may use its own ticker, but it must not
advance or independently sample simulation state.

## Test strategy

The design has three test levels.

### ECS contract tests

These tests define local components and systems. They verify explicit query
construction, schedule order, lifecycle, entity semantics, component
validation, and isolation between interleaved Worlds. They do not import the
game systems module.

### System tests

These tests create a World with a selected system factory and fake service
ports. They spawn only the entities needed for the behavior, advance the World
by explicit deltas, and inspect components or recorded effects. They do not
construct `GameViewModel` or browser adapters.

### ViewModel tests

These tests construct a World with `createGameSystems`, then construct
`GameViewModel` with that World and fake audio and random ports. They invoke
lifecycle methods and commands directly, tick with explicit deltas, and assert
HUD/render projections and recorded effects. They run in the default Node test
environment.

Playwright remains a composition smoke test. It verifies that the browser
adapters, ViewModel, DOM, and Pixi connect correctly. It does not replace
system or ViewModel coverage.

## Dependency rules

Allowed dependencies:

- ECS facade to Koota.
- Components to ECS component declarations.
- Systems to ECS facade, components, and service contracts.
- ViewModel to ECS facade, components, and service
  contracts.
- Browser adapters to service contracts and browser APIs.
- Pixi view to Pixi and ViewModel projection types.
- `main.ts` to all production adapters needed for composition.

Forbidden dependencies:

- Systems or ViewModel to DOM, Pixi, HTML audio, keyboard events, rAF, or
  global random state.
- Views or `main.ts` to Koota handles.
- Pixi view to World queries.
- ECS contract tests to game systems.
- Decorators to process-global runtime instances.
- One World to another World's systems or queries.

## Error and lifecycle policy

- A constructor or composition error fails before the first simulation update.
- Invalid component schemas and values fail at registration or spawn time.
- Reading an absent component returns no value according to the public type.
- Entity liveness is checked through `EntityRef.isAlive()`.
- Updating a disposed World or ViewModel fails clearly.
- Repeated disposal is safe.
- Audio playback failure is swallowed by the audio adapter because it must not
  stop simulation.
- View mounting failure is reported to the composition root rather than
  leaving a running simulation loop behind.

## Migration constraints

The constructor-injection migration is complete. The final API has no
compatibility exports, runtime service keys, container, resolver, or query
property wiring.

Behavior changes are limited to fixes required by the design:

- Worlds no longer share system or query state.
- Audio unlocks only after a genuine user gesture.
- Jump uses a keydown edge rather than repeating every frame while held.
- Floor penetration is corrected in the same update.
- All owned listeners, frames, systems, Worlds, and Pixi resources have
  teardown.

## Rejected alternatives

Using the current process-global singleton map was rejected because it cannot
provide World isolation or reliable unit tests.

Constructor injection throughout the game was selected because every stable
dependency edge is visible at the call site and system tests can compose only
the World and systems they need. The project does not use a runtime container.

Adding `@aurelia/kernel` was rejected for this iteration. The required feature
set is small, and explicit composition keeps ownership and teardown visible.

Exposing the World directly from `GameViewModel` was rejected because it would
let Pixi and DOM code rebuild dependencies on mutable ECS details. Explicit
projections are the ViewModel boundary.

Driving simulation from the Pixi ticker was rejected because it gives timing
ownership to the rendering adapter and makes headless execution harder. The
composition root owns one simulation loop until the fixed-timestep backlog
item introduces a dedicated loop abstraction.

## Consequences

The facade exposes system-instance composition and disposal, so its useful
public surface is larger than the original four-method description. That extra
surface makes ownership explicit and removes hidden global state.

Tests can replace input, audio, and randomness without module mocking. A test
can compose one system instead of importing the entire game schedule. The same
World construction path is used in tests and production.

Render and HUD projections introduce allocation. Current entity counts are in
the hundreds, and the existing proxy queries already allocate. Performance
work remains measurement-driven.

Explicit system factories add construction code that must be updated when a
system is added. In return, system dependencies are inspectable, deterministic,
and easy to restrict in tests.

## Follow-on order

After this design is implemented and all gates pass, the next technical work
should proceed in this order:

1. Fixed-timestep simulation and interpolation.
2. Tilemap parsing and collision.
3. Input buffering and coyote time on the fixed collision model.
4. Melee, knockback, and hit-stop.
5. Relation support and inventory.
6. Prefabs.
7. Stable component/relation identities and versioned snapshots.
8. World resources and game-state scheduling.
9. Boss, menu, and music content.
10. Frame-time profiling and budgets.
11. Compiler work only if profiling satisfies its documented entry criterion.

`docs/ecs-mvvm-implementation-plan.md` defines the implementation phases and
serves as the handoff record between fresh agent sessions.
