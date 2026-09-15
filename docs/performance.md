# Performance

The performance loop is a local-first, browser-level check for sustained game
work. It builds the optimized `performance.html` entry, owns a loopback preview,
runs fresh headless Chromium contexts, stores bounded clean measurements, compares
them with an explicit baseline, and replays selected cases under diagnostics.
Ordinary gameplay E2E remains a separate black-box check.

## Status

The implementation is operational, but enforcement is not calibrated:

- `performance/budgets.json` is intentionally `calibrated: false`.
- `performance/baselines/ci.json` does not exist.
- CI and nightly workflows collect candidates; neither is a required gate.
- The retained Phase 8 receipt is invalid because its old records lacked the
  required workload payload. The transport and full-matrix fixes are present,
  but still need stable-runner verification.
- No accepted baseline, calibration run IDs, or verified CI/nightly run IDs are
  available. Do not describe local recovery runs as authoritative.

## Setup And Commands

From the repository root:

```sh
vp install
vp exec playwright install chromium
vp run typecheck:performance
```

The runner owns `dist-performance/`, its preview process, and each
`performance-results/<run-id>/` directory. Do not start a manual preview for
these commands.

Collect without enforcing a baseline:

```sh
vp run perf --collect --output performance-results/local-collect
```

Explicitly accept a complete, valid local candidate:

```sh
vp run perf:baseline \
  --from performance-results/local-collect \
  --baseline-dir performance-baselines.local \
  --accept
```

Compare against that local baseline:

```sh
vp run perf \
  --baseline performance-baselines.local/baseline.json \
  --output performance-results/local-enforce
```

Other useful commands:

```sh
# Select scenarios with a comma-separated value.
vp run perf --scenario idle,movement --collect

# Force CPU/trace evidence for one scenario.
vp run perf:diagnose --scenario idle \
  --output performance-results/idle-diagnosis

# Run the complete clean matrix plus diagnostics.
vp run perf:full --collect --output performance-results/full-collect

# Compare the ECS query representation benchmark.
QUERY_VARIANT=named vp run perf:query
```

`perf` and `perf:full` accept `--policy`, `--baseline`,
`--required-scenarios`, `--output`, and `--baseline-dir`. Inputs are validated,
recorded as provenance, and are never deleted. `perf:full` is intentionally
expensive: it runs 21 clean repetitions, including three 60-second lifecycle
repetitions, then replays selected scenarios. Use a dedicated CI/nightly runner
for calibration rather than repeatedly running it on a developer laptop.

## Workloads

`performance/scenarios.json` is the validated source of scenario definitions.
The harness selects only declared scenarios and never imports game code or
inspects ECS/Pixi state. Each repetition uses a fresh page and context, one
Chromium worker, real browser time, and no gameplay fake clock.

| Selection       | Scenarios                                               |              Warm-up |                Sample | Repetitions |
| --------------- | ------------------------------------------------------- | -------------------: | --------------------: | ----------: |
| fast            | `idle`, `movement`, `firing`, `foes-50`                 |                  2 s |                   8 s |           3 |
| full            | fast set, `bullets-250`, `bullets-1000`, `lifecycle-60` | 3 s for stress cases | 15 s for stress cases |           3 |
| diagnostic only | `diagnostic-self-test`                                  |                  2 s |                   5 s |           1 |

`foes-50` maintains exactly 50 foes. `bullets-250` uses 50 foes and 250
bolts; `bullets-1000` uses 200 foes and 1,000 bolts; `lifecycle-60` samples for
60 seconds. The diagnostic self-test is never baseline data.

The workload adapter starts from an empty synthetic world, then uses real
movement, AI, collision, death, shooting, and floor-correction systems. It
maintains seeded foes in world x `[-160, 160]`, uses finite-lived nonzero-damage
bolts, keeps 80% in an upper collision-scan lane and 20% in the ground collision
lane, and recycles/replenishes bounded populations. Maintenance is measured as
game callback work. Seeded setup is repeatable for equal timestep sequences;
variable frame timing still changes trajectories.

Validity precedes performance comparison. A window is invalid for missing
populations, insufficient visible bolts, exceeded ceilings, missing progress,
stalled simulation, dropped/truncated samples, input lateness, browser errors,
wrong build, or incomplete required records. A valid but slow workload is a
capacity result, not permission to reduce the load.

## Clean Measurement

Raw records are written before assertions, including failed repetitions:

```text
performance-results/<run-id>/measurements/<scenario>-<repetition>.json
```

The optimized build must expose the expected build ID and matching external
source maps. The visible benchmark page provides normal HUD values plus
scenario, build, renderer, load, progress, and Start/Begin/End/Stop controls.
The measured window is delimited by visible sample controls and User Timing
marks; warm-up and control actions are excluded.

Collected values include:

- raw RAF elapsed time for observed cadence;
- total callback work and workload, simulation, HUD, projection,
  render-submission, and after-render phase times;
- workload counts, visibility, progress, simulation seconds, and wall seconds;
- optional Long Task data and CDP `TaskDuration`/`JSHeapUsedSize` boundaries;
- environment, build, scenario, and workload fingerprints.

