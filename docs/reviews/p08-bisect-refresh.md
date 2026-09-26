# P08 Bisect refresh correction — 2026-09-26

Bisect controls now retain their last validated context during background reads. This fixes Start and
Good/Bad clicks being swallowed by transient refresh-driven disabling. Actual operations still disable
the controls, and the backend still rejects a changed checkout before executing any action.

## Cause and correction

The unchanged P08 baseline `6920a3f` failed two of three full Bisect trials: once at Start and once while
marking a midpoint. Temporary renderer tracing recorded the read lifecycle, DOM mouse events and action
submission. In the Start failure, the same snapshot was returned before and after this sequence:

| Event                                | Relative time | State                                            |
| ------------------------------------ | ------------: | ------------------------------------------------ |
| Valid context shown                  |        255 ms | Start enabled, no operation running              |
| Background refresh begins            |        378 ms | `reading` makes Start disabled                   |
| Mouse-down/up/click arrive           |        406 ms | Menu command is disabled; no action is submitted |
| Read finishes with the same snapshot |        514 ms | Start enabled again                              |

The pointer action completed during a harmless read, so neither Git nor the operation registry received
a command. The same `reading` flag also disabled the banner's Good/Bad/Skip/Abort buttons. A readiness
assertion before clicking could not protect against a later refresh. Runtime artifacts are in the
ignored `test-results/bisect-runtime/`; temporary tracing was removed from both application and test code.

`useBisect` now treats initial context availability, repository capability and actual mutation activity
as separate concerns. A background read preserves the usable snapshot instead of toggling busy. A
synchronous action claim prevents duplicate submissions before React renders the busy state. The
existing repository/operation generations still prevent old completions from replacing another tab's
state. The common-directory queue and main-process snapshot validation are unchanged; there is no
automatic retry or retargeting after a stale-state refusal.

## Regression evidence

`tests/e2e/bisect-refresh.test.ts` uses a TypeScript wrapper around real Git to pause only Bisect context
reads until the test releases a file gate. It exercises mouse-down → refresh → mouse-up deterministically,
without relying on a lucky interval between reads. This regression fails on the original implementation
at its disabled Start assertion (`test-results/bisect-controlled-before/`).

The corrected application:

- Completes Start, Bad, Good, Skip and Abort while refresh is held across each pointer interaction.
  Controls remain enabled during the read and disabled during the actual operation. Exactly five
  successful Bisect operations are recorded, and original branch/refs/worktree state is restored.
- Rejects Good when an external checkout changes HEAD while the old context is displayed. HEAD stays at
  that new revision, the bisect log remains unchanged, exactly one failed classification is recorded,
  and Abort still restores the original checkout. No fresh-snapshot retry marks an unintended commit.
- Passes five consecutive original F26 scenarios, including both endpoint choices, midpoint Skip,
  application restart, first-bad detection and original-ref/clean-checkout restoration.

The reference remains `P2-006:F1` and `P2-006-skip-subcase:F1–F3`, Fork Windows 2.22.0.0, captured
2026-09-19. The dossier and original workflow evidence were reviewed. Confidence is high for those
manual actions and the independently reproduced application race; the catalogue does not establish
Fork's refresh/click timing. Layout, source images, capture coverage, native-platform claims and the
existing manual-Bisect scope are unchanged. No new public screenshots or application assets were needed.

## Verification

The original workflow passes all five consecutive runs in `test-results/bisect-stability/`. Both
controlled-refresh scenarios pass in `test-results/bisect-refresh-verified/`, then pass again in the
complete suite with the added operation-lock and exact-operation-count assertions.

- `npm run check`: **603 tests passed**, one existing opt-in skip; type, lint and formatting checks pass.
- `npm run build`: passed as part of `npm run test:e2e`.
- Full headless Electron suite: **62 passed, two existing opt-in skips**, including all Bisect scenarios,
  all P03 viewport scenarios and production desktop/preload smoke. No routine UI failure remains in this
  run. Artifacts: `test-results/bisect-full-verification/`.

Tests use disposable repositories and profiles, sandboxed headless Electron and the committed npm
dependencies. The user's repository, bridge and IDE services are not modified by test Git operations.
