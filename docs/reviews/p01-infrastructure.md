# P01 — Git execution and operation infrastructure

Implementation date: 2026-09-22. Scope: all six P01 requirements and its four acceptance criteria,
including F14's infrastructure and Activity presentation. P05 provider/authentication coverage and
P14's native platform matrix remain separate. **Complete for the Linux baseline.**

## Reference and design

Primary reference: Fork **Windows 2.22.0.0**, recorded 2026-09-19/20 at 96 DPI, high confidence:

- `P1-011:F1`, original case `reference/cases/P1-011.json`, screenshots `screen-0291` and `screen-0292`:
  All/User/Background scopes, selected two-line rows, times, compact detail header and command/output.
- `P1-011-delayed-local-cancel-subcase:F1–F5`, original case JSON, screenshots `screen-0288` and
  `screen-0290`, `evidence/continuous17/git-verification.json` and before/after Git manifests:
  toolbar cancellation, retained partial output, eventual termination and unchanged rejecting remote.
  This does **not** establish cancellation before an accepting remote writes its refs.
- C03/C04: requested cancellation, process completion and remaining Git state are separate.
  The captured premature “canceled” row is deliberately not reproduced.

Linux follows that composition with independent controls: viewport-bounded 1044 × 455 Activity,
approximately 31% list / 69% detail, underlined scope tabs, blue selection, timestamps, scrolling output
and keyboard navigation. The previous 720 × 280 panel and filled scope buttons were compared before
editing. Captures: `test-results/p01-activity-{light,dark,narrow,cancelled}.png` and `p01-trust-light.png`
(git-ignored). Conflicts/pending operations return focus to Local Changes/Recovery; Activity retains
the record. Changing scopes or closing Activity does not cancel work.

