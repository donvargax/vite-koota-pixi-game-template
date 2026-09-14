# vite-koota-pixi-game-template

Opinionated starter for 2D web games: **Vite+** toolchain, **TypeScript**,
**koota** Entity-Component-System behind a small **Aurelia-inspired** facade,
**PixiJS** rendering, and quality gates (`vp check`, **fallow** audit, Vitest +
Playwright).

It boots a small playable demo (move, jump, shoot zombies on a tile floor).
The application is split into an ECS model, a headless `GameViewModel`, and
browser-side views and adapters. Fork it, keep the shell, replace the game.

## Quickstart

```bash
vp install             # install deps
vp dev                 # HMR dev server
vp test                # unit tests (Vitest)
vp run e2e             # Gherkin gameplay + browser smoke tests (Chromium)
vp run test:coverage   # V8 coverage with thresholds
vp build               # production build
vp run audit           # Fallow audit
vp check               # format + lint + typecheck, all must pass
```

`vp exec <bin>` runs a local binary such as `tsc`, `fallow`, or `playwright`.

## Layout

| Path                                                  | What                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `src/ecs/facade.ts`                                   | ECS facade; the only module that imports Koota             |
| `src/game/locomotion.ts`, `dash.ts`                   | Movement, floor correction, and dash state/behavior        |
| `src/game/combat.ts`                                  | Aim, weapons, projectiles, shooting, and hits              |
| `src/game/enemies.ts`, `player-life.ts`               | Enemy population and player life controllers/systems       |
| `src/game/actors.ts`, `spatial.ts`, `presentation.ts` | Shared actor, spatial, and visual data                     |
| `src/game/composition.ts`                             | Explicit system, query, and port wiring                    |
| `src/game/*.test.ts`                                  | Adjacent fast feature and ViewModel tests                  |
| `src/game/game-view-model.ts`                         | Headless game coordinator and immutable projections        |
| `src/game/pixi-view.ts`                               | Renderer consuming render projections                      |
| `src/game/audio.ts`, `input.ts`                       | Disposable browser service adapters                        |
| `src/main.ts`                                         | Browser composition, HUD binding, and the single rAF loop  |
| `public/assets/`                                      | Vendored CC0 art/audio (+ `ATTRIBUTION.md`)                |
| `docs/`                                               | Design docs, asset register, and future work               |
| `e2e/`                                                | Gherkin gameplay, visual baselines, and browser smoke test |

## Model, ViewModel, and View

Gameplay favors locality over a strict one-file-per-feature rule: feature-owned
data, tuning, systems, and controllers live together, with fast tests alongside.
Shared data and explicit composition remain separate; the layers, ports, and
adapters still define the runtime boundaries.

The ECS `World` is the model. It owns entities, components, queries, system
instances, and their lifecycle. `World.create(factory)` creates the backend,
passes the exact World to a synchronous factory, installs the returned systems,
and initializes them in priority order. Decorators record component and schedule
metadata; they do not create global instances. Each World gets fresh systems and
queries, and `dispose()` tears them down in reverse schedule order.

`GameViewModel` composes real `PlayerLife` and `EnemyPopulation` controllers around
a World supplied by the composition root. It accepts audio and randomness through
service ports, exposes commands such as `damagePlayer()` and `spawnFoe()`, and
returns immutable HUD and render projections. After each World update, it observes
both features before respawn or reinforcements, preserving sound ordering. It
owns the controllers' lifecycle, but does not construct or dispose the injected
World and has no Pixi, DOM, or browser-global dependency.

`PixiView`, the keyboard and audio adapters, and the DOM live on the view side.
`main.ts` assembles them, starts the ViewModel, advances it from one rAF loop,
binds commands, renders projections, and disposes every owned resource.
Browser modules stay in `src/game`; headless import and browser-global guards in
`vite.config.ts` enforce the boundary without directory churn.

## ECS in 60 seconds

Components are decorated classes holding only flat data. Systems receive their
queries and service ports through constructors and run by priority. Equal
priorities preserve the order returned by the composition function.

The working examples are in the source rather than duplicated here:

