# F01–F16 catalogue correction pass — 2026-09-20

The user's single implementation request covers corrections to F01 through F16 against the supplied
Windows 2.22.0.0 catalogue. This record distinguishes those verified corrections from the broader
feature-family backlog. F17's conflict editor, F18's interactive rebase and subsequent features are not
implemented by this pass. Existing security, operation queues, stale-state checks and independent
branding remain in place.

## Feature traceability

Case IDs link through the [catalogue alignment](../research/fork-catalogue-alignment.md#complete-topic-to-implementation-crosswalk)
to original observations, PNGs, UIA and Git evidence. Tests use independently authored disposable
repositories and profiles; the supplied evidence bundle is unchanged.

| Family | Captured correction / implementation                                                                                                                                                                                                                                                                          | Verification and retained limits                                                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01    | P1-012: Clone reviews URL/parent/name, tests the connection, reports a cancellable job and opens the resulting repository. An exclusive new destination prevents overwriting existing data; failure retains it for inspection. CLI and second-instance paths open without reloading the renderer.             | Foundation unit/Electron and lifecycle tests check source refs, destination tree/upstream, invalid/existing paths, ownership and relative launch paths. Standalone local sources must be absolute; remote authentication is delegated to installed tools.     |
| F02    | Existing bounded source-folder hierarchy/scanning retained; the manager refreshes automatically while visible and on focus, with an in-flight guard.                                                                                                                                                          | Existing source scan/topology tests remain. P0-002 does not establish a pristine manager. Custom manager folders, default-source preferences and cancellable scan jobs remain broader backlog.                                                                |
| F03    | P0-004/P0-005/P2-015: horizontal tabs remain alongside a toggled repository list. Drag/keyboard reorder, preceding-tab close, restart-persistent recently closed tabs and version-1 preference migration share the same session model. Normal window bounds/maximized state persist with off-screen recovery. | Foundation and lifecycle tests cover migration/order/close/reopen/restart and unchanged renderer on second-instance activation. Commit List Layout remains separate and unimplemented; no exclusive vertical-mode parity claim.                               |
| F04    | P0-003/P0-006/P2-017: reference/parent/HEAD selection does not checkout. Graph rows virtualize; Home/End and distant targets navigate directly to bounded page windows.                                                                                                                                       | History unit/Electron tests and the opt-in 100k-commit/1,002-ref benchmark. Browser paint/memory and the full Linux/display matrix remain unmeasured.                                                                                                         |
| F05    | Existing independent collapse projection retained and checked alongside paging/virtualization, including merges, octopus histories, multiple roots and parent connectivity.                                                                                                                                   | Graph/collapse/history regressions pass. No new Fork collapse trial exists in the catalogue; the original public evidence still applies.                                                                                                                      |
| F06    | P1-029: Message/Author/Path/Diff Content and Repository/Current Branch scopes; independent result list plus graph/message highlights; bounded direct result navigation.                                                                                                                                       | Search fixtures verify matching and no Git mutation; Electron exercises all four scopes. Non-message matching rules are independent literal policies. Recent queries and hash-search extension remain later work.                                             |
| F07    | P0-007/P1-033: merge changed files compare to first parent; unloaded parent links work; commit/detail/file/tree selection and scroll survive session switches. Restart selects HEAD/Commit.                                                                                                                   | Revision tests verify first-parent files and content; Electron checks cross-repository tree/blob retention and revision ownership. Separate History/Blame inspectors remain F21.                                                                              |
| F08    | P0-014–017/P0-025: selected staged/unstaged side drives diff/actions; partially staged paths occupy both lists. Hidden/untracked/ignored state changes list/header/visible count while raw tab dirtiness remains Git-derived.                                                                                 | Working-tree/selection fixtures and changes Electron tests; sidebar counts refresh when history is active.                                                                                                                                                    |
| F09    | P0-026–028/P2-004/P2-007: context/full-file/wrap/whitespace controls, fixed gutters, linked split scrolling, independent-layout popup, binary metadata, rename-only empty diff and explicit cancellable Load Diff. File/view/repository switches retain line anchors.                                         | Diff fixtures and changes Electron test, including a 60,000-line load, return-to-file opt-in, binary/rename states and popup Down/Space. Syntax highlighting and full rich-image viewers remain separate backlog.                                             |
| F10    | P0-018–024/P0-032: insertion-only staging preserves the old line in the index; partial hunk actions retain viewport and focus the source list. File/multi-file/hunk/line discard has read-only preview, snapshot validation, confirmation and durable recovery.                                               | Independent intermediate index assertions, inverse staging, stale rejection, Cancel invariance, unrelated work/index preservation and UI focus/selection tests. Discard covers tracked unstaged content; untracked deletion is not inferred from the capture. |
| F11    | P0-029–031: nonempty subject enablement, correct Amend Last Commit label, durable repository drafts and read-only amend cancellation. Message-only merge amend preserves tree and both parents.                                                                                                               | Existing commit/hook/template tests plus merge-amend and UI draft/reload/amend cases. Signing, co-author assistance, spell checking and commit-and-push remain their original broader scope.                                                                  |
| F12    | P1-001–005: blank-message tags are annotated; Tag Details, tag push and selected remote deletion are real workflows. Clean checkout starts directly after fresh-state review; dirty/detached checkout retains preflight. New Branch starts without checkout selected.                                         | Ref fixtures verify tag objects/metadata, partial remote failures, state guards and checkout refusals. Electron verifies blank annotation and tag details; a slow checkout still outlives the control deadline without affecting another tab.                 |
| F13    | P1-007–012: Test Connection for remote forms and Clone; existing fetch/pull/push/upstream/lease workflows retained. Explicit operations may use configured native askpass/credential tools without credentials crossing the renderer API.                                                                     | Local bare remotes, connection/clone, rejection/upstream and synthetic native-helper tests. Authenticated live provider services and a platform-by-platform credential UI matrix were not exercised.                                                          |
| F14    | P1-011: cancellation-requested stays running until process completion, is visible in toolbar/activity and disables repeated Cancel. Global automatic fetch persists independently of per-remote opt-outs. Background authentication suppresses standard interactive prompts.                                  | Registry/runner/scheduler/preference tests; POSIX cancellation escalates even after SIGTERM was sent. Arbitrary configured helper programs must honor their own noninteractive policy. No rollback is promised.                                               |
| F15    | P1-013–015: unchecked Stage new files produces two-parent stashes with new files in the index parent. Apply optionally deletes only after success; conflicts retain stash and unrelated untracked files. Rename and existing selected-file/export workflows remain bounded jobs.                              | Stash fixtures assert parent/index shape, exact restoration, failed-pop retention and rename content; Electron checks selected-file stash. Hunk/line stash and patch import/advanced export remain P08 scope.                                                 |
| F16    | P1-006/P1-019–022: Default FF, No-FF, Squash and Don't Commit have separate graph/index/pending outcomes. Paused squash survives restart; recovery respects unresolved index stages and operation-specific continuation/abort.                                                                                | Merge-mode matrix, recovery/commit fixtures and branch-menu Electron regression. Full conflict editing is F17. Explicit rebase Skip remains a project extension.                                                                                              |

## Cross-feature integration and adaptations

- Linux view shortcuts now use Ctrl+0 for HEAD, Ctrl+1 for Local Changes, Ctrl+2 for history and
  Ctrl+Shift+D for details. New Tag uses Ctrl+Shift+G. Numbered tabs use Ctrl+Alt+1–9 and zoom reset uses
  Ctrl+Alt+0 to avoid collisions. Menu labels and handlers share these bindings; menu accessible names
  exclude the visual shortcut text while retaining `aria-keyshortcuts`.
- A diff popup is a bounded modal inspector inside the application, with an independent layout and
  linked file selection. This is an explicit Linux adaptation of the captured separate window. Menus
  opened inside a modal are portaled into its top layer; focus returns on close.
- Text selection uses accessible added/removed-line controls instead of reproducing Fork's drag-text
  gesture. The selected-line Git outcome is verified independently of that presentation choice.
- Discard keeps stronger previews and recovery copies than the captured prompt. Operation results,
  sequencer state and requested cancellation remain separate. Captured misleading success labels and
  trapped focus/clipped controls are not copied.
- Normal restart restores tabs/list/window/sidebar and resets history selection/details to HEAD/Commit.
  Useful pane-size persistence and durable drafts/recovery remain product choices. Completed clone records
  cannot reopen intentionally closed tabs merely because a renderer reload rehydrates Activity.
- If an autostashed paused merge is completed through the composer, its recovery copy remains available
  for explicit Apply. Recovery Continue/Abort performs the reapply itself. No saved work is silently dropped.
- Automatic manager discovery uses bounded polling; this does not claim Fork's private watcher mechanism.
  The 15-second visible-manager refresh avoids overlapping scans. Repository reads remain bounded and
  generation/ownership guarded.

Resource limits are independent product policies: initial text diffs above 512 KiB or 10,000 lines require
Load Diff; the explicit load is bounded at 8 MiB/15 seconds and is not reused after leaving/reselecting the
file. Large fixed-height diff virtualization disables wrap above 2,000 rows. History location scans cap
at 200,000 commits/14 MiB/15 seconds and report a limit rather than silently pretending a distant target
does not exist. These values are not inferred Fork thresholds.

## Authentication sources and boundaries

Consulted 2026-09-20: [Git credentials](https://git-scm.com/docs/gitcredentials),
[OpenSSH askpass](https://man.openbsd.org/ssh.1), and
[Git Credential Manager environment](https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/environment.md#GCM_INTERACTIVE).
`GIT_TERMINAL_PROMPT=0` alone does not suppress graphical helpers. Silent operations mask inherited/core
askpass and set the supported SSH/GCM/noninteractive controls; explicit user network work can invoke the
user's installed tools. Existing cached credential helpers and SSH agents remain usable. Secrets are
not persisted by Git Workbench or carried in shared/renderer DTOs, so this pass introduces no secret store.
Arbitrary configured helper code remains subject to the outstanding repository-trust policy.

## Validation record

Verified on Linux x64, Node 24.13.0 and Git 2.55.0, on this host reporting an AMD Ryzen 9 7900X,
12 logical CPUs and 23 GiB RAM:

- `npm run check`: type checks, lint, full formatting check and **295 tests pass**. The single opt-in
  performance test is skipped in the routine suite and run separately below.
- `npm run test:e2e`: production build and **nine headless Electron scenarios pass**, covering original
  workflows plus catalogue foundation, history, Local Changes and real second-instance/restart behavior.
  The slow checkout regression still crosses the 15-second control deadline with a real hook.
- `HISTORY_BENCHMARK=1 npx vitest run tests/unit/history-performance.test.ts`: passes with **100,000
  commits and 1,002 refs**. Latest run: first query **276 ms**, warm **263 ms**, distant row-90k navigation
  **655 ms**, graph **64 ms**, collapse **108 ms**. Fixture-inclusive final RSS growth is **361 MiB**;
  sampled read/graph-work peak growth is **280 MiB**, with fixture generation reported separately.
  Both original 512 MiB limits remain enforced. These are backend/harness results, not browser budgets.
- The first full scale rerun exposed quadratic buffer copying in the Git runner. Bounded output now
  accumulates chunks and joins once; a multi-chunk UTF-8 regression protects byte integrity. Memory and
  timing diagnostics are printed before assertions, and the service/sampling timer are disposed.
- `git diff --check` passes. Original/final light/dark screenshots for the shell, search, Local Changes,
  popup, checkout, remote dialogs and Activity were inspected. Artifacts are under git-ignored
  `test-results/`; the private catalogue remains unchanged and is not imported by application code.

Original and final light/dark screenshots are compared by matching workflow, selected side and viewport.
Native Wayland moving/edge-resizing, multi-monitor physical behavior, Windows/macOS runtime and live
hosting authentication remain unverified. The Electron suite remains headless with the sandbox enabled.

## Interaction follow-up

Verified **2026-09-20**, following the user's three specific corrections to the preceding pass:

- **F09/F10 — hunk presentation:** P0-020's before/selected/after PNGs and
  `reference/specification/hunk-controls-batch04.json` show a quiet `@@` range line and an outlined
  changed-row region with inline Stage/Discard controls. The old permanent blue action header was
  incorrect. Range text now scrolls with the diff; a separate overlay appears on region hover or keyboard
  focus. It reserves no content row, stays within the viewport at far-right scroll positions, and keeps
  existing snapshot-validated action semantics. Full-file changed groups have independent controls;
  selected-line controls and the documented checkbox adaptation remain.
- **F07/F34 — commit details:** P0-011 documents vertical splitters; P0-012:F1 documents collapse to the
  tab strip and restoration; P1-031:F1 captures a separate commit-details window. The user's clarification
  establishes the requested main-pane pop-out entry point. The splitter now clamps to available height;
  visible Hide/Show and Pop Out buttons sit beside the tabs. Tab selection also expands a hidden pane.
  Pop Out opens a real, independently navigable read-only window retaining the selected revision, view
  and path. It survives closing its repository tab and closes with its owning window. Native frame
  appearance/window-manager interactions remain platform verification work.
- **F12/F15/F34 — toolbar split buttons:** P0-008's dropdown captures and P0-009's hover PNGs show the
  separate chevron regions. The user clarified primary-click semantics; the bundle does not independently
  exercise every primary route. Branch opens Create Branch and Stash opens Save Stash; their smaller
  right-hand buttons open the existing menus, with independent mouse/keyboard focus and disabled states.

`npm run check` passes **301 tests**, type checks, lint and formatting (the existing opt-in scale test
remains skipped in the routine suite). `npm run test:e2e` builds production bundles and passes **ten
headless scenarios**, including the new interaction regression. It checks hover versus hidden controls,
far-right scrolling with long range/content lines, actual staged bytes, pointer/keyboard resizing,
hide/restore height, both toolbar segments, commit/Changes/File Tree pop-outs, parent navigation,
renderer isolation, rejected child mutations, repository-tab independence and owner-close cleanup.
Focused policy/input tests verify the inspector allowlist and exact sender boundary. `git diff --check`
passes. Final screenshots (`hunk-hover-scrolled.png`, `commit-details-window.png` and existing light/dark
workflow captures) remain under git-ignored `test-results/`; catalogue files are unchanged.
