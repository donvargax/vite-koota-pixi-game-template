# TODO — next slices

Ordered by dependency and value. Each slice should land as its own commit(s)
with tests/e2e updated and all gates green (`vp check`, `fallow audit`).

1. [ ] **Fixed-timestep physics (Design 3 slice)**: split simulation (`dt`
       fixed 1/60 accumulator) from rendering; keep coyote time and projectiles
       deterministic when frames hitch.
2. [ ] **Tile collision (AABB vs tilemap)**: replace the flat `FLOOR_Y` with
       collision against tiny-dungeon tiles (solid set from the sample TMX), while
       keeping one-way platforms in mind.
3. [ ] **Edge input and coyote time**: add input buffering and a 100ms grace
       period after leaving ground; represent both as tested timers on `Stats`.
4. [ ] **Melee attack and hit-stop**: add a sword arc hit test, slash VFX from
       the particle pack, `knifeSlice` SFX, 2-3 frozen frames on connect, and foe
       knockback.
5. [ ] **Relations and inventory**: add coins, keys, and potions as entities,
       a `Contains` relation on the player, and the HUD counter.
6. [ ] **Prefabs (Design 3 slice)**: add `definePrefab` templates for zombies,
       bullets, and pickups.
7. [ ] **Stable schemas and snapshots**: add stable component/relation
       identities and versioned schema-driven save/restore for positions, HP,
       inventory, and tick.
8. [ ] **Game-state scheduling**: add title, pause, and death states with a
       `GameState` trait and `runIf` system gating.
9. [ ] **Content and shell**: add the boss slice, a licensed looping music
       track, and touch input/PWA packaging. Keep attribution and license checks in
       `docs/assets.md`.
10. [ ] **Frame-time profiling and budgets**: expose rAF frame deltas on
        `window.__game`, run a scripted 50-zombie/10-second firing scene in
        Playwright, collect the distribution, and assert p95 < 20ms in CI. A
        Chromium tracing file may be captured for flame-graph inspection.
11. [ ] **SoA compiler spike (DEFERRED)**: see
        `docs/future/ecs-compiler.md`; begin only after profiling shows sustained
        pressure at 10k+ entities, not for elegance.
