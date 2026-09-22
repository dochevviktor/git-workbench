# F38 Lean Branching — 2026-09-22

## Evidence and independent execution policy

`P0-008-toolbar-dropdown-subcase:F1`, Windows 2.22.0.0, light, 96 DPI, captures the
Branch dropdown's Lean Branching heading, Start, Sync and disabled Finish on main.
The original case, screen-0038 and both Git manifests were inspected: opening menus
changed no Git state. Execution outcomes remain unknown in that catalogue case.

The maintainer's [proposal](https://github.com/fork-dev/TrackerWin/issues/1432)
(2022-01-20, reviewed 2026-09-22) describes creating a topic from the newer base,
rebasing during Sync, and merging during Finish. It proposes fast-forwarding a
single commit and a merge commit for multiple commits. Confidence: high for the
published proposal, not proof of current Windows behavior.

Git Workbench's independently specified policy, fixed before enabling operations:

- The user reviews a local base branch in every dialog. The initial suggestion is
  main, master, develop, then the current branch. No naming convention or Git-flow
  configuration is required. The choice is remembered per repository for this renderer
  session, including the default used by Start; it is not a repository setting.
- Start creates and checks out an untracked local branch at the newer of the base
  and its existing upstream ref. Diverged or missing upstreams require repair first.
- Sync rebases the current branch on its upstream when needed, then on the newer
  base. Sync on the base only integrates its upstream. Each conflict stops the sequence;
  use existing Recovery Continue/Abort, then run Sync again to finish remaining steps.
- Finish requires a base synchronized exactly with its configured upstream, and a
  topic containing that base. It checks out the base and fast-forwards one commit,
  or creates a merge commit for multiple commits. The topic branch is retained.
- All three require a committed, attached HEAD, a clean index/worktree including
  untracked files, and no unfinished operation or pending saved-change recovery.
  Finish refuses a base occupied by another worktree. Dirty Start/Sync menu entries
  still open review; their execution buttons require a clean state as an independent policy.
- Review snapshots cover HEAD, local refs/worktree occupancy, upstream targets,
  and operation/working state. Execution revalidates inside the common-directory
  queue. No automatic fetch, push, force push, reset, deletion, or autostash occurs.
  Sync uses ordinary non-interactive rebase without updating other local branches.
  Failures and cancellation retain Git's resulting state and appear in Activity;
  a completed checkout or earlier Sync stage is not automatically rolled back.

Dialog layouts are independently authored using the existing accessible dialog
shell. The original dropdown screenshot is the layout reference; no Start/Sync/
Finish dialog or resulting history is established by the private catalogue.

## Verification

- `npm run check`: 470 tests passed, one existing skip; type checking, lint and
  formatting passed. Eight disposable-repository F38 tests cover the lifecycle,
  one/multiple-commit parents, local and fetched upstream changes, stale snapshots,
  missing/diverged upstreams, configured dependent-ref preservation, cancellation
  before mutation, worktree occupancy, dirty/detached/unborn/invalid-name guards,
  fresh service reconstruction of rebase Continue/Abort and inspector denial.
- `npm run build`: passed; existing dependency annotation and bundle-size warnings remain.
- Headless Electron desktop isolation/preload/commit smoke passed. The F38 Electron
  workflow passed with independent Git assertions for Cancel, Start, Sync, Finish,
  topic retention, stale-state rejection and Refresh, dirty-state execution guards,
  Escape dismissal, plus unknown-session rejection.
- Compared `test-results/f38-menu.png`, `f38-start.png`, `f38-start-dark.png` and
  `f38-finish-narrow.png` with catalogue screen-0038. The last capture uses 780×650.
  `f38-dirty-main-menu-light.png` also matches the original dirty-main menu state.
  Existing New Tag/Checkout extensions remain around the captured action order.
  Dark fields were corrected to use the shared dialog styles; dialog contents are
  an independent design because their Fork counterparts were not captured.

Resource policy inherits bounded reference reads (10,000 local branches), 15-second
read commands, checkout limits, ten-minute P06 replay jobs and bounded inert Activity
output. The base is selected from returned local branches, not a free-form revision.
All mutation tests use disposable repositories; no user repository was mutated.

Full Fork parity, automatic remote tracking-ref restoration, persisted base selection,
merge-preserving replay, cancellation during accepting hooks, native platform/scaling
variants and atomic protection from external Git processes are not claimed. A Sync
can leave the previously selected commit outside the visible history; the existing
history view exposes its unavailable-selection message until another commit is selected.
F38's local workflow is verified; F38 parity and the broader P12 phase remain partial.
