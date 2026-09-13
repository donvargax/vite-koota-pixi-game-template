# vite-koota-pixi-game-template

Opinionated starter for 2D web games: **Vite+** toolchain, **TypeScript**,
**koota** Entity-Component-System with an **Aurelia-inspired** facade
(decorators + `resolve()` DI), **PixiJS** rendering, and quality gates
(`vp check`, **fallow** audit, Vitest + Playwright).

It currently boots a small playable demo (move, jump, shoot zombies on a
tile floor) to prove the wiring. Fork it, keep the shell, replace the game.

## Quickstart

```bash
vp install     # install deps (pnpm)
vp dev         # HMR dev server
vp test run    # unit tests (vitest)
pnpm e2e       # browser smoke test (playwright + chromium)
vp check       # format + lint + typecheck, all must pass
```

`vp exec <bin>` runs any local binary (`tsc`, `fallow`, `playwright`).

## Layout

| Path                            | What                                                       |
| ------------------------------- | ---------------------------------------------------------- |
| `src/ecs/design2.ts`            | Aurelia-style ECS facade over koota (the core abstraction) |
| `src/game/components.ts`        | Component classes (plain data)                             |
| `src/game/systems.ts`           | Systems (logic, priority-ordered)                          |
| `src/game/pixi-view.ts`         | Renderer: syncs ECS state to Pixi sprites                  |
| `src/game/assets.ts`            | Asset manifest + loader                                    |
| `src/game/audio.ts`, `input.ts` | SFX one-shots, keyboard state                              |
| `src/main.ts`                   | Bootstrap, HUD, game loop                                  |
| `public/assets/`                | Vendored CC0 art/audio (+ `ATTRIBUTION.md`)                |
| `docs/`                         | Design docs, asset register, ideas                         |
| `e2e/`                          | Playwright smoke test                                      |

## ECS in 60 seconds

Components are decorated classes holding only data. Systems declare what
they need with `@query` and run in priority order. The world has four
methods: `spawn`, `destroy`, `query`, `update`.

```ts
@component()
class Health {
	value = 100;
}

@singleton()
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

const world = resolve<World>(IWorld);
world.spawn(new Position(0, 0), new Health(30));
world.update(dt);
```

Two koota semantics to know (enforced by the facade, documented in code):
`entity.get()` returns a **snapshot copy** — write through `set()` or the
live `Query` tuples. Query tuples are snapshot proxies that write through
per field.

## Assets and licenses

`public/assets/` vendors CC0 packs by Kenney (art, SFX, stingers) — no
attribution legally required, credited anyway in
`public/assets/ATTRIBUTION.md`. The full register, including planned
(non-vendored) boss/music packs with their licenses, lives in
`docs/assets.md`. Rule: never vendor NC/ND/unclear-terms packs.

## Quality gates

- Pre-commit hook (`.vite-hooks/pre-commit`, survives `vp config`):
  `vp staged` on our sources, then `fallow audit` (new-findings-only gate).
- `fallow` full runs may list intentional API surface (decorator-registered
  systems, lifecycle hooks) — triage before "fixing"; see `TODO.md`.
- Hook scoping is deliberate: formatter/linter/audit all ignore
  `public/assets` (vendored Tiled files include a `.tsx` that is really XML).

## Docs

- `docs/aurelia-ecs.md` — what we borrowed from Aurelia 2 and what we left out
- `docs/ecs-design.md` — the three candidate designs and why Design 2 won
- `docs/assets.md` — asset register with licenses and sources
- `docs/future/ecs-compiler.md` — **deferred** SoA compiler idea
- `TODO.md` — next gameplay and tech slices
