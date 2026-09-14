# Performance Runtime Handoff

Status: Phase 2 lifecycle handoff. The runtime owns one game session and one
render loop. The normal page and the future benchmark page use the same
controller boundary without sharing world or renderer instances.

## Public Signature

`src/game/browser-runtime.ts` exports:

- `AnimationFramePort`: `now()`, `request(callback)`, and `cancel(handle)`.
- `BrowserRuntimePorts`: caller-supplied `input`, `audio`, and `random` ports.
- `RuntimeView`: `mount(parent)`, `render(projection, nowMs)`, `dispose()`, and
  optional `getRendererMetadata()`.
- `RuntimeWorkloadContext`: the runtime-created `World` and `GameViewModel`,
  available only to an injected workload factory.
- `RuntimeWorkloadFactory`: creates the optional workload adapter.
- `RuntimeWorkload`: optional `beforeSimulation`, `afterSimulation`,
  `afterRender`, and `dispose` hooks.
- `RuntimeObserver`: receives one `RuntimeFrameObservation` after each frame.
- `BrowserRuntimeOptions`: stage parent, ports, view factory, animation-frame
  adapter, initial foe positions, HUD callback, optional workload factory, and
  optional observer.
- `BrowserRuntimeController`: immediate `ready` promise, `damagePlayer(amount)`,
  `spawnFoe()`, and idempotent `dispose()`.
- `createBrowserRuntime(options)`: constructs and starts a controller.

The normal page supplies `KeyboardInput`, `HtmlAudio`, `Math.random`,
`PixiView`, browser RAF, and the existing HUD callback. It does not receive the
world or model.

## Frame Contract

After `ready` resolves, exactly one RAF callback is scheduled. Each callback
runs this order:

1. `workload.beforeSimulation(dtSeconds)`.
2. `GameViewModel.tick(dtSeconds)`.
3. `workload.afterSimulation(dtSeconds)`.
4. One HUD projection and the supplied HUD update callback.
5. One render projection from `GameViewModel`.
6. `RuntimeView.render(projection, nowMs)`.
7. `workload.afterRender(projection)` with the same projection object, only
   after successful view submission.
8. The optional observer receives the completed frame, then the next RAF is
   scheduled.

The observer records total callback work and these phase totals:
`workload-before`, `simulation`, `workload-after`, `hud`, `projection`,
`render-submission`, and `after-render`. Phase clock reads and observation are
skipped when no observer is supplied, so clean runtime work does not include
observation overhead.

`rawElapsedMs` is the actual interval between RAF timestamps. The simulation
delta is `min(rawElapsedMs / 1000, 1 / 30)`. The first interval starts at the
clock read after view readiness, so renderer and texture loading time is not
counted as first-frame simulation time.

## Ownership

| Resource                           | Owner                         | Cleanup                                  |
| ---------------------------------- | ----------------------------- | ---------------------------------------- |
| `World`                            | Runtime                       | Always disposed by the runtime           |
| `GameViewModel`                    | Runtime                       | Always disposed by the runtime           |
| `RuntimeView` and Pixi application | Runtime                       | Disposed once, including startup races   |
| RAF handle                         | Runtime                       | Cancelled on disposal                    |
| Workload instance                  | Runtime when factory supplied | Optional workload `dispose` is attempted |
| Input port                         | Caller/page                   | Runtime never binds or disposes it       |
| Audio port                         | Caller/page                   | Runtime never binds or disposes it       |
| DOM listeners                      | Caller/page                   | Runtime never installs or removes them   |

Owned cleanup attempts workload, view, model, and world independently. Multiple
cleanup failures are reported as an `AggregateError`; one failure does not
prevent the remaining resources from being attempted. Disposal is idempotent.

## Lifecycle And Errors

`ready` resolves only after world/model startup and view mount. A mount or
startup failure rejects `ready` after owned cleanup. Disposing during either
view await prevents late frame scheduling and causes `ready` to reject with a
runtime lifecycle error after cleanup completes.

`damagePlayer` and `spawnFoe` return rejected promises before readiness and
after disposal. Once ready, they forward to the model and do not expose the
world or model to the caller.

The runtime does not implement pause, reset, reuse, or a second mount. A
runtime controller represents one session.

## Pixi View Lifecycle

`PixiView` has an explicit single-mount lifecycle: idle, mounting, mounted, or
disposed. A concurrent or post-disposal mount is rejected. App initialization
and texture loading each have a current-generation check. If disposal wins,
late-created application resources are destroyed, the canvas is not attached
after initialization, the stage is not built, and rendering is not attempted.

Disposal is safe before mount completes and repeated disposal destroys each
owned application once. Shared loaded textures are not destroyed by the view.
Initialization failures destroy the owned application before propagating the
original error.

`getRendererMetadata()` reads the selected renderer name from the existing
Pixi renderer. Backend and GPU identity remain `null` when Pixi does not
provide a supported value; metadata collection creates no graphics context and
does not change rendering.

## Gameplay Guarantees

- Existing normal-page markup, element IDs, keyboard behavior, audio behavior,
  button labels, and HUD assignments remain unchanged.
- The existing capped simulation delta and visual rendering path remain in use.
- The page exposes no benchmark controls, telemetry global, entity injection
  API, or hidden runtime handle.
- Input and audio are bound before startup and are cleaned up on pagehide,
  startup failure, or normal disposal. Button listeners are added only after
  readiness and removed on cleanup.
- Existing gameplay E2E and visual snapshots remain the validation boundary;
  Pixi cancellation details are covered by unit tests.

## Checks

The Phase 2 gate completed on 2026-09-14:

- `vp install`: pass, already up to date.
- `vp check`: pass, 68 files formatted; no warnings, lint errors, or type
  errors.
- `vp test run`: pass, 12 files and 57 tests.
- `vp run test:coverage`: pass, 91.21% statements, 81% branches, 91.76%
  functions, and 93.54% lines.
- `vp exec tsc -p tsconfig.json --noEmit`: pass.
- `vp exec tsc -p tsconfig.performance.json`: pass.
- `vp run build`: pass, ordinary production build completed.
- `vp run e2e`: pass, 11 existing Playwright tests including smoke and visual
  gameplay coverage.
- `vp run audit`: pass with one warning for the Phase 1
  `@jridgewell/trace-mapping` dependency, which is intentionally consumed by
  a later diagnostics step.
