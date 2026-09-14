# Gameplay E2E tests

Write player behavior in `e2e/features/*.feature`, then run it with Playwright:

```sh
vp install
vp exec playwright install chromium
vp run e2e
```

`playwright-bdd` generates native Playwright tests before each run. Generated
specs live in `e2e/.features-gen/`; do not edit or commit them.

## Commands

Pass Playwright flags directly to Vite+, without an extra `--` separator:

```sh
vp run e2e --project=gameplay
vp run e2e --project=realtime
vp run e2e --project=smoke
vp run e2e --grep @combat
vp run e2e --project=gameplay --repeat-each=20 --workers=1 --retries=0
vp run e2e --project=realtime --repeat-each=10 --retries=0
vp run e2e --project=gameplay --headed
vp exec playwright show-report
```

The suite starts the development server automatically. Local runs can reuse a
server on port 5173; CI requires its own server. One worker and zero retries are
the defaults so timing failures remain visible.

If that port is occupied, leave the other server running and choose another:

```sh
E2E_PORT=5174 CI=1 vp run e2e
```

For Playwright UI mode, generate first, then open the UI:

```sh
vp run e2e:generate
vp exec playwright test --ui
```

Run `vp run e2e:generate` again after editing feature files. The UI watches the
generated specs, not the Gherkin source. Do not assume a feature edit has taken
effect until generation succeeds.

## Black-box boundary

Both steps and their helpers must interact through the browser. Allowed surfaces
are keyboard/mouse input, normal navigation, displayed HUD values, canvas
screenshots, and Playwright's browser clock. Reading the displayed player
position is allowed; reading the player's model position is not.

Do not import production modules, inspect Pixi sprites or ECS state, call game
methods through `page.evaluate`, inject entities, or introduce hidden state
attributes or `window.__game` hooks. The E2E lint override rejects imports with a
`src` path segment. Review still needs to catch runtime access and any future
aliases that bypass that rule.

Each scenario gets a fresh browser context and navigates to the ordinary game
page. The arena already has a fixed starting layout. Random spawn controls are
not used to set up gameplay scenarios.

## Adding a feature

Keep Gherkin focused on what a player does and sees:

```gherkin
@combat @realtime
Feature: Ranged combat
  Scenario: Defeating an enemy by shooting
    Given I have entered a fresh arena
    When I fire right at the approaching enemies
    Then fewer enemies remain in the arena
```

1. Add the scenario under `e2e/features/`. Use tags such as `@combat` for filtering.
2. Reuse steps from `e2e/steps/gameplay.steps.ts`, or add a thin step definition
   using `Given`, `When`, and `Then` from `e2e/support/fixtures.ts`.
3. Put key bindings, selectors, and reusable browser operations in `GamePage`.
   Keep scenario data in the per-test fixture, never module-level mutable state.
4. Assert the claimed outcome. A lower foe count proves a defeat, not correct
   rendering of both guns or independent aiming. Use pixels when the claim is
   visual.
5. Repeat the scenario without retries. Add `@realtime` only if it also works
   without clock control; that tag runs the same scenario in both projects.

Action durations in the driver are bounded input gestures, not assertions about
exact physics constants. Movement compares the displayed position before and
after input. Dash compares displacement against walking for the same duration,
with movement controls released during the dash. Stopping samples the displayed
position over an observation window. Shooting uses a fixed burst and then checks
the result; it does not keep firing indefinitely until the test passes.

The driver tracks held keys and releases them during teardown. Page errors fail
the scenario. On failure, the fixture attaches visible page text and browser
errors; Playwright retains traces, screenshots, and video. CI uploads the report
and test results for seven days.

## Controlled and real time

The `gameplay` project installs and pauses the browser clock before navigation.
During startup it advances time in small increments until the HUD shows the
initial enemies, because a visible canvas alone does not mean textures loaded.
Afterward, input gestures advance normal timers and animation frames with
`page.clock.runFor()`. No game tick or model API is called.

Do not substitute `fastForward()` for gameplay progression: it can skip the
intermediate callbacks needed for movement. Do not wait on a frozen HUD without
advancing the clock. Asset loading still takes real time, so advancing a large
virtual interval is not a readiness check.

The `realtime` project never installs the clock. It covers walking left/right
and shooting with ordinary browser timing. Its bounded gestures tolerate some
variation, but very low frame rates can still fail a scenario. Diagnose the
trace and video rather than adding retries or silently lengthening every wait.

## Visual baselines

Jumping verifies three views: grounded, airborne, then grounded again. Reviewed
PNGs live in `e2e/snapshots/linux/`. The 64-by-180 CSS-pixel crop includes the
starting player, sky, and floor, but excludes approaching enemies. It depends on
the arena's current layout, not on hidden sprite coordinates.

The clock stays paused during capture. Screenshots use no allowed differing
pixels beyond Playwright's default color threshold. CSS animation suppression
does not freeze Pixi's JavaScript animation loop.

To update a baseline after an intentional visual change:

```sh
vp run e2e --project=gameplay --grep @visual --update-snapshots
vp run e2e --project=gameplay --grep @visual --repeat-each=20 --retries=0
```

Inspect both PNGs and the diff before accepting them. The airborne image must
show the player above the ground; approving a newly generated image without
review could approve a broken jump. Do not run snapshot updates in CI.

Baselines were created with headless Chromium on Linux. Match the locked
Playwright/browser version, viewport, device scale, and rendering environment.
Other operating systems need separately reviewed baselines, or can run
`vp run e2e --grep-invert @visual` while using Linux for visual checks. A browser,
GPU, or renderer change can require baseline review even when gameplay is correct.

## Current scope

The default run executes seven controlled gameplay cases, three real-time
cases, and the existing demo smoke test. Coverage includes movement, stopping,
dash, shooting an enemy, and visibly jumping and landing. Gameplay tests do not
claim to verify independent aiming, individual projectile rendering, audible
sound, or contact damage. The current game has no enemy-contact damage system;
the damage button belongs only to demo smoke coverage.

Exact physics and ECS behavior remain in Vitest. Add browser coverage for a
player-facing outcome, not a duplicate assertion about an internal component.

References: [Playwright-BDD](https://vitalets.github.io/playwright-bdd/),
[browser clock](https://playwright.dev/docs/clock),
[visual comparisons](https://playwright.dev/docs/test-snapshots).
