# Fork catalogue alignment — 2026-09-20

This audit makes the supplied Windows capture catalogue the primary behavioral and visual reference
for the existing Linux application. It refines the [feature surface](fork-public-surface.md) and
[implementation plan](../implementation-plan.md); it does not implement or complete a product phase.

Subsequent implementation: the user requested a single F01–F16 correction pass. Its
[implementation/verification record](../reviews/f01-f16-catalogue-corrections.md) now supersedes the
planned status and current-code descriptions in this historical audit for those completed corrections.
The original observations, topic coverage, unknowns and crosswalk remain unchanged.

Subsequent implementation: the bounded F17 text conflict slice is recorded in the
[conflict-helper handoff](../reviews/f17-conflict-helper.md). It maps P1-015–020 and P1-022 findings to
the current IPC, conflict service, Local Changes helper and disposable-repository tests. This updates
Git Workbench implementation coverage only; the catalogue's Fork capture status and case-level unknowns
remain unchanged.

Subsequent implementation: the bounded F18 interactive-rebase slice is recorded in the
[interactive-rebase handoff](../reviews/f18-interactive-rebase.md). It maps P1-023/P1-024 plan,
message and Edit/amend/continue findings to the typed plan IPC, controlled sequence-editor service,
history menu, plan dialog, Commit/Recovery state and disposable-repository/Electron tests. Merge
preservation, dependent-reference updates and captured option effects remain explicit limits; the
catalogue's Fork capture status and case-level unknowns remain unchanged.

Subsequent implementation: the bounded F19 history-operation slice is recorded in the
[history-operations handoff](../reviews/f19-history-operations.md), and the bounded F20 reflog/lost-commit
slice is recorded in the [reflog recovery handoff](../reviews/f20-reflog-recovery.md). F20 maps P1-028's
reflog mode, dimmed lost rows, Exit state, and Mixed Reset recovery to the typed history mode, bounded
Git service, existing operation/CAS reset path, and Electron verification. Reflog expiry and named
branch/tag recovery variants remain explicit limits; the catalogue's Fork capture status and case-level
unknowns remain unchanged.

Subsequent implementation: the bounded F21 file-history/Blame slice is recorded in the
[file-history and Blame handoff](../reviews/f21-file-history-blame.md). It maps P1-030's separate
timeline, revision cards and rename traversal, P1-031's blame groups and linked commit details, and
P1-033's Blame revision navigation to named committed-read IPC, separate owned inspector windows, and
disposable-repository/Electron verification. Directory/selected-code history, copies, restart persistence,
and general main-graph Back/Forward remain explicit limits; the catalogue's Fork capture status and
case-level unknowns remain unchanged.

Subsequent implementation: the bounded F22 worktree slice is recorded in the
[worktree handoff](../reviews/f22-worktrees.md). It maps `P2-001-create-remove-subcase:F1–F2` and
`P2-001-open-subcase:F1` to typed worktree topology reads, common-directory-serialized create/open/remove/
prune operations, occupied/current/dirty/locked guards, the Worktrees sidebar and linked tabs. Dirty and
locked presentation was not captured by Fork; the explicit force policy is a Linux-safe project adaptation.
Detached creation, lock/unlock, nested worktrees, and the broader P09 family remain explicit limits.

Subsequent implementation: the bounded F23 submodule slice is recorded in the
[submodule handoff](../reviews/f23-submodules.md). It maps `P2-002-clean-dirty-watcher-subcase:F1–F4`,
`P2-002-view-subcase:F1`, and `P2-002-missing-update-subcase:F1–F3` to typed recursive submodule reads,
parent HEAD/index/child revision comparison, dirty-child state, operation-backed lifecycle actions,
backend-resolved child tabs, and disposable/Electron verification. Successful local initialization is
an independent Linux result; Fork's captured local-transport failure remains unchanged. Nested mutation,
missing-object, interrupted-update/cancellation, conflict continuation, and broader tool/provider routes
remain explicit limits.

Subsequent implementation: the public-only F25 native Git-flow slice is recorded in the
[Git-flow handoff](../reviews/f25-git-flow.md). It maps the vendor's Git-flow feature-family claim and
the public feature/release/hotfix workflow specification to conventional `gitflow.*` config reads,
typed capability checks, ordinary-Git initialize/start/finish operations, annotated version tags, and
the Git-flow toolbar/menu/dialogs. Disposable Git and headless Electron tests complete one feature,
release, and hotfix lifecycle. Exact Fork defaults, private UI, remote publish/track/delete, topic rebase,
automatic stash/reapply, linked topic worktrees, and specialized conflict continuation remain public
gaps or deliberate bounded-slice limits; F38 Lean Branching remains separate from F25.

## Baseline, provenance and review limits

