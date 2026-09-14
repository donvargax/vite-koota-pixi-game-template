# Performance Contracts

Status: Phase 3 workload handoff. This document fixes the wire vocabulary and
runner boundaries for the performance loop. Numerical budgets are calibrated
later; platform capabilities are observed at runtime.

## Scope And Fixed Decisions

The performance loop builds the production game with a dedicated
`performance.html` entry, runs declared workloads in Chromium, records bounded
raw observations, compares clean measurements with a reviewed baseline, and
replays failures independently under diagnostics. The normal page and ordinary
gameplay E2E remain separate black-box surfaces.

The implementation uses existing Playwright and Chromium/CDP plus
`@jridgewell/trace-mapping`. Node 24 native erasable TypeScript is used for the
CLI and pure harness code. Vite+ and Vitest are used for browser, decorated ECS,
and headless composition tests. The harness never imports `src`, reads ECS or
Pixi internals, injects entities, or calls hidden game methods.

Each repetition receives a fresh browser context and page. There is one worker,
one active page, and one workload at a time. Clean, CPU-trace, and allocation
are distinct modes. Only clean measurements affect a verdict. Diagnostic data
is bounded evidence and cannot alter the original clean verdict.

## Units And Value Rules

- Durations, elapsed time, timestamps, and lateness use milliseconds unless a
  field explicitly says simulation seconds.
- Frame and callback work samples use milliseconds. Counts are non-negative
  integers. Ratios are dimensionless and finite.
- World positions use game pixels. Device pixel ratio is a scalar environment
  value. Percentages are represented as ratios from `0` through `1`.
- Monotonic timestamps come from `performance.now()` or the equivalent CDP
  monotonic source. Wall-clock timestamps are provenance only.
- Unsupported observations are `null` with a capability/status reason; they are
  never represented as zero. Missing required observations invalidate a window.
- Samples are bounded at collection time. Truncation, dropped entries, timeout,
  and observer errors are explicit failure data.

## Record Contracts

Every record carries a schema discriminant and schema version. The exact
wire types are exported from `performance/contracts.ts`; the following
requirements define their meaning.

### Scenario

A scenario contains `schema`, `version`, `id`, category, fixed seed, target
populations, layout and pattern versions, audio policy, an absolute-time input
schedule, warm-up and sample durations, repetition count, fast/full membership,
and a validity envelope. The envelope includes before-simulation and
after-maintenance targets, visible projected-bolt minimum, hard population
ceiling, finite lifetime/velocity bounds, and maximum input lateness.

Scenario-defining fields include every value that can change workload or
coverage: IDs and category, seed, all counts, durations, input/audio/layout
definitions, validity bounds, selection, and repetitions. The harness
canonicalizes these fields and stores a stable workload-definition fingerprint.

`diagnostic-self-test` is a declared scenario outside fast/full and baseline
membership. It exists only to prove source attribution of the bounded named CPU
function in the bundled benchmark entry.

### Build Manifest

A build manifest contains build ID, revision or `unversioned`, dirty-source
fingerprint, optimized entry/output hashes, exact JavaScript and source-map
file hashes, tool versions, and the workload-definition fingerprint. It never
copies environment values indiscriminately or stores secrets. The performance
build owns `dist-performance/`; historical evidence lives under its run
directory.

### Environment

Environment data records Node, Playwright, and Chromium versions; OS and
architecture; CPU identity; local machine key or explicit CI runner class;
actual renderer/backend; optional GPU identity; headless mode; viewport and
DPR; throttling/audio policy; page visibility; and measured idle cadence.
Machine identifiers are hashed. Compatibility fields are distinct from
provenance. An unknown renderer or unavailable GPU is explicit and cannot
accidentally match a known hardware/software environment.

### Window

A measurement window identifies scenario and repetition and records monotonic
start/end, actual elapsed time, requested duration, input delivery timing and
lateness, raw RAF cadence samples, per-frame CPU-work samples, phase aggregates,
long-task support/count/duration, and CDP task-time and heap boundary samples.
It also records mode, completion, timeout/cancellation, dropped entries,
truncation, and capability statuses. Control-action overhead is excluded by
explicit boundary markers.

### Workload

A workload record contains before-simulation and after-simulation counts,
after-maintenance counts, projected on-screen bolt count, spawn/recycle/removal
activity, observed hit/down counts, simulation seconds, raw wall seconds,
minimum/maximum load, and progress/validity status. Exact removal causes are
reported only when observed; inferred causes remain labeled as inferred.

### Comparison

