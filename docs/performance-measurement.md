# Performance Measurement

Status: Phase 4 measurement handoff. Clean collection is implemented; policy,
comparison, and diagnostic replay are later phases. A clean record is evidence,
not an accepted performance verdict.

## Raw Records

The fast Playwright matrix writes one JSON envelope per scenario/repetition:

```text
performance-results/<run-id>/measurements/<scenario-id>-<repetition>.json
```

The current scenario runner uses `PERF_OUTPUT_DIR` as `<run-id>` and defaults
to `performance-results/phase4-fast`. The envelope contains:

- `schema: "phase4-raw-measurement"`, `schemaVersion`, `mode`, scenario ID, and repetition
- `environment`, including the compatibility record and observed cadence data
- `window`, a wire-compatible `WindowRecord`
- `visibleSummary`, the final visible benchmark status/load/progress/build/renderer values
- `error` and the Playwright test title

Records are written in `finally`, including failed or timed-out repetitions.
The expected fast matrix is 12 records: `idle`, `movement`, `firing`, and
`foes-50`, three repetitions each. There is no pooled frame file and no
threshold comparison in Playwright.

## Boundaries And Samples

The benchmark page marks `benchmark-sample-start` after the visible Begin sample
control and `benchmark-sample-end` after End sample. The collector reads those
monotonic User Timing boundaries and includes only `benchmark-frame` entries
between the declared sample boundaries. Control-action time is outside the
window. The warm-up is a real browser-time wait before Begin sample and is not
included in the raw frame samples.

Each frame detail contains raw RAF elapsed time, capped simulation delta,
callback work, and the seven runtime phase durations. RAF samples describe
cadence (`rawElapsedMs`); `render-submission` describes CPU time spent submitting
the existing render projection. Neither is a GPU duration. The frame and CPU
buffers are bounded and expose truncation/dropped-entry metadata.

CDP `Performance.getMetrics` is read only at the start and end boundaries.
`TaskDuration` is converted from seconds to milliseconds and reported as a
boundary delta. `JSHeapUsedSize` is a JavaScript heap boundary value/delta; it
does not account for GPU memory, browser process memory, textures outside the
JS heap, or native allocations. Long Task entries are optional. Unsupported
capabilities are `null` with a reason, never zero.

The collector uses one final page retrieval and then clears consumed marks. It
does not make per-frame RPCs, install a fake clock, force GC, profile, trace,
take screenshots, or inspect the renderer. A host watchdog rejects stalled
page work. Missing markers, malformed entries, empty frame samples, dropped
entries, timeout, cancellation, and unsupported capabilities remain explicit
failure data.

## Fixture And Discovery

`e2e/performance/fixtures.ts` uses Playwright's base test directly. Every test
gets a fresh context/page, fixed 1280x720 viewport at DPR 1, browser-error
capture, a production build identity check, visible stage/canvas readiness, a
real Start gesture, and collector cleanup. It never installs the gameplay fake
clock. The shared scheduler starts at sample origin, replays only events before
the shorter window, records actual delivery/lateness, and releases held keys on
cancellation or completion.

`playwright.performance.config.ts` selects only `e2e/performance/*.spec.ts`,
uses one Chromium worker with no retries or parallelism, and disables trace,
video, and screenshots for clean measurement. It requires the runner to supply
`PERF_BASE_URL` and `PERF_BUILD_ID`; it does not start or reuse a development
server. `performance/*.test.ts` files are not selected by this config.

The workload validity spec checks visible Start/Stop, invalid scenario errors,
build/readiness identity, ordinary HUD updates, the sustained 50-foe load, and
the two declared bullet tiers. It asserts no FPS budget. The clean scenario
spec expands the manifest's fast selection and persists every repetition before
assertions can discard it.

The scenario progress minima are liveness envelopes: they reject an empty or
stalled window but do not require a target frame rate or simulation/wall-time
ratio. A valid, slowly advancing stress window remains eligible for the later
capacity verdict; a missing frame or missing completion remains invalid.

## Production Preview

Build and serve the exact optimized performance distribution:

```sh
PERFORMANCE_BUILD_ID=phase4-local vp build --mode performance
vp preview --host 127.0.0.1 --port 4173 --strictPort --outDir dist-performance
```

Run the browser validity gate first:

```sh
PERF_BASE_URL=http://127.0.0.1:4173 PERF_BUILD_ID=phase4-local \
  vp exec playwright test --config=playwright.performance.config.ts workload.spec.ts
```

Then collect the complete fast raw set:

```sh
PERF_BASE_URL=http://127.0.0.1:4173 PERF_BUILD_ID=phase4-local \
PERF_OUTPUT_DIR=performance-results/<run-id> \
  vp exec playwright test --config=playwright.performance.config.ts scenarios.spec.ts
```

The optimized build must serve the exact build ID shown in the page and matching
external source maps. A wrong build, hidden page, missing completion, empty
frame set, dropped bounded buffer, or page watchdog expiry is an invalid
measurement, not a zero-valued result.

## Telemetry Overhead Check

To inspect measurement overhead, run two trace-free repetitions of the same
scenario, seed, input schedule, viewport, and production build: one with the
runtime observation/telemetry path enabled and one with it disabled by a
measurement-only harness configuration. Compare callback-work and phase
summaries, sample counts, elapsed time, and workload validity. Keep both raw
records and label the toggle in the run provenance. Do not use the comparison
to alter gameplay systems, workload populations, simulation constants, or
performance budgets. The result is an observation about the measurement path,
not a gameplay optimization.
