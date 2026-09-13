# TODO — next slices

Ordered roughly by value. Each slice should land as its own commit(s) with
tests/e2e updated and all gates green (`vp check`, `fallow audit`).

## Gameplay

- [ ] **Melee attack + game feel**: sword swing (arc hit test, slash VFX from
      particle-pack, `knifeSlice` SFX), hit-stop (2–3 frozen frames on connect),
      knockback on foes.
- [ ] **Coyote time + jump buffering**: 100ms grace after leaving ground,
      buffered jump input; both are timers on a `Stats` component, unit-tested.
- [ ] **Tile collision (AABB vs tilemap)**: replace the flat `FLOOR_Y` with
      collision against tiny-dungeon tiles (solid set from the sample TMX);
      keeps 1-way platforms in mind. This unlocks real level design.
- [ ] **Pickups + inventory via relations**: coins/keys/potions as entities,
      `Contains` relation on the player, HUD counter; coin SFX already vendored.
- [ ] **Boss slice**: vendor Admurin Pixel Art Bosses (CC-BY 4.0 — keep
      attribution; see `docs/assets.md`), add a boss AI state machine system
      (telegraphed slam + summon), boss HP bar.
- [ ] **BGM**: vendor a looping music track (HydroGene CC0 pack or
      Incompetech CC-BY — verify license at download, see `docs/assets.md`),
      add a tiny music manager (menu/game/boss layers, mute toggle).
- [ ] **Menus + game states**: title, pause, death screen; a `GameState`
      world trait driving system `runIf` gating.

## Tech

- [ ] **Save snapshots (Design 3 slice)**: schema-driven world snapshot +
      restore to localStorage (positions, HP, inventory, tick); version field
      from day one.
- [ ] **Prefabs (Design 3 slice)**: `definePrefab` for zombie/bullet/pickup
      templates replacing the `spawn*` helpers in `main.ts`.
- [ ] **Fixed-timestep physics (Design 3 slice)**: split simulation (`dt`
      fixed 1/60 accumulator) from rendering; keeps coyote/projectiles
      deterministic when frames hitch.
- [ ] **Frame-time profiling in E2E with performance budgets**: the technique
      for "hotpath analysis during e2es" is called **performance profiling** —
      specifically **trace-based performance testing** enforced with
      **performance budgets** (games call the metric **frame pacing**).
      Concrete slice: expose rAF frame deltas on `window.__game`, add a
      scripted E2E scene (spawn 50 zombies, hold fire for 10s), collect the
      frame-time distribution via Playwright, assert p95 < 20ms in CI.
      Optional: capture a Chromium **tracing** file (`chromiumTracing`) for
      flame-graph inspection of the worst frames.
- [ ] **SoA compiler spike (DEFERRED — see `docs/future/ecs-compiler.md`)**:
      entry criterion is profiler evidence from the item above (sustained
      pressure at 10k+ entities), not elegance. Until then the proxy facade
      stays.
- [ ] **Touch input + PWA packaging**: virtual joystick/buttons, installable
      manifest + offline cache for the demo.