RAF is cadence, not GPU time. `render-submission` is CPU submission time, not
GPU duration. Heap boundaries cover JavaScript heap only, not textures, native
allocations, browser memory, or GPU memory. Unsupported values are `null` with
a reason, never zero. Buffers are bounded and dropped entries are failures.

Comparison aggregates each repetition, then uses the median repetition
aggregate. Frame samples are never pooled across repetitions. A regression is
an absolute ceiling breach or a degradation exceeding both the reviewed
relative threshold and minimum absolute delta. Valid-load simulation/wall-time
degradation is a capacity failure.

## Verdicts And Artifacts

Exit status:

| Status | Meaning                                                                                                          |
| -----: | ---------------------------------------------------------------------------------------------------------------- |
|    `0` | Accepted comparison, or explicitly successful collection/diagnosis                                               |
|    `1` | Performance or capacity regression                                                                               |
|    `2` | Invalid input/workload, missing or incompatible enforcement data, unsupported tooling, or infrastructure failure |

Known regressions remain status `1` even if diagnostic replay fails. Diagnostic
results never replace the original clean verdict.

Each run contains:

```text
performance-results/<run-id>/
  build/                 exact optimized JavaScript and source maps
  measurements/          bounded raw records
  diagnostics/           profiles, traces, and allocation evidence
  results.json           immutable comparison and evidence
  summary.md             offline summary
  report.html            static offline report
  artifact-manifest.json artifact inventory
```

Open `report.html` directly. Load `.cpuprofile` files in Chrome DevTools and
trace JSON in Perfetto or a compatible local Chrome tracing viewer. Reports make
no network request and reference artifacts with relative paths.

## Diagnostics

Clean measurement is trace-free. CPU sampling plus Chromium tracing is a
separate `cpu-trace` replay; HeapProfiler allocation sampling is a separate
`allocation` replay. Both use fresh pages and bounded evidence. Reference
Playwright `1.63.0` and Chromium `153.0.8010.12` support CPU profiling,
streamed tracing, and heap sampling through CDP.

Diagnostic defaults are a 5-second evidence window, 30-second trace-drain
timeout, 100 MiB per trace, and 500 MiB total evidence per run. Traces are
drained to EOF before closing; a capped or malformed trace is marked truncated,
never presented as complete JSON. Missing capabilities, command failures,
timeouts, detachment, and stream errors are explicit statuses.

`performance/evidence.ts` consumes only local profiles, traces, built
JavaScript, and source maps. It maps CPU samples with trace-mapping, preserves
unmapped frames, avoids recursive double counting, and summarizes recognized
GC/render spans without claiming complete process or GPU coverage.

Instrumentation changes timing. It is evidence for investigation, not clean
budget data. A slowdown not reproduced under instrumentation is
`not-reproduced`; it does not clear a known clean regression.

## Calibration And Baselines

Calibration is per compatible environment identity: runner class, OS/arch,
CPU, Node/Playwright/Chromium, renderer/backend, viewport/DPR, and relevant
audio/throttling settings. Do not pool incompatible machines.

For one stable runner, retain at least five valid fast invocations and three
valid full invocations in separate immutable directories. Every invocation must
have complete coverage, valid workload, complete bounded samples, compatible
fingerprints, and clean trace-free measurements. Retain per-repetition
distributions, invocation variation, validity, capacity ratios, and build/
environment provenance. Never replace an invalid repetition with a retry in the
same output or discard a slow valid run.

Choose thresholds above observed unchanged-run variation and verify sensitivity
with disposable fixtures: unchanged, below-noise, meaningful regression,
absolute ceiling, near-zero baseline, and capacity-failure cases. At least one
source-level CPU-work gate and workload/capacity validity are required. Cadence,
heap, and Long Task metrics may remain informational when noisy or unsupported.

Local baselines are explicit, same-machine artifacts and are never copied across
incompatible environments. CI baselines are reviewed tracked files; candidates
and expiring workflow artifacts never become authoritative automatically.

Do not continue full calibration on the reference laptop. Observed local
`bullets-1000` and `lifecycle-60` slowdowns are capacity observations, not
approved policy values.

## CI And Scope

`.github/workflows/ci.yml` runs `vp run perf --collect`; the nightly workflow
runs `vp run perf:full --collect`. Both use `ubuntu-24.04`, install the pinned
Chromium setup, and upload candidate/history artifacts. CI reads trusted policy,
scenario, and baseline inputs from the base revision when present, but does not
accept a candidate baseline. The performance job is not currently a required
branch-protection check.

The verified scope is headless Chromium and its observed CDP surface. Renderer,
backend, and optional GPU identity are observation fields only. This harness
does not provide completed GPU profiling or GPU-memory accounting.

## Related Code

- `performance/contracts.ts`: wire records and statuses.
- `performance/scenarios.json` and `performance/scenarios.ts`: workloads,
  validation, selection, and fingerprints.
- `performance/compare.ts` and `performance/baseline.ts`: verdicts and explicit
  baseline acceptance.
- `performance/diagnostics.ts` and `performance/evidence.ts`: bounded replay
  and source-mapped evidence.
- `performance/cli.ts`: build, preview, collection, comparison, escalation, and
  reporting orchestration.
- `src/game/browser-runtime.ts` and `src/benchmark/workload.ts`: shared runtime
  and real-system workload adapter.
