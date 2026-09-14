# Performance workloads

The benchmark page runs the same composed game systems as the normal page, but
starts a fresh runtime with `initialFoePositions: []` and a declared workload
adapter. The adapter receives the runtime-created `World` and `GameViewModel`
through the explicit workload factory. The harness only uses the visible page,
User Timing entries, and browser/CDP timing APIs; it does not import this code
or inspect ECS/Pixi state.

## Manifest

`performance/scenarios.json` is a `scenario-manifest` with schema version `1`
and workload version `phase-3-workloads-1`. Each scenario declares:

- `id`, `category`, `seed`, `workloadVersion`, and `schemaVersion`
- foe and bolt targets, finite bolt life, nonzero damage, and velocity bounds
- layout version, pattern, world bounds, ground lane, and upper bolt lane
- representative HTML audio, synthetic counting audio, or disabled audio
- absolute-time input events, held-key cleanup, and maximum lateness
- warm-up and measured durations, repetition count, and fast/full/baseline membership
- before-simulation, after-simulation, after-maintenance, visibility, progress,
  and population-ceiling validity fields

The declared selections are:

| Selection       | Scenarios                                                             |                  Warm-up |                    Sample | Repetitions |
| --------------- | --------------------------------------------------------------------- | -----------------------: | ------------------------: | ----------: |
| fast            | `idle`, `movement`, `firing`, `foes-50`                               |                      2 s |                       8 s |           3 |
| full            | the fast scenarios plus `bullets-250`, `bullets-1000`, `lifecycle-60` | 3 s for stress workloads | 15 s for stress workloads |           3 |
| diagnostic only | `diagnostic-self-test`                                                |                      2 s |                       5 s |           1 |

`foes-50` means 50 maintained foes, not 50 foes added to a default arena.
`bullets-250` uses 50 foes and 250 bolts. `bullets-1000` uses 200 foes and
1,000 bolts. The lifecycle scenario samples for 60 seconds. The diagnostic
self-test is outside fast, full, and baseline membership.

The validator in `performance/scenarios.ts` accepts only finite, bounded
values. It rejects duplicate IDs, unsupported schema/category/audio values,
unsorted or contradictory input schedules, missing validity envelopes,
populations above the declared limits, and selections that name unknown or
duplicate scenarios. `selectScenarios` expands a named selection, while
`expandScenarioMatrix` returns one `{ scenarioId, repetition }` entry for each
required repetition. `workloadFingerprint` hashes the canonical selected
definitions, including timing, population, input, audio, layout, validity,
selection, and repetition fields.

## Adapter interface

`src/benchmark/workload.ts` exports:

```ts
interface BenchmarkWorkloadContext {
	readonly world: World;
	readonly model: GameViewModel;
}

interface BenchmarkWorkloadOptions {
	readonly scenario: ScenarioDefinition;
}

interface BenchmarkWorkload {
	beforeSimulation(dtSeconds: number): void;
	afterSimulation(dtSeconds: number): void;
	afterRender(projection: RenderProjection): void;
	resetWindow(): void;
	getWindowRecord(rawWallSeconds?: number): WorkloadRecord;
	dispose(): void;
}
```

`createBenchmarkWorkload(context, options)` seeds the declared populations,
then returns the adapter. The adapter uses real `FoeShamble`, movement,
collision, death, shooting, and floor-correction systems through the supplied
world. It does not replace or disable a system.

Before each simulation tick it places surviving foes in the seeded ground-level
slots and restores missing target populations. After the tick it records the
post-simulation counts, health decreases, missing entity IDs, and simulation
time, then recycles off-screen or expired bolts and replenishes the declared
targets. Maintenance is bounded and is part of the runtime callback measured by
the observer. Population ceilings are checked before and after maintenance.

Foe slots stay in world x `[-160, 160]` at ground y `0`. The adapter keeps 80%
of bolts in an upper lane at y `96`, above the 20-pixel collision radius, and
20% in the ground collision lane at y `0`. Both cohorts move with finite seeded
velocities. Upper-lane bolts still scan every foe without normally colliding,
which keeps the collision loop busy while preserving projected visibility.
Ground-lane bolts can hit and damage foes. All bolts have finite life and
nonzero damage, so removal comes from observed expiry, collision, or recycling,
not from an infinite lifetime or zero-damage shortcut. The adapter reports
removal activity without assigning an exact cause when the game systems do not
expose that cause.

The adapter keeps scalar counters and extrema only. It does not retain entity,
sound, frame, or sample histories. Seeded random generation makes initial
layout and cohort selection repeatable for the same scenario and timestep
sequence. It does not make variable-time simulation trajectories deterministic:
different `dt` sequences change movement, collision timing, expiry boundaries,
and the resulting entity set.

## Browser payload

`performance.html` keeps the ordinary health, foe-count, and player-position
HUD and adds visible elements with stable IDs:

- `benchmark-status`, `benchmark-build`, `benchmark-scenario`,
  `benchmark-renderer`, `benchmark-load`, and `benchmark-progress`
- `benchmark-error` for invalid URL, startup, or workload errors
- `benchmark-start`, `benchmark-begin`, `benchmark-end`, and `benchmark-stop`

The entry accepts only the `scenario` URL parameter and resolves it through the
validated manifest. Start is a user gesture. Ready is shown only after runtime
mount completes. Begin sample resets adapter counters and writes the
`benchmark-sample-start` User Timing mark. During the sample, each runtime
observer frame writes a bounded `benchmark-frame` mark whose detail contains
raw RAF timing, capped simulation delta, total callback work, and the seven
runtime phase timings. End sample writes `benchmark-sample-end`, reads the
adapter record once, and renders the final load/progress summary. Stop and
pagehide dispose the runtime, workload, keyboard input, audio port, and page
listeners.

Extra load/progress DOM telemetry updates at most once per 15 observed frames,
approximately 4 Hz at 60 FPS. The update runs in the workload's measured
`afterRender` callback. The sample marks separate control-action overhead from
the measured window. The page does not expose a game global or a hidden state
attribute. A collector can read User Timing entries and clear the entries it
has consumed.

## Validity and performance

Validity is checked before any performance budget is considered. A window is
invalid when declared populations are not present at the boundaries, the
projected visible-bolt minimum is missed, the hard population ceiling is
exceeded, simulation or wall-time progress is too short, or successful render
progress is absent. Missing observations and stalled pages are invalid results,
not zero-valued measurements.

A valid window can still fail a later capacity or performance comparison. A
low simulation/wall-time ratio with valid load is a capacity failure. A clean
measurement with valid workload and complete required observations is eligible
for comparison. Diagnostic timing never changes that clean verdict.

The normal gameplay page remains a separate black-box surface. Its existing
fixture, fake-clock behavior, controls, and visual tests do not use the
benchmark adapter or performance page. Normal gameplay therefore remains the
representative check for player-facing behavior, while the declared benchmark
loads provide controlled sustained pressure for workload validity and later
measurement.
