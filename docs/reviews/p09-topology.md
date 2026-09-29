# P09 — Worktrees, submodules and Git-flow

Date: 2026-09-29. Linux. This handoff supersedes the earlier bounded F22/F23/F25
implementation notes within P09's specified scope. Catalogue capture coverage and
unobserved Fork variants remain separate from implementation verification.

Status: **complete for P09's Linux scope**. The full-suite caveat below remains explicit.

## Delivered scope

| P09 requirement                                  | Implementation and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worktree lifecycle and shared references         | Local/remote-tracking create, detached-commit create, open, remove, prune and lock/unlock. Current/main removal stays unavailable. Linked tabs identify their parent; the sidebar groups linked directories under the parent when appropriate. Branch occupancy prevents conflicting checkouts. Tests assert retained branch tips, remote tracking, locked missing registrations, Cancel and tab cleanup.                                                                                                      |
| Safe worktree removal                            | The reviewed absolute path, branch, lock reason and dirty state remain visible. Force is explicit. Changed-file fingerprints invalidate a review even when the path count is unchanged. Nested worktree creation is refused; removal refuses unrelated nested repositories, substituted paths and uninspectable scopes.                                                                                                                                                                                        |
| Submodule lifecycle and nested status            | Add/init/update/sync/remove operate on the actual owning repository and relative gitlink. Recursive Add now performs add followed by update; Git does not accept the old add --recursive construction. Definitions are parsed correctly, NUL-delimited index/status reads preserve unusual paths, and an empty child directory cannot inherit the parent's HEAD. The sidebar represents a nested submodule once, with expandable descendants.                                                                  |
| Pointer comparisons and navigation               | Staged compares parent HEAD → index; unstaged compares index → child HEAD. Compact before/after author, hash, date and subject rows precede a real bounded child graph and ahead/behind counts. Dirty count and detached/missing state remain explicit. Open Submodule uses the backend-issued identity and parent: child tab label. Removing a child closes its affected tabs.                                                                                                                                |
| Missing commits and interrupted updates          | Update fetches missing objects and explicitly checks out the recorded gitlink at detached HEAD. Unavailable objects remain a failed job with the child checkout preserved. Network/recursive scope is reviewed before starting; Activity reports progress and supports cancellation. Native partial Git state is reread after interruption, and explicit Update resumes initialization. No locks are deleted or writes automatically retried.                                                                  |
| Submodule conflicts and removal                  | P06 source/working-gitlink resolution and Continue remain available across restart. Tests now verify the topology's unmerged index state before resolution and the chosen index/unchanged dirty child afterward. Removal previews the exact child and nested paths, includes ignored data in its force decision, rejects new changes after review and protects unrelated nested repositories.                                                                                                                  |
| Git-flow initialization and all three lifecycles | Conventional production/development and topic-prefix configuration now includes the version tag prefix. Feature finish updates develop only: the earlier implementation incorrectly also merged into production. Release/hotfix finish creates an annotated production tag, optionally merges into develop, and retains/deletes the topic as reviewed. Tests independently verify destinations, parent tips, tag object types, fast-forward and retention options, including execution from a linked worktree. |
| Git-flow interruption and capability checks      | A versioned atomic per-worktree finish journal records reviewed source/target IDs before mutation. Conflicts or interruption retain the topic and completed results. Continue validates the saved state, recognizes a completed command with the reviewed parents, and resumes the remaining steps after app restart. Stop Finish keeps existing history/tags and leaves any pending Git merge available in Recovery. Occupied destinations are checked before the first history change.                       |

The topology hooks distinguish read refreshes from active mutations and claim actions synchronously.
New Git-flow dialogs fetch a current review before freezing their snapshot. A subsequently changed
review is refused; reopening the dialog obtains a new review. Repository switching dismisses these
dialogs. A stopped or cancelled operation refreshes the actual repository state.

## Reference and visual comparison

Primary reference: supplied Fork **Windows 2.22.0.0**, Windows 11, primarily 96 DPI,
captured 2026-09-19–20; rechecked 2026-09-29. Original cases and linked Git records were read,
including the worktree before/removed manifests and refs, parent dirty status/patch and the failed
submodule Update status. Confidence is high for those recorded states, not their unknown variants.