- [`actors.ts`](src/game/actors.ts) holds `Health`, `PlayerTag`, and `FoeTag`;
  [`spatial.ts`](src/game/spatial.ts) holds `Position`, `Velocity`, `Facing`, and
  `FLOOR_Y`; [`presentation.ts`](src/game/presentation.ts) holds `Sprite` data.
- [`locomotion.ts`](src/game/locomotion.ts), [`dash.ts`](src/game/dash.ts), and
  [`combat.ts`](src/game/combat.ts) keep related systems and feature-owned data
  together. [`enemies.ts`](src/game/enemies.ts) owns `EnemyPopulation` and
  `FoeShamble`; [`player-life.ts`](src/game/player-life.ts) owns `PlayerLife`, the
  player recipe, and `Death`.
- `createGameSystems` in [`composition.ts`](src/game/composition.ts) explicitly
  wires each system's named queries and service ports. Decorator priorities
  interleave features: `Platformer` (6), `FoeShamble` (7), `DashSystem` (8),
  `AimSystem` (9), `Movement` (10), `FloorCorrection` (11), `Shooting` (12),
  `BoltHit` (15), and `Death` (20). Array order only breaks priority ties.
- [`facade.test.ts`](src/ecs/facade.test.ts) exercises the ECS facade directly,
  including components, named queries, scheduling, and World isolation.

Browser capabilities are TypeScript contracts (`InputPort`, `AudioPort`, and
`RandomPort`). `createGameSystems(world, input, audio)` passes the needed ports,
queries, and spawn capability to each system. `EntityRef` and `Query` expose the
operations game code needs without exposing Koota handles. `entity.get()` returns
a snapshot copy; write through `set()` or the named live query components.

The player recipe imports exported dash and weapon components to assemble a
playable actor. This is practical cross-feature wiring, not a plugin framework.

## Test styles

Learn gameplay through the MVVM boundary first: drive commands and fake input,
advance explicit `dt`, then inspect projections and recorded audio. Use smaller
adjacent feature tests for edge cases such as cooldowns or projectile expiry;
keep the unchanged black-box E2E suite as the browser-level fallback.

- ECS contract tests use local components and systems to verify explicit query
  construction, scheduling, entity semantics, lifecycle, and World isolation.
- Feature tests select a small set of systems and use fake input and audio ports.
  They run without Pixi or browser globals.
- ViewModel tests compose a real World, `PlayerLife`, and `EnemyPopulation`, then
  assert immutable HUD and render projections and recorded effects.
- Playwright runs Gherkin gameplay scenarios through keyboard input, visible HUD,
  and canvas screenshots. Most use controlled browser time; a tagged subset also
  runs in real time. A separate smoke test covers the demo buttons.

See [Gameplay E2E tests](docs/e2e.md) for commands, feature authoring, visual
baselines, and the black-box boundary.

## Assets and licenses

`public/assets/` vendors CC0 packs by Kenney (art, SFX, stingers) — no
attribution legally required, credited anyway in
`public/assets/ATTRIBUTION.md`. The full register, including planned
(non-vendored) boss/music packs with their licenses, lives in
`docs/assets.md`. Rule: never vendor NC/ND/unclear-terms packs.

## Quality gates

- Pre-commit hook (`.vite-hooks/pre-commit`, survives `vp config`):
  `vp staged` on sources and documentation, then `fallow audit` (new-findings-only gate).
- `fallow` full runs may list intentional API surface (decorator-registered
  systems and lifecycle hooks) — triage before "fixing"; see `TODO.md`.
- Hook scoping is deliberate: formatter/linter/audit all ignore
  `public/assets` (vendored Tiled files include a `.tsx` that is really XML).
- CI runs `vp install`, `vp check`, `vp test`, coverage, `vp build`, Fallow, and
  the Playwright gameplay and smoke tests on Node 24.

## Docs

- `docs/design.md` — Aurelia inspiration, the three candidate designs, and the
  implemented choice
- `docs/design.md` — the architectural source of truth
- `docs/assets.md` — asset register with licenses and sources
- `docs/future/ecs-compiler.md` — **deferred** SoA compiler idea
- `TODO.md` — next gameplay and tech slices
