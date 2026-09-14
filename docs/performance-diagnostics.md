# Performance Diagnostics

Status: Phase 6 diagnostics handoff. Clean measurement remains trace-free. CPU,
trace, and allocation replay are separate evidence modes and never change the
original clean comparison verdict.

## Reference Capability Check

The installed toolchain reports Playwright `1.63.0` and Chromium
`153.0.8010.12` on the reference Linux environment. A direct CDP smoke check
confirmed these operations:

- `Profiler.enable`, `Profiler.setSamplingInterval`, `Profiler.start`,
  `Profiler.stop`, and `Profiler.disable`: supported.
- `Tracing.getCategories`: supported. The reference browser exposes
  `devtools.timeline`, `disabled-by-default-devtools.timeline`,
  `disabled-by-default-devtools.timeline.frame`, `blink.user_timing`, `v8`,
  `toplevel`, `disabled-by-default-v8.gc`, and
  `disabled-by-default-v8.cpu_profiler` among its categories.
- `Tracing.start` with `transferMode: ReturnAsStream`, `Tracing.end`,
  `IO.read`, and `IO.close`: supported; a stream handle and readable data were
  returned.
- `HeapProfiler.startSampling` and `HeapProfiler.stopSampling`: supported.

Diagnostics still discover categories on every run. A category missing on a
different Chromium build is recorded in `missingCapabilities`; it is never
reported as a zero-duration event. If no requested trace category is exposed,
the trace collector returns an unsupported startup failure. CDP detachment,
command failure, timeout, malformed JSON, and stream errors are infrastructure
or evidence failures, not successful empty evidence.

## Public API

`performance/diagnostics.ts` exports:

- `createCpuTraceCollector(options)`: one page CDP session containing the
  sampling CPU profiler and one streamed Chromium trace.
- `createAllocationCollector(options)`: the separate HeapProfiler sampling
  lifecycle. It cannot start while another diagnostic collector owns the same
  CDP session.
- `createEvidenceBudget(maximumBytes)`: an explicit per-run byte budget shared
  by collectors.

The internal defaults are a 5-second evidence window, 30-second trace-drain
timeout, 100 MiB maximum trace per replay, and 500 MiB total evidence budget.

Collectors expose `start`, `stop`, and bounded `run`. `stop` returns a status
of `complete`, `unsupported`, `failed`, or `truncated`, selected/available
categories, missing capabilities, artifact status, and errors. Cleanup is
attempted after startup, command, stop, stream, and detachment failures.

The trace is read to EOF before its `IO.close` command is attempted. A size cap
stops writing additional bytes but continues draining the CDP stream. The
artifact is then marked `truncated` and `validJson: false`; a partial JSON file
is never presented as complete evidence. File handles are closed on successful
and failed writes.

## Evidence And Artifacts

Diagnostic replay artifacts belong under the run's `diagnostics/` directory:

- CPU sampling profile: JSON in Chrome `.cpuprofile` format.
- Chromium trace: streamed JSON trace-event data suitable for standard Chrome
  tracing and Perfetto viewers.
- Allocation sampling: HeapProfiler sampling profile JSON.
- Evidence status: bounded machine-readable status and error data.

`performance/evidence.ts` consumes only supplied local profile, trace, JavaScript
map, and source-map inputs. It does not fetch remote sources. It maps generated
line/column locations with `@jridgewell/trace-mapping`, preserves unmapped
frames, aggregates self/total CPU sample cost without counting recursive stack
frames twice, and retains unknown trace events while excluding them from
recognized GC/render summaries. Recognized spans are grouped by process/thread
and use overlap-aware interval ownership rather than adding nested durations.

Source-map self-test runs require explicit `PERF_GENERATED_ENTRY` and
`PERF_SOURCE_MAP_PATH` inputs pointing at the exact optimized build entry and
map. The self-test scenario is excluded from fast/full/baseline membership.

## Viewing Evidence

1. Open the `.cpuprofile` file in Chrome DevTools Performance, using the Load
   profile action, and inspect the sampled call tree and mapped source frames.
2. Open the trace JSON in `https://ui.perfetto.dev/` or a compatible local
   Chrome tracing viewer. For offline review, use a locally installed viewer;
   the report itself makes no network request.
3. Open `report.html` directly from the run directory. It is static and links
   only to relative artifacts. `summary.md`, `results.json`, and
   `artifact-manifest.json` remain usable when a replay is partial or fails.

The report states the original clean verdict separately from diagnostic
reproduction. A slowdown not reproduced under instrumentation is
`not-reproduced`; an invalid workload or missing required sample is `invalid`.
Neither state clears a known regression.

## Overhead And Memory Limits

CPU sampling and trace instrumentation add observer overhead and can alter
timing. Diagnostic values are evidence for investigation, not clean budget
measurements and never feed `comparePerformance`. Allocation sampling also
changes allocation behavior and is not simultaneous with a clean or CPU/trace
pass. Natural heap boundaries and allocation samples show observed behavior;
they do not prove total memory retention, GPU memory use, native allocation
leaks, or a renderer leak. Forced GC is not used by this phase.

The per-replay trace cap is 100 MiB and the shared run cap is 500 MiB. Missing
categories, unsupported APIs, truncation, and drain timeouts have explicit
statuses and resolution paths: use a compatible pinned Chromium, inspect the
captured error/status record, or rerun the bounded replay. Increasing a limit
must be an intentional policy change, not an automatic fallback.