| Evidence                                 | Original images inspected                                   | Result and adaptation                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-001-create-remove-subcase:F1–F3       | screen-0433, screen-0435, screen-0439                       | Compact 590px worktree form, parent/child identity and hierarchy, current-worktree Delete state, removal from the parent and disappearing empty section. Independently authored folder/branch marks; removal review is taller when lock/data-loss details are needed. Parent grouping expands/collapses; Open remains an explicit worktree action. |
| P2-001-open-subcase:F1                   | Original menu/occupied-branch cases and linked Git evidence | Existing Open/file-manager/Copy Path and occupied-reference protections are retained. Detached creation, lock/unlock and nested-path refusal are independent Git-backed extensions, not captured Fork outcomes.                                                                                                                                    |
| P2-002-view-subcase:F1                   | screen-0452                                                 | Replaces the oversized side-by-side hash cards with compact metadata rows and child graph; Open Submodule stays at the bottom. The selected staged/unstaged side controls the actual compared pointers.                                                                                                                                            |
| P2-002-clean-dirty-watcher-subcase:F1–F4 | screen-0445, linked parent status and unstaged.patch        | Dirty-child count appears beside the title in red; equal pointers remain equal. Real child changes refresh the parent and Open Submodule produces an independent child tab. Localized dates, explicit detached text and expandable dirty paths are Linux adaptations.                                                                              |
| P2-002-missing-update-subcase:F1–F3      | screen-0449 and recorded failed Update state                | Missing children remain navigable entries with an explicit Initialize/Update review. The captured Windows file-transport failure remains unchanged evidence; successful local initialization/recovery is established by this project's disposable Git tests.                                                                                       |
| Vendor Windows 1.17 post, 2018-06-11     | Public gitflow.png and gitflow-menu.png                     | Initialization includes production/development, three topic prefixes and Version Tag Prefix in the compact dialog. Repository/branch menus expose the workflow; the retained toolbar shortcut and durable finish banner are project adaptations. The historical image does not establish current 2.22 defaults.                                    |

Public sources accessed 2026-09-29:

