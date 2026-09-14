# Local Performance Automation

The local performance loop builds the optimized benchmark entry, starts an
owned loopback preview, runs fresh Chromium contexts, writes bounded raw
records, compares clean measurements, and replays selected failures under
diagnostics. The normal gameplay E2E command remains separate.

## Setup

From the repository root:

```sh
vp install
vp exec playwright install chromium
vp run typecheck:performance
```

The runner owns `dist-performance/`, the preview process, and each run's
`performance-results/<run-id>/` directory. Do not start a manual preview for a
performance command.

## Commands

Collect a fast candidate without enforcing a baseline:

```sh
vp run perf --collect --output performance-results/local-collect
```

Accept a valid clean local candidate explicitly:

```sh
vp run perf:baseline \
  --from performance-results/local-collect \
  --baseline-dir performance-baselines.local \
  --accept
```

Run the enforcing fast loop against that local baseline:

```sh
vp run perf \
  --baseline performance-baselines.local/baseline.json \
  --output performance-results/local-enforce
```

Select scenarios with a comma-separated `--scenario` value:

```sh
vp run perf --scenario idle,movement --collect
```

Force evidence for one scenario without comparison:

```sh
vp run perf:diagnose \
  --scenario idle \
  --output performance-results/idle-diagnosis
```

Run the full scenario set. Full mode runs CPU/trace evidence for selected
scenarios and the allocation pass:

```sh
vp run perf:full --collect --output performance-results/full-collect
```

Full mode is intentionally expensive. It runs the complete clean matrix,
including three 60-second `lifecycle-60` repetitions, then replays selected
scenarios under CPU/trace and allocation diagnostics. Do not use it repeatedly
on a developer laptop for calibration. Use `--scenario <id>` to isolate one
workload while debugging, and use the dedicated CI/nightly runner for the
five-fast/three-full calibration set.

All path inputs can be overridden explicitly with `--policy`, `--baseline`,
`--required-scenarios`, `--output`, and `--baseline-dir`. Paths are recorded as
provenance. The runner never deletes arbitrary input paths.

## Results

Each run contains:

```text
performance-results/<run-id>/
  build/                 exact optimized JavaScript and source maps
  measurements/          one raw JSON record per scenario/repetition
  diagnostics/           CPU profiles, traces, allocation evidence
  results.json           immutable comparison and evidence data
  summary.md             offline summary
  report.html            static offline report
  artifact-manifest.json artifact inventory
```

Open `report.html` directly. Load `.cpuprofile` files in Chrome DevTools
Performance and open trace JSON in Perfetto or a compatible Chrome tracing
viewer. Diagnostic timing never changes `originalVerdict`.

## CI And Nightly Integration

The current workflows collect candidates but do not enforce performance:

| Workflow job                                                                 | Runner         | Command                      | Status          |
| ---------------------------------------------------------------------------- | -------------- | ---------------------------- | --------------- |
| `Performance collection` in `.github/workflows/ci.yml`                       | `ubuntu-24.04` | `vp run perf --collect`      | collection only |
| `Full performance collection` in `.github/workflows/performance-nightly.yml` | `ubuntu-24.04` | `vp run perf:full --collect` | collection only |

Both workflows run the native performance type check, install the pinned
Chromium setup, and pass trusted policy and scenario inputs. CI reads policy,
scenarios, and an accepted baseline from the trusted base revision when those
files exist; it does not accept a candidate baseline. Nightly reads the
tracked files on trusted main and uploads compact metrics/history with a
requested 90-day retention and diagnostics/source maps with a requested
14-day retention. Repository retention limits may shorten those requests.

There is currently no accepted `performance/baselines/ci.json`, so the
trusted-input preparation records a missing baseline and cannot establish an
enforcing comparison. The performance job is not a required branch-protection
check; requiring it is an administrator action after calibration and baseline
bootstrap are complete. No CI or nightly run ID is recorded in this repository,
so workflow execution and retention are not claimed as verified here.

Local baseline acceptance is explicit and machine-compatible only. It requires
a complete valid clean candidate and `perf:baseline --from <run-dir> --accept`;
it never promotes data to the tracked CI baseline. Same-machine local
baselines still require representative operating conditions and must not be
copied between incompatible environments.

The verified browser scope is headless Chromium and its observed CDP surface.
Software-GPU or hardware-GPU behavior is not calibrated or accepted as a
performance capability; renderer/backend and optional GPU identity are
observation fields only. The harness does not provide completed GPU profiling
or GPU-memory accounting.

Exit status `0` means an accepted comparison or explicitly successful
collection/diagnosis. Status `1` means a valid performance or capacity
regression. Status `2` means invalid input, incomplete workload/observations,
missing or incompatible enforcement inputs, unsupported tooling, or an
infrastructure failure.

## Troubleshooting

- `unbaselined-collection`: run `perf:baseline --from <run-dir> --accept` only after the run is complete and valid, then pass that baseline to enforcing `perf`.
- `workload-invalid`: inspect the raw record's `workload.failures`, population boundaries, visible-bolt count, render progress, and sample completion. Do not accept the run.
- `infrastructure-failure`: inspect `build/` and the command logs in the report. A build or readiness failure never reuses an unrelated server.
- `wrong build` or environment mismatch: use the exact build ID and compatible local machine/runner identity; do not copy a baseline between machines.
- Missing diagnostic artifacts: inspect the diagnostic status for unsupported CDP capabilities, truncation, stream-drain failure, or non-reproduction. The clean verdict remains authoritative.

## Verification Status

The tracked policy is intentionally uncalibrated, so a normal enforcing run
must not claim a production comparison. On 2026-09-14, the fast collection
command below was measured locally at 376 seconds wall time and 57,343,945
bytes of output:

```sh
vp run perf --collect --output performance-results/phase7-collect-timed
```

It exited `2` because the existing Phase 4 scenario writer did not include a
required `workload` record in its raw output; the CLI preserved those records
and marked them invalid instead of fabricating workload data. The workload
transport and full-matrix collection fixes are now present in the working tree,
but the default-policy collect/accept/successful-compare demonstration remains
blocked by Phase 9 calibration. The disposable CLI tests use explicit temporary
policy, manifest, baseline, and output paths to verify successful comparison,
automatic regression escalation, diagnostic failure preservation, and full-mode
evidence without changing tracked policy or accepting production data.

The canonical retained invalid-workload receipt is
`performance-results/phase8-collection/summary.md`; it records the pre-fix
fast scenarios. No calibration run IDs, accepted baseline provenance, or
CI/nightly run IDs are available, so none are asserted by this handoff.