Trust is an independent product requirement, not observed Fork behavior. Technical references consulted
2026-09-22: [Git configuration](https://git-scm.com/docs/git-config),
[Git environment/protocol controls](https://git-scm.com/docs/git),
[Node child processes](https://nodejs.org/api/child_process.html), and
[Windows taskkill](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill).

## Execution and trust

Git **2.43.0** is the minimum. Discovery resolves a regular executable file; Windows accepts native
EXE/COM files, not shell batch files. Diagnostics expose version, minimum and porcelain-v2/pathspec-file/
rebase-update-refs capabilities. Unsupported selections are refused with a Preferences recovery route.
LFS and other extensions retain separate capability checks.

Opening an existing repository permits bounded object/history/configuration reads. Working-tree reads
and executable operations require trust: even status can invoke a clean filter. Restricted reads disable
fsmonitor, external diff/textconv, signature display, maintenance, replacements, optional locks and
transports. An empty `GIT_ALLOW_PROTOCOL` prevents lazy fetching on the minimum Git; `GIT_NO_LAZY_FETCH`
also suppresses it on newer Git. Missing objects fail locally. No filter/config scan is followed by an
unsafe assumption that configuration stayed unchanged.

Trust Repository explains the executable-program boundary. The versioned atomic mode-0600 profile
store remembers up to 1,000 canonical common-directory/filesystem-identity grants. Linked worktrees
share a grant; replacing the common directory invalidates it. Corrupt data is preserved and fails
closed. Trust includes later hook/configuration changes until revoked in Repository Settings.
Revocation refuses while a job is active, serializes with short writes, invalidates reads and stops
background scheduling across worktrees. Trusted programs are not sandboxed.
Parent-repository operations may inspect/run programs in their submodules, as the trust dialog states;
opening a submodule as an independent repository uses its own grant. Linked-worktree reads resolve their
common directory before using its grant, and stale worktree rows are not shown under a different tab.

Newly initialized repositories and explicitly cloned new destinations are trusted as user-created
repositories; reinitializing an existing repository does not grant trust. Standalone Clone/Test Connection
use installed machine Git/credential tools as explicit application actions. Existing `ext::` refusal
remains. Git ownership checks are honored; the app never adds safe.directory entries or deletes locks.

The runner uses asynchronous argv-only spawning, normalizes inherited repository/config/pathspec/editor
overrides and disables trace destinations. Byte-bounded output and diagnostics redact URL/query credentials,
authorization headers and labeled secrets, and strip terminal controls. Live output waits for complete
lines so split credentials cannot leak across process chunks. IPC error logs retain the fixed channel
without private exception fields. Unlabeled secrets intentionally printed by a trusted program cannot
be recognized automatically.

## Lifetimes and coordination

Signalled reads share the six-process limit; identical ordinary reads coalesce, queued cancelled reads
never spawn, and shutdown aborts/drains reads. Read generations advance at mutation entry and exit.
Common-directory queues serialize linked-worktree writes; unrelated repositories progress independently.
A queued cancellation settles promptly while retaining the preceding write's serial barrier, without
executing its callback. Operation revisions and renderer owner/generation guards remain intact.

POSIX Git processes lead a group: TERM escalates to KILL after one second, and remaining group members
are killed even when the parent closes first. Windows uses native `taskkill /PID … /T /F` without a shell.
App quit aborts and drains work before exiting. Existing custom/external processes participate in the
same queue/job lifetime. Deliberately daemonized programs escaping the group remain outside the existing
waiting-tool contract; no OS sandbox is claimed.

Accepted jobs remain queryable after unsubscribing or renderer reload. “Cancelling…” lasts until work
settles; structured terminal results survive cancellation and the UI explains possible completed remote/
local changes. Nothing retries or promises rollback. Activity records are bounded and session-only;
actual sequencer/recovery state remains Git-owned and survives application restart.

## Verification

`tests/operation-fixture.ts`, the TypeScript process fixture, the P01 unit/Electron scenarios and existing
repository/network/registry suites cover normal/bare/linked repositories, merges, unusual paths, missing
executables, spawn/nonzero/output/timeout failures, descendant cleanup, trust, ownership, locks, missing
promisor objects, queue cancellation, independent work, shutdown, redaction and IPC validation.

- **95 tests passed on Git 2.43.0**, built from official source in a temporary directory. Local transports
  were used; the build omitted curl/OpenSSL development libraries. This verifies CLI/local compatibility,
  not HTTPS/provider behavior.
- Git 2.55.0, Linux x64, Node 24.13.0: `npm run check` passes **483 tests**, with one existing opt-in
  skip, including type/lint/format checks. `npm run build` passes. **13 distinct targeted headless Electron
  scenarios pass**: the 12-scenario P01/desktop/catalogue/conflict/network/rebase/submodule/worktree/CLI
  matrix, plus repeated application quit during a running Git hook. The final build reruns desktop and
  both P01 scenarios successfully. Repeated Quit waits for the hook/process group to stop, preserves HEAD
  and retains the staged file. Light/dark/narrow Activity and trust captures were inspected against the
  original reference states. Locale-specific date formatting is retained as an independent adaptation.
- The initial full Electron suite passed 25 scenarios, skipped one opt-in case and failed seven.
  Four P01 integration failures (conflict overlay, submodule inspection, stale worktree rows and the CLI
  test's old clean-status expectation) are corrected and pass the final targeted matrix. The remaining
  three reproduce on an untouched archive of baseline **27e403c**, built with the same lockfile/dependencies:
  `interaction-corrections` loses its automation session after closing a sibling inspector;
  `settings` loses the main-page session after closing its inspector; `quick-launch` either dismisses the
  file chooser during a context refresh or loses its main-page session after its inspector closes.
  The archive is `/tmp/git-workbench-p01-baseline-k8mObt`; its traces/error contexts remain in its
  `test-results/`. These P03/P12 or automation issues are not reported as passing or as P01 regressions.
- Native Windows/macOS runtime verification remains P14; credential/provider coverage remains P05.
  No window frame geometry changed, so native Wayland frame testing is unaffected. The catalogue's
  real-network/accepting-remote cancellation limits remain unknown.

All mutating tests use temporary repositories/profiles. The private catalogue is unchanged. No Fork
images/binaries enter the application and no historical capture harness was run.

## Window-close follow-up — 2026-09-22

The reported pair of `Object has been destroyed` dialogs came from one cleanup failure. The `closed`
handler retrieved `BrowserWindow.webContents` after native window destruction. That threw before the
window could be removed from the IPC registry; the application's subsequent `dispose()` retried the
same stale entry and raised the second dialog. Earlier close tests did not check for main-process error
dialogs and their mocks allowed the destroyed window's native getter to remain readable.

Registration now retains the WebContents emitter before destruction. Cleanup unregisters the window
and removes its exact listeners before closing children or cancelling services, and both per-window
cleanup and registry disposal are idempotent. State/activation publishing also guards destroyed renderers
and windows. No sender/frame, sandbox, or process-draining policy has changed.

Three unit regressions reproduce the old failure and cover destruction, renderer destruction before the
window, and reentrant disposal with owned inspectors. The new headless `window-close` scenarios close
one inspector while keeping a sibling usable, then close the main window via the title bar, native close,
or application Quit. They capture and fail on every uncaught exception/native error box and require a
clean process exit. The settings scenario now waits for its asynchronous browser handoff before checking
it, so that unrelated timing race does not prevent exercising inspector closure.

Verification: `npm run check` passes 486 tests (one existing opt-in skip), and `npm run build` passes.
The final headless run passes eight scenarios: desktop smoke, interaction/inspector lifecycle, settings,
both P01 workflows, and all three new close routes. The earlier interaction/settings inspector-close
failures are now resolved. The ninth scenario, Quick Launch, still hits its previously recorded file
chooser/context-refresh race (zero options while two are expected); it remains outside this close fix.