A comparison records expected and received scenario/repetition coverage,
per-repetition summaries, median-of-repetitions aggregates, baseline and policy
provenance, deltas, metric statuses, immutable original verdict, and reasons.
Frame samples are not pooled across repetitions.

### Evidence

Evidence records replay mode and status, reproduction status,
supported/missing capabilities, raw CPU/trace/allocation paths, build-map
linkage, mapped CPU summaries, bounded recognized GC/render events,
truncation, and errors. Raw evidence remains navigable in standard DevTools or
Perfetto viewers; no custom flame-graph renderer is part of this contract.

## Status And Precedence

Statuses distinguish `passed`, `regression`, `capacity-failure`,
`workload-invalid`, `unsupported`, `infrastructure-failure`, and
`unbaselined-collection`. A clean window with invalid or missing required data
cannot pass. Precedence is:

1. Invalid input, malformed policy/manifest, missing required coverage, or
   tooling failure is `invalid`/exit 2.
2. A completed measurement with invalid workload or insufficient required
   observations is `workload-invalid`/exit 2.
3. Valid load with a simulation/wall-time capacity breach is
   `capacity-failure`/exit 1.
4. A valid comparable clean measurement that breaches an absolute ceiling or
   both the relative and minimum absolute degradation thresholds is
   `regression`/exit 1.
5. A valid clean collection without a compatible enforcing baseline is
   `unbaselined-collection`/exit 2, unless explicit `--collect` was requested.
6. Explicit successful collection or diagnosis is exit 0 and is not an
   accepted performance verdict.

Known regressions remain exit 1 even if their independent diagnostic replay
fails; the replay failure is recorded separately. Optional unsupported metrics
are not missing required metrics.

## Runtime Ownership And Callback Contract

`src/game/browser-runtime.ts` owns the world, model, view, and RAF handle.
Callers own input/audio binding and DOM listeners. The controller is returned
immediately with a readiness promise and idempotent disposal. It exposes
readiness, disposal, `damagePlayer(amount)`, and `spawnFoe()`. Calls to the
game actions before readiness or after disposal reject with a defined lifecycle
error. Normal-page buttons are bound only after readiness and receive the
controller, never the world or model.

The optional read-only `afterRender` workload hook receives the single render
projection after successful view submission. It is the only place for
visibility/render-progress accounting. Its work is included in total callback
work. A skipped or throwing render does not increment successful-render
progress. Hook types stay in runtime/workload modules; only scalar JSON wire
results cross into `performance/contracts.ts`. Tests must prove projection
identity and exactly one projection call.

When an observer is present, a frame callback executes in this order:

1. Workload-before hook.
2. Model tick using capped simulation `dt`.
3. Workload-after hook.
4. One HUD projection and DOM update.
5. One render projection.
6. View render/submission.
7. `afterRender` with that same projection.
8. Observer completion and scheduling of the next RAF.

The observer measures total callback work and the workload, simulation, HUD,
projection, and render-submission phases. First-frame timing starts after
readiness; later simulation uses `min(rawSeconds, 1/30)`, while raw RAF elapsed
time remains observable.

Initialization and disposal are race-safe. Every owned cleanup is attempted
after an exception, with aggregate errors reported. Caller-owned input/audio
ports are never bound or disposed by the runtime.

## Benchmark Browser Surface

`performance.html` is a dedicated visible stage with the normal game dimensions
and ordinary health, foe-count, and player-position HUD. It additionally
displays benchmark status, build ID, selected scenario, renderer identity,
load/progress summary, and controls named Start, Begin sample, End sample, and
Stop. Controls are accessible and visible; there are no hidden state
attributes, entity injection controls, game globals, or inline benchmark data.

The benchmark entry selects only a declared scenario from the URL, starts from
a user gesture, displays ready only after runtime mount, and exposes the build
ID supplied by build configuration. Window counters reset through visible
sample controls. Extra telemetry updates at most 4 Hz and its work is included
in the measured callback. User Timing entries are the observation surface and
are cleared after consumption. Stop, pagehide, invalid input, and startup
failure release controls, listeners, runtime, and owned ports.

The normal page keeps its existing markup and gameplay behavior. It has no
benchmark controls or telemetry API. Ordinary gameplay E2E continues using
its existing fake-clock and real-time projects; it cannot infer permission to
inject entities or call runtime methods.

## Input Scheduling

The performance fixture exports the shared input scheduler; specs never import
one another. Schedule origin is the measured sample start after declared
warm-up. Replays use the identical prefix of events, drop events at or after
the shorter replay end, record monotonic actual delivery and lateness, and
always release held keys, including cancellation paths. The scheduler uses
real browser time and never installs the gameplay fake clock.

