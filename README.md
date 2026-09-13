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
vp run e2e             # browser smoke test (Playwright + Chromium)
vp run test:coverage   # V8 coverage with thresholds
vp build               # production build
vp run audit           # Fallow audit
vp check               # format + lint + typecheck, all must pass
```

`vp exec <bin>` runs a local binary such as `tsc`, `fallow`, or `playwright`.

## Layout

| Path                            | What                                                      |
| ------------------------------- | --------------------------------------------------------- |
| `src/ecs/design2.ts`            | ECS facade; the only module that imports Koota            |
| `src/ecs/di.ts`                 | World-scoped construction and service resolution          |
| `src/game/components.ts`        | Component classes containing flat model data              |
| `src/game/systems.ts`           | Systems and the explicit `gameSystems` manifest           |
| `src/game/game-view-model.ts`   | Headless game coordinator and immutable projections       |
| `src/game/pixi-view.ts`         | Renderer consuming render projections                     |
| `src/game/audio.ts`, `input.ts` | Disposable browser service adapters                       |
| `src/main.ts`                   | Browser composition, HUD binding, and the single rAF loop |
| `public/assets/`                | Vendored CC0 art/audio (+ `ATTRIBUTION.md`)               |
| `docs/`                         | Design docs, asset register, and future work              |
| `e2e/`                          | Playwright composition smoke test                         |

## Model, ViewModel, and View

The ECS `World` is the model. It owns entities, components, queries, systems,
and a private dependency scope. A World receives its system classes explicitly;
decorators record metadata but do not create global instances. Every World gets
its own system instances and injected queries, and `dispose()` tears them down
in reverse schedule order.

`GameViewModel` owns the World and the application rules around it. It accepts
input, audio, and randomness through service ports, exposes commands such as
`damagePlayer()` and `spawnFoe()`, and returns immutable HUD and render
projections. It has no Pixi, DOM, or browser-global dependency.

`PixiView`, the keyboard and audio adapters, and the DOM live on the view side.
`main.ts` assembles them, starts the ViewModel, advances it from one rAF loop,
binds commands, renders projections, and disposes every owned resource.

## ECS in 60 seconds

Components are decorated classes holding only flat data. Systems declare what
they need with `@query`, resolve services while their World constructs them,
and run by priority. Equal priorities preserve explicit manifest order.

```ts
@component()
class Health {
	value = 100;
}

@system({ priority: 20 })
class Death extends GameSystem {
	@query(Health)
	declare dying: Query<[Health]>;

	execute(): void {
		for (const { entity, comps } of this.dying) {
			if (comps[0].value <= 0) entity.destroy();
		}
	}
}

const world = new World({ systems: [Death] });
world.spawn(new Position(0, 0), new Health(30));
world.update(dt);
world.dispose();
```

Browser capabilities are contracts (`InputPort`, `AudioPort`, and `RandomPort`)
registered as providers when a World is created. `EntityRef` and `Query` expose
the operations game code needs without exposing Koota handles. `entity.get()`
returns a snapshot copy; write through `set()` or the live query tuples.

## Test styles

- ECS contract tests use local components and systems to verify DI scoping,
  query wiring, scheduling, entity semantics, lifecycle, and World isolation.
- System tests select a small manifest and use fake input and audio ports. They
  run without Pixi or browser globals.
- ViewModel tests drive commands and explicit deltas, then assert immutable HUD
  and render projections and recorded effects.
- The Playwright test is a composition smoke test for the browser adapters,
  ViewModel, DOM, and Pixi canvas.

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
  the Playwright smoke test on Node 24.

## Docs

- `docs/aurelia-ecs.md` — what we borrowed from Aurelia 2 and what we left out
- `docs/ecs-design.md` — the three candidate designs and the implemented choice
- `docs/ecs-mvvm-design.md` — the architectural source of truth
- `docs/assets.md` — asset register with licenses and sources
- `docs/future/ecs-compiler.md` — **deferred** SoA compiler idea
- `TODO.md` — next gameplay and tech slices