F31 implementation (2026-09-22): [Quick Launch handoff](../reviews/f31-quick-launch.md)
maps `P1-032:F1` (Windows 2.22.0.0, 2026-09-19, high-confidence captured UI) to grouped
commands/recent repositories, branch/tag selection, existing Rebase review and outside-click
dismissal. The public [2019-10-23 Quick Launch article](https://fork.dev/blog/posts/quick-launch/)
(retrieved 2026-09-22) supports Ctrl/Cmd+P, branch checkout and fuzzy file-history lookup.
Linux light/dark screenshots were compared with the original four case images. Accessible
HTML dialog, back/close buttons, shortcut/disabled hints, bounded HEAD-file enumeration and
the Unicode substring/subsequence ranking are independent adaptations. Exact Fork ranking,
empty-result behavior and other command outcomes remain catalogue unknowns; custom commands
remain F33. The private bundle is unchanged.

- Source: the user's private [bundle](fork-reference-new/START_HERE.md), especially the
  [implementation handoff](fork-reference-new/reference/catalogue/START_HERE.md),
  [design guide](fork-reference-new/reference/catalogue/DESIGN_GUIDE.md), original cases and linked PNG,
  public UI Automation (UIA), and ordinary Git snapshots.
- Baseline: Fork **Windows 2.22.0.0**, Windows 11 build 26200, captures on **2026-09-19–20**, predominantly
  **96 DPI**; catalogue prepared **2026-09-20**. Existing configured profiles were used. Current settings
  are not proven factory defaults, and Windows observations do not establish macOS or Linux behavior.
- Coverage: **82 topics, 147 cases, 275 findings, 541 unique case-linked screenshots**; **70 observed,
  11 partial, one blocked** topics. “Observed” means bounded research coverage, not complete feature
  behavior or Git Workbench implementation.
- Integrity rechecked on **2026-09-20**: all **7,295** entries in
  [BUNDLE_MANIFEST.json](fork-reference-new/BUNDLE_MANIFEST.json) matched SHA-256 and byte size
  (**212,007,834 bytes**). The catalogue's earlier seal counts **7,106** evidence files; that is a
  different inventory from the portable bundle manifest, which also includes the handoff/catalogue.
  Hash agreement verifies the supplied bundle's integrity, not independent reproduction of every trial.
- Review: all topic summaries, recorded findings and case unknowns; representative original screenshots
  at full resolution for shell, tabs, Appearance, Local Changes, menus, tags, resolver, rebase, diff popup,
  search, file history and images; selected original case/Git records; and relevant current source/tests.
  This is not an exhaustive visual inspection of all 541 images or a fresh run of Fork or Git Workbench.
- Keep the bundle unchanged and private/local. Its scripts, Windows paths, fixture recipes, process
  identifiers and input coordinates are historical capture material. Author implementation fixtures
  independently in TypeScript; do not replay the Windows harness, ship screenshots, or extract artwork.

For a claim, prefer the original case and its matching evidence over derived catalogue summaries.
Later successful subcases can resolve an early capture failure; they do not prove every variant.
Use **B-UI** for directly captured presentation and **B-Git** for a result supported by recorded repository
state. Retain **D/O** for public documentation/images and **I/U** for project decisions/unknowns.
A visible menu option establishes an entry point, not its successful effect. Preserve source conflicts.

## Corrections to existing assumptions

The finding IDs below identify the exact trial; linked dossiers expose original records and artifacts.
All changes in the last column are planned unless explicitly identified as existing behavior.

| Concern                   | Captured evidence                                                                                                                                                                                                                                                                                                                        | Current implementation or old assumption                                                                                                                                 | Required decision / owner                                                                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository navigation     | [P0-005](fork-reference-new/reference/catalogue/features/P0-005.md), `P0-005-tab-sidebar-subcase:F1`, `P0-005-shell-search-subcase:F1–F2`: optional Work-grouped repository list coexists with horizontal tabs. Appearance's Horizontal/Vertical labels belong to **Commit List Layout**.                                                | `App.tsx` renders mutually exclusive tab orientations; `RepositoryTabs.tsx` and the tab store encode that choice.                                                        | C01: additive repository list with shared selection/order; separate commit-layout preference. The alternate commit-layout outcome is still untested. Migrate existing settings without losing tabs; exclusive tabs, if retained, are a project extension. |
| Shortcuts and focus       | [P0-012](fork-reference-new/reference/catalogue/features/P0-012.md), `P0-012:F1`: Ctrl+0 HEAD, Ctrl+1 Local Changes, Ctrl+2 graph, Ctrl+Shift+D details. [P0-010](fork-reference-new/reference/catalogue/features/P0-010.md) displays Ctrl+Shift+G for New Tag; the later tag case uses that route.                                      | `App.tsx` uses Mod+1–9 for tabs and Mod+0 for zoom reset; New Tag has no binding.                                                                                        | C01: one command/shortcut map with tested precedence and Linux bindings. Preserve keyboard escape from the diff; the captured Tab trap is not an accessibility requirement.                                                                               |
| Local Changes state       | [P0-015](fork-reference-new/reference/catalogue/features/P0-015.md) and [P0-016](fork-reference-new/reference/catalogue/features/P0-016.md) distinguish unstaged/staged selection; [P0-025](fork-reference-new/reference/catalogue/features/P0-025.md) changes the visible count and header when hiding untracked/showing ignored files. | Separate lists and visibility controls exist. Full captured selection/count transition coverage is not recorded.                                                         | C02: verify selected side, count definition, empty states, active/inactive selection and action availability together. Do not replace status truth with the filtered visible count.                                                                       |
| Diff controls and popup   | [P0-027](fork-reference-new/reference/catalogue/features/P0-027.md): context 3→4→3, entire file, whitespace, wrap disabled in split; popup Down changes underlying file and Space closes. [P2-004](fork-reference-new/reference/catalogue/features/P2-004.md): explicit Load Diff.                                                       | `DiffViewer.tsx` has unified/split/search/whitespace; oversized results are messages. It has no equivalent context/full-file/wrap/popup/load workflow.                   | C02: add explicit bounded capabilities where needed and reusable diff presentation; popup layout can differ from main diff. Do not infer a universal large-file threshold from 60,000 lines.                                                              |
| Partial staging           | [P0-022](fork-reference-new/reference/catalogue/features/P0-022.md), `P0-022:F1`: staging only an addition leaves both old and new lines in the index. [P0-032](fork-reference-new/reference/catalogue/features/P0-032.md): hunk Stage preserves viewport and moves focus to the file row.                                               | Backend line selection and a repeated-selection regression already exist in `staging-service.ts` / `staging-service.test.ts`. Exact focus/viewport parity is unverified. | C02: keep the backend model; assert the intermediate index blob and inverse, plus UI selection/focus/scroll transitions. This is not evidence to rewrite working staging wholesale.                                                                       |
| Amend                     | [P0-031](fork-reference-new/reference/catalogue/features/P0-031.md): preview/cancel leaves Git unchanged; message-only merge amend preserves both parents and tree.                                                                                                                                                                      | Read-only amend preview is implemented.                                                                                                                                  | C02: map existing tests to the captured cases and add only missing behavior; retain hook/stale-state safeguards.                                                                                                                                          |
| Tags                      | [P1-004](fork-reference-new/reference/catalogue/features/P1-004.md), `P1-004-empty-message-tag-subcase:F3`: blank Message creates an annotated tag object.                                                                                                                                                                               | `contracts.ts` explicitly defines blank as lightweight; `reference-service.ts` and `ReferenceDialogs.tsx` implement it.                                                  | C03: correct blank-message creation across contract, backend, UI and tests. Existing lightweight tags remain readable; any explicit lightweight creation is a labeled extension, not an inferred Fork route.                                              |
| Checkout                  | [P1-002](fork-reference-new/reference/catalogue/features/P1-002.md): clean checkout has no intervening dialog. [P1-003](fork-reference-new/reference/catalogue/features/P1-003.md): dirty choice, refusal, reapply conflict/success and tracked discard.                                                                                 | The stabilization supplies explicit policies and recovery copies, including broader untracked scope.                                                                     | C03: reconcile trigger/selected-state behavior; retain exact scope preview and recovery as deliberate product protections. Captured initial choices vary; untracked/staged discard and index-restoration parity are unknown.                              |
| Merge                     | [P1-006](fork-reference-new/reference/catalogue/features/P1-006.md): FF, No-FF, Squash, Don't Commit; selected mode retained across sampled repositories.                                                                                                                                                                                | `MergeRebaseDialog.tsx` offers source/destination/autostash, without the four merge modes.                                                                               | C04: backend-owned merge-mode enum, preflight and separate ancestry/index/pending/message/finish tests. Do not conflate squash with a completed merge commit.                                                                                             |
| Stash new files           | [P1-013](fork-reference-new/reference/catalogue/features/P1-013.md), `P1-013-stage-new-files-subcase:F1`: initially unchecked **Stage new files** produces a two-parent stash with the new file in its index parent; ignored file stays out.                                                                                             | `StashDialogs.tsx` starts include-untracked checked; `repository-service.ts` constructs `stash push --include-untracked`.                                                | C03: align the option's meaning and resulting stash state, or explicitly retain a distinct include-untracked extension. Test preexisting index state; its restoration is not established by this Fork trial.                                              |
| Conflict helper           | [P1-016–019](fork-reference-new/reference/catalogue/features/P1-017.md): side cards, two source panes above an editable result, 0/1→1/1, disabled→enabled Resolve, stage then complete.                                                                                                                                                  | Recovery supports external editing and continuation; no full helper. Original plan could be read as requiring three visible source panes plus result.                    | C04: keep base/ours/theirs as backend data; target two visible inputs plus result, with operation-specific labels and separate Resolve/Continue transitions.                                                                                              |
| Interactive rebase        | [P1-023](fork-reference-new/reference/catalogue/features/P1-023.md): newest-first plan, connectors/drop styling, combined messages; Edit pauses detached and automatically enters Amend before Continue.                                                                                                                                 | P07 only had broad action coverage.                                                                                                                                      | C04/P07: specify plan order, message composition, pause/edit/amend/continue and exact final graph. Backup/dependent-branch checkboxes were visible but not exercised.                                                                                     |
| Activity and cancellation | [P1-011](fork-reference-new/reference/catalogue/features/P1-011.md) reports canceled while still canceling; [P1-022](fork-reference-new/reference/catalogue/features/P1-022.md) reports succeeded alongside a Git conflict.                                                                                                              | Queryable jobs and process-group cancellation are already project behavior.                                                                                              | C03/C04: represent requested cancellation, terminal process outcome and unfinished Git operation separately. Do not reproduce misleading success labels or infer accepting-remote cancellation from a rejecting hook.                                     |
| Search and navigation     | [P1-029](fork-reference-new/reference/catalogue/features/P1-029.md): separate results and graph match highlights; Message/Author/Path/Diff Content with Repository/Current Branch scope. [P1-033](fork-reference-new/reference/catalogue/features/P1-033.md): Back/Forward is verified in Blame only.                                    | Message sidebar search exists; remaining scopes and inspector windows are absent. General graph history was unresolved.                                                  | C05: implement explicit query scope, graph highlighting, rename-aware History/Blame and bounded inspector navigation. Hash search/general graph history remain independent extensions unless separately sourced.                                          |
| Patch import              | [P2-005](fork-reference-new/reference/catalogue/features/P2-005.md): location/applicability dialog, no content preview in this route; mixed patch applies exactly to index and worktree, Cancel changes nothing.                                                                                                                         | P08's “preview” could imply an observed patch-content browser.                                                                                                           | C05: require applicability preflight and exact apply/Cancel/error behavior. Any content preview is an enhancement.                                                                                                                                        |
| Restart                   | [P2-015](fork-reference-new/reference/catalogue/features/P2-015.md): tabs/order/active repo/window/sidebar persist; selected commit/detail view/horizontal divider reset in the measured trial.                                                                                                                                          | Plan promises general pane/tab restoration; profile-local pane persistence already exists.                                                                               | C01: adopt an explicit per-state policy; durable drafts/recovery remain project requirements. Preserve useful pane persistence as a documented deviation, not a Fork claim.                                                                               |
| Missing surface family    | [P0-008](fork-reference-new/reference/catalogue/features/P0-008.md), `P0-008-toolbar-dropdown-subcase:F1`: Lean Branching Start/Sync/Finish entry points.                                                                                                                                                                                | No dedicated feature family; Git-flow alone is not equivalent.                                                                                                           | Add F38, with P06/P12 ownership. Visible inventory is captured; outcomes require further evidence or an explicitly independent specification before parity claims.                                                                                        |

## Design methodology inferred from the captures

These are **I** implementation principles derived from **B-UI** states, not claims about Fork's private
design process, internal widgets or architecture.

1. **Keep repository context stable.** Title/menu row, compact icon-over-label toolbar, central
   repository/branch/activity region and horizontal tabs form the shell. The optional repository list
   sits outside the repository navigation tree. Local Changes and All Commits replace the content region
   while retaining navigation. Use [P0-003](fork-reference-new/reference/catalogue/features/P0-003.md),
   [P0-005](fork-reference-new/reference/catalogue/features/P0-005.md) and
   [P0-014](fork-reference-new/reference/catalogue/features/P0-014.md) as distinct states.
2. **Make selection determine the next action.** List side, selected hunk/lines, current branch, root
   commit and unfinished operation determine labels and availability. Active blue selection, inactive
   gray selection, hover, text selection and validation states require separate comparisons. Share
   command availability across menus, toolbar, shortcuts and Quick Launch; test the repository outcome.
3. **Use compact action dialogs and larger inspection windows.** Observed action forms use a heading,
   short explanation, target summary, aligned fields/options, inline feedback and affirmative/Cancel
   actions. Tag is 590×315; Merge 560×225; Checkout 500×219 in sampled 96-DPI trials. Resolver, interactive
   rebase and History/Blame use approximately 1020×720 workspaces; diff popup has its own large viewport.
   These are comparative measurements, not fixed CSS sizes or responsive rules.
4. **Keep controls close to their content.** Thin file/diff toolbars, inline hunk/line actions, paired
   source/result cards and a composer beneath the diff avoid separating the action from its target.
   Reuse diff and commit-detail presentation across history, changes, popup, file history and rebase,
   while giving each view its own selection and layout state.
5. **Model workflow transitions explicitly.** Preview, disabled action, validation, running, cancellation
   requested, failure, conflict, staged resolution and final completion are different states. A Resolve
   action changes index/worktree; a subsequent Commit/Continue changes history. Captured Activity labels
   are not authoritative proof of either.
6. **Treat persistence as a state table.** In-session file/view/repository/layout switching retains the
   sampled diff location; restart is a separate contract. Theme, pane position, selected file, focused
   control, selected commit, draft and pending Git operation should not share one blanket retention rule.
7. **Extract proportions and states before tokens.** The catalogue has 14 structured measurements plus
   prose/UIA dimensions. A 40px toolbar and 23px menu rows are sampled 96-DPI measurements. Exact font
   family, palette, graph columns and fractional-scale behavior remain incomplete. Use independently
   authored tokens and icons, and compare matching theme, viewport and focus. Never derive a global
   minimum from the smallest tested window or treat invisible Windows frame margins as client pixels.

## Deliberate Linux/product adaptations

- Preserve isolated Electron/preload/main boundaries, validated capabilities and repository ownership.
  A separate inspector requires a bounded owner/target identity and exact teardown, not a generic window
  or command executor. Repository text stays inert; image/LFS work needs a safe asset path.
- Keep recovery copies, stale-state checks, explicit destructive scope and lease-checked force push.
  Their safety policy is independently specified even where Fork's captured route uses fewer prompts.
- Keep rebase Skip as an explicit Git Workbench recovery capability if useful; it is not verified Fork UI.
  Do not mislabel a conflict as success, a pending cancellation as terminated, or a bisect result as failure.
- Make small windows and keyboard focus usable. Do not reproduce severe clipping or the captured diff
  focus trap. Windows frame behavior, executable paths, shell defaults and protocol restrictions are
  not Linux requirements. Native Wayland frame verification remains separate from headless UI checks.
- Preserve useful current pane persistence and durable drafts/recovery. Match the captured restart
  selection of HEAD/Commit unless a documented project preference says otherwise; never discard a draft
  merely to match a clean capture. Defaults not established by the bundle must be labeled project defaults.
- Retain public-only targets: manager automation, graph-collapse details, Git-flow, signing, hosted
  accounts/PRs/notifications, LFS locks/authenticated transfers, richer custom commands and AI adapters.
  They remain planned and individually sourced; the catalogue neither proves nor removes them.

## Settings scope clarification — 2026-09-22

F34/P12 now explicitly requires **global application settings** and **repository settings**, each still
planned, not implemented. P0-013's crosswalk entry covers the captured global Preferences inventory;
it must not be treated as evidence for a repository settings dialog or completion of either surface.

Evidence: `P0-013-general-git-subcase:F1–F4` (Windows 2.22.0.0, 2026-09-19; high confidence for the
visible tabs/global-user fields and no-edit Git invariance). The
[Windows 1.30 release notes](https://git-fork.com/releasenoteswin) (2019-03-22) establish Repository
Settings; [Mac 1.0.75 notes](https://git-fork.com/releasenotes) (2019-03-14) establish repository
bugtracker configuration. Public sources checked 2026-09-22; high confidence for those bounded claims,
not the Windows 2.22 repository field inventory. No new catalogue capture topic is invented.

The [surface record](fork-public-surface.md#application-and-repository-settings) retains unknowns.
The [P12 settings deliverables](../implementation-plan.md#f34-application-settings-and-repository-settings--planned-not-implemented)
specify Linux scope/inheritance, persistence, validation, configuration isolation and worktree tests
as independent requirements. Save/cancel behavior, exact repository fields and pristine defaults need
further evidence or an explicit product decision. No phase or feature completion status is promoted.

## Complete topic-to-implementation crosswalk

Capture IDs `P0-…/P1-…/P2-…` are **research topics**, distinct from project phases `P00–P14`.
`F01–F38` are feature families; `C01–C06` are the plan's correction sequence within those phases.
The Capture column below is copied from the catalogue and is never project completion status.
Existing implemented slices remain partial; new corrections require their own verification record.

| Topic                                                               | Capture  | Feature family | Phase / correction  | Reconciliation requirement                                                                                                                                                               |
| ------------------------------------------------------------------- | -------- | -------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [P0-001](fork-reference-new/reference/catalogue/features/P0-001.md) | partial  | F34            | P12 / C01           | Version baseline only; first launch and installation provenance remain unknown.                                                                                                          |
| [P0-002](fork-reference-new/reference/catalogue/features/P0-002.md) | partial  | F01, F02       | P02 / C01           | Opening is captured; pristine empty-manager behavior remains a separate requirement.                                                                                                     |
| [P0-003](fork-reference-new/reference/catalogue/features/P0-003.md) | partial  | F04, F07, F34  | P03 / C01           | Match shell composition and measured viewport; do not invent exact graph columns.                                                                                                        |
| [P0-004](fork-reference-new/reference/catalogue/features/P0-004.md) | observed | F03            | P02 / C01           | Open/switch/close/reopen and actual reorder; restored tab selects HEAD in the trial.                                                                                                     |
| [P0-005](fork-reference-new/reference/catalogue/features/P0-005.md) | partial  | F03, F34       | P02, P12 / C01      | Additive repository list; distinguish Commit List Layout from repository navigation.                                                                                                     |
| [P0-006](fork-reference-new/reference/catalogue/features/P0-006.md) | observed | F12, F34       | P03 / C01           | Slash hierarchy and selection navigate without checkout.                                                                                                                                 |
| [P0-007](fork-reference-new/reference/catalogue/features/P0-007.md) | observed | F07            | P03 / C01           | Parent links, selected revision and Changed Files; second-parent variants still need tests.                                                                                              |
| [P0-008](fork-reference-new/reference/catalogue/features/P0-008.md) | partial  | F34, F38       | P12 / C01           | State-specific menu inventory, workspace and Lean Branching entries; effects partly unknown.                                                                                             |
| [P0-009](fork-reference-new/reference/catalogue/features/P0-009.md) | observed | F13, F14, F34  | P12 / C01           | Hover and tooltip states; quick-operation modifier effects are not exercised.                                                                                                            |
| [P0-010](fork-reference-new/reference/catalogue/features/P0-010.md) | partial  | F12, F18, F34  | P03, P12 / C01      | Root/current/noncurrent/file/tab menus and disabled states; no universal enablement rule.                                                                                                |
| [P0-011](fork-reference-new/reference/catalogue/features/P0-011.md) | observed | F34            | P03, P12 / C01      | Splitter constraints and content scrolling; bounds are specific to the capture.                                                                                                          |
| [P0-012](fork-reference-new/reference/catalogue/features/P0-012.md) | partial  | F34            | P12 / C01           | Resolve view/tab/zoom shortcut collisions; accessible focus with documented deviations.                                                                                                  |
| [P0-013](fork-reference-new/reference/catalogue/features/P0-013.md) | partial  | F33, F34       | P12 / C01           | Preference inventory and current settings; no pristine-default claim.                                                                                                                    |
| [P0-014](fork-reference-new/reference/catalogue/features/P0-014.md) | observed | F08            | P04 / C02           | Navigation plus stacked file lists, diff and composer.                                                                                                                                   |
| [P0-015](fork-reference-new/reference/catalogue/features/P0-015.md) | observed | F08, F09       | P04 / C02           | Unstaged selection controls diff and Stage/Unstage availability.                                                                                                                         |
| [P0-016](fork-reference-new/reference/catalogue/features/P0-016.md) | observed | F08, F09       | P04 / C02           | Staged selection controls diff and Stage/Unstage availability.                                                                                                                           |
| [P0-017](fork-reference-new/reference/catalogue/features/P0-017.md) | observed | F08, F10       | P04 / C02           | One partially staged path appears in both lists with separate diffs.                                                                                                                     |
| [P0-018](fork-reference-new/reference/catalogue/features/P0-018.md) | observed | F10            | P04 / C02           | Whole-file Stage changes only chosen index entry and advances file selection.                                                                                                            |
| [P0-019](fork-reference-new/reference/catalogue/features/P0-019.md) | observed | F10            | P04 / C02           | Whole-file Unstage preserves worktree and unrelated index entries.                                                                                                                       |
| [P0-020](fork-reference-new/reference/catalogue/features/P0-020.md) | observed | F10            | P04 / C02           | Hunk Stage retains preexisting staged edits and other unstaged hunks.                                                                                                                    |
| [P0-021](fork-reference-new/reference/catalogue/features/P0-021.md) | observed | F10            | P04 / C02           | Inverse hunk Unstage restores prior index state.                                                                                                                                         |
| [P0-022](fork-reference-new/reference/catalogue/features/P0-022.md) | observed | F10            | P04 / C02           | Insertion-only selection differs from a replacement; test index bytes and inverse.                                                                                                       |
| [P0-023](fork-reference-new/reference/catalogue/features/P0-023.md) | observed | F10            | P04 / C02           | File/hunk discard confirmation, Cancel, retained unrelated edits and next selection.                                                                                                     |
| [P0-024](fork-reference-new/reference/catalogue/features/P0-024.md) | observed | F10            | P04 / C02           | Select-all file staging; subset selection remains a project test requirement.                                                                                                            |
| [P0-025](fork-reference-new/reference/catalogue/features/P0-025.md) | observed | F08            | P04 / C02           | Visibility options change list, header annotation and visible count without Git mutation.                                                                                                |
| [P0-026](fork-reference-new/reference/catalogue/features/P0-026.md) | observed | F09, F27       | P04, P10 / C02      | Rename-only blank diff, deletion and paired binary metadata cards.                                                                                                                       |
| [P0-027](fork-reference-new/reference/catalogue/features/P0-027.md) | observed | F09            | P04 / C02           | Context, entire file, whitespace, wrap, split and selection-linked popup.                                                                                                                |
| [P0-028](fork-reference-new/reference/catalogue/features/P0-028.md) | observed | F09, F34       | P04 / C02           | Fixed gutter, linked scrolling and bounded in-session position retention.                                                                                                                |
| [P0-029](fork-reference-new/reference/catalogue/features/P0-029.md) | observed | F11            | P04 / C02           | Empty staging/message disables Commit; clean-state variants need local tests.                                                                                                            |
| [P0-030](fork-reference-new/reference/catalogue/features/P0-030.md) | observed | F11            | P04 / C02           | Commit enablement, file count, clearing and exact remaining unstaged state.                                                                                                              |
| [P0-031](fork-reference-new/reference/catalogue/features/P0-031.md) | observed | F11            | P04 / C02           | Amend preview/cancel is read-only; message-only merge amend preserves tree and parents.                                                                                                  |
| [P0-032](fork-reference-new/reference/catalogue/features/P0-032.md) | observed | F10, F34       | P04 / C02           | Partial-hunk action retains viewport, clears highlight and moves focus to file row.                                                                                                      |
| [P1-001](fork-reference-new/reference/catalogue/features/P1-001.md) | observed | F12            | P05 / C03           | Create/rename/delete forms and validation; sampled checkout option is unchecked.                                                                                                         |
| [P1-002](fork-reference-new/reference/catalogue/features/P1-002.md) | observed | F12            | P05 / C03           | Clean branch checkout acts immediately; separate it from dirty-checkout preflight.                                                                                                       |
| [P1-003](fork-reference-new/reference/catalogue/features/P1-003.md) | observed | F12, F16       | P05, P06 / C03      | Dirty refusal, reapply conflict/success and tracked discard; unknown untracked scope.                                                                                                    |
| [P1-004](fork-reference-new/reference/catalogue/features/P1-004.md) | partial  | F12            | P05 / C03           | Empty annotation still creates annotated tag; details/delete; lightweight route unknown.                                                                                                 |
| [P1-005](fork-reference-new/reference/catalogue/features/P1-005.md) | observed | F12            | P05 / C03           | Detached warning, graph emphasis and return to branch.                                                                                                                                   |
| [P1-006](fork-reference-new/reference/catalogue/features/P1-006.md) | observed | F16            | P06 / C04           | FF, No-FF, Squash and Don't Commit have different parent/index/pending outcomes.                                                                                                         |
| [P1-007](fork-reference-new/reference/catalogue/features/P1-007.md) | observed | F13            | P05 / C03           | Edit Remote and Test Connection; add/rename/delete effects need independent tests.                                                                                                       |
| [P1-008](fork-reference-new/reference/catalogue/features/P1-008.md) | observed | F13, F14       | P05 / C03           | Stale-ref fetch and badges; automatic-fetch interval remains public-only evidence.                                                                                                       |
| [P1-009](fork-reference-new/reference/catalogue/features/P1-009.md) | observed | F13, F16       | P05, P06 / C03      | Merge/rebase Pull; dirty and conflict variants remain explicit test scope.                                                                                                               |
| [P1-010](fork-reference-new/reference/catalogue/features/P1-010.md) | observed | F13            | P05 / C03           | Push/upstream setup/rejection; force option presence does not prove lease semantics.                                                                                                     |
| [P1-011](fork-reference-new/reference/catalogue/features/P1-011.md) | observed | F14            | P01, P05 / C03      | Cancel-requested versus terminal state; delayed rejecting receiver is a bounded trial.                                                                                                   |
| [P1-012](fork-reference-new/reference/catalogue/features/P1-012.md) | observed | F01, F13       | P02, P05 / C03      | Local Clone form, Test Connection, progress and opening; authentication unobserved.                                                                                                      |
| [P1-013](fork-reference-new/reference/catalogue/features/P1-013.md) | observed | F15            | P06 / C03           | Stage new files changes stash index-parent shape; audit current include-untracked policy.                                                                                                |
| [P1-014](fork-reference-new/reference/catalogue/features/P1-014.md) | observed | F15            | P06 / C03           | Inspect/apply with optional deletion and confirmation; rename outcome unobserved.                                                                                                        |
| [P1-015](fork-reference-new/reference/catalogue/features/P1-015.md) | observed | F15, F17       | P06 / C04           | Conflicted pop retains stash; side choice stages result without advancing HEAD.                                                                                                          |
| [P1-016](fork-reference-new/reference/catalogue/features/P1-016.md) | observed | F17, F34       | P06 / C04           | Operation banner, file conflict cards and prepared message.                                                                                                                              |
| [P1-017](fork-reference-new/reference/catalogue/features/P1-017.md) | observed | F17            | P06 / C04           | Two source panes over editable result, resolution count and disabled Resolve.                                                                                                            |
| [P1-018](fork-reference-new/reference/catalogue/features/P1-018.md) | observed | F17            | P06 / C04           | Choose side enables Resolve; writing/staging clears unmerged entries.                                                                                                                    |
| [P1-019](fork-reference-new/reference/catalogue/features/P1-019.md) | observed | F16, F17       | P06 / C04           | Commit resolved merge with two expected parents and cleared banner.                                                                                                                      |
| [P1-020](fork-reference-new/reference/catalogue/features/P1-020.md) | observed | F16, F17       | P06 / C04           | Abort confirmation/Cancel and verified restoration; unrelated-edit variant remains.                                                                                                      |
| [P1-021](fork-reference-new/reference/catalogue/features/P1-021.md) | observed | F16            | P06 / C04           | Ordinary rebase target, resulting ancestry and content.                                                                                                                                  |
| [P1-022](fork-reference-new/reference/catalogue/features/P1-022.md) | partial  | F16, F17       | P06 / C04           | Continue/Abort and empty-result continuation; explicit GUI Skip remains unknown.                                                                                                         |
| [P1-023](fork-reference-new/reference/catalogue/features/P1-023.md) | observed | F18            | P07 / C04           | Newest-first plan, actions, combined messages, Edit/amend/continue.                                                                                                                      |
| [P1-024](fork-reference-new/reference/catalogue/features/P1-024.md) | observed | F18            | P07 / C04           | Later plan-execution case resolves earlier input failure; verify rewritten messages/graph.                                                                                               |
| [P1-025](fork-reference-new/reference/catalogue/features/P1-025.md) | observed | F19, F17       | P06 / C04           | Cherry-pick success/conflict/abort with author/message and parent checks; bounded implementation is traced in the [F19 handoff](../reviews/f19-history-operations.md).                   |
| [P1-026](fork-reference-new/reference/catalogue/features/P1-026.md) | observed | F19, F17       | P06 / C04           | Revert success/conflict/abort; use operation-specific side labels; bounded implementation is traced in the [F19 handoff](../reviews/f19-history-operations.md).                          |
| [P1-027](fork-reference-new/reference/catalogue/features/P1-027.md) | observed | F19            | P06 / C04           | Soft/Mixed/Hard reset with exact HEAD/index/worktree assertions; retain project safeguards; bounded implementation is traced in the [F19 handoff](../reviews/f19-history-operations.md). |
| [P1-028](fork-reference-new/reference/catalogue/features/P1-028.md) | observed | F20            | P08 / C05           | Lost-commit graph mode and recovery, including Exit.                                                                                                                                     |
| [P1-029](fork-reference-new/reference/catalogue/features/P1-029.md) | observed | F06            | P03, P08 / C05      | Search scopes, separate result list and graph highlights; other matching rules unknown.                                                                                                  |
| [P1-030](fork-reference-new/reference/catalogue/features/P1-030.md) | observed | F21            | P08 / C05           | Separate history timeline, revision cards and rename traversal.                                                                                                                          |
| [P1-031](fork-reference-new/reference/catalogue/features/P1-031.md) | observed | F21            | P08 / C05           | Blame groups and separate historical commit details.                                                                                                                                     |
| [P1-032](fork-reference-new/reference/catalogue/features/P1-032.md) | observed | F31            | P12 / C05           | Quick Launch command to parameter chooser to existing action dialog.                                                                                                                     |
| [P1-033](fork-reference-new/reference/catalogue/features/P1-033.md) | partial  | F07, F21       | P03, P08 / C05      | Parent/HEAD navigation and Blame Back/Forward; no general graph history claim.                                                                                                           |
| [P2-001](fork-reference-new/reference/catalogue/features/P2-001.md) | observed | F22            | P09 / C05           | Worktree create/open/remove; occupied branch and current-worktree action states. Bounded implementation is traced in the [F22 handoff](../reviews/f22-worktrees.md).                     |
| [P2-002](fork-reference-new/reference/catalogue/features/P2-002.md) | observed | F23            | P09 / C05           | Revision cards, dirty child and child tab; Update failure does not prove successful init.                                                                                                |
| [P2-003](fork-reference-new/reference/catalogue/features/P2-003.md) | observed | F27            | P10 / C05           | Side-by-side, swipe and onion skin; pixel comparison stays public-only.                                                                                                                  |
| [P2-004](fork-reference-new/reference/catalogue/features/P2-004.md) | observed | F09, F27       | P04 / C02           | Explicit Load Diff for large text; threshold and timing remain unknown.                                                                                                                  |
| [P2-005](fork-reference-new/reference/catalogue/features/P2-005.md) | observed | F15, F36       | P08 / C05           | Export and applicability preflight; Cancel and exact staged add/edit/rename result.                                                                                                      |
| [P2-006](fork-reference-new/reference/catalogue/features/P2-006.md) | observed | F26            | P08 / C05           | Bisect good/bad/skip/abort; report first-bad result as success despite captured error dialog.                                                                                            |
| [P2-007](fork-reference-new/reference/catalogue/features/P2-007.md) | observed | F09, F34       | P04, P14 / C02, C06 | Unicode/CRLF/long-line presentation; platform limits and normalization stay explicit.                                                                                                    |
| [P2-008](fork-reference-new/reference/catalogue/features/P2-008.md) | observed | F32            | P12 / C05           | Contextual command editor and bounded output; variables/forms/errors need local tests.                                                                                                   |
| [P2-009](fork-reference-new/reference/catalogue/features/P2-009.md) | observed | F33            | P12 / C05           | External tool configuration and historical blob handoff; full merge invocation unverified.                                                                                               |
| [P2-010](fork-reference-new/reference/catalogue/features/P2-010.md) | observed | F35            | P13 / C05           | Statistics and treemap composition; define metric/date/tile rules independently.                                                                                                         |
| [P2-011](fork-reference-new/reference/catalogue/features/P2-011.md) | observed | F24            | P10 / C05           | Local initialization and historical Save As; exact pointer/hash preservation is in the [F24 handoff](../reviews/f24-lfs.md); remote/auth/locks/push remain open.                         |
| [P2-012](fork-reference-new/reference/catalogue/features/P2-012.md) | observed | F34            | P12 / C01           | Light/dark switch preserves sampled layout and selection.                                                                                                                                |
| [P2-013](fork-reference-new/reference/catalogue/features/P2-013.md) | observed | F34            | P12, P14 / C01, C06 | Resize constraints and clipping evidence; provide usable Linux minimum/overflow.                                                                                                         |
| [P2-014](fork-reference-new/reference/catalogue/features/P2-014.md) | blocked  | F34            | P14 / C06           | 125% Fork capture blocked; independently test Linux scaling.                                                                                                                             |
| [P2-015](fork-reference-new/reference/catalogue/features/P2-015.md) | observed | F03, F34       | P02, P12 / C01      | Explicit restart policy; tabs/window/sidebar persist, commit/detail/divider reset.                                                                                                       |
| [P2-016](fork-reference-new/reference/catalogue/features/P2-016.md) | observed | F08, F14       | P01, P02 / C02      | External file changes refresh; no watcher mechanism or latency inferred.                                                                                                                 |
| [P2-017](fork-reference-new/reference/catalogue/features/P2-017.md) | observed | F04            | P03, P14 / C01, C06 | Home/End and scroll on 351 commits; retain larger independent performance gate.                                                                                                          |

## Verification and remaining research

F32 checkpoint (2026-09-22): `P2-008-create-execute-remove-subcase:F1–F5` and
`P2-008-menu-subcase:F1` now map to a verified Linux editor/menu/run/output/remove workflow. The
repository Bash route preserves refs/index/status in temporary Git fixtures. Five target resolvers,
optional forms, direct process and HTTP(S) actions, disabled imports and versioned export are independently
specified and tested; they are not retroactively claimed as captured outcomes.

The original editor/Bash/output screenshots were inspected before styling and compared with local
`f32-editor-light.png`, `f32-editor-dark.png`, `f32-editor-narrow.png` and `f32-output-light.png`.
The captured list/editor/help structure, target/name/action controls and Details output remain; a
dedicated File-menu manager, inline editor/form controls, explicit enable/review, environment-based Bash
variables and responsive scrolling are deliberate Linux/product adaptations. The public Windows dark
action editor (TrackerWin 2807, 2026-06-22) and macOS UI controls editor (Tracker 2629, 2026-05-12),
both version-unstated, supplement the original Windows 2.22.0.0 evidence. Sources were checked 2026-09-22;
high confidence covers visible controls and release-note feature existence, not underlying semantics.
See the [source record](fork-public-surface.md#f32-contextual-custom-commands--2026-09-22) and
[F32 handoff](../reviews/f32-custom-commands.md) for tests, bounds and remaining asynchronous/format/platform gaps.

Before implementing a slice, choose its original case(s), inspect the exact screenshots, record the
preconditions and expected transitions, and link the implementation and tests to finding IDs. Compare
Git Workbench before/after captures using independently generated repositories. Assert Git content,
index stages, refs/parents and sequencer state independently of application DTOs. Verify Cancel and
unrelated-state preservation, not just the successful screenshot.

Keep a row per accepted correction: **case/finding → component/service → implemented states → test/manual
evidence → deviation/unknown**. The correction table above seeds ownership, not completion. F17's row is
the [dated handoff](../reviews/f17-conflict-helper.md), including the independent multi-region and
non-text tests and the retained stash/delete/rename/submodule limits. F18's row is the
[interactive-rebase handoff](../reviews/f18-interactive-rebase.md), including plan/action/message,
Edit/amend/continue, root, empty-commit, conflict-abort and local-recovery tests with merge-preservation
and dependent-reference limits retained.
For the remaining record see [GAPS.md](fork-reference-new/reference/catalogue/GAPS.md): first launch,
pristine empty manager, graph columns, exclusive vertical tabs, full menu/focus/default matrices,
lightweight-tag creation, explicit GUI rebase Skip, general graph Back/Forward and 125% DPI remain
partial/blocked. Observed topics also retain limits: manual/multi-region conflict editing, dirty
worktree removal, submodule initialization success, authenticated LFS/locks, force-push semantics,
network cancellation and metric definitions are not established by their simpler trials.

A 351-commit navigation capture is not a performance benchmark. The project's 100,000-commit/1,000-ref
baseline and Linux accessibility/scaling/restart/error tests remain acceptance gates. No runtime tests
were rerun for this documentation audit; earlier implementation verification records retain their dates.

Documentation validation (2026-09-20): all 82 topics appear exactly once in the crosswalk with their
catalogue status; the surface contains 38 unique F-items; cited finding IDs, local links/anchors and
reference-style links were checked after the F25 handoff update. Prettier and `git diff --check` pass.
F24's bounded local slice updates P10 to Partial and the public-only F25 bounded slice updates the
verified implementation record for P09; the phases remain partial. The supplied
bundle and preexisting `.gitignore` edits were preserved.

## F26 alignment checkpoint — 2026-09-22

Implemented `P2-006:F1` and `P2-006-skip-subcase:F1–F3` with high confidence for the recorded
Windows 2.22.0.0 workflow (capture 2026-09-19): Repository > Bisect, initially disabled Good,
checkout of a known-good revision, midpoint, Skip and immediate Abort restoring the original branch.
Compared original `screen-0482` with Linux midpoint/result screenshots. The banner occupies the strip
below repository tabs and exposes Bad/Good/Skip/Abort. Linux adds an explicit range row and links,
keeps neutral independently authored reference chips, and reports first-bad as a successful outcome.
Repeated-skip ambiguity and restart restoration are independent verified additions; captured
ambiguity remains unknown. [Git documentation](https://git-scm.com/docs/git-bisect), accessed
2026-09-22, supports their semantics. See the [F26 handoff](../reviews/f26-bisect.md) for tests and limits.

## F28 alignment checkpoint — 2026-09-22

F28 remains public-only signing scope. High-confidence captured anchors `P0-030:F1` and
`P1-004-empty-message-tag-subcase:F1–F3` (Windows 2.22.0.0, 2026-09-19/20) establish the existing
composer and annotated-tag form, including an empty annotation. Screens 0185 and 0232 and their
original cases/Git verification records were compared with the new Linux composer and tag screenshots.
The signing selector, repository key dialog and explicit verification row are independent additions;
the comparison does not turn them into observed Fork behavior.

[Fork Mac release notes](https://git-fork.com/releasenotes), accessed 2026-09-22, document GPG commit
signing in 1.0.58 (2017-10-23) and signed tags in 1.0.82 (2019-07-22). Confidence is high for these
Mac features, while exact Windows signing configuration and native prompts remain unknown.
[Git verification](https://git-scm.com/docs/git-verify-commit) and
[configuration](https://git-scm.com/docs/git-config) support the independent backend semantics.
The public image index was refreshed and consulted; no signing screenshot supplies stronger layout
evidence. No reference images were added to application assets. See the [F28 handoff](../reviews/f28-signing.md).

## F30 alignment checkpoint — 2026-09-22

Authenticated issue/PR lists and notifications have no original case/finding ID in the Windows
2.22.0.0 bundle. Consult the public evidence rather than inventing a captured state. The
[Windows release notes](https://fork.dev/releasenoteswin), accessed 2026-09-22, establish notifications
in 1.61 (2021-04-09), and author/assignee filters plus recent searches in 1.62 (2021-05-07), high
confidence for availability. Current exact UI behavior remains unknown.

Refreshed the public library (226 present) and inspected `site-imagenotifications.jpg` from the
[product page](https://fork.dev/) before styling. It is undated macOS/light imagery, unstated version,
medium confidence for repository/title/time grouping. Compared generated Linux light notification
and light/dark PR screenshots after implementation. Accounts navigation, explicit refresh/paging,
text-only entries, bounded session search history and filter forms are independently authored
adaptations, not observed Windows parity. There is no matching private screenshot for this state.
The implementation preserves the existing repository clone/browser workflows and copies no assets.

The [GitHub API sources and implementation record](fork-public-surface.md#f30-github-lists-and-notifications--2026-09-22)
define provider behavior and limitations. The [F30 handoff](../reviews/f30-hosting-activity.md) records
mock, Electron and live read-only verification. Automatic notifications, remote read-state actions,
other providers and persistent history remain separate scope; P11 remains partial.

## F29 alignment checkpoint — 2026-09-22

No authenticated hosting workflow is captured in the supplied catalogue. The relevant original
`P1-012-local-clone-subcase` JSON, screen-0295 (`clone-ready_e769d0`) and Git after-manifest were read
before implementation. Findings F1–F3 have high confidence for Windows 2.22.0.0 local clone only.
The existing URL/Parent Folder/Name/Test Connection/Clone form remains the final destination review;
the independently authored hosting browser supplies a credential-free URL and name.

For the public gap, `npm run research:references` restored/checked the 226-image index. The existing
`win-2026-07-31-trackerwin2826-1-preferences-dark.png` shows the account sidebar and separate
Account/Repositories tabs. Its source is [TrackerWin #2826](https://github.com/fork-dev/TrackerWin/issues/2826),
accessed 2026-09-22, Windows version unstated, medium confidence for layout. The new Linux account and
repository screens use that organization with independent styling and no copied icons or avatars.
Token-file import, storage choices and explicit Git-helper text are deliberate Linux adaptations;
the public screenshot does not establish them. No inaccurate green Online indicator or F30 notification
placeholder is reproduced. New screenshot comparisons are recorded in the [F29 handoff](../reviews/f29-hosting.md).

[Windows](https://git-fork.com/releasenoteswin) and [Mac](https://git-fork.com/releasenotes) release notes
(accessed 2026-09-22) provide the provider-specific availability evidence summarized in the
[public research](fork-public-surface.md#f29-github-account-and-repository-browser--2026-09-22).
GitHub REST and Electron safeStorage documentation supply independent implementation semantics.
OAuth, non-GitHub account setup and self-hosted servers remain explicit unknown/unimplemented scope;
neither this comparison nor the earlier PR browser handoff completes F29/P11.