## Workload And Diagnostic Contracts

Synthetic workloads maintain seeded ground-level foe slots in world x `[-160,
160]` while real movement, AI, collision, death, and floor correction execute.
Bolts use finite lifetimes and nonzero damage: 80% are visible upper-lane
collision scans and 20% use the ground collision lane. Off-screen survivors are
recycled and expired/hit bolts are replenished. Maintenance is bounded and
counts toward callback work.

The diagnostic self-test is outside baseline membership and is activated only
by its visible control. It calls a named CPU function in the bundled benchmark
entry and preserves an observable checksum. Source attribution must map samples
to that bundled function; an injected `page.evaluate` function is not valid
evidence.

Phase 3 implements the workload surfaces as follows:

- `performance/scenarios.json` declares `idle`, `movement`, `firing`,
  `foes-50`, `bullets-250`, `bullets-1000`, `lifecycle-60`, and the excluded
  `diagnostic-self-test` scenario with finite seeded populations and explicit
  validity envelopes.
- `performance/scenarios.ts` exports `validateScenarioManifest`,
  `getScenario`, `selectScenarios`, `expandScenarioMatrix`, and
  `workloadFingerprint`. Validation accepts unknown JSON only after checking
  schema, bounds, timing order, membership, target consistency, and selection.
- `src/benchmark/workload.ts` exports `createBenchmarkWorkload`,
  `BenchmarkWorkloadContext`, `BenchmarkWorkloadOptions`, and the
  `BenchmarkWorkload` hook/record interface. It uses real composed systems,
  bounded seeded maintenance, finite bolt cohorts, exact target boundaries,
  removal and hit observations, and projection-based visibility.
- `performance.html` and `src/benchmark/main.ts` provide the visible benchmark
  surface. The page selects only a validated scenario from the URL, starts from
  a user gesture, and emits bounded `benchmark-frame` User Timing marks with
  the runtime observation payload. It does not expose a game global or hidden
  entity controls.

The workload adapter reports removal activity without assigning an exact cause
when the composed game systems do not expose one. Seeded generation repeats
initial layout and cohort selection for equal timestep sequences, but variable
simulation time still changes movement, collisions, and expiry boundaries.

## Fingerprints, Baselines, And Compatibility

Trusted required membership, repetitions, and workload definitions come from
the base manifest/policy in CI, not the candidate. Candidate manifests must
match the trusted workload fingerprint. Same-version modifications, removed
fast scenarios, reduced populations, reduced repetitions, and extra/missing
required entries fail closed. Local accepted baselines pin the same fingerprint
and machine compatibility fields.

Build hash and commit provide provenance but do not establish compatibility.
Local compatibility includes the hashed machine identity. CI uses an explicit
runner class plus detected environment. Accepted CI baseline data is tracked
and reviewed; local accepted baselines are ignored files. A successful run
never replaces either baseline automatically.

## CLI Grammar

The planned commands are:

```text
vp run perf [--collect] [--policy <path>] [--baseline <path>]
  [--required-scenarios <path>] [--output <dir>] [--baseline-dir <dir>]
vp run perf:diagnose --scenario <id> [--policy <path>] [--output <dir>]
vp run perf:full [--collect] [--policy <path>] [--baseline <path>]
  [--required-scenarios <path>] [--output <dir>] [--baseline-dir <dir>]
vp run perf:baseline --from <run-dir> --accept
```

Defaults are validated before build/run. Paths are resolved safely, recorded as
provenance, and never used to delete arbitrary files. CI passes trusted policy,
baseline, and required-scenario inputs explicitly. `perf` measures the fast
set and diagnoses absolute failures; `perf:full` measures all scenarios and
always runs CPU/trace plus lifecycle allocation evidence. `--collect` is an
explicit unbaselined collection request.

Exit code `0` means accepted, or an explicitly requested successful
collection/diagnosis. Exit code `1` means performance or capacity regression.
Exit code `2` means invalid input, invalid workload, required baseline/policy,
unsupported verdict, or tooling failure.

## Artifact Layout

Each run writes immutable raw and aggregate data under:

```text
performance-results/<run-id>/
  build/
  measurements/
  diagnostics/
  results.json
  summary.md
  report.html
  artifact-manifest.json
```

Local accepted baselines use `performance-baselines.local/`. The optimized
owned build uses `dist-performance/`. Generated output is ignored; reviewed
policy and the tracked CI baseline remain source files. Reports reference raw
records instead of mutating them.

## Planned Public Modules

The following modules and configuration files are public handoff surfaces. Each
module exports only the responsibility named here; internal helpers remain
private.