- [Fork Windows 1.17](https://fork.dev/blog/posts/forkwin-1.17/) supplies the initialization image and
  commit/branch context-menu entry points. High confidence for the historical Windows surface.
- [Fork Windows release notes](https://fork.dev/releasenoteswin) supply documented Git-flow availability
  and historical fixes/options; no new exact-default claim is made.
- [Git worktree](https://git-scm.com/docs/git-worktree) supplies linked/detached, locking and pruning semantics.
  [Git submodule](https://git-scm.com/docs/git-submodule) supplies init/update/checkout/sync and recursive scope.
- [Git-flow features](https://git-flow.readthedocs.io/en/latest/features.html),
  [releases](https://git-flow.readthedocs.io/en/latest/releases.html), and
  [hotfixes](https://git-flow.readthedocs.io/en/latest/hotfix.html) support the independently specified
  branch/tag lifecycles. These are not evidence of Fork internals.

`npm run research:references` restored/reindexed the 226 cached public images. Existing Git-flow image
metadata now records the post's stated version and topic; no new screenshot was downloaded. The private
bundle is unchanged, its artwork is not shipped, and no Fork binaries or capture harness were used.

After captures are generated under the ignored `test-results/p09-topology-*/` directories:
`worktree-create-light.png`, `worktree-linked-light.png`, `worktree-remove-dark-small.png`,
`submodule-revisions-light.png`, `submodule-dirty-dark.png`, `submodule-remove-dark.png`,
`submodule-update-scope-dark.png`, `gitflow-initialize-light.png`, `gitflow-finish-light.png`,
and `gitflow-recovery-dark.png`. They were compared with the original states above. The 880×600 removal
dialog keeps its path, force choice and buttons reachable. Window frame/move/resize behavior is unchanged;
native Wayland/window-manager and fractional-DPI parity are not newly claimed.

An untouched baseline replay from commit `2377983` retains the prior large hash cards at
`/tmp/git-workbench-p09-baseline-B10mTh/test-results/f23-submodule-dirty-card.png`.
That exported checkout used the committed sources and existing dependencies; it did not modify the
user's worktree or private reference bundle. Its before state was compared with the original dirty-child
capture and the current compact graph/metadata layout.

## Boundaries and explicit policies

- Existing channels stay stable. Named `repository:get-submodule-comparison` extends contracts,
  explicit preload and owner-checked main routing together. Results are strict, bounded DTOs. Inspectors
  are denied topology reads/mutations; sender/frame/document checks, trust, sandbox, isolation, CSP and
  subscription cleanup remain intact. Renderer code receives no command executor or credentials.
- Backend operations retain common-directory serialization. Standard submodule Git directories under
  a parent's modules directory also share parent/child barriers, including child tabs in other windows;
  unrelated repositories remain independent. Queued cancellation preserves the preceding barrier.
- Topology reads allow 1,000 worktrees/submodules. Submodule recursion is limited to 16 levels; incomplete
  topology is reported and mutations refused. Child comparison loads at most 100 history commits plus
  its two endpoints and reports truncation; absent local metadata is labelled, never fabricated.
- Removal fingerprints inspect at most 10,000 changed/ignored filesystem entries; the unrelated-repository
  scan stops at 20,000 entries. Incomplete inspections refuse removal. Symlink ancestors/selected paths
  cannot redirect a submodule mutation. Ignored files do not inflate Git's ordinary dirty-child count,
  but they are shown and protected in removal review. Force removal discards the reviewed child data;
  committed Git objects/branches are retained, not a backup of uncommitted bytes.
- Explicit submodule operations may use native Git authentication and locally selected file transports.
  Update uses checkout rather than a repository-configured custom update action. Its process has a
  ten-minute/8 MiB output bound; displayed output is sanitized/bounded, and cancellation uses the existing
  supervised Git process lifetime. Cancellation does not promise rollback.
- The finish journal has a strict version-1 schema and a 256 KiB read bound. Writes use a private temporary
  file plus rename; unreadable state fails closed while preserving the original. No implicit history
  rollback, force push, branch overwrite or lock deletion is introduced. Ordinary Git remains usable
  without a git-flow executable. Source/destination changes require review instead of silent retargeting.
- Git-flow-specific remote publish/track/delete automation, automatic stash/reapply, topic rebase, support
  branches and exact current Fork defaults are outside the phase's initialize/start/finish specification;
  ordinary P05/P06 workflows remain available. Submodule Move/Console routes, unusual legacy external
  Git-directory layouts, live hosted authentication and native Windows/macOS parity are not newly verified.
  P14 retains these broader parity questions and the catalogue's case-level unknowns.

## Verification

`npm run check` passes **618 tests**, with one opt-in skip, including type checks, lint and formatting.
The production build passes. The full headless Electron run reports **62 passed, 3 failed, 2 opt-in
skips**. All six F22/F23/F25/P09 scenarios and the production preload/renderer smoke pass.

The three failures are outside P09: P03's collapsed/125%-zoom retained-row assertion, F36's disabled
Copy as Patch menu item, and the ordinary F16 merge/rebase fixture's Git command. All three pass an
unchanged isolated rerun in `test-results/p09-failure-recheck/`. The disabled Copy as Patch failure also
reproduces on the untouched `2377983` baseline exported at `/tmp/git-workbench-p09-baseline-B10mTh`;
P03 and F16 pass there. This establishes a pre-existing patch failure and intermittent viewport/merge
failures, not a completely green full-suite run. Their original failure artifacts remain in
`test-results/`; their broader investigation is not hidden by P09's completion. No unrelated tests or
assertions were relaxed. All P09 acceptance requirements have independent implementation evidence above.

- Worktree/submodule/Git-flow unit suites: **23 tests** cover lifecycle and independent Git outcomes,
  nested scope, missing objects, empty/symlink child state, same-path stale reviews, ignored data,
  unrelated nested repositories, all three flow families and durable conflicts/interruption.
- P01's existing queue scenario now also exercises parent/child repositories, queued cancellation and
  independent repository progress. P06's real gitlink-conflict test verifies the new topology DTO before
  and after resolution/Continue, preserving the dirty child bytes.
- Interrupted recursive initialization and a merge completed before journal acknowledgement are tested
  with injected command-boundary cancellation and a fresh service/runner read. P01 separately verifies
  process-group termination. No destructive recovery or removal is tested in the user's working repository.
- Preload tests reject malformed requests/results and command/path injection; inspector tests reject the
  new comparison channel and expanded mutation actions. Existing owner/frame/lifecycle checks still run.
- Three new headless P09 scenarios cover worktree review/identity/locking, child graph/nested update/removal,
  and Git-flow conflict continuation after full app restart. The existing F22/F23/F25 lifecycle scenarios
  remain regression coverage, including remote-tracking worktrees in backend tests.
