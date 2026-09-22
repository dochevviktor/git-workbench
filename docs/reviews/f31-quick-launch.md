# F31 — Quick Launch

Implemented 2026-09-22 on Linux. F31 now provides Ctrl/Cmd+P, toolbar and File-menu
entry points; Recent Repositories and Commands; fuzzy lookup; branch/tag parameter
selection; and handoff to existing actions. P12 remains partial for its other families.

## Evidence and independent decisions

- Primary: `P1-032:F1`, Fork Windows 2.22.0.0, captured 2026-09-19, light appearance,
  96 DPI. High confidence for Recent Repositories/Commands, Rebase filtering,
  branch/tag chooser, confirmation dialog, and outside-click dismissal. Reviewed the
  original case, four linked screenshots, action log and before-Git manifest. There
  is no after-Git evidence for an executed rebase in this case.
- Public: [Quick Launch](https://fork.dev/blog/posts/quick-launch/), 2019-10-23,
  retrieved 2026-09-22. High confidence for Ctrl/Cmd+P, branch checkout and fuzzy
  file-history lookup on Mac/Windows; exact ranking and current defaults are unknown.
  Restored and browsed the public reference index; no new reference image was added.
- Linux follows the Windows grouped popup, blue selection, command token and existing
  action-dialog flow. The HTML modal, close/back buttons, shortcut hints, disabled
  reasons and keyboard instructions are independent accessibility adaptations.
  Matching normalizes Unicode and ignores case, ranking contiguous matches before
  ordered subsequences. This is not a claim about Fork's algorithm.

## Implementation

The palette projects actual menu callbacks, shortcuts and disabled states, propagating
disabled parent menus. Unimplemented menu placeholders without callbacks are excluded.
Rebase and Merge accept local branches and tags and open the existing review dialog;
Checkout Branch uses the existing clean/dirty checkout path. File History enumerates
committed files at the current HEAD and opens the existing owned read-only inspector.
Recent repositories use the existing canonical open/deduplication path.

No IPC or privilege surface is added. Git reads, mutation snapshots, serialization,
preconditions, recovery and errors remain in existing backend services. The merge/rebase
dialog's source type now represents the name/full reference it actually consumes, so a
tag does not need to masquerade as a branch DTO.

Arrow keys select, Enter activates, Escape dismisses, and Backspace on an empty
parameter input returns to commands. Input composition does not activate commands.
Dismissal restores focus. The root command list updates in place during refresh;
repository/ref-snapshot or operation-busy changes close an active parameter chooser.
Mutation dialogs retain backend snapshot validation. Async parameter results
are discarded after dismissal/back/retry. File lookup stops scheduling after cancellation;
one already-running bounded tree read can finish.

File lookup caps at 5,000 files, 200 directories and ten seconds before scheduling
another read, preserving backend truncation. Partial results explicitly direct users
to File Tree for omitted paths. It excludes submodule contents and untracked files.
Only 200 matched rows render at once, with a narrowing hint; searching considers the
whole collected list. No new subscriptions, background polling or persisted search
state are introduced.

## Verification

Unit tests cover ranking, Unicode/unusual paths, duplicate repository names, inherited
menu availability, committed-tree traversal, submodule exclusion, read failure,
cancellation and file/directory/time limits. The headless Electron scenario covers
no-repository disabled actions, toolbar/shortcut entry, arrows, fuzzy command and
parameter lookup, branch and tag confirmation, Cancel without changes, a real divergent
rebase with independently checked ancestry/content, checkout, Unicode file history,
recent-repository deduplication, Merge dialog handoff, repeated dismissal/focus restore,
empty results, dark appearance and stale-context closure after external checkout.

Validation commands: `npm run check`, `npm run build`, and
`npx playwright test tests/e2e/quick-launch.test.ts tests/e2e/desktop.test.ts`.
The check gate passes 384 tests with one existing skip, plus type checks, lint and formatting.
Tests use disposable repositories and profiles; no mutating test touches this checkout.
Light commands, parameter and rebase-dialog screenshots plus dark commands are written
under ignored `test-results/f31-*.png`. Compared with the four original P1-032 screenshots:
grouping, selection, token-to-parameter transition and review flow agree; native-window
chrome, icons, focus outlines and footer hints remain deliberate project differences.

Unverified: exact Fork ranking, complete command inventory, very large repository
performance, screen-reader/IME platform matrix and native Wayland interaction. No frame
or window-management code changes. Custom command definitions remain F33; external
tools and preferences remain their separately scoped P12 work.