- `performance/contracts.ts`: erasable JSON wire types, discriminants, runtime
  observation payloads, workload declarations, failure variants, and bounded
  sample metadata.
- `performance/scenarios.json`: declared scenario data and membership.
- `performance/scenarios.ts`: pure unknown-input validation, lookup, selection,
  expansion, and workload fingerprint input.
- `performance/statistics.ts`: finite sample validation, nearest-rank
  percentiles, means, medians, rates, and simulation/wall ratio.
- `performance/collect.ts`: serializable browser timing callbacks and host CDP
  boundary collection contracts; no clean-mode profiling.
- `performance/environment.ts`: environment observation and compatibility
  identity hashing.
- `performance/compare.ts`: pure aggregate/verdict calculation and strict
  policy validation from unknown JSON.
- `performance/baseline.ts`: strict baseline read, validation, compatibility,
  and explicitly authorized atomic acceptance.
- `performance/budgets.json`: schema, directions, required/informational
  metrics, calibration status, and environment policy.
- `performance/diagnostics.ts`: bounded CPU-trace, Chromium-trace, and
  allocation collection lifecycles.
- `performance/evidence.ts`: bounded profile/map/trace parsing and source,
  GC, and render summaries.
- `performance/report.ts`: static report data assembly and artifact references.
- `performance/cli.ts`: argument parsing, safe paths, build/run orchestration,
  status/exit-code mapping, and trusted-input provenance.
- `src/game/browser-runtime.ts`: injected runtime controller, lifecycle, frame
  sequencing, projections, observer phases, and aggregate cleanup.
- `src/benchmark/workload.ts`: seeded real-game workload adapter, bounded
  maintenance, counters, validity, and render-progress observation.
- `src/benchmark/main.ts`: visible benchmark page wiring, manifest selection,
  user controls, runtime/workload ports, User Timing payloads, and cleanup.
- `e2e/performance/fixtures.ts`: fresh-context performance fixture, readiness,
  collector lifecycle, scheduler, errors, and attachments.
- `e2e/performance/workload.spec.ts`: browser workload-validity checks.
- `e2e/performance/scenarios.spec.ts`: selected clean repetition execution and
  raw-record persistence.
- `e2e/performance/diagnostics.spec.ts`: independent diagnostic replays.
- `tsconfig.performance.json`: strict native NodeNext erasable TypeScript check.
- `playwright.performance.config.ts`: single-worker performance browser config.
- `performance.html`: dedicated visible benchmark document.

The normal `src/main.ts`, gameplay Playwright config, and ordinary E2E surface
retain their current ownership and rules unless a later numbered step names an
explicit change.

## Phase Ownership And Verification

Phase 1 owns this contract, the wire types, package dependency and lockfile,
TypeScript roots, Vitest/staged-check/lint scopes, and generated-output ignore
rules. Phase 2 owns runtime lifecycle. Phase 3 owns scenario validity and the
browser workload. Phase 4 owns clean measurement. Phase 5 owns policy,
comparison, and baselines. Phase 6 owns diagnostics/evidence. Later phases own
the CLI, calibration, CI integration, and reporting.

The Phase 1 gate runs `vp check`, `vp test`,
`vp exec tsc -p tsconfig.json`, `vp exec tsc -p tsconfig.performance.json`,
and `vp run audit`. Existing E2E remains unchanged. A new-root collection test
is owned by step 21; Phase 1 only makes its eventual collection explicit.

Phase 3 checks completed before the phase gate:

- `vp install`: pass, already up to date.
- `vp check`: pass, 44 files formatted and no warnings, lint errors, or type
  errors.
- `vp test`: pass, 14 files and 78 tests.
- `vp run test:coverage`: pass, 92.53% statements, 82.72% branches, 94.57%
  functions, and 94.83% lines.
- `vp test run performance/scenarios.test.ts`: pass, 15 tests.
- `vp test run src/benchmark/workload.test.ts`: pass, 6 tests.
- `vp exec tsc -p tsconfig.json --noEmit`: pass.
- `vp exec tsc -p tsconfig.performance.json`: pass.
- `vp build`: pass; normal output contains only `index.html` and no benchmark
  entry or source maps.
- `vp build --mode performance`: pass; `dist-performance` contains both HTML
  entries, optimized output, and matching external source maps.
- `vp run audit`: pass; the new benchmark roots and public contract are
  reachable, generated directories remain excluded only by precise patterns,
  and the pre-commit gate reports no new audit findings.

The independent Playwright performance fixture does not exist yet, so the
browser validity gate is deferred to the first task after that fixture is
created. No performance budget is assessed in Phase 3.
