# Performance Calibration

Status: Phase 8 collection procedure. The tracked policy is intentionally
uncalibrated. No threshold in this document is a measured fact, an accepted
baseline, or an enforcement decision.

## Current Recovery Status

The first local collection receipt is obsolete: its raw records predate the
workload transport fix and were correctly marked `workload-invalid`. The
working tree now carries the workload handoff, full-matrix selection, and
per-scenario browser isolation fixes, but those changes still need a committed
verification receipt.

Do not continue full calibration on the reference laptop. A full invocation
contains 21 clean repetitions, including three 60-second `lifecycle-60`
samples, then CPU/trace and allocation replays for the selected full scenarios.
Recent local valid records observed `bullets-1000` frame CPU p95 between 228 and
553 ms with a simulation/wall ratio near 0.0019. `lifecycle-60` observed about
34 renders in 60 seconds with a ratio near 0.018. These values show why the
local machine is heavily loaded; they are capacity observations, not policy
limits.

Resume calibration on one dedicated, stable runner identity. Retain five valid
fast and three valid full invocations from that identity, then review variation
and injected-regression sensitivity before changing tracked policy or baseline
files. Partial local runs remain useful for diagnosis but cannot satisfy the
Phase 9 gate.

## Purpose

Calibration turns collected clean measurements into a reviewed policy without
using expiring CI artifacts as the source of truth. It must be repeated for
each reference environment identity. An environment identity includes the
declared runner class, Node/Playwright/Chromium versions, operating system and
architecture, CPU identity, renderer/backend, viewport/DPR, and relevant audio
and throttling settings. Do not pool observations from incompatible identities.

Phase 8 workflows collect candidates only:

- `CI / Performance collection` runs the fast collection on `ubuntu-24.04`.
- `Performance nightly / Full performance collection` runs `perf:full --collect`
  on the same runner class and pinned Chromium setup.
- Neither workflow accepts a baseline or acts as the required performance gate.
- Compact nightly artifacts request 90-day retention and evidence requests
  14-day retention. Repository or organization limits may shorten those
  periods; an upload action's retention error is an explicit workflow event,
  not permission to treat missing evidence as a passing run.

## Collection Set

For one reference environment, collect at least:

1. Five valid fast invocations with the complete fast scenario matrix and all
   declared repetitions.
2. Three valid full invocations with the complete full scenario matrix and all
   declared repetitions.

Use separate immutable output directories. For example:

```text
performance-results/calibration/<environment-key>/fast-01/
performance-results/calibration/<environment-key>/fast-02/
performance-results/calibration/<environment-key>/fast-03/
performance-results/calibration/<environment-key>/fast-04/
performance-results/calibration/<environment-key>/fast-05/
performance-results/calibration/<environment-key>/full-01/
performance-results/calibration/<environment-key>/full-02/
performance-results/calibration/<environment-key>/full-03/
```

Run collection with the policy, trusted scenario manifest, and baseline paths
explicitly supplied. The baseline is not accepted during collection:

```sh
vp run perf --collect \
  --policy <trusted-policy.json> \
  --baseline <trusted-baseline.json> \
  --required-scenarios <trusted-scenarios.json> \
  --output performance-results/calibration/<environment-key>/fast-01

vp run perf:full --collect \
  --policy <trusted-policy.json> \
  --baseline <trusted-baseline.json> \
  --required-scenarios <trusted-scenarios.json> \
  --output performance-results/calibration/<environment-key>/full-01
```

Use the same trusted policy and scenario definitions for every invocation in
the set. Increment the output directory for each run; never overwrite a raw
record. Record the commit, build manifest, policy and workload fingerprints,
environment identity, command line, exit status, and any infrastructure or
diagnostic errors beside the downloaded results.

## Valid Run Rules

Only a run meeting every condition below can contribute to calibration:

- Every required scenario and repetition is present exactly once.
- Every record is a clean measurement with the expected build and workload
  fingerprint.
- The workload is valid at its declared boundaries, including populations,
  projected visibility, hard ceiling, progress, and real simulation/wall-time
  advancement.
- Required frame, callback-work, phase, and timing samples are non-empty,
  bounded, complete, and not dropped or truncated.
- Input lateness and browser errors are within the declared scenario envelope.
- The environment identity is complete and compatible with the calibration
  group.
- The run did not use a fake clock, reduced tier, shortened sample, forced GC,
  profiler, trace, allocation sampling, or a diagnostic replay for its clean
  values.

Do not replace an invalid repetition with a retry in the same output, remove a
slow repetition, or average a partial matrix. Preserve failed output and mark
the invocation invalid. A valid slow run remains data for capacity analysis;
it is not silently reduced to make collection pass.

## Retained Distributions

Retain the raw bounded measurement records, `results.json`, `summary.md`,
`artifact-manifest.json`, build manifest, and the exact optimized JavaScript
and source maps for every valid invocation. Retain per-repetition distributions
before aggregating across invocations. At minimum, retain for each
scenario/repetition and metric:

- sample count and bounded-sample metadata;
- p50, p95, and p99 from the actual samples;
- mean and median where available;
- actual elapsed time and simulation/wall-time ratio;
- workload validity and capacity status; and
- environment, build, policy, and workload fingerprints.

The comparison unit is the median repetition aggregate. Do not pool frame
samples across repetitions or let a scenario with more samples receive more
weight. Preserve the five fast and three full invocation-level aggregate sets
so reviewers can see variation across invocations as well as variation inside
an invocation.

## Variation And Noise

For each scenario and candidate metric within one environment group:

1. List the median repetition aggregate for every valid invocation.
2. Calculate the median, minimum, maximum, range, and p95 of those invocation
   aggregates.
3. Report the observed variation separately for fast and full tiers; do not
   use the fast tier to stand in for full-tier capacity.
4. Identify outliers from their retained records and explain them. Do not
   discard them solely because they are inconvenient.
5. Record the observed noise bound and the reviewer-approved margin above it
   for every proposed enforced threshold.

Thresholds must be visibly above the measured unchanged-run variation. The
margin is a reviewed calibration decision and must state why it is large
enough for the reference environment; it is not an arbitrary constant hidden
in a script. If the shared runner makes variation too large to distinguish a
meaningful regression, do not set an unlimited threshold. Mark the metric
informational or move calibration to a dedicated stable runner and record the
limitation.

## Injected-Regression Sensitivity

Before accepting thresholds, use disposable policy, baseline, and raw-record
fixtures under ignored output paths. Never edit the tracked policy, introduce
a permanent gameplay slowdown, or accept the injected result as a baseline.

For every proposed required metric and tier, exercise at least these cases:

- an unchanged record that remains below the proposed absolute ceiling and
  degradation thresholds;
- a change below the reviewed noise margin that does not fail;
- a meaningful change that exceeds both the relative threshold and the
  minimum absolute delta and fails;
- an absolute ceiling breach that fails even without a baseline degradation;
- a zero or near-zero baseline case using the comparator's explicit absolute
  rule; and
- a valid-load simulation/wall-time reduction that produces a capacity failure,
  not a workload setup error.

The sensitivity receipt records the fixture name, injected metric/direction,
expected status and exit code, observed status and exit code, and proof that
the original clean verdict remains immutable through diagnostic failure. A
comparator-only injection verifies decision sensitivity; it is not evidence
that the browser workload produced the regression. A separate controlled
end-to-end replay may be used for investigation, but its instrumented timing
never calibrates clean thresholds.

## Policy Selection

Every tier must enforce workload validity and capacity validity before metric
comparison. At least one source-level CPU-work regression gate is required:
`frameCpuWorkP95Ms` is the primary candidate because it measures the bounded
game callback work and can be connected to mapped CPU evidence without
claiming GPU time.

The reviewed policy must explain each enforced metric. Use this decision table
as the receipt structure, filling values only from the collected data:

| Metric                | Possible policy role                                  | Required review reason                                                                         |
| --------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `frameCpuWorkP95Ms`   | Required regression metric                            | Detects game callback work regressions and supports source-mapped diagnosis.                   |
| `simulationWallRatio` | Required capacity metric when sensitivity is adequate | Detects insufficient simulation progress under sustained valid load.                           |
| `rawRafP95Ms`         | Required only if stable; otherwise informational      | Measures observed cadence, but includes browser/compositor scheduling and is not GPU duration. |
| `heapUsedDeltaBytes`  | Informational unless proven stable and supported      | Measures JS heap boundaries only; it does not measure GPU, native, or total browser memory.    |
| `longTaskRate`        | Informational unless supported and stable             | Depends on browser Long Task availability and is noisy for a small bounded window.             |

Absolute ceilings and relative-plus-absolute degradation rules are selected
per reviewed metric from the observed distributions. A required metric may not
be marked calibrated until all of its thresholds are present, justified above
noise, and shown to detect the injected meaningful regression. Unsupported or
noisy optional metrics remain explicitly informational rather than becoming
zero-valued requirements.

## Review Receipt

The calibration review records:

- environment identity and the exact five fast and three full run IDs;
- commit, build, policy, scenario, and workload fingerprints;
- validity status and retained artifact locations for every invocation;
- per-repetition and invocation aggregate distributions;
- measured variation/noise and the reasoning for each margin;
- injected-regression sensitivity results for every proposed required metric;
- selected absolute ceilings, relative thresholds, and minimum absolute deltas;
- the reason each enforced metric protects workload, capacity, or CPU work; and
- the accepted revision and reviewer authorization for changing the tracked
  policy and, later, the tracked CI baseline.

Calibration must not reduce workload populations, shorten a tier, or install a
fake clock. If five fast or three full valid invocations cannot be collected,
calibration is incomplete and Phase 9 enforcement remains blocked.
