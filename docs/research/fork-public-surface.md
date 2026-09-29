# Fork: captured and public feature surface

P09 implementation — **2026-09-29**: the [phase handoff](../reviews/p09-topology.md) supersedes the
bounded F22/F23/F25 implementation notes below for the specified Linux phase. Rechecked original
cases, screenshots and Git evidence: `P2-001-create-remove-subcase:F1–F3`,
`P2-001-open-subcase:F1`, `P2-002-view-subcase:F1`,
`P2-002-clean-dirty-watcher-subcase:F1–F4`, and `P2-002-missing-update-subcase:F1–F3`.
These are high-confidence Windows 2.22.0.0 observations, captured 2026-09-19–20. Linked-directory
identity/action states, compact revision metadata/graph, dirty count and child-tab navigation guide
the Linux implementation. Force/lock controls, recursion review and durable interrupted-operation
handling are independent adaptations; the captured failed local Update is not successful-init evidence.

Public gaps, accessed **2026-09-29**: [Fork Windows 1.17](https://fork.dev/blog/posts/forkwin-1.17/)
(2018-06-11) supplies the initialization form including Version Tag Prefix and the context-menu
entry points. Its restored `gitflow.png`/`gitflow-menu.png` are high-confidence historical Windows
light UI evidence, with medium confidence for application to the current design and no claim about
2.22 defaults. [Windows release notes](https://fork.dev/releasenoteswin) retain documented availability.
[Git worktree](https://git-scm.com/docs/git-worktree), [Git submodule](https://git-scm.com/docs/git-submodule),
and the [feature](https://git-flow.readthedocs.io/en/latest/features.html)/
[release](https://git-flow.readthedocs.io/en/latest/releases.html)/
[hotfix](https://git-flow.readthedocs.io/en/latest/hotfix.html) guides establish the independent Git
semantics, not Fork internals. The feature-finish production mutation missed by earlier tests is
corrected; direct Git assertions now prove production is unchanged. Public image metadata was clarified
and reindexed; no new image, private-bundle modification or borrowed application asset was needed.
Case-level unknowns, live hosted variants, additional Git-flow automation and native-platform parity
remain visible in the handoff and P14. Full-suite results are reported without hiding unrelated failures.

P08 Bisect refresh correction — **2026-09-26**: the [follow-up](../reviews/p08-bisect-refresh.md)
fixes dropped Start/classification clicks during unchanged background reads. The manual workflow stays
anchored to `P2-006:F1` and `P2-006-skip-subcase:F1–F3` (Windows 2.22.0.0, 2026-09-19, high-confidence
UI/Git evidence). Read/mouse timing and stale-checkout refusal are independent application regressions,
not new Fork observations. Capture coverage, layout and platform limits remain unchanged.

P03 viewport verification correction — **2026-09-26**: the [runtime record](../reviews/p03-viewport.md)
closes the inherited prepend assertion through test synchronization and visible-anchor checks. The
production paging calculation is unchanged. `P2-017:F1` remains high-confidence evidence for scrolling
without changing selection in the captured Windows 2.22.0.0 trial (2026-09-19); its dossier and original
case were reviewed. Multi-page/virtualization/125%-Electron-zoom regressions are independent project
verification, not additional Fork capture coverage or a native DPI claim.

P08 completion — **2026-09-26**: the [phase handoff](../reviews/p08-investigation.md) records the
Linux investigation, recovery and patch scope. High-confidence captured Windows 2.22.0.0 anchors are
`P1-028:F1`, `P1-029:F1`, `P1-030-file-history-subcase:F1`,
`P1-030-rename-follow-subcase:F1–F3`, `P1-031:F1`,
`P1-033-blame-history-navigation-subcase:F1–F4`, `P2-005-mixed-patch-preflight-subcase:F1–F4`,
the P2-005 import/export subcase F1 findings, and `P2-006-skip-subcase:F1–F3` (2026-09-19–20).
Original cases, PNGs and linked Git verification were compared with before/after Linux captures.
Compact History cards, shared timelines, compact Blame attribution and revision changes follow those
states. The earlier tall Blame cards stretched source lines and have been replaced.

Directory history and selected-code history are documented in [Windows release notes](https://fork.dev/releasenoteswin)
for 1.52 (2020-07-16) and 2.14 (2025-11-21); 1.81 (2023-01-27) confirms the File Tree Save As route.
Sources checked 2026-09-26, high confidence for documented availability, not uncaptured behavior.
[Git log](https://git-scm.com/docs/git-log), [Git blame](https://git-scm.com/docs/git-blame) and
[Git apply](https://git-scm.com/docs/git-apply), accessed the same date, support the independently
specified line-range/original-path/index policies. Directory descendant tracking, ordinal timeline
selection, exact outside-checkout Save As, cancellable reads, mailbox net staging and merge-parent
exports are tested project behavior. Named branch/tag recovery and expiry likewise do not convert the
catalogue's unknown variants into Fork observations. The public reference index was restored; no new
image was required and the private bundle remains unchanged. Safety refusals and native-platform
limits remain explicit in the handoff; no general graph Back/Forward or inspector restart parity is claimed.

P07 completion — **2026-09-26**: [implementation and verification](../reviews/p07-interactive-rebase.md)
now close F18 and the P07 portion of F16 for Linux. High-confidence catalogue anchors are
`P1-023-dialog-subcase:F1`, `P1-023-plan-execution-subcase:F1–F3` and
`P1-023-edit-amend-continue-subcase:F1–F3` (Windows 2.22.0.0, 96 DPI, 2026-09-19–20). Original cases,
plan/message/menu/Amend screenshots and Git results were compared before and after implementation.
The compact plan, revision inspection, shortcuts, connectors, message rules and detached Edit sequence
follow those observations. The earlier P1-024 input failure remains superseded by the later successful
plan-execution case.

Dependent-ref updates, retained original-head refs, optional backup branches, published-history
acknowledgement and a fixed-topology merge policy are independently specified Linux behavior. Their
Git outcomes are verified; Fork's checkbox effects remain unobserved. The
[Git 2.43.0 rebase manual](https://git-scm.com/docs/git-rebase/2.43.0) (2023-11-20) and
[Fork Windows 1.23 post](https://fork.dev/blog/posts/forkwin-1.23/) (2018-11-10) were checked on
2026-09-26. Confidence is high for Git's documented options and the tested project behavior, not for
uncaptured Fork internals. The public reference library/index was restored; no new reference image
was required. The modal, responsive columns and recovery controls are Linux adaptations; native
Windows/macOS, exact 125%-DPI and broader accessibility/parity questions remain open.

Public research began **2026-09-16**, with source/design updates on **2026-09-17** and **2026-09-19**.
**Current alignment: 2026-09-20**, against the user-supplied **Fork Windows 2.22.0.0** black-box catalogue.
Scope: independently implementing the captured Windows workflows and separately documented public
feature families, with Linux as the primary target. This is a requirements/evidence inventory, not a
claim of verified equivalence. The filename is retained for existing links.

The earlier research used public websites, release notes, blog posts and screenshots only. The user
subsequently supplied observations from a dedicated Windows VM: screenshots, public UIA, actions and
ordinary Git state checks. This audit consumes that evidence without installing/running Fork or
inspecting its proprietary source/binaries. Code, branding, icons and implementation remain independent;
reference screenshots are private/local research material, never application assets.

## Current reference and evidence precedence

P06 implementation checkpoint (2026-09-24): the [merge/recovery handoff](../reviews/p06-merge-recovery.md)
verifies the Linux phase requirements against `P1-006:F1` and its mode subcases,
`P1-013-tracked-subcase:F1`, `P1-013-stage-new-files-subcase:F1`, `P1-014:F1`, `P1-015:F1`,
`P1-016:F1`–`P1-020:F1`, `P1-021:F1`, the P1-022 continue/abort/empty-result cases,
and the P1-025/P1-026/P1-027 success/conflict/reset subcases. Original cases, screenshots and
index/parent/status evidence were inspected. Baseline: Windows 2.22.0.0, captured 2026-09-19–20,
96 DPI; high confidence for those individual observations. Linux now follows the compact forms,
top operation banner, paired source cards and wide incoming-left/current-right resolver. Before/after,
light/dark, small-window, binary, multi-region, stash and continuation captures are in the handoff.

Public supplements accessed 2026-09-24: [Fork Windows 1.48](https://git-fork.com/blog/posts/forkwin-1.48/)
(2020-05-05, high-confidence documentation of selected-file stashes and branch drag) and the official
Git [stash](https://git-scm.com/docs/git-stash), [cherry-pick](https://git-scm.com/docs/git-cherry-pick),
[revert](https://git-scm.com/docs/git-revert) and [reset](https://git-scm.com/docs/git-reset) manuals.
These inform the independent Git implementation, not claims about Fork's unobserved internals.
Selected-file index isolation, hunk/line stashes, multi-region Both ordering, binary/gitlink choices,
journalled stash Abort, supported Git Skip, source-object checks and reset safeguards are **I** policies
verified separately. Generic external stash provenance, native Windows/macOS and broader parity remain
unknown; P07 interactive-rebase extensions are unchanged. The public reference index was restored
(226 existing images), with no added/copied assets and no private-bundle modifications.

P05 implementation checkpoint (2026-09-23): the [reference/network handoff](../reviews/p05-network.md)
verifies the Linux phase requirements and acceptance. Primary observations are
`P1-001-create-rename-delete-subcase:F1–F2`, `P1-002:F1`, `P1-003:F1`,
`P1-004-empty-message-tag-subcase:F1–F3`, `P1-004-create-delete-tag-subcase:F1–F2`,
`P1-007:F1`, `P1-008-stale-fetch-subcase:F1–F4`, `P1-009-pull-rebase-subcase:F1–F3`,
`P1-010-upstream-subcase:F1–F2`, `P1-011-delayed-local-cancel-subcase:F1–F5` and
`P1-012-local-clone-subcase:F1–F3`. Dossiers, original cases, screenshots and Git tag/refs/status
evidence were inspected. Baseline Windows 2.22.0.0, captured 2026-09-19–20, 96 DPI; high confidence
for these individual states. Before/after Electron images follow the compact widths, icon column,
aligned fields, selected rename text, optional tracking and green connection success. Extra option
disclosures, independent icons/fonts/buttons, exact-lease review and retained Recovery are adaptations.

Public supplements accessed 2026-09-23: [Git push](https://git-scm.com/docs/git-push) establishes the
explicit lease form and background-fetch caveat; [Git credentials](https://git-scm.com/docs/gitcredentials)
documents native helper/askpass use. [Windows notes](https://git-fork.com/releasenoteswin) document
multi-reference deletion (1.74, 2022-05-20) and stale selection (2.16, 2026-02-20), and
[Mac notes](https://git-fork.com/releasenotes) document folder completion (2.10, 2021-07-23).
Confidence is high for published capabilities, with independently authored Linux execution and review.
Real loopback TLS/SSH, encrypted-key agent use, credential cancellation, and cancellation before/after
remote acceptance are implementation evidence, never inferred Fork outcomes. Live provider/native-keyring
and platform matrices remain unverified; public pin/hide/custom sorting remains outside the completed
P05 lifecycle. The public image cache was restored; no reference assets were added or copied.

P04 implementation checkpoint (2026-09-23): the [working-changes handoff](../reviews/p04-working-changes.md)
closes the Linux phase's five requirements and four acceptance criteria. Original `P0-014:F1–F2`,
`P0-022:F1–F2`, `P0-023-hunk-subcase:F1`, `P0-025-untracked-toggle-subcase:F1–F3`,
`P0-026:F1`, `P0-027-whitespace-context-wrap-subcase:F1`, `P0-028-scroll-persistence-subcase:F1–F4`,
`P0-030:F1`, `P0-031-submit-subcase:F1` and `P0-032-scroll-focus-staging-subcase:F1–F3` anchor
the case/PNG/Git comparison (Windows 2.22.0.0, captured 2026-09-19–20, 96 DPI; high confidence
within each trial). Text-selection staging, syntax colors, paired line numbers, single-line context
steps and a compact composer follow those visible states. The retained labelled toolbar, 280 px
initial file column, keyboard line checkboxes, bounded pane sizes and richer discard preview/Recovery
remain explicit Linux adaptations. Light/dark and 880×600 before/after captures are in the handoff.

The [Windows 1.38 article](https://fork.dev/blog/posts/forkwin-1.38/) (2019-08-27) and
[Windows 2.20 release notes](https://fork.dev/releasenoteswin) (2026-06-05), accessed 2026-09-23,
supplement inline search/split and token-highlighting descriptions; confidence is high for those
published claims, not for an exact tokenizer or palette. The public image library was restored and
browsed; no new screenshot asset was added. Reverse replacement/new-file selections, metadata-preserving
text patches, staged-rename target isolation, combined visibility toggles and stale line-preview rejection
are independently tested corrections. Catalogue unknowns are retained, including untracked deletion,
Combined List behavior, restart diff anchors and full platform/codec/signing/assistance variants.

P03 implementation checkpoint (2026-09-23): the [history handoff](../reviews/p03-history.md) completes
the Linux history/graph/revision scope and P03 search requirements. Primary evidence remains
`P0-003-baseline-subcase:F1–F2`, `P0-006:F1`, `P0-007:F1–F3`, `P1-029:F1`, `P2-017:F1` and the
retained P0-011/P1-033/P2-015 navigation/persistence observations: Windows 2.22.0.0, 2026-09-19–20,
96 DPI, high confidence for the observed states. Original PNG/case/Git records were compared with
before/after Linux light/dark/880×600 captures. Compact metadata, separators, file disclosures and
Expand All now align with those references; paged trees, SHA search, virtual rows and retained selected
collapse tips are independently specified implementations, not inferred Fork internals.

Public gap supplements, accessed 2026-09-23: [collapsible graph](https://fork.dev/blog/posts/collapsible-graph/)
(2020-08-03, Mac/Windows), [Windows 1.21](https://fork.dev/blog/posts/forkwin-1.21/) (2018-09-25,
inline summary changes), and [Mac 2.9 notes](https://fork.dev/releasenotes) (2021-06-25, recent queries).
These are high-confidence documentation/images for their published versions. Applying recent queries
to Linux with session-only retention is a project choice; current Windows persistence and exact merge
collapse boundaries remain unknown. The restored public images and unchanged private bundle remain
outside application assets. Browser and backend 100k/1k measurements are recorded separately in the
handoff; P2-017's small captured fixture does not establish either budget.

Start with the [catalogue handoff](fork-reference-new/reference/catalogue/START_HERE.md),
[design guide](fork-reference-new/reference/catalogue/DESIGN_GUIDE.md) and
[2026-09-20 alignment audit](fork-catalogue-alignment.md). The audit maps **all 82 topics** to F-items,
project phases and the C01–C06 correction sequence. The bundle records **147 cases, 275 findings and
541 unique case-linked screenshots**: **70 observed, 11 partial, one blocked** topics. These are research
statuses, not Git Workbench implementation percentages. All **7,295** portable-manifest entries passed
size/hash verification on 2026-09-20; that inventory is distinct from the earlier 7,106-file evidence seal.

The baseline is Windows 11 build 26200, predominantly 96 DPI, captured 2026-09-19–20. Existing settings
are not pristine defaults. Screenshots establish visible presentation; corresponding Git records establish
bounded repository effects. Original cases and linked PNG/UIA/Git evidence take precedence over derived
summaries; later subcases can resolve earlier capture failures. Public material supplements missing
features/platforms and does not override a captured result for this version. Keep conflicts and limits.

The catalogue resolves several earlier assumptions:

- P0-005: the optional workspace repository list **coexists with horizontal tabs**. Appearance's
  Horizontal/Vertical entries mean **Commit List Layout**, whose alternate result is not established.
- P0-022/P0-032: selected-addition staging and post-stage focus/viewport retention are separate acceptance
  criteria. P0-027/P2-004 add context/full-file/wrap, a selection-linked diff popup and explicit Load Diff.
- P1-004: Create Tag with an empty message creates an **annotated** tag. The previous lightweight fallback
  was corrected in the F01–F16 implementation pass.
- P1-006/P1-016–024: merge modes, two-input/result conflict presentation and interactive Edit/amend/continue
  now have concrete state and Git-outcome references. Explicit GUI rebase Skip remains unknown.
- P1-013: **Stage new files** produces a stash with the new file in its index parent. The F01–F16 pass
  implements that policy and keeps include-untracked as a distinct compatibility path.
- P1-029–033: search fields/scopes and graph highlighting, separate History/Blame windows and Blame
  Back/Forward are captured. General main-graph Back/Forward remains unknown.
- P2-015: tab/window/sidebar persistence differs from commit/detail/divider restoration. A blanket
  restore-everything parity requirement is incorrect.
- P0-008: add **F38 Lean Branching** for observed Start/Sync/Finish entries; their effects are untested.

Exact cases, current source locations, confidence limits and planned corrections are in the
[alignment audit](fork-catalogue-alignment.md#corrections-to-existing-assumptions). Existing F01–F16,
F29 and F34 slices retain their partial implementation status; no new phase is complete from this review.

Implementation checkpoint: the [F01–F16 correction pass](../reviews/f01-f16-catalogue-corrections.md)
subsequently implements and verifies the captured corrections together, including the F34 shell
prerequisites. The feature matrix below distinguishes that result from remaining broader scope. F17 is
implemented within the bounded scope in its handoff, and F18 is now implemented within the bounded scope
in its [handoff](../reviews/f18-interactive-rebase.md). Captured coverage and full-family implementation
are still separate records.

Interaction follow-up (2026-09-20): P0-020/hunk-control captures establish separate text-range and
highlight layers; P0-011/P0-012 establish resizing and collapse; P1-031 shows a commit-details window.
The user clarified the main-pane pop-out route and Branch/Stash primary versus chevron behavior. These
corrections are now implemented and verified, with source limits and tests in the
[interaction record](../reviews/f01-f16-catalogue-corrections.md#interaction-follow-up). Hover controls
are no longer described as a permanent diff header, and the commit-details inspector is no longer deferred.

F17 implementation checkpoint (2026-09-20): the [conflict-helper handoff](../reviews/f17-conflict-helper.md)
adds operation-aware stage inspection, bounded base/ours/theirs panes, an editable result, marker-region
counts, validated write-and-stage, and existing Commit/Continue/Abort integration. The project covers
text conflicts independently and safely reports binary, submodule, delete/modify, rename, missing-stage
and oversized states; those non-text Fork variants are not claimed as built-in parity. Stash-specific
provenance labels and external-tool handoff remain bounded; F19 cherry-pick/revert/reset is implemented
within the dated [F19 handoff](../reviews/f19-history-operations.md), with the catalogue's untested
variants still distinct.

F20 is implemented within the bounded [reflog recovery handoff](../reviews/f20-reflog-recovery.md): the
renderer can enter and Exit a backend-bounded lost-commit graph, and the existing reviewed reset,
branch/tag, checkout, cherry-pick, revert, and patch routes receive full commit IDs. Reflog expiry,
named branch/tag recovery variants, and the broader P08 family remain unverified.

F21 is implemented within the bounded [file-history and Blame handoff](../reviews/f21-file-history-blame.md):
the renderer opens separate read-only History and Blame inspectors, follows one selected file through
committed renames, loads historical diffs without changing the checkout, attributes bounded text lines,
and provides Blame revision selection plus Back/Forward. This maps the captured `P1-030`/`P1-031`/
`P1-033` cases and is independently verified on Linux with disposable repositories. Directory history,
selected-code history, copies, restart persistence, and general main-graph Back/Forward remain outside
the bounded slice.

F22 is implemented within the bounded [worktree handoff](../reviews/f22-worktrees.md): the renderer lists
backend-issued linked worktrees, creates local or remote-tracking worktrees, opens them as linked tabs,
and removes/prunes them with current/main, occupied-branch, dirty, locked, and stale-registration guards.
This maps the captured `P2-001-create-remove-subcase:F1–F2` and `P2-001-open-subcase:F1` entry points and
is independently verified on Linux with disposable repositories. Fork's dirty/locked presentation was
not captured; the explicit force policy is a documented Linux adaptation. Detached creation, lock/unlock,
nested worktrees, and the broader P09 family remain outside the bounded slice.

F23 is implemented within the bounded [submodule handoff](../reviews/f23-submodules.md): the backend reads
parent gitlinks and child HEAD/dirty state, compares parent baseline/index/child revisions, and exposes
typed Add/Initialize/Update/Sync/Remove operations with stale snapshots and exact removal guards. The
renderer replaces the planned Submodules placeholder, shows nested paths and dirty-child revision cards,
and opens initialized children through a backend-resolved `parent: child` tab. This maps
`P2-002-clean-dirty-watcher-subcase:F1–F4`, `P2-002-view-subcase:F1`, and
`P2-002-missing-update-subcase:F1–F3`. Successful local initialization is independently verified on
Linux; Fork's captured local-transport Update failure is retained as research evidence. Nested mutation,
missing-object, interrupted-update/cancellation, conflict continuation, and broader provider/tool routes
remain unverified, so F23 and P09 stay partial.

F24 is implemented within the bounded [local LFS handoff](../reviews/f24-lfs.md): the backend recognizes
Git LFS pointer blobs, reports pointer/materialized state and local object availability, offers an
operation-backed `git lfs install --local`, and streams an exact local historical payload through native
Save As without changing the checkout. The renderer shows the historical payload size and retrieval
progress in Changes and File Tree. This maps `P2-011-initialize-download-subcase:F1–F4` and
`P2-011-local-lfs-subcase:F1`. Authenticated/remote transfers, push, locks, track/untrack editing and
remote missing-object recovery remain unverified and outside this bounded slice.

### F24 source refresh

Accessed **2026-09-20**. The supplied Windows 2.22.0.0 catalogue is primary evidence: the captured
`P2-011-initialize-download-subcase` on **2026-09-19** records Initialize Git LFS adding the four LFS
hooks, a historical `sample.bin` LFS card showing **32.0 KB (32,768 B)** while the checkout remains a
130-byte pointer, Save As retrieving the exact SHA-256
`e11360251d1173650cdcd20f111d8f1ca2e412f572e8b36a4dc067121c1799b8`, and unchanged Git state
(`P2-011-initialize-download-subcase:F1–F4`). The same-day `P2-011-local-lfs-subcase:F1` confirms the
badge/size/Save As presentation while leaving initialization and transfer completion unestablished.
The case explicitly did not test HTTP/authenticated servers, push, or locks.

The current [Git LFS specification][lfs-spec] defines the UTF-8 pointer's `version`, SHA-256 `oid`, and
byte `size` fields and its bounded pointer form. The official [install manual][lfs-install] documents
`git lfs install --local` as repository-local filter configuration and hook installation; the general
[Git LFS manual][lfs-man] documents the optional `git-lfs` executable and its transfer adapters. These
are high-confidence **D** Git/LFS semantics, accessed 2026-09-20, not observations of Fork or proof of
Linux parity.

This project chooses an **I** bounded Linux implementation: pointer parsing and local cache lookup stay
backend-owned; selecting a pointer never downloads a large object; Save As verifies the object size and
SHA-256 while streaming to a native-selected path; and a missing optional `git-lfs` executable is
reported without silently installing or replacing it. Remote/authenticated transfers, locks, push,
track/untrack editing, and remote missing-object recovery remain **U** and are not inferred from local
Save As.

F25 is implemented within the bounded [Git-flow handoff](../reviews/f25-git-flow.md): the backend reads
and writes the conventional `gitflow.branch.*` and `gitflow.prefix.*` repository configuration and
exposes typed initialize, feature/release/hotfix start, and finish operations. Finish creates annotated
release/hotfix tags, can merge the topic back into develop, supports an explicit no-fast-forward choice,
and deletes or retains the topic branch according to the reviewed action. The renderer adds a Git-flow
toolbar/menu and initialization/start/finish dialogs. Disposable Git tests and the headless Electron
scenario verify all three lifecycles and independent Git state. This is an **I** implementation of the
publicly advertised family, not a new Fork capture: public sources establish the feature family and
standard Git-flow documentation establishes the branch/tag outcomes, while exact Fork defaults and
conflict/publish variants remain **U**. F38 Lean Branching remains a separate captured menu inventory.

### F25 source refresh

Accessed **2026-09-20**. Fork's [product page][home] lists **Git-flow** under its feature overview
alongside Git LFS and GPG (**D**, vendor source; Mac and Windows product page, no Linux claim). The
Windows [release notes][win] record a Git-flow hotfix integration fix (**D**, historical Windows source;
the notes do not specify the exact command path), while the Mac [release notes][mac] record a no-fast-
forward option for feature finish and an option not to merge a release into develop (**D**, historical
Mac source). These are public capability signals, not evidence that every platform/version has identical
defaults.

The public [git-flow presentation][gitflow-presentation] says the model is a convention implemented with
ordinary Git commands and documents initialization around a production branch plus develop. The
[feature][gitflow-features], [release][gitflow-releases], and [hotfix][gitflow-hotfix] guides document
feature/release/hotfix base branches, finish destinations, release/hotfix version tags, and cleanup
(**D**, public git-flow documentation; accessed 2026-09-20). The docs are not Fork sources and do not
establish Fork's private UI, defaults, conflict recovery, remote publishing, or platform behavior.

This project therefore chooses an **I** native implementation that does not require an installed
git-flow extension: standard Git remains available when the extension is absent, repository-local
`gitflow.*` keys stay compatible with the documented model, and clean/stale/pending-operation checks are
explicit safety adaptations. Automatic stash/reapply, topic rebase, remote publish/track/delete, linked
topic worktrees, exact Fork dialog defaults, and specialized continuation after a conflict remain **U**
or outside this bounded slice.

Since 2026-09-17, public screenshots used for design comparison are listed with their source, date,
platform, stated version, and theme in [`fork-references.json`](fork-references.json).
`npm run research:references` downloads them into the git-ignored `docs/research/fork-references/`
folder and writes an `INDEX.md` there, grouped by topic and source. The local copies exist only for
comparison: they are never committed, bundled, or used as application assets. This public downloader
does **not** restore the private catalogue. Keep that bundle intact at `fork-reference-new/`; its original
cases/screenshots are the first comparison source for captured Windows states.

## Baseline and confidence

F37 checkpoint (2026-09-22): optional OpenAI API commit-message and branch/commit-range review is
implemented as an independent, session-only integration. It requires native key-file setup, explicit
model selection, local material preview and a separate Send. Messages become editable drafts only on
request; review text has no execution or Git mutation capability. See the
[F37 handoff](../reviews/f37-ai.md) for source/platform findings, request policy and verification limits.
No AI behavior is established by the private catalogue. P0-013-general-git-subcase:F1–F4 and P0-030:F1
only anchor surrounding settings/composer presentation and existing commit semantics.

Public evidence, refreshed 2026-09-22: [TrackerWin 2808](https://github.com/fork-dev/TrackerWin/issues/2808)
contains the Windows OpenAI token-login/Commit-preferences screenshot (2026-06-22, version unstated;
**O**, high confidence for controls only). [Windows releases][win] document Claude integration in 2.14
and revised branch review in 2.15. [Mac releases][mac] document Claude messages/review (2.59/2.60), SHA
ranges (2.61), Codex messages/review and configurable agent requests (2.64), and Cursor messages (2.70)
(**D**, high confidence for advertised support, not private invocation details). CLI adapters remain
unimplemented. No matching Windows Codex/Cursor claim was found in these release notes.

The direct [OpenAI Responses request](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
and [retention policy](https://developers.openai.com/api/docs/guides/your-data) were checked 2026-09-22.
Our API adapter, immutable diff preview, fixed endpoint, session-only credential policy and range
semantics are **I**, not observed Fork implementation. `store: false` does not remove all provider
retention. Live provider behavior, native platform parity and the agent CLI families remain **U**.

At the 2026-09-16 public-source review, the release pages listed **Mac 2.70 (2026-09-04)** and
**Windows 2.22 (2026-08-28)**.
Both list vertical repository tabs. The Mac page additionally names Cursor for generated commit messages;
older Mac entries name Codex integration. Do not assume every integration is identical on Windows.
Sources: [Mac releases][mac], [Windows releases][win].

The product website offers Mac and Windows downloads, with no Linux download listed.
Source: [Fork product page][home].

Evidence labels:

- **D**: explicitly documented by the vendor. Historical posts establish the advertised workflow,
  but do not prove every detail remains unchanged in the current release.
- **O**: visible in a public screenshot, without interactive verification.
- **B-UI**: visible presentation/action transition recorded in the supplied Windows catalogue; cite the
  original case/finding, capture date and limits. This is not a fresh runtime trial by this project.
- **B-Git**: repository outcome supported by that case's ordinary Git records. UI labels alone do not
  establish success, rollback, stash structure or remote acceptance.
- **I**: our implementation/design inference. It must not be described as observed Fork behavior.
- **U**: unresolved through the material examined. Seek further supplied black-box/public evidence or
  define an independent behavior and document the deviation before claiming equivalence.

The matrix covers captured and documented feature families. Full preference/shortcut/default/error
matrices and platform discrepancies remain incomplete even where a topic is marked observed.
F01, the first F02 slice, the initial F03 slice, the initial F04 slice, the initial F05 slice, the
initial F07 slice, the F08–F11 local-change slices, the initial F12 branch/tag slice, the initial F13
remote/network slice, the F14 background-fetch/activity slice, and the initial F34 workspace chrome slice are **partial** in this project.
The stabilization also starts the F15/F16 recovery subset and the F29 PR browser handoff; their full
feature families and all other F-items remain incomplete or planned.

## Historical source and implementation records

The dated F01–F34 records below preserve what was known and tested at the time. Their statements of
unknown behavior or public-only research are historical wherever the current catalogue reconciliation
above supersedes them. They are not new parity claims. In particular, initial vertical-tab assumptions,
blank-message tag behavior and blanket persistence rules must not be reused as requirements.

### P02 completion and F01–F03 source refresh — 2026-09-23

P02's Linux repository/session scope is now complete within the
[P02 handoff](../reviews/p02-repository-sessions.md). It covers manager logical folders/display aliases,
default sources and real summaries, cancellable bounded discovery, backend filesystem invalidation,
session/read ownership, init/clone/CLI routes, persistent drafts/preferences and missing/corrupt settings
recovery. Broader F01 authentication/provider validation remains P05; F02/F03 named workspaces and
native platform extensions remain P12/P14.

**B, high confidence:** Windows 2.22.0.0 `P0-004-close-restore-subcase:F1`,
`P0-004-reorder-subcase:F1–F2`, `P0-005-tab-sidebar-subcase:F1`,
`P2-015-layout-selection-restart-subcase:F1–F4`, `P2-016:F1`, and
`P1-012-local-clone-subcase:F1–F3` establish the captured tab, restart, refresh and local-clone states.
Their original cases/screenshots and linked Git snapshots remain primary. No watcher implementation or
latency is inferred from those observations, and P0-002's pristine manager gap stays unresolved.

**O/D, accessed 2026-09-23:** the official undated/unversioned light Windows
[manager Summary image](https://fork.dev/images/carousel/carousel_repomanagerWin1.jpg) and
[Statistics image](https://fork.dev/images/carousel/carousel_repomanagerWin2.jpg), already listed in the
public asset manifest, guide the tree, title/path/Open, metadata and branch/tag rows. The
[1.0.79 Mac article](https://git-fork.com/blog/posts/fork-1.0.79/) (2019-06-12) documents source hierarchy
import/rescan/default selection. These give high confidence for pictured presentation and advertised
outcomes, without establishing exact Windows folder-edit behavior or Linux support. The Linux metadata
editor, resource limits, source-default context action, recovery controls and watcher policy are **I**
choices. Statistics keeps its existing F35 inspector. Light/dark/880×600 comparisons and test evidence
are in the handoff; no private bundle assets changed or entered the application.

The older F01–F03 slices below are historical where this completion record supersedes them.

### F01 source refresh

Accessed **2026-09-16**. The [Fork product page][home] explicitly advertises creating, cloning, or
adding existing repositories and quickly opening recent repositories. This is high-confidence
evidence for the advertised outcomes on Fork's listed Mac and Windows platforms, but it does not
specify dialog fields, persistence format, recovery behavior, or Linux support. The product page
lists Mac and Windows downloads and no Linux download.

For repository topology, this project uses the public [git-rev-parse documentation][rev-parse], which
documents separate working-tree, Git-directory, common-directory, bare, and top-level queries, and
[git-init documentation][init], which documents creating or reinitializing normal and bare repositories.
These are Git CLI semantics, not observations of Fork. The current implementation was tested with Git
2.55.0 on Fedora Linux; Windows/macOS path and dialog differences remain unverified.

Current project status: F01 is partial. Local open, initialize, canonical topology discovery, recent
entries, close/reopen sessions, and corrupt recent-file recovery are implemented and tested. Remote
clone, authentication, and long-running clone jobs remain deferred to P01/P05; local clone and the
remaining repository-manager workflows remain deferred to P02/P12. The first F02 source-scan slice
and initial F03 tab slice are recorded below.

### F02 source refresh

Accessed **2026-09-16**. The [Fork 1.0.79 manager article][manager] explicitly says that Fork can
recreate the source-folder structure in its Repository Manager, automatically import repositories into
their respective folders, rescan source directories manually, and select a default source folder in
Preferences. This is high-confidence **D** evidence for the advertised Mac workflow; the article is
tagged Mac and does not establish Windows behavior or exact scan rules.

The current [Mac release notes][mac] document multiple source-code directories in Fork 2.60 and
automatic discovery of new repositories in 2.56. The [Windows release notes][win] document the same
multiple-source-directory outcome in Fork 2.15 and automatic new-repository discovery in 2.12; older
Windows notes document Repository Manager subfolders and a performance improvement for rescanning.
These are **D** outcomes on the respective listed platforms. Exact recursion depth, symlink handling,
repository-marker rules, folder edit semantics, scan cancellation, and default-directory persistence
remain **U**.

This project’s first slice is an **I** choice: source roots are persisted separately from recent/open
sessions; the folder tree is regenerated from canonical filesystem paths; normal repositories are
recognized through `.git` entries and bare repositories through their standard top-level markers;
directory symlinks are not followed; overlapping roots are deduplicated; and bounded scans report
warnings instead of silently claiming completeness. These choices are not observations of Fork.

### F03 source refresh

Accessed **2026-09-16**. The [Fork 1.0.79 manager article][manager] and the current [Mac release
notes][mac] and [Windows release notes][win] document repository tabs, including the newer vertical-tab
option in the listed platform releases. This is **D** evidence for the advertised tab outcome on Mac
and Windows; it does not establish Linux support, exact shortcut bindings, dirty-state calculation,
tab persistence, or multiwindow ownership.

This project’s initial F03 slice is an **I** choice: tabs are owned by a window session, canonical tab
records and active selection are persisted atomically, Git porcelain-v2 status supplies a visible
clean/dirty/unknown indicator, vertical tabs are the default with a persisted horizontal alternative,
and Ctrl/Cmd+Shift+T reopens the most recently closed tab during the renderer session. These are
independent implementation decisions, not observed Fork behavior. The slice is partial: closed-tab
history is not yet restored after a full application restart, automatic invalidation uses polling rather
than a filesystem watcher, and P12 still covers multiwindow ownership, drag ordering, colors, and layout
refinements.

### F04 source refresh

Accessed **2026-09-16**. Fork’s public [history screenshot][history-image] is **O** evidence for a
history workspace with a commit table, graph lanes, reference decorations, and selected-commit details;
the image is a 2020 Windows view and is not a current spacing or Linux specification. Fork’s
[collapsible graph article][graph], tagged for Mac and Windows, is high-confidence historical **D**
evidence that its graph represents merge ancestry and supports branch-focused inspection, but collapse
behavior is outside the initial F04 slice. Platform differences beyond the tagged article remain **U**.

The public [git-log documentation][git-log] defines the underlying observable history semantics used by
this project: commit logs follow parent links, default output is reverse chronological, `--max-count`
and `--skip` support bounded pages, and decoration can expose ref names. The [git-for-each-ref
documentation][for-each-ref] supplies the reference enumeration contract. These are Git CLI semantics,
not observations of Fork, and are used here to keep the backend machine-readable and independent of
Fork’s implementation.

This project’s initial F04 slice is an **I** choice: `--all --topo-order` supplies a bounded local stream;
separate ref enumeration keeps full names and tracking metadata; a pure lane pass preserves parent edges
when already-loaded pages are recomputed; and commit messages are rendered as inert text. It is verified
against disposable merge/tag/unborn repositories and a real Electron selection flow. Detached-head and
multiple-root integration fixtures, large-history performance, collapse/filtering, changed-file details,
and revision-tree inspection remain unverified.

### F05 source refresh

Accessed **2026-09-17**. The official [collapsible graph article][graph], published **2020-08-03** and
tagged for **Mac and Windows**, explicitly documents collapsing and expanding merge commits by clicking
their graph tips or using `←`/`→`, and collapsing all branches from the graph context menu before
expanding the branches of interest. This is high-confidence historical **D** evidence for those
advertised platform workflows. The article does not establish Linux support, the exact merge-boundary
rules, nested-merge behavior, persistence, paging behavior, or accessibility details.

This project’s first F05 slice is an **I** choice: collapsing a merge hides loaded commits reachable
only from its non-first parent, keeps merge tips and reference-decorated tips visible as navigation
handles, reconnects hidden edges at the nearest visible ancestor, and keeps collapse state scoped to
the active repository view. Left/Right keyboard commands, merge-tip buttons, and graph context-menu
actions are covered by unit tests and a disposable-repository Electron flow. Paged-history continuity,
large-history performance, exact current Fork visuals, and cross-platform pointer behavior remain
unverified; Linux follows the project’s independent implementation because Fork publishes no Linux
build.

### F06 source refresh

Accessed **2026-09-17**. The official [Fork for Windows 1.38 article][diff] explicitly documents a
sidebar filter for searching branches by name and a filter for file lists. This is high-confidence
**D** evidence for the Windows workflow, published **2019-08-27**; it does not establish the current
search panel layout or exact matching rules. The official [Mac release notes][mac] document a new
commit search, file-path search, and file matches for diff/path searches in Fork 1.0.98 (**2020-09-04**),
and recent search queries in Fork 2.9 (**2021-06-25**). These are high-confidence **D** outcomes for
Mac release history, but the notes do not specify the complete query language, scope, or current UI.
Neither source establishes Linux support or parity between the two platforms.

This project’s first F06 slice is an **I** choice: a reference context-menu action scopes the history
query to the selected reference’s validated commit target, while the commit search field performs a
bounded, case-insensitive, fixed-string search over commit messages. Since the 2026-09-17 design refresh
below, that field and its results live in a sidebar Search Commits panel instead of filtering the list.
Both filters use the existing generation guard and paged history request, and search text remains a
single backend argument. The slice is verified against disposable Git fixtures and an Electron flow.
File-list filtering, path history, diff-content search, author/hash search, recent-query persistence, and
large-history search performance remain unverified and are deferred to the changed-file/diff and P08
investigation slices.

### F07 source refresh

Accessed **2026-09-17**. The official [Fork product page][home] advertises a Commit List and says that
history can find commits where a file or directory changed. It also explicitly advertises browsing the
repository file tree at any commit. The page lists Mac and Windows downloads only, so this is high-confidence
**D** evidence for the advertised outcomes on those platforms, not Linux support or a complete interaction
specification. The published [history screenshot][history-image] is **O** evidence for the lower Commit,
Changes, and File Tree detail views, including author/committer blocks, SHA, parent links, and message;
it does not establish current spacing, changed-file merge rules, or blob-preview behavior.

The official [git-diff-tree documentation][git-diff-tree] defines comparing a commit with its parents and
machine-readable raw path metadata; [git-ls-tree][git-ls-tree] defines listing entries in a committed tree;
and [git-cat-file][git-cat-file] defines reading an object's type, size, and contents. These are **D** Git
semantics used to keep the backend independent of Fork and are not observations of Fork.

This project’s first F07 slice is an **I** choice: committed changes use `diff-tree -m` so merge revisions
show the union of paths changed against their parents, retain rename/copy similarity, modes, object IDs,
and unusual path bytes, and deduplicate identical path pairs. Revision trees are requested one directory
at a time through validated repository IDs and relative paths. Blob previews are bounded at 1 MiB and
return explicit binary/too-large states; repository text remains inert text. Disposable Git tests compare
paths and tree entries with independent CLI reads, and the Electron flow verifies changed-file, tree, and
text-preview selection. Merge presentation, tree caching/virtualization, path persistence, detached and
multiple-root integration, and large-tree performance remain unverified. Fork’s exact current behavior,
platform differences, and Linux support remain **U**.

### F08 source refresh

Accessed **2026-09-17** using the existing linked [working-changes image][changes-image] and [Windows
1.23 article][rebase]. The screenshot is **O** evidence of separate staged and unstaged file areas in
Fork’s working-changes workspace; the Windows article is **D** evidence for the documented staging and
discard workflow around the same surface. These sources are historical Windows-oriented material and do
not establish Fork’s current layout, exact status classification, ignored-file defaults, tree/list state,
Linux support, or Mac/Windows parity. Those details remain **U**.

This project’s initial F08 slice is an **I** choice: a backend-owned `status --porcelain=v2 -z` read
returns bounded staged, unstaged, untracked, and ignored DTOs; a partially staged path appears in both
relevant sections; rename/copy similarity, conflict status, and mode metadata remain visible; and the
renderer offers per-repository tree/list presentation with persisted visibility toggles. Git status
semantics are verified independently on Fedora Linux with disposable repositories; Fork equivalence,
platform differences, actual merge-conflict presentation, and later conflict/commit behavior remain **U**;
F10 records the independent staging implementation below.

### F09 source refresh

Accessed **2026-09-17** using the official [Windows 1.38 article][diff], the official [Mac 1.0.79
article][manager], and the published [side-by-side screenshot][split-image]. The Windows article is
high-confidence **D** evidence, dated **2019-08-27**, for inline diff search and side-by-side viewing;
the Mac article is **D/O** evidence, dated **2019-06-12**, for diff-mode controls and hidden-character
display; and the product screenshot is **O** evidence of a two-pane line-numbered comparison. These
historical Mac/Windows sources do not establish current defaults, complete whitespace semantics, merge
diff presentation, Linux support, or behavior for binary and very large files.

This project’s initial F09 slice is an **I** choice: a named backend diff capability returns bounded raw
Git patches for a validated committed or working-tree target, with normal, `ignore-all-space`,
`ignore-space-change`, and `ignore-space-at-eol` comparison modes. The renderer owns presentation state and renders unified or split
rows, adjacent-line inline highlights, literal search navigation, and optional visible space/tab/CR
markers. Binary, oversized, and conflict targets return explicit non-text states. Disposable Git and
Electron tests verify the local workflow; F10 adds snapshot-validated hunk/line actions; syntax rendering,
image viewers, and exact current Fork parity remain **U**. Linux follows the independent implementation
because Fork publishes no Linux build.

### F10 source refresh

Accessed **2026-09-17** using the existing official [Fork product page][home] and published [working-changes
image][changes-image]. The product page is **D** evidence that file staging belongs to the Commit workflow;
the Windows-oriented screenshot is **O** evidence of pane-level Stage/Unstage controls and inline hunk
Stage/Discard controls. These sources do not document Fork’s exact line-selection patch model, stale-edit
handling, conflict policy, binary behavior, current defaults, or Linux support; those details remain **U**.

This project’s initial F10 slice is an **I** choice: whole-file stage/unstage, hunk and line stage/unstage,
and hunk/line discard use a named backend capability with a filesystem/index snapshot token. The backend
rebuilds selected patches from a fresh normal-whitespace diff, serializes repository mutations, and refuses
stale snapshots; the renderer exposes explicit added/removed-line selection. Disposable Git tests compare
the working tree and index after partial actions and cover CRLF, missing final newlines, rename/deletion,
symlink, binary, mode, and unborn-repository cases. The implementation is Linux-first and is not presented
as observed Fork behavior.

### F11 source refresh

Accessed **2026-09-17** from the official [Mac release notes][mac] and [Windows release notes][win], the
[Fork product page][home], and the published [working-changes image][changes-image], [Mac local-changes
image][mac-changes-image], and [commit message length image][length-image].

Documented (**D**; version, date, and platform as listed): Mac 1.0.9 (2016-06-10) "Show number of
changed files on the commit button"; Mac 1.0.12 (2016-07-08) "Added recent commit messages to the commit
view" and Windows 1.16 (2018-05-08) "Add recent messages list to commit message field"; Mac 1.0.20
(2016-09-02) "Show character counter for commit subject line in commit dialog" and Windows 1.18
(2018-06-28) "Add commit header length reminder"; Mac 1.0.89 (2020-01-24) "Ability to configure commit
subject limit"; Mac 1.0.22 (2016-09-16) and Windows 1.21 (2018-09-25) commit-message spell checking;
Mac 1.0.44 (2017-04-20) "Show changes from the latest commit in amend mode" and GitClient 1.0.1
(2017-04-17) "Implemented a possibility to amend the last commit"; Mac 1.0.64 (2018-02-22) "Support
commit templates" and Windows 1.26 (2019-01-15) "Take commit template into account"; Mac 1.0.69
(2018-08-01) "Show output of pre-commit hooks interactively" and "Automatically resize the commit message
area"; Mac 1.0.57 (2017-10-09) "Add 'Skip hook' option when pre-commit hook fails"; Windows 1.70
(2022-01-28) "Ability to create commit message draft using prepare-commit-msg hook"; Windows 1.54
(2020-09-18) fixed "Amend message disappears after switching between Changes/All Commits"; Mac 1.0.61
(2017-12-15) "--signoff" support; Mac 1.0.58 (2017-10-23) GPG signing; Mac 1.72 (2022-04-15)
"Co-authored" signature autocomplete; Windows 1.24 (2018-11-26) "Ability to commit and push" with
Mac 1.0.34 (2016-12-16) and Windows 1.43 (2020-01-13) options to push automatically after a commit.

Observed (**O**): the composer sits under the diff with a subject field, a description field, an Amend
check box, and a Commit button. The product image shows the button labelled "Commit 9 Files" and a
remaining-character count of 18 for a 32-character subject; the Windows 1.17 image shows "-38" in red for
an 88-character subject. Both are consistent with a 50-character guide counted down and shown negative
once exceeded. The newer Windows image (`win-2026-05-13-trackerwin2777-1`, stated 2.21-era) shows the
same composer with a split Commit button that carries a menu arrow, and a small icon at the right of the
subject field. The subject icon's exact menu is **U**; the recent-messages release notes are the only
public evidence of what such a list contains.

This project's initial F11 slice is an **I** choice: one bounded `repository:get-commit-context` read
returns the identity Git would use, the commit an amend would replace with its published state, a
`commit.template` with comment lines removed, pending merge/cherry-pick/revert/rebase state with Git's
own prepared message, recent messages from the loaded history, the executable commit hooks present, and a
compare-and-swap token over HEAD, the pending operation, and the staged entries. `repository:commit`
re-reads that context, refuses a stale token, and runs one `git commit --cleanup=whitespace --file=-`
with the message on standard input. Hooks run because committing is an explicit user action, their output
is returned as bounded inert text, and `--no-verify` is offered only as a separate, explicitly chosen
action after a hook failure. Expected refusals (empty message, nothing staged, unmerged files, missing
identity) are reported as structured results rather than exceptions. The renderer keeps subject and body
drafts per repository, counts down from 50 characters, labels the button "Commit N Files", and prefills
an amend from the previous message. Ticking Amend also shows what the amended commit would contain in the
Staged pane, by reading the index against HEAD's parent: the commit's own files are marked, files staged
since then appear beside them, and nothing is reset, so unticking restores the ordinary view. Fork's Mac
1.0.44 (2017-04-20) "Show changes from the latest commit in amend mode" documents the outcome; its exact
presentation, and whether Fork mutates anything, remain **U**. Signing, `--signoff`, co-author autocomplete, commit-and-push,
spell checking, a configurable subject limit, and Fork's exact recent-message definition are not
implemented; Fork equivalence remains **U**.

### F12 source refresh

Accessed **2026-09-19** from the official [Mac release notes][mac] and [Windows release notes][win], the
[Fork product page][home], and the local screenshot library described at the top of this document
(entries dated 2018-09-14 to 2026-03-24).

Documented (**D**; version and date as the release pages list them): Mac 1.0.10 (2016-06-18)
"Implemented possibility to add and remove tags" and "Added possibility to remove local and remote
branches"; Mac 1.0.11 (2016-07-01) "Implemented remote branch tracking"; Mac 1.0.38 (2017-02-13)
"Implemented ability to rename for local branches"; Mac 1.0.45 (2017-05-10) "Delete multiple branches or
tags support" with Windows 1.27 (2019-02-08) "Ability to delete multiple branches" and Windows 1.74
(2022-05-20) / Mac 2.18 (2022-05-12) "Remove multiple branches or tags at once"; Mac 1.0.55 (2017-09-05)
"Allow to checkout remote branches"; Mac 1.0.57 (2017-10-09) "Replace spaces with hypnens in new branch
dialog" [sic]; Mac 1.0.65 (2018-03-15) "Add ability to change tracking reference for local branch" with
Windows 1.21 (2018-09-25) "Add ability to change tracking reference for remote branches"; Windows 1.15
(2018-04-25) "Validate reference names in create branch/tag dialogs"; Windows 1.18 (2018-06-28) "Track
remote branch on double-click" and Mac 2.16 (2022-02-18) "Checkout branch on label double click in
graph"; Windows 1.20 (2018-08-13) "Add Create Branch toolbar button"; Windows 1.35 (2019-06-21) "Don't
propose to delete upstream if it doesn't exist"; Windows 1.43 (2020-01-13) "No context menu for active
branch" and "Show branches and tags in commit details"; Windows 1.44 (2020-01-31) "Show different branch
icons according to upstream status" with Mac 1.0.90 (2020-02-21) "Show branch upstream status on
sidebar"; Windows 1.47 (2020-03-27) "Add F2 keyboard shortcut to rename local branch"; Mac 2.10
(2021-07-23) "Autocomplete for branch folders in Create Branch dialog"; Windows 1.75 (2022-07-08) "Add
push option to create tag dialog"; Mac 2.29 (2023-05-12) "⌘B for quick checkout is back"; Mac 2.59
(2025-11-07) "Show worktree icon for branches checked out in other worktrees" with Windows 2.17
(2026-03-13) "Display worktree icon on branches checked out in other worktrees"; Mac 2.62 (2026-01-23)
and Windows 2.16 (2026-02-20) "Select Stale Local Branches" on the sidebar; Mac 2.63 (2026-02-13)
"Option to remove corresponding worktree when deleting a branch"; Mac 2.21/Windows 2.21 (2026-07-16)
"Checkout remote branch as worktree" and "Show warning icon for active branch with invalid upstream".

Observed (**O**) in the local reference library: the macOS local-branch menu
(`mac-2026-03-22-tracker2584-2`, stated 2.65.0) reads Checkout '<branch>' / Checkout '<branch>' as
Worktree… — Push… / Push and Create Pull Request… — Merge into '<current>'… / Rebase on '<branch>'… /
Interactively Rebase on '<branch>'… — New Branch… (⇧⌘B) / New Tag… (⇧⌘T) — Tracking ▸ / Rename
'<branch>'… / Delete '<branch>'… — Copy Branch Name. The same menu opened on a branch another worktree
has checked out (`mac-2026-03-22-tracker2584-1`) has no Checkout entry at all, and its Fast-Forward item
is disabled. The remote-branch menu (`mac-2025-08-14-tracker2421-2`) starts with Checkout
'<remote>/<branch>' and also offers New Branch…, New Tag…, and Delete '<remote>/<branch>'…. The commit
menu (`mac-2025-08-14-tracker2421-1`) offers New Branch… ⇧⌘B and New Tag… ⇧⌘T; the 2018 Mac blog image
(`blog-2018-09-14-fork-1.0.70-new-branch-menu`) shows the same menu with Create New Branch…, Create New
Tag…, and Checkout Commit…. The Windows toolbar Branch button
(`win-2025-07-22-trackerwin2545-1`) opens with New Branch… on Ctrl+Shift+B. The macOS Branches section
menu (`mac-2026-01-26-tracker2534-1`) lists New Branch…, Select Stale Local Branches, and Sort Branches.
The Create Tag dialog (`win-2026-03-24-trackerwin2745-1`, `mac-2026-02-19-tracker2556-1` stated 2.62.1,
`mac-2026-04-17-tracker2604-4` stated 2.66.6) has a large mark, the title "Create Tag" with the line
"Create annotated tag at the selected point", a "Create tag at:" row naming the short hash and subject, a
"Tag Name:" field, an optional "Message:" area, a Push check box, a bottom-left warning ("Tag 'v0.2.7-ios'
already exists") and Create and Push / Cancel buttons, ordered affirmative-first on Windows and
affirmative-last on macOS.

Unresolved (**U**): the Create Branch dialog itself is not in any public image examined, so its fields,
defaults, and checkout behavior are inference here. Fork's exact deletion warnings, its upstream picker,
its branch icons per upstream state, and the current wording of every menu entry were not verified.

This project's initial F12 slice is an **I** choice: one bounded `repository:get-reference-context` read
returns the local branches with their upstream, stale-upstream flag, linked-worktree checkout, and
merged state, the tags with their peeled target and whether they are annotated, the remote names and
remote-tracking branch names, the working-tree and pending-operation state, and a compare-and-swap token
over HEAD, the local branches, and the tags. `repository:apply-reference-action` takes one named action —
create/rename/delete a branch, set or unset an upstream, check out a branch, a remote branch, or a
commit, and create or delete a tag — re-reads that context inside the per-repository mutation queue,
refuses a stale token, and runs exactly one Git invocation with backend-built arguments. A start point is
either a commit this window already saw or a reference the same read reported, so revision syntax never
reaches Git. Names are bounded in the shared schema and then validated by Git's own `check-ref-format`.
Refusals Fork's UI implies — a name in use, an unmerged branch, a branch another worktree has checked
out, the current branch, local changes a checkout would overwrite, a running sequencer — come back as
structured results with the exact obstacle, and only an unmerged deletion offers an explicit force.
Fork's multiple-branch selection and deletion, branch folders and moving, pinning, sorting, hiding,
"Select Stale Local Branches", checkout as a worktree, remote-branch deletion, pushing a tag from the
create dialog, F2 and ⌘B shortcuts, branch-folder autocomplete, and the space-to-hyphen replacement are
not implemented. This project keeps Ctrl/⌘+Shift+T for reopening a closed tab, so New Tag has no
shortcut; New Branch uses Ctrl/⌘+Shift+B as both platforms document.

### F13 source refresh

Accessed **2026-09-19** from the official [Mac release notes][mac] and [Windows release notes][win], the
[Fork product page][home], the [Windows 1.48 operations post][operations], and the local screenshot
library (entries dated 2020-05-05 to 2026-08-04).

Documented (**D**; version and date as the release pages list them): Mac 1.0.12 (2016-07-08) "Added
remote repository management (add/edit/rename/delete)" and "Implemented clone"; Mac 1.0.11 (2016-07-01)
"Implemented remote branch tracking"; Mac 1.0.27 (2016-10-21) "Show progress and status for clone, fetch,
pull and push operations"; Mac 1.0.31 (2016-11-25) "Display how many commits behind or ahead are" with
Mac 1.0.90 (2020-02-21) "Show branch upstream status on sidebar" and Windows 1.44 (2020-01-31) "Show
different branch icons according to upstream status"; Mac 1.0.33 (2016-12-09) "Add possibility to prune
branches during fetch"; Mac 1.0.34 (2016-12-16) "Pull using rebase instead of merge"; Mac 1.0.62
(2018-01-15) "git fetch --all"; Mac 1.0.72 (2018-12-01) and Windows 1.22 (2018-10-26) "Ability to pull a
branch without checking out it (fast-forward pull)"; Windows 1.16 (2018-05-08) "Automatically fetch
remotes"; Windows 1.25 (2018-12-14) "Allow to push a branch to a remote branch with different name" and
"Ability to push a single tag"; Windows 1.41 (2019-10-25) "Ability to push multiple branches at once";
Windows 1.55 (2020-10-30) "Global option to always fetch tags"; Mac 2.1 (2020-12-04) "Ability to edit
remote branch name on push"; Mac 2.20 (2022-07-15) and Windows 1.74 (2022-05-20) "Allow to fast-forward
multiple branches". The [Windows 1.48 post][operations] documents Git output with progress and
cancellation for network work.

Observed (**O**) in the local reference library: the Fetch dialog
(`win-2026-08-04-trackerwin2827-2`, stated 2.21.0.0) has a large mark, the title "Fetch" with the line
"Fetch latest changes from remote repository", a "Remote:" drop-down, a "Fetch all remotes" check box,
and Fetch / Cancel. The remote context menu (`win-2025-09-26-trackerwin2615-1`) reads Fetch 'origin'…
(Ctrl+Shift+F) — Edit 'origin'… — Delete 'origin'… — a checked "Fetch 'origin' Automatically". The
activity window (`win-2025-11-26-trackerwin2659-1`) has All / User / Background tabs, a list whose rows
carry a title such as "Pull 'origin/Slot1181'", a status line ("Everything is up to date"), a time, and a
spinner with a cancel cross while one runs; the detail pane repeats the title, says "succeeded" with a
timestamp, and shows the command (`$ git pull --rebase=false origin --prune`) above its output. The
2020 push post (`blog-2020-05-05-forkwin-1.48-push-multiple-branches`) shows a sidebar selection of three
branches with "Push 3 branches to 'origin'…". A macOS sidebar (`mac-2026-04-23-tracker2610-1`, stated
2.66.6) shows a branch row with `7↓27↑` beside its name.

Correction from the workflow audit below: a complete Windows Pull dialog was already in the reference
library, and a complete historical Windows Push dialog has now been added. Their visible fields are
**O**, not unresolved. Current defaults, force-push confirmation semantics, credential prompts,
background-fetch scheduling, and activity tab definitions remain **U**.

This project's initial F13 slice is an **I** choice. Long-running Git work is owned by a main-process
operation registry: `repository:start-network-operation` validates one named request, accepts it, and
returns a running record immediately, so the preload deadline never decides the outcome of a fetch or a
push. Progress, output, and completion arrive on `repository:operation-changed`, addressed to the window
that started the work; `repository:list-operations` and `repository:cancel-operation` complete the
surface, and a record stays queryable after every listener has gone. One network operation runs per
repository at a time, which is also how duplicate work is refused. Cancellation aborts the process group,
so the transport helper and ssh stop with it, and the result says the outcome is unknown rather than
retrying a write. Fetch, fast-forward-only pull, push, and deleting a branch on a remote each become
exactly one Git invocation with backend-built arguments: a push refspec can only name a local branch, and
`--force-with-lease` is only ever added by an explicit confirmation. Failures are classified into
authentication, network, rejected, lease, no-upstream, not-fast-forward, local-changes, not-found,
cancelled, and timeout, each with one actionable sentence, and an ordinary push that is rejected never
falls back to a force. Git's carriage-return progress becomes percentage updates, and only completed
phases are kept in the log; every line is stripped of terminal escapes and of credentials embedded in a
URL. Remote management adds, renames, retargets, and removes remotes with Git's own `check-ref-format`
validation, and declines an `ext::` URL, which would make Git run a local command, because repository
trust is a later phase. Merge and rebase pulls, interactive credential and
passphrase prompts, platform secret storage, clone, pushing a single tag, pushing to a differently named
remote branch, and fast-forwarding several branches at once are not implemented.

### F14 source refresh

P01 completion checkpoint (2026-09-22): the [infrastructure handoff](../reviews/p01-infrastructure.md)
records `P1-011:F1` and `P1-011-delayed-local-cancel-subcase:F1–F5`, original cases, screenshots and Git
verification. Confidence is high for the captured Windows 2.22.0.0 Activity composition and bounded
rejecting-remote trial. Linux now uses a wider list/output panel, underlined scopes, row times and a
compact header, with truthful cancellation-requested/terminal states. Trust, version gating, process
supervision and queue policies are independently specified and tested. F14's P01 infrastructure is
complete; the broader P05 provider/native-helper and P14 platform matrices remain partial. This does
not turn the catalogue's accepting-remote or real-network cancellation unknowns into observed outcomes.
The following dated paragraphs retain the earlier slice's historical scope.

Accessed **2026-09-19** from the official [Fork 1.0.67 article][activity], the official [Fork for
Windows 1.48 article][operations], and the local activity screenshots listed in
fork-references.json. The Mac article is **D**, dated **2018-05-28**, and says that Fork automatically
fetches all remotes in open tabs every 20 minutes, with per-remote contextual-menu and global preference
controls. It also documents cancellation of fetch, pull, push, and clone, and an activity manager that
keeps past/current activities with their results. The Windows article is **D**, dated **2020-05-05**,
and documents cancellation plus Git command output in the activity manager. These sources establish
advertised Mac and Windows outcomes, not Linux support, credential-prompt behavior, current defaults, or
the internal scheduling policy.

The current local reference library provides **O** evidence for an activity surface with All, User, and
Background tabs, operation rows, cancellation affordances, command text, output, and terminal status.
The Windows screenshot shows a Pull and Fetch row; the newer macOS screenshot shows command output from
a commit. Neither screenshot proves the scheduler's timing or the meaning of every tab.

This project's F14 slice is an **I** choice: automatic fetching is enabled by default for configured
remotes in open tabs, uses a 20-minute main-process timer, allows a durable per-remote opt-out from the
remote context menu, rotates several remotes through one repository slot, and applies a repository-global
acceptance guard across windows. Operations carry a validated user/background source, remain queryable
after listener removal, stream bounded redacted progress/output, and can be cancelled through the same
process-group policy as explicit network work. Disposable Git tests cover opt-out/re-enable scheduling,
preference recovery and rename, duplicate prevention, and independent remote-ref assertions; the
Electron flow covers the activity scope controls. The global automatic-fetch preference documented by
the Mac article, credential/passphrase prompts, clone cancellation, and cross-platform runtime behavior
remain **U** or deferred to P05.

### F15 source refresh

Accessed **2026-09-19** from the official [Fork for Windows 1.48 article][operations], the official
[Windows release notes][win], the official [Mac release notes][mac], and the official [Fork 1.0.70
article][patches]. The Windows article is high-confidence **D**, dated **2020-05-05**, for a partial
stash command in the file context menu that saves individual changed files instead of the whole working
directory. This is Windows evidence; it does not establish the Mac UI, hunk-level selection, staged-state
rules, or Linux support. The Windows 1.49 notes document saving a stash as a patch, and the current
Windows 2.21 and Mac 2.69 notes document a Save as Patch command in the stash context menu. These are
**D** outcomes on the listed platforms, with no public evidence that the current defaults or dialog
wording are identical across Mac and Windows. The 2018 Mac article documents saving commits as patches;
the 2018 Fork 1.0.70 article documents saving selected working-directory files as a patch.

This project's verified F15 slice is an **I** implementation: reflog stashes are enumerated by stable
commit ID and included as independently labelled history entries; a named stash operation can save all
supported changes or selected whole-file paths, optionally including untracked files; inspect, apply,
pop, and delete re-read the current stash list, preserve staged state with `--index`, keep a failed pop
in Git, and protect Recovery copies from normal deletion. Commit, stash, and selected working-tree
patch export use a bounded main-process save dialog and backend-built Git arguments. Snapshot checks
prevent a stale selected-file stash or working patch from using changed data. Hunk/line-level stash
selection, patch import/apply, multi-commit patch bundles, and exact Fork dialog defaults remain outside
this slice and are deferred to the later P08 patch work. Linux follows the independently authored
Windows-oriented layout because Fork publishes no Linux build.

### F01–F13 workflow audit and reference correction

Accessed and visually inspected **2026-09-19**. The [audit report](../reviews/f01-f13-review.md)
records application defects, missing workflows, reproduction evidence, and proposed acceptance criteria.
The original review changed no implementation status. Its subsequently verified remediation is recorded
below; F01–F13 remain partial feature families.

- **O, high confidence for the captured Windows UI:** the existing
  `win-2025-11-25-trackerwin2658-1-dialogs-dark.png` from
  [TrackerWin issue 2658](https://github.com/fork-dev/TrackerWin/issues/2658), posted **2025-11-25**,
  shows the entire Pull dialog. It contains Remote and Branch selectors, a non-editable Into branch,
  rebase and stash/reapply checkboxes, and Pull/Cancel actions. The earlier claim that these fields
  could not be established was incorrect. The version is unstated; neither current defaults nor
  macOS behavior follow from this image.
- **O, high confidence for the visible controls; historical Windows evidence:** newly indexed
  `win-2023-04-29-qiita-checkout-dark.png` from
  [segur's public hands-on article](https://qiita.com/segur/items/8ce6914af5578c5f4ce2), published
  **2023-04-29**, updated **2023-05-14**, shows the target branch, three local-change radio choices
  (stash/reapply, preserve changes, discard), and Checkout/Cancel. It corroborates the user's
  2026-09-19 report. Windows is identified from the captured chrome; the Fork version and image
  capture date are unstated. The selected choice is an observed state, not proof of a default.
  The article's explanations are not used to define Git semantics or recovery guarantees.
- **O, historical Windows evidence:** `win-2023-04-29-qiita-push-dark.png`, from the same article,
  shows separate source-branch and destination selectors, with a remote/branch pair in the latter.
  It also shows tag and force options. It does not establish whether the force option uses a lease.
- **D, high-confidence historical Windows workflow:** the official
  [Windows 1.23 article](https://fork.dev/blog/posts/forkwin-1.23/), published **2018-11-10**, describes
  updating an inactive branch from its remote without checking it out. Its already indexed image
  `blog-2018-11-10-forkwin-1.23-fast-forward-pull.png` is a branch menu, previously categorized only
  as a dialog. It is now indexed under branch menus, fast-forward, and pull. This is a separate
  workflow from running `git pull --ff-only` on the current branch.
- **O, Windows:** the existing cropped menu
  `win-2026-03-24-trackerwin2746-4-menus-dark.png` from
  [TrackerWin issue 2746](https://github.com/fork-dev/TrackerWin/issues/2746), posted **2026-03-24**,
  stated **2.18.0.0**, shows upstream fast-forward, push, and pull-request creation entries above
  merge/rebase. Its crop does not establish the complete menu or checkout availability. The full
  current menu supplied by the user remains user-reported evidence, not an independently observed
  current Fork session.
- **D, historical Windows workflow:** the official
  [Windows 1.48 article](https://fork.dev/blog/posts/forkwin-1.48/), published **2020-05-05**, places
  pull-request creation in the branch context menu. The plan groups hosting integration in P11;
  the audit recommends separating an earlier browser handoff from later account/list/notification
  integration. That scope split is our **I** recommendation, not a claim about Fork's implementation.

Linux continues to follow the Windows visual target. These captures do not establish current macOS
equivalence, defaults, clean-versus-dirty checkout triggering, untracked-file discard scope, preservation
of staged state during stash/reapply, or conflict recovery. Those need explicit product rules and Git
fixture tests. Collecting an image is not acceptance of a workflow: each relevant control must be mapped
to a contract, implementation, failure/recovery path, and test before coverage is described as complete.

### Stabilization implementation verification

Verified **2026-09-19** on Fedora Linux with Git **2.55.0** and Node **24.13.0**. These are **I** product
decisions and independently tested Git behavior, not observations of Fork internals. The preceding
initial-slice limitations are historical where superseded by this record.

- F12 now includes checkout local-change radio choices and full-reference tracking/creation. Preserve
  uses Git's ordinary refusal/carry behavior. Stash/reapply restores index state; Discard previews tracked
  and untracked paths and keeps a recovery copy. Linux follows Windows affirmative-button order.
- F13 now has a Pull dialog with explicit source/destination, merge/rebase and stash/reapply options;
  separate inactive-branch fast-forward; and visible editable Push destinations derived from exact
  upstream configuration. Pull to an inactive branch states that it will check it out first. Fast-Forward
  leaves the active worktree alone. Other-worktree checkouts and stale snapshots are refused.
- The F15/F16 subset keeps saved changes in named stashes and pinned recovery refs, persists a per-worktree
  journal, and offers apply, resolution acknowledgement, and merge/rebase continue/skip/abort after restart.
  Ordinary merge and rebase operations revalidate backend-issued refs, support named stash-and-reapply,
  expose branch context-menu and drag/drop entry points, and leave conflicts as unfinished Git states.
  This is not general stash management, interactive rebase, or the full three-way conflict editor.
- The F29 subset opens a validated GitHub.com, GitLab.com, Bitbucket.org, or Azure DevOps PR form in the
  system browser. Accounts, PR submission, listing, and notifications remain outside this slice.
- R1–R12 and late-result ownership risks are addressed. `npm run check` passes **239 tests** plus type,
  lint, and format checks. Production build and **three headless Electron scenarios** pass. The test
  browser handoff is intercepted; live hosting forms and authentication were not exercised.

UI captures were compared with the restored local checkout, Pull, Push, branch-menu, and activity
references. All 226 public images remain ignored and unbundled. Screenshot evidence establishes the
visible controls, not exact current palettes/defaults or cross-platform equivalence. The performance
improvements and remaining verification limits are detailed in the [remediation record](../reviews/f01-f13-review.md#remediation-verified--2026-09-19).

### F34 workspace chrome, graph drawing, and context-menu refresh

Accessed **2026-09-16**, prompted by a request to bring the layout, graph drawing, context menus, and
title bar closer to Fork. Only the public images and release-note pages linked below were used; images
were viewed in a temporary working directory (they are now part of the local reference library described
at the top of this document). Frames of the public blog GIFs were inspected individually.

Observed in public images (**O**; contents date from 2019–2020, so current spacing may differ):

- Windows window chrome ([history image][history-image], [manager image][manager-image]): a
  custom-drawn top row holds File/View/Repository/Window/Help menus, a centered title, and
  minimize/maximize/close buttons. Below it, an icon-over-label toolbar has Quick Launch, Fetch, Pull,
  Push, and Stash with a dropdown; a centered repository panel with an activity button, repository
  name (`*` when dirty), and current branch; New Branch; then Open in, Console, Appearance, and
  Feedback. Equal-width repository tabs follow, with `*` for uncommitted changes and a `+` button.
- The manager image shows a new tab titled Repository Manager with a Recent/Repositories tree, a
  details pane with an Open button, "Welcome to Fork! Open a repository to start" in the toolbar
  panel, and only File/Window/Help menus while no repository tab is active.
- The [Mac history image][mac-history-image] shows the same toolbar and tabs with native traffic
  lights inside a full-height sidebar.
- The repository sidebar has the repository name and a settings button, Changes (count) and All
  Commits entries, an icon row (branches, search, hosting service), a Filter field, and a tree of
  Starred, Branches, Remotes, Tags, Stashes, and Submodules. Branch names containing `/` appear as
  folders; the current branch has a check mark, bold text, and ahead/behind counts
  ([branch status image][branch-status-image], [sidebar filter image][sidebar-filter-image]).
- The commit table has no column headers: graph, reference labels and subject, avatar and author,
  short SHA, and date. The HEAD commit row is bold, and commits not reachable from the current branch
  are gray. Details below use Commit, Changes, and File Tree tabs with author/committer blocks, SHA,
  parent links, and the message.
- Graph drawing ([collapsible graph image][graph-image], [colored labels image][labels-image]):
  lanes are vertical lines that keep their column; a merge edge leaves the merge commit horizontally
  and turns down into the parent's lane with a rounded corner; a lane ending at its parent turns
  into that commit with a rounded corner; ordinary commits are small rings and merge commits are
  larger filled markers. Reference labels use a light tint of the commit's lane color with a border
  in that color, and a remote-tracked label adds a hosting-service icon segment.
- Menus ([bisect GIF][bisect-gif], [partial stash GIF][stash-gif], [drag-and-drop GIF][dnd-gif]):
  title-bar menus list shortcuts at the right and submenu arrows. The commit context menu starts with
  Create New Branch…, Create New Tag…, Interactive Rebase ▸, Reset '<branch>' to Here…, Checkout
  Commit…, Cherry-pick Commit…, Revert Commit…, Save as Patch…, and Copy Commit SHA (later entries are
  cropped). A right-clicked row is highlighted without replacing the selection. File and
  branch-drop menus are also renderer-styled popups.
- Some 2020 GIF frames also show lanes moving sideways with S-shaped transitions when space frees up.

Documented in release notes (**D**; version and date shown, Mac or Windows as listed): Mac 1.0.11
(2016-07-01) “Made the window title-less”; Windows 1.16 (2018-05-08) “Move application menu to
title”; Mac 1.0.18 (2016-08-22) unreachable revisions shown in gray; Mac 2.30 (2023-06-23)
“Emphasize active branch in commit list”; Windows 1.34 (2019-06-08) and Mac 2.53 (2025-05-21) branch
labels drawn with their graph colors; Windows 2.16 (2026-02-20) “Refreshed visual style - chevron
icons, updated graph lines, new toolbar icons” and a fix for “Vertical graph lines have subtle
horizontal offsets between rows”; Mac 2.65 (2026-03-20) and Windows 2.18 (2026-03-24) “Add 4 more
graph colors”; Mac 2.15 (2022-01-07) light/dark theme independent from the system; Windows 1.15/1.27
(2018/2019) closing tabs with middle click; Windows 1.30 (2019-03-22) “Close All” and “Close All But
This” in the tab context menu; Windows 2.21 (2026-07-16) Open in Terminal and Open in File Explorer
in the tab context menu; Mac 2.68 (2026-06-19) tab context menu Rename, select color, Open in
Terminal, Show in Finder; Mac 2.3 (2021-01-22) and Windows 1.58 (2021-01-15) copy to clipboard in
the branch context menu; Mac 1.0.35 (2017-01-13) “Open in Finder” in the repository manager context
menu; Mac 1.0.41 (2017-03-22) repository manager when all tabs are closed; Mac 2.66 (2026-04-10)
arrow-key sidebar navigation; Windows 2.20 (2026-06-05) Ctrl+Shift+T reopening and Tab/Shift-Tab
navigation between sidebar, commit list, and details. Sources: [Mac releases][mac], [Windows
releases][win].

This project’s implementation is an **I** choice built from those observations and documented
outcomes: Linux and Windows use a frameless Electron window with a renderer-drawn title bar, menu
bar, and window controls; macOS keeps native traffic lights and its native application menu. All
context menus and title-bar menus share one renderer menu component. Graph lanes keep their column,
elbows are quarter circles, and lines slightly overlap row boundaries so they stay continuous.
Unimplemented Git operations keep Fork’s menu and toolbar positions but are disabled with a tooltip
naming the planned phase. Colors, icons, and wording are independently authored; Fork assets are not
used.

Unresolved (**U**): the full current commit, branch, and tab context-menu contents; whether lanes
still move sideways; the rules behind “Compact branch labels” (Windows 1.55, Mac 2.19); and exact
current palettes and spacing. Linux has no Fork release to compare with, so Linux chrome follows the
Windows layout. The 2026-09-17 refresh below resolves the graph-marker refresh, tab indicators, and
Mac vertical-tab placement from newer public screenshots.

### Design reference refresh (2026-09-17)

Accessed **2026-09-17**, prompted by a request to realign the design after the F05–F08 slices. The
official images above date from 2018–2020, so current visuals come from user screenshots attached to
Fork’s public issue trackers ([Mac][tracker-mac], [Windows][tracker-win]) between 2025-03 and 2026-09,
plus the images already cited. File-name prefixes below identify images in the local reference library;
each entry in [`fork-references.json`](fork-references.json) links its issue. Reporter annotations and
redactions are not Fork UI, and a mockup attached to Mac issue 2707 was excluded. Versions are cited only
where the reporter stated them.

Observed (**O**):

- Windows chrome, 2025-08 to 2026-08 (`win-2025-08-01-trackerwin2560-2`,
  `win-2026-05-13-trackerwin2777-1`, and `win-2026-08-13-trackerwin2830-1`, which states 2.21): the title
  row has menus, a centered title, and feedback (and, in `win-2026-05-23-trackerwin2789-1`, notification)
  icons beside the window buttons. The compact toolbar reads Quick Launch, Fetch, Pull, Push, Stash ▾,
  the repository panel (name and branch, without `*`), Branch ▾, then Open in ▾, Console, Appearance ▾,
  and Work ▾. Equal-width tabs are low and mark uncommitted changes with a dot at their left edge
  (`win-2025-06-08-trackerwin2514-1`); Windows preferences name a “Tab indicator for uncommitted changes”
  (`win-2025-12-17-trackerwin2670-2`). Mac 2.x pill tabs show the dot at the right
  (`mac-2026-04-13-tracker2598-1`).
- Mac 2.70-era window (`mac-2026-09-10-tracker2707-1`, issue posted six days after the 2.70 release):
  a left column lists workspace repositories while the horizontal pill tabs remain; the detail views
  use a segmented Commit/Changes/File Tree control.
- Graph (Windows 2.17–2.22, Mac 2026: `win-2026-03-24-trackerwin2747-1`,
  `win-2026-09-10-trackerwin2847-1`, `mac-2026-09-10-tracker2707-1`): ordinary commits are small filled
  dots; merge commits are rings holding a chevron, pointing down while expanded and right while
  collapsed. This matches the Windows 2.16 (2026-02-20) release note “Refreshed visual style - chevron
  icons, updated graph lines, new toolbar icons” (**D**). Right-clicking the graph at a merge showed a
  menu with Collapse, Expand All, and Collapse All (`win-2025-07-23-trackerwin2548-1`).
- Labels (`win-2026-04-16-trackerwin2763-1`, `win-2025-11-03-trackerwin2642-1`): a branch label is a
  lane-tinted box; a hosting/remote icon sits in its own adjacent box; tags use one lavender box with an
  icon segment. Subjects with a message body end in a return-arrow indicator
  (`mac-2026-07-02-tracker2658-1`, `mac-2026-07-16-tracker2668-1`).
- Commit menu (`win-2025-10-12-trackerwin2628-3`, `mac-2025-08-14-tracker2421-1`): New Branch…,
  New Tag…, Interactive Rebase ▸, Reset '<branch>' to Here…; later entries are not shown.
- Search (`win-2026-04-16-trackerwin2763-1`): the sidebar magnifier replaces the reference tree with
  Search Commits, a query field, a “Commit Message ▾” scope, a result count, and result rows with avatar,
  subject, and date. A reference-filtered commit list shows “Filtered by: '…' Clear filter” above it.
- Commit details on Windows use underlined tabs (`win-2025-08-27-trackerwin2584-1`,
  `win-2025-08-01-trackerwin2560-2`). The Commit tab lists changed files under the message. The Changes
  tab starts with a one-line summary (avatar, author, short SHA, date, subject), then a file pane with a
  search strip and a folder tree or Name/Location list with colored status badges, beside the diff
  (`site-imagediffwin`, `win-2026-03-24-trackerwin2747-1`). The File Tree tab pairs a folder tree
  (folders first) with a line-numbered preview (`mac-2026-09-10-tracker2707-1`,
  `win-2025-10-07-trackerwin2626-1`).
- Local changes (`win-2026-05-13-trackerwin2777-1`, `win-2026-03-23-trackerwin2743-1`,
  `win-2025-10-30-trackerwin2641-1`, `mac-2025-09-23-tracker2464-1`, `site-commitviewwin1`): an Unstaged
  pane with Stage sits above a Staged pane with Unstage; untracked files appear in Unstaged with an added
  badge. A strip above them holds search, an eye toggle, and an options menu with View as Tree, View as
  List, View as Combined List, Hide Untracked Files, and Show Ignored Files
  (`mac-2026-04-25-tracker2616-1`). The diff fills the right side above a commit composer with subject,
  description, Amend, and Commit.

Implemented from these observations (**I**, independently drawn): commit dots and chevron merge rings;
separate remote-marker label boxes and fixed-color tag labels; the message-body indicator; a compact
toolbar with Branch ▾ and a Console button (both disabled with their phases); dot tab indicators; a
sidebar Search Commits panel whose results select commits in the unfiltered list, loading at most 40
further history pages to reveal one; a “Filtered by … Clear filter” strip; a graph menu on right-clicks
inside the graph column, with the same commands appended to the commit menu so they stay reachable from
the keyboard; the Commit tab file list; Changes and File Tree split panes with a lazily loaded folder
tree; and the Local Changes Unstaged/Staged layout with its options menu. Views that depend on later
phases keep Fork’s positions but explain themselves: the diff area shows the independently implemented
bounded local diff; Stage and Unstage plus hunk/line actions are enabled by F10, and F11 enables the
commit composer with its subject counter, recent messages, Amend, and "Commit N Files" button. The F11
slice also removed the F08 placeholder metadata list above the diff, which Fork does not show: the file
header now carries only the status badge, the path, and any rename or mode detail. The active detail tab
persists
while other commits are selected. View as Combined List, the eye toggle, and search scopes other than
commit messages are not implemented.

Unresolved (**U**): whether choosing a Fork search result filters or only scrolls the commit list; the
complete search scope list; the eye toggle’s meaning; whether colored tab dots are tab colors or change
indicators; current dark and light palettes; and all Linux behavior.

## Feature coverage

Phase IDs refer to [the implementation plan](../implementation-plan.md).
The [2026-09-19 remediation](../reviews/f01-f13-review.md#remediation-verified--2026-09-19) verifies F12
checkout local-change choices, F13 selected-source pull, inactive-branch fast-forward, visible push
destinations, and the early F29 PR browser handoff. The F15/F16 recovery subset supports these workflows;
the full feature families below remain partial. Reference evidence alone is not implementation evidence.

The B topic IDs below resolve through the [complete catalogue crosswalk](fork-catalogue-alignment.md#complete-topic-to-implementation-crosswalk)
to dossiers and original cases. B is shorthand for catalogue evidence; each claim must distinguish
B-UI from B-Git and retain its trial's limits. “Partial” describes the implemented subset, not verified
parity with every captured state. F33's file-manager action and F36's initial export subset originated in
earlier slices; F36's dated handoff now records the verified import and clipboard workflow.
F38's dated handoff records an independently specified local workflow; Fork execution remains unobserved.

| ID  | Target                                                                                | Evidence                                                                                                                             | Project status (2026-09-20)                                                                                                                                                                                                                      | Owner                         |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| F01 | Initialize/open/clone/recent repositories                                             | D: [product][home]; B: P0-002, P1-012                                                                                                | P02/P05 complete for Linux (2026-09-23): repository sessions and authenticated local HTTPS/SSH clone verified; live provider/native platform matrix remains unverified                                                                           | P02, P05 / C03                |
| F02 | Manager hierarchy, source directories and discovery                                   | D: [manager][manager], [releases][win]; B: P0-002 (opening only)                                                                     | P02 complete for Linux (2026-09-23): hierarchy, aliases, default sources, summaries, scan jobs and discovery verified; P12 workspace extensions remain                                                                                           | P02, P12                      |
| F03 | Horizontal tabs, optional workspace repository list, dirty indicators, reorder/reopen | D: [releases][win]; B: P0-004–005, P2-015                                                                                            | P02 complete for Linux (2026-09-23): additive list, order/reopen, watchers, isolated state and restart recovery verified; P12 workspace extensions remain                                                                                        | P02, P12 / C01                |
| F04 | History graph, labels, authors, hashes, dates and selection                           | O: [history][history-image]; B: P0-003, P0-006–007, P2-017                                                                           | P03 complete for Linux (2026-09-23): ancestry, navigation, virtualization and 100k/1k browser budgets verified; [handoff](../reviews/p03-history.md)                                                                                             | P03 / C01                     |
| F05 | Graph merge collapse/expand                                                           | D: [graph][graph]; no focused catalogue trial                                                                                        | P03 complete for Linux (2026-09-23): independent projection, paging connectivity and visible selected-commit retention verified; exact unobserved Fork rules remain unknown                                                                      | P03                           |
| F06 | Ref/file filters and scoped commit/path/content search                                | D: [diff][diff], [releases][mac]; B: P1-029                                                                                          | P03/P08 Linux scope complete (2026-09-26): fields/scopes/highlights, SHA/recent queries, bounded cancellation and repository invalidation verified; see P08 handoff                                                                              | P03, P08 / C05                |
| F07 | Commit metadata, parent navigation, changed files and revision tree                   | D/O: [product][home], [history][history-image]; B: P0-007, P1-033                                                                    | P03 complete for Linux (2026-09-23): parent/HEAD/session navigation, inline changes, paged large trees, inert blobs and resize/hide/pop-out verified; F21 variants stay in P08                                                                   | P03 / C01, C05                |
| F08 | Separate staged/unstaged lists, tree/list and visibility/count state                  | D/O: [changes][changes-image]; B: P0-014–017, P0-025                                                                                 | P04 complete for Linux (2026-09-23): staged/unstaged/conflict lists, tree/list, visibility combinations and counts verified; see P04 handoff                                                                                                     | P04 / C02                     |
| F09 | Text diff, context/full-file/wrap, whitespace, popup and explicit large-diff load     | D: [diff][diff]; B: P0-026–028, P2-004/P2-007                                                                                        | P04 complete for Linux (2026-09-23): bounded syntax/text review, controls, popup, large-load and anchors verified; richer image formats remain P10                                                                                               | P04 / C02                     |
| F10 | File/hunk/line stage/unstage and discard                                              | D/O: [product][home], [changes][changes-image]; B: P0-018–024, P0-032                                                                | P04 complete for Linux (2026-09-23): precise file/hunk/line actions, reverse patches, metadata isolation and safe discard/Recovery verified; untracked deletion not claimed                                                                      | P04 / C02                     |
| F11 | Commit/amend, templates/messages/hooks and composer states                            | D: [releases][win]; B: P0-029–031                                                                                                    | P04 complete for Linux (2026-09-23): commit/amend, drafts/templates, identity/hooks/failure and compact composer verified; broader public assistance remains unclaimed                                                                           | P04 / C02                     |
| F12 | Branch/tag lifecycle, tag details, clean/dirty/detached checkout                      | D: [releases][win]; B: P1-001–005                                                                                                    | P05 lifecycle complete for Linux (2026-09-23), including reviewed batch/stale deletion and scoped remote/tag writes; broader public pin/hide/custom sorting remains unclaimed                                                                    | P05 / C03                     |
| F13 | Remotes/Test Connection, fetch/pull/push, clone/upstream                              | D: [operations][operations]; B: P1-007–012                                                                                           | P05 complete for Linux (2026-09-23): remote editing, explicit push review, tracking/tags, local TLS/SSH authentication and Pull verified; live provider/platform matrix remains unverified                                                       | P05, P06 / C03                |
| F14 | Automatic fetch, operation activity/output and cancellation                           | D: [activity][activity]; B: P1-008/P1-011                                                                                            | P01/P05 Linux requirements verified, including accepting-receiver and credential cancellation; broader provider/native-platform coverage remains unverified                                                                                      | P01, P05 / C03                |
| F15 | Stash history, partial stash, new-file policy, apply/pop/drop and patch export        | D: [operations][operations], [patches][patches]; B: P1-013–015, P2-005                                                               | P06 complete for Linux (2026-09-24): file/hunk/line stash, staged-state preservation, apply/pop/drop/rename and durable conflict recovery verified; F36/P08 patch import/export remains separately traced                                        | P06, P08 / C03–C05            |
| F16 | Merge modes, ordinary rebase, recovery and branch drag entry points                   | D: [operations][operations]; B: P1-006/P1-019–022 (Fork drag effects uncaptured)                                                     | P06/P07 complete for Linux (2026-09-26): four merge modes, ordinary/interactive rebase, conflict previews, restart recovery and explicit merge-topology policy verified                                                                          | P06, P07 / C04                |
| F17 | Conflict cards and built-in two-input/editable-result helper                          | D: [merge][merge]; B: P1-015–020, P1-022/P1-025–026                                                                                  | P06 complete for Linux (2026-09-24): side cards, multi-region/manual text, delete/rename/binary/gitlink choices, external tools and operation-backed staging verified; platform/parity unknowns retained                                         | P06 / C04                     |
| F18 | Visual interactive rebase, plan/message editing and Edit/amend/continue               | D: [rebase][rebase]; B: P1-023–024                                                                                                   | P07 complete for Linux phase scope (2026-09-26): catalogue-aligned editor/quick actions, messages, dependent refs, merge policy, published warnings and retained backup/restart recovery; Fork option effects and platform parity remain unknown | P07 / C04                     |
| F19 | Cherry-pick, revert and Soft/Mixed/Hard reset                                         | D: [product][home]; B: P1-025–027                                                                                                    | P06 complete for Linux (2026-09-24): single-commit/mainline/no-commit workflows, restart/empty-result recovery, three reset modes and untracked/ignored safeguards verified; batch history selection stays outside this phase                    | P06 / C04                     |
| F20 | Lost commits/reflog mode and recovery                                                 | D: [product][home]; B: P1-028                                                                                                        | P08 Linux scope complete (2026-09-26): graph/Exit, Mixed Reset, named branch/annotated-tag recovery and expired-object handling verified; see P08 handoff                                                                                        | P08 / C05                     |
| F21 | File/directory/selected-code history, rename-aware History and Blame                  | D: [product][home], [releases][win]; B: P1-030–031/P1-033                                                                            | P08 Linux scope complete (2026-09-26): directory/code history, compact timeline/Blame, original-path navigation, change highlighting and exact Save As verified; copy/platform parity remains unclaimed                                          | P08 / C05                     |
| F22 | Worktree lifecycle, occupied-branch state and linked tabs                             | D: [releases][win]; B: P2-001                                                                                                        | P09 Linux scope complete (2026-09-29): local/remote/detached worktrees, linked identity, lock/unlock, reviewed removal/prune and shared refs verified; broader platform parity unclaimed                                                         | P09 / C05                     |
| F23 | Submodule lifecycle, revision comparison, dirty state and navigation                  | D: [merge][merge]; B: P2-002                                                                                                         | P09 Linux scope complete (2026-09-29): nested lifecycle, compact pointer graph, child tabs, missing/interrupted updates, conflict continuation and exact removal review verified; capture unknowns retained                                      | P09 / C05                     |
| F24 | LFS initialization, historical payload retrieval, transfers and locks                 | D: [manager][manager], [operations][operations]; B: P2-011                                                                           | Partial; local pointer/materialized inspection, initialization, exact Save As and unchanged-pointer verification; remote/auth/locks/push open                                                                                                    | P10 / C05                     |
| F25 | Git-flow feature/release/hotfix workflows                                             | D: [product][home], [git-flow docs][gitflow-presentation], [Windows 1.17 UI](https://fork.dev/blog/posts/forkwin-1.17/); public-only | P09 Linux scope complete (2026-09-29): native initialization/version prefix, correct lifecycle destinations and durable finish recovery verified; additional automation and exact Fork defaults unclaimed                                        | P09                           |
| F26 | Bisect start/good/bad/skip/abort and result                                           | D: [operations][operations]; B: P2-006                                                                                               | P08 Linux manual scope complete (2026-09-26): endpoints, Skip/Abort, restart and outcomes verified; [refresh-safe controls and stale-checkout protection](../reviews/p08-bisect-refresh.md) corrected; automation/custom terms unclaimed         | P08 / C05                     |
| F27 | Binary metadata and side-by-side/swipe/onion-skin/pixel image comparison              | D: [diff][diff], [releases][mac]; B: P0-026, P2-003                                                                                  | Bounded PNG/JPEG four-mode workflow verified 2026-09-22; pixel policy independently specified from public-only evidence; other codecs/SVG/LFS previews remain ([handoff](../reviews/f27-image-diffs.md))                                         | P04 fallback, P10 / C02, C05  |
| F28 | GPG signing/verification and signed tags                                              | D: [product][home], [releases][mac]; public-only                                                                                     | Bounded GPG commit/amend/tag signing, repository key and explicit verification implemented; native pinentry/platform matrix unverified ([handoff](../reviews/f28-signing.md))                                                                    | P10                           |
| F29 | Hosted accounts/repository lists and PR entry points                                  | D: [operations][operations], [releases][win]; public-only; 2026-09-24 user-specified account forms                                   | Partial; five-provider token accounts, repository browsing, exact-server HTTPS Git and configurable GitHub device OAuth verified with fixtures (2026-09-24); live authorization, renewal and platform coverage remain                            | P11, P05 auth                 |
| F30 | Notifications and issue/PR lists/filters                                              | D: [product][home], [releases][win]; public-only                                                                                     | Verified GitHub explicit-refresh slice (2026-09-22): paged lists, state/author/assignee/title filters, recent session searches, notification inbox and safe links; automatic alerts and other providers remain                                   | P11                           |
| F31 | Quick Launch commands and parameter selection; fuzzy lookup                           | D: [Quick Launch][quick]; B: P1-032                                                                                                  | Implemented bounded command/repository/branch/tag/file lookup; [F31 handoff](../reviews/f31-quick-launch.md). Exact ranking/inventory parity unverified.                                                                                         | P12 / C05                     |
| F32 | Contextual custom commands, action editor, forms and shared definitions               | D: [activity][activity], [releases][win]; B: P2-008                                                                                  | Bounded Linux workflow verified (2026-09-22): editor, five targets, reviewed Bash/process/URL execution, forms, disabled imports/export and cancellation; exact Fork formats/aliases and asynchronous modes remain partial                       | P12 / C05                     |
| F33 | External tools, historical-content handoff, terminal/file manager and CLI opening     | D: [activity][activity], [releases][win]; B: P2-009                                                                                  | Partial; configurable editor/diff/terminal and reviewed text merge handoff implemented; CLI/file-manager verified; non-text/daemon/platform variants remain                                                                                      | P02, P12 / C05                |
| F34 | Chrome, menus, themes, preferences, focus, splitters and state retention              | D/O: [releases][win], [history][history-image]; B: P0-003–013, P2-012–016                                                            | Partial; Preferences Accounts/layout correction verified 2026-09-23; scoped identity, presentation, Git selection and issue links retained; full inventory/workspace/platform scope remains                                                      | P03, P04, P12, P14 / C01, C06 |
| F35 | Statistics/date chart/contributors and file activity treemap                          | D: [product][home], [releases][win]; B: P2-010                                                                                       | Bounded slice verified; UTC/raw-author metrics, date chart/contributors and cancellable cached file activity; independent rules and limits in [F35 handoff](../reviews/f35-statistics.md)                                                        | P13 / C05                     |
| F36 | Patch export/import, applicability preflight and clipboard routes                     | D: [releases][win], [releases][mac]; B: P2-005                                                                                       | P08 Linux scope complete (2026-09-26): byte-preserving import/export, staged conflicts, mailboxes, merge-parent export and unusual Linux paths verified; safety refusals/platform limits in [P08 handoff](../reviews/p08-investigation.md)       | P08 / C05                     |
| F37 | Optional external AI commit-message/review integrations                               | D: [releases][mac], [releases][win]; public-only; O: TrackerWin 2808                                                                 | Partial; session-only OpenAI API messages and diff review verified; CLI adapters/platform matrix remain. [Handoff](../reviews/f37-ai.md)                                                                                                         | P13                           |
| F38 | Lean Branching Start/Sync/Finish                                                      | B-UI: P0-008-toolbar-dropdown-subcase:F1; effects U; public proposal TrackerWin 1432                                                 | Partial; reviewed local Start/Sync/Finish verified with P06 recovery; remote restoration and exact Fork execution remain outside the slice. [Handoff](../reviews/f38-lean-branching.md)                                                          | P06 prerequisites, P12        |

Recent release notes also describe conflict previews, rebase-dependent-reference updates, richer worktree
navigation, and tab ergonomics. These are refinements within F03/F16/F18/F22, not reasons to declare the
basic workflows complete early. Source: [Mac releases][mac].

## F38 Lean Branching — 2026-09-22

Primary evidence: `P0-008-toolbar-dropdown-subcase:F1`, original JSON, screen-0038,
UIA and before/after Git manifests (2026-09-20, Windows 2.22.0.0, light, 96 DPI).
High confidence for Start/Sync/disabled Finish on main and no mutation during menu
inspection; no captured execution or dialog evidence. Private assets remain unchanged.

Public supplement: the maintainer's [Lean Branching proposal](https://github.com/fork-dev/TrackerWin/issues/1432)
(2022-01-20, reviewed 2026-09-22; Windows prerelease proposal, not a 2.22 outcome)
supports the three-action model. Confidence is high for the published intent and
limited for current behavior. No application or downloadable binary was obtained.
The public screenshot index was restored and checked; the private menu capture
remains the relevant layout reference.

The [implementation handoff](../reviews/f38-lean-branching.md) defines and tests
Git Workbench's local policy: user-selected base, clean checkout, guarded Start,
Sync through rebase and Recovery, and Finish retaining the topic. No automatic
remote writes, reset, deletion or stash. Reference and P06 services remain
authoritative. Linux dialogs use existing independent chrome and keyboard behavior;
the heading and action order follow the captured menu. Full Fork execution, remote
tracking-ref restoration, merge-preserving replay, base persistence and the native
platform/scaling matrix remain outside verified parity. P12 stays partial.

## F36 patch import/export and clipboard — 2026-09-22

Refresh follow-up (2026-09-22): the three baseline branch/stash failures found during F36 are addressed
in the [refresh-fix record](../reviews/reference-refresh-fixes.md). Reference snapshots survive a
same-repository refresh, operation busy state follows its own lifetime, and empty sections remember
expansion intent. Tests synchronize on refreshed actions rather than pre-existing rows. These are
independent implementation corrections, not new catalogue observations or expanded feature claims.

F36 checkpoint (2026-09-22): the [patch handoff](../reviews/f36-patches.md) implements file/clipboard
preflight, exact staged application, three-way conflict reporting, Create Patch save/copy and text-diff
Copy as Patch. Primary high-confidence Windows 2.22.0.0 anchors are
`P2-005-mixed-patch-preflight-subcase:F1–F4` (2026-09-20), plus import/export subcase F1 findings
(2026-09-19). Original cases, preflight/export screenshots and mixed-patch Git evidence were inspected.
Windows release notes document Ctrl+V/preflight in 2.17 (2026-03-13) and diff copy in 1.85 (2023-05-26);
Mac 2.64 (2026-03-06) documents Cmd+V. Sources: [Windows](https://fork.dev/releasenoteswin),
[Mac](https://fork.dev/releasenotes), accessed 2026-09-22; high-confidence documented capability,
not newly observed behavior. [Git apply](https://git-scm.com/docs/git-apply), accessed the same date,
supports the independently selected check/index/three-way semantics. Linux follows the captured
field/button order with independent chrome, clipboard controls and disabled malformed-input Apply.
File import/export preserve raw bytes; clipboard requires text. Binary round trips are independently
tested but not claimed as Fork parity. Mailboxes, merge-parent export, symlink/submodule imports,
exotic paths and native platform coverage remain partial; P08 is not complete.

## F35 statistics and treemap — 2026-09-22

User-reported SillyTavern regression corrected: the original 10,000-commit guard preceded date filtering.
Compact author-date metadata is now filtered before detailed activity reads and range limits. A user
Computation limit selector offers Standard/2×/5×/10×, with explicit CPU, memory, responsiveness and
duration warnings. This is an independent product addition, not observed Fork behavior. Read-only
Electron verification on the requested repository confirms a 9-commit September range at Standard and
all 11,805 commits at 2×, with unchanged refs/index/status. See the handoff for bounds and regression tests.

`P2-010:F1` is the primary Windows 2.22.0.0 reference (captured 2026-09-19, high confidence for its
sampled state). Original screens 0515–0517 show date range/month chart, contributor table/donut and
file tiles with Commits/Authors details. The original JSON and linked before/after Git evidence were
reviewed; recovery spans those snapshots, so they do not prove statistical aggregation or isolation.

The independent implementation exposes both views through Repository and Quick Launch. Exact metric
rules are HEAD-reachable commits, inclusive UTC author dates, unmerged name/email identities and
per-path touches, with first-parent merge diffs and delete/add rename treatment. Computation is local,
cached, bounded and cancellable. [Git log documentation](https://git-scm.com/docs/git-log), accessed
2026-09-22, supports those explicit Git choices, not inferred Fork semantics.

Generated light/dark/narrow Linux screens were compared with the original screenshots. A shared modal,
explicit date inputs, Unicode paths, folder drill-down, accessible tables and independently weighted
tiles are deliberate product adaptations. Captured date/aggregation/tile algorithms remain unknown.
The [F35 handoff](../reviews/f35-statistics.md) records implementation, tests, screenshots and resource
limits. F37 AI and the P14 large-repository/native-platform matrix remain separate scope.

## Application and repository settings

Scope audit: **2026-09-22**. Both surfaces belong to **F34 / P12**, with persistence prerequisites in
P02. Global preferences were broadly listed; repository settings were not an explicit deliverable.
Both settings surfaces now have **bounded implementations**, verified 2026-09-22; the complete
preference inventory and broader F34 workspace scope remain partial. The
[explicit plan](../implementation-plan.md#f34-application-settings-and-repository-settings)
tracks each surface and its acceptance criteria separately. The [F34 handoff](../reviews/f34-settings.md)
records implemented controls, independent semantics, tests and remaining field/platform limits.

- **Global application settings — B, high confidence for visible inventory:**
  [P0-013 dossier](fork-reference-new/reference/catalogue/features/P0-013.md), original case
  `P0-013-general-git-subcase:F1–F4`, captured **2026-09-19**, Windows **2.22.0.0**.
  File → Preferences exposes General, Commit, Git, Integration, Custom Commands and Updates.
  General presentation controls and Git instance/verbose-output/global-user fields are observed.
  The linked Git-page screenshot and batch02 Git verification support the visible global scope and
  unchanged repository state after a no-edit visit. Other pages' detailed controls, write behavior,
  defaults and persistence remain untested.
- **Repository settings — D, high confidence for existence, detailed behavior unresolved:**
  [Windows release notes](https://git-fork.com/releasenoteswin), **1.30, 2019-03-22**, explicitly add
  a Repository Settings dialog. [Mac release notes](https://git-fork.com/releasenotes),
  **1.0.75, 2019-03-14**, document repository bugtracker configuration. Sources checked **2026-09-22**.
  These establish a Windows dialog and a Mac capability respectively, not the full Windows 2.22 field
  inventory or global/local precedence, save/cancel semantics, or worktree behavior.
- **Linux/product specification:** provide separate application and selected-repository settings,
  explicit scope/origin/inheritance, global and local identity editing, isolated persistence and tested
  error handling. Repository identity and issue-link editing now have a bounded implementation; their exact
  Windows presentation remains unverified. Use installed Linux Git/tools, independently authored UI,
  and project defaults rather than the captured bundled Windows Git instance or assumed factory defaults.

## Layout observations

The current Windows reference is the catalogue's P0-003/P0-005/P0-014 shell, P0-027 diff states,
P1-017 resolver, P1-023 rebase editor and P1-030/P1-031 inspectors. The
[design-methodology analysis](fork-catalogue-alignment.md#design-methodology-inferred-from-the-captures)
derives component/state rules and records measurement limits. The following older public observations
remain useful context; their broad composition is not an exact current token specification.

The [published history image][history-image] shows a custom title row with menus and window
controls, a top action toolbar and repository tabs, a narrow left navigation tree, a large commit
table with graph lanes, and lower commit/changes/tree details.
Repository navigation and selected-commit inspection remain visible together. This screenshot's contents
date from 2020; its exact spacing and horizontal-tab arrangement are not a current pixel specification.
The newer vertical-tab option is documented separately in release notes.

The [working-changes image][changes-image] retains repository navigation. Its center file column is split
into unstaged and staged sections, with a larger diff to the right and a commit composer beneath.
Hunk actions sit beside the relevant change. The [split-diff image][split-image] shows an enlarged,
two-column comparison and keyboard hints. These are observations of published images, not measured
interaction behavior.

Target shell composition (**I**, derived from captured/public presentation; only partially implemented):

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ File View Repository Window Help            Title                ─  □  ✕   │
├────────────────────────────────────────────────────────────────────────────┤
│ Quick Launch Fetch Pull Push Stash▾ [≡ repo / branch ↑↓] Branch▾           │
│                                         Open in▾ Console Appearance▾       │
├────────────────────────────────────────────────────────────────────────────┤
│ ● repository tab │ repository tab │ Repository Manager │                 + │
├───────────────┬────────────────────────────────────────────────────────────┤
│ repo       ⚙  │ Filtered by: 'branch'  Clear filter   (only when filtered) │
│ Local Changes │ graph + labels + subject ↩ │ author │ SHA │ date           │
│ All Commits   ├────────────────────────────────────────────────────────────┤
│ ⑂  ⌕          │ Commit │ Changes │ File Tree                               │
│ Filter        │ Commit: people, refs, SHA, parents, message, files         │
│ ▾ Branches    │ Changes, File Tree: summary row, file list │ preview       │
│ ▾ Remotes     │                                                            │
│ ▸ Tags        │ Local Changes swaps the right side for                     │
│   Stashes     │ Unstaged/Stage, Staged/Unstage │ diff + commit composer    │
│   Submodules  │                                                            │
└───────────────┴────────────────────────────────────────────────────────────┘
```

The sidebar magnifier (⌕) swaps the filter and reference tree for Search Commits. A toggled repository
list adds an outer column to the left of this diagram while **retaining the horizontal tabs** (P0-005).
It is distinct from the repository's branch navigation and from Appearance's Commit List Layout.
Legacy orientation settings now migrate to additive repository-list visibility. Operation banners occupy
transient rows; the existing F14 activity surface carries jobs/output/cancellation. Resizable panes and
selection follow the explicit retention policy, with Linux deviations recorded in the alignment audit.
Graph color supplements labels; added/removed styling supplements signs. Typography, spacing, icons
and theme tokens are independently authored; exact fonts/palette and alternate commit-layout behavior
are not established by the available captures.

## F30 GitHub lists and notifications — 2026-09-22

Public-only evidence, accessed 2026-09-22. No authenticated hosting case is present in the supplied
Windows 2.22.0.0 catalogue; capture coverage does not establish this implementation.

| Source                                                                             | Finding and confidence                                                                               | Platform/version and implementation consequence                                                                         |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [Windows release notes](https://fork.dev/releasenoteswin)                          | High: 1.61 adds GitHub notifications; 1.62 adds issue/PR author/assignee filters and recent queries. | Windows, 2021-04-09 / 2021-05-07; supports the feature family, not exact current geometry or polling behavior.          |
| [Product page](https://fork.dev/) and local `site-imagenotifications.jpg`          | Medium: notification entries group repository, title and time.                                       | Undated macOS light image, version unstated; Linux uses Accounts with explicit refresh, no copied avatars/tray artwork. |
| [GitHub search API](https://docs.github.com/en/rest/search/search)                 | High: scoped search, paging, 1,000-result cap, incomplete-result flag and errors.                    | Provider semantics, not Fork observations; named state/author/assignee/title filters construct backend queries.         |
| [GitHub notifications API](https://docs.github.com/en/rest/activity/notifications) | High: unread/all, participation, pagination, classic-token requirements and subject metadata.        | Provider semantics; explicit read-only inbox, no automatic read-state writes.                                           |

Implemented and verified: GitHub issue/PR lists, filters, bounded recent title searches during the
Accounts dialog, notification inbox and validated browser handoffs. Refresh, cancellation, empty and
error states are explicit. Live read-only issue/PR/notification calls passed with the user-authorized
token without storing credentials or private results. Automatic alerts/polling, mark-read, persistent
search history, other providers and full review editing remain unimplemented. See the
[F30 handoff](../reviews/f30-hosting-activity.md) for test evidence and limits.

## F32 contextual custom commands — 2026-09-22

Primary evidence: Windows 2.22.0.0 catalogue `P2-008-create-execute-remove-subcase:F1–F5` and
`P2-008-menu-subcase:F1`, captured 2026-09-19, reviewed 2026-09-22. High confidence for the observed
target/action lists, Bash editor, repository menu, output and removal; the linked Git comparison
reports 13 unchanged records. Forms, expansion, failures and sharing are not established by this trial.

Public sources checked 2026-09-22: [Windows release notes](https://git-fork.com/releasenoteswin),
1.85 (2023-05-26) for text/branch/file form controls, and 1.84 (2023-04-28) for variable syntax and
shared-command format/OS support. High confidence for feature existence, not exact runtime behavior.
Restored screenshots from [TrackerWin 2807](https://github.com/fork-dev/TrackerWin/issues/2807)
(2026-06-22, Windows, dark, version unstated) and
[Tracker 2629](https://github.com/fork-dev/Tracker/issues/2629)
(2026-05-12, macOS, light, version unstated) supplement editor/form presentation. Platform differences
are explicit; neither substitutes for the Windows catalogue. The existing manifest already includes both.

Implementation: profile-owned contextual commands, saved action/form editor, enabled menu entries,
reviewed Bash/direct-process/HTTP(S) actions, bounded output/cancellation and native JSON import/export.
Imports start disabled. Independent Linux specifications cover quoted Bash environment values, direct
argv templates, required inputs, stale preview guards, supervised process groups and versioned sharing.
The File-menu manager and combined action editor are deliberate adaptations pending F34 Preferences.
Exact Fork aliases/formats and asynchronous/hidden-output modes remain partial. Local tests and real
headless Electron verification are documented in the [F32 handoff](../reviews/f32-custom-commands.md).

## Unresolved parity questions

F32 checkpoint (2026-09-22): the [custom-command handoff](../reviews/f32-custom-commands.md) records
the independent form, variable and sharing specification and its verification. It does not promote
the catalogue's unknown variants to observed Fork behavior.

- **U:** pristine defaults, first launch and empty manager; exhaustive menus/preferences/focus behavior.
  Captured Pull/Push/reset/discard/stash/conflict forms now establish concrete option sets and transitions,
  but selected settings in an existing profile are not defaults. Use the catalogue's per-case limits.
- **U:** exclusive vertical-tab mode, alternate Commit List Layout result, lightweight-tag creation,
  explicit GUI rebase Skip and general main-graph Back/Forward. Observed alternatives are documented;
  failure to find a route is not proof of global absence.
- **U:** full manual/multi-region/non-text conflict behavior, untracked/ignored destructive scope,
  force-push implementation, staged restoration in dirty checkout, accepting-remote/network cancellation,
  dirty/locked worktree removal and successful submodule initialization. Test independent product rules.
- **U:** full provider-by-provider parity, self-hosted authentication details, review versus browser handoff,
  and notification behavior. A documented PR entry point does not by itself establish an in-app review editor.
- **U:** all signing backends, sparse checkout, partial clone, reftable/SHA-256 behavior, and platform feature gaps.
  Treat underlying Git capabilities and advertised Fork support as separate questions.
- **U:** exact performance, graph lane algorithm, internal caching, watcher strategy, and private IPC or service design.
  Choose and measure our own implementation.
- **U:** exact fonts/colors/graph column boundaries, 125% DPI (capture blocked), full restart/crash
  retention, accessibility and cross-platform behavior. The 351-commit capture is not a benchmark;
  96-DPI geometry does not establish scaled layout. Lean Branching entry points lack exercised outcomes.
- **U:** proprietary algorithms and hidden state are outside this research scope. Equivalence will be assessed
  against documented user outcomes and Git repository state, not against private implementation behavior.

## F27 source and implementation checkpoint — 2026-09-22

`P0-026:F1` and `P2-003:F1` establish paired binary metadata and Side-by-Side/Swipe/Onion Skin
on Windows 2.22.0.0 (2026-09-19; high confidence within the captured trial). Original case JSON,
screens 0156 and 0455–0458, and the linked before/after Git manifests were inspected. Image mode
viewing preserved all 13 recorded Git command hashes. Zoom, alpha and differing dimensions remain
catalogue unknowns; independent tests do not turn them into Fork observations.

[Windows 1.38](https://fork.dev/blog/posts/forkwin-1.38/) (2019-08-27) corroborates the three modes.
[Mac release notes](https://git-fork.com/releasenotes) 2.42 (2024-04-19) establish pixel highlighting,
and 2.68 (2026-06-19) mentions 16-bit RGBA. Sources checked 2026-09-22; high confidence in the named
platform capabilities, no claim of Windows 2.22 pixel UI or algorithm parity. Public references were
restored and the image/diff index consulted; no new reference image or application asset was imported.

The verified Linux workflow uses bounded static PNG/JPEG raster payloads, Side-by-Side default,
draggable and keyboard Swipe, alpha-aware Onion Skin and decoded 8-bit RGBA Pixel highlighting.
Top-left alignment for unequal dimensions, checkerboard transparency, magenta changes, accessible
range controls and explicit decode/size/format failures are independent product choices. SVG stays
inert; other codecs, animation, zoom/pan and LFS-image resolution remain unimplemented. Screenshots
were compared before/after against the original cards and mode views; metadata contrast was corrected.
See the [F27 handoff](../reviews/f27-image-diffs.md) for tests, limits and comparison artifacts.

## Maintaining this record

Before each correction/phase, read its dossiers, inspect original screenshots and compare matching
preconditions/Git evidence. Supplement unresolved topics with dated public sources; preserve version,
platform, confidence and conflicts. Keep four records separate: public claims, captured observations,
project decisions/deviations, and implementation verification. Add a feature row if a new observed or
documented surface has no coverage. Mark the project partial while promised subworkflows are missing;
capture “observed” never implies implemented. Keep public-only requirements visible.

Keep the private bundle unchanged and git-ignored; its historical setup/capture scripts are not new
implementation instructions. Use its cases as references for independently authored TypeScript fixtures,
and record case/finding → component/service → tested states → validation → deviation/unknown in
the [alignment record](fork-catalogue-alignment.md). Do not publish or bundle the images.

Public images used for the F34 refresh: [history image][history-image] and [manager image][manager-image]
(Windows, 2020 content); [Mac history image][mac-history-image] (2020 content); [collapsible graph
image][graph-image] 2020-08-03; [colored labels image][labels-image], [sidebar filter
image][sidebar-filter-image] 2019-08-27; [bisect GIF][bisect-gif], [partial stash GIF][stash-gif],
[drag-and-drop GIF][dnd-gif], [branch status image][branch-status-image] 2020-05-05. All accessed
2026-09-16.

Source dates for historical workflow evidence: [activity][activity] 2018-05-28;
[rebase][rebase] 2018-11-10; [merge][merge] 2019-02-06; [manager][manager] 2019-06-12;
[diff][diff] 2019-08-27; [Quick Launch][quick] 2019-10-23; [operations][operations] 2020-05-05;
[graph][graph] 2020-08-03. All accessed 2026-09-16; the graph article was revisited 2026-09-17 for F05.

[home]: https://fork.dev/
[mac]: https://fork.dev/releasenotes
[win]: https://fork.dev/releasenoteswin
[graph]: https://fork.dev/blog/posts/collapsible-graph/
[quick]: https://fork.dev/blog/posts/quick-launch/
[operations]: https://fork.dev/blog/posts/forkwin-1.48/
[patches]: https://fork.dev/blog/posts/fork-1.0.70/
[gitflow-presentation]: https://git-flow.readthedocs.io/en/latest/presentation.html
[gitflow-features]: https://git-flow.readthedocs.io/en/latest/features.html
[gitflow-releases]: https://git-flow.readthedocs.io/en/latest/releases.html
[gitflow-hotfix]: https://git-flow.readthedocs.io/en/latest/hotfix.html
[rev-parse]: https://git-scm.com/docs/git-rev-parse
[git-log]: https://git-scm.com/docs/git-log
[for-each-ref]: https://git-scm.com/docs/git-for-each-ref
[git-diff-tree]: https://git-scm.com/docs/git-diff-tree
[git-ls-tree]: https://git-scm.com/docs/git-ls-tree
[git-cat-file]: https://git-scm.com/docs/git-cat-file
[init]: https://git-scm.com/docs/git-init
[diff]: https://fork.dev/blog/posts/forkwin-1.38/
[rebase]: https://fork.dev/blog/posts/forkwin-1.23/
[merge]: https://fork.dev/blog/posts/fork-1.0.73/
[manager]: https://fork.dev/blog/posts/fork-1.0.79/
[activity]: https://fork.dev/blog/posts/fork-1.0.67/
[history-image]: https://fork.dev/images/carousel/carousel_mainWin.jpg
[changes-image]: https://fork.dev/images/carousel/carousel_commitviewWin1.jpg
[split-image]: https://fork.dev/images/carousel/carousel_commitviewWin2.jpg
[mac-changes-image]: https://fork.dev/images/carousel/carousel_commitviewMac1.jpg
[length-image]: https://fork.dev/blog/posts/forkwin-1.17/commit-message-length.png
[manager-image]: https://fork.dev/images/carousel/carousel_repomanagerWin1.jpg
[mac-history-image]: https://fork.dev/images/carousel/carousel_mainMac.jpg
[graph-image]: https://fork.dev/blog/posts/collapsible-graph/swift-show-all.png
[labels-image]: https://fork.dev/blog/posts/forkwin-1.38/colored-branch-labels.jpg
[sidebar-filter-image]: https://fork.dev/blog/posts/forkwin-1.38/sidebar-filter.jpg
[branch-status-image]: https://fork.dev/blog/posts/forkwin-1.48/branch-status.jpg
[tracker-mac]: https://github.com/fork-dev/Tracker/issues
[tracker-win]: https://github.com/fork-dev/TrackerWin/issues
[bisect-gif]: https://fork.dev/blog/posts/forkwin-1.48/bisect.gif
[stash-gif]: https://fork.dev/blog/posts/forkwin-1.48/partial-stash.gif
[dnd-gif]: https://fork.dev/blog/posts/forkwin-1.48/drag-and-drop-merge.gif
[lfs-spec]: https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md
[lfs-install]: https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-install.adoc
[lfs-man]: https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs.adoc

## F26 implementation evidence — 2026-09-22

`P2-006:F1` and `P2-006-skip-subcase:F1–F3` (Windows 2.22.0.0, captured 2026-09-19)
are high-confidence evidence for Start/Bad/Good/Skip/Abort, midpoint selection and restored branch.
Original screenshots, cases and Git evidence were compared with independent Linux implementation
and headless Electron screenshots. [Git bisect documentation](https://git-scm.com/docs/git-bisect),
accessed 2026-09-22, supplements reset and ambiguous-skip semantics. The app deliberately presents
first-bad as success, adds a visible range, and tests restart and repeated-skip ambiguity independently.
Those variants do not expand the captured Fork claims. See the [F26 handoff](../reviews/f26-bisect.md)
for the verification matrix and remaining limits.

## F28 implementation evidence — 2026-09-22

The [product page](https://git-fork.com/) and [Mac release notes](https://git-fork.com/releasenotes)
(1.0.58, 2017-10-23; 1.0.82, 2019-07-22), accessed 2026-09-22, establish GPG capability,
commit signing and signed tags with high confidence for those documented platforms. They do not
establish an exact Windows 2.22 signing dialog. `P0-030:F1` and
`P1-004-empty-message-tag-subcase:F1–F3` remain the captured composer/tag layout and Git-semantics
anchors; signing is a public-only extension. Original cases, screens 0185/0232 and linked Git
verification records were inspected before and after the independent Linux implementation.

Implemented explicit GPG/Unsigned/Git-default commit and tag choices, repository-local key editing
with effective-value display and inheritance removal, and exact-object commit/tag verification.
[Git configuration](https://git-scm.com/docs/git-config),
[commit](https://git-scm.com/docs/git-commit), [verify-commit](https://git-scm.com/docs/git-verify-commit)
and [verify-tag](https://git-scm.com/docs/git-verify-tag), accessed 2026-09-22, supply the backend
semantics. Trusted, untrusted, unsigned, invalid and unavailable-key results remain distinct.
Other signing backends and native protected-key/platform trials are not claimed. See the
[F28 handoff](../reviews/f28-signing.md) for independent tests, screenshots and explicit limits.

## F29 GitHub account and repository browser — 2026-09-22

The 2026-09-23 [accounts correction](../reviews/github-accounts-correction.md) supersedes the file-based
login and API-only Git policy below. Accounts now lives inside Preferences by user request; clipboard
PAT login and account-backed HTTPS Git are independent implementation decisions, not newly observed Fork behavior.

The supplied Windows 2.22.0.0 catalogue contains no authenticated hosting case. Its
`P1-012-local-clone-subcase:F1–F3` (2026-09-19, high confidence), original case, screen-0295 and Git
after-manifest establish only the existing clone form and local clone semantics. They do not establish
token handling, hosted enumeration, OAuth or private Git transport behavior.

Fresh public evidence, accessed 2026-09-22:

| Provider     | Public target evidence                                                                                                                                                       | Implementation and remaining scope                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub       | [Windows release notes](https://git-fork.com/releasenoteswin), 1.56 (2020-11-20) integration and 1.87 (2023-08-08) OAuth naming; high confidence for documented availability | GitHub.com PAT identity, accounts, paginated repositories, clone selection and browser links implemented; OAuth/Enterprise and automatic refresh not implemented |
| GitLab       | Same Windows 1.56 notes include integration/private servers; high confidence                                                                                                 | Existing gitlab.com PR creation browser handoff only; accounts/enumeration/private servers remain planned                                                        |
| Bitbucket    | Same Windows 1.56 notes; high confidence                                                                                                                                     | Existing bitbucket.org PR creation browser handoff only; account/token variants remain planned                                                                   |
| Azure DevOps | [Fork release-note blog index](https://www.git-fork.com/blog/tags/release-notes/) documents PR creation; high confidence for that narrow behavior                            | Existing Azure PR form handoff; account/repository enumeration not established by this evidence or implemented                                                   |
| Gitea        | [Mac release notes](https://git-fork.com/releasenotes), 2.15 (2022-01-07); high confidence for Mac integration, Windows details unknown                                      | Account integration remains planned; no inferred Windows field-level parity                                                                                      |

The already-indexed Windows Accounts screenshot in
[TrackerWin #2826](https://github.com/fork-dev/TrackerWin/issues/2826) (2026-07-31; version unstated,
dark theme) shows account navigation, Account/Repositories tabs, token update and notifications.
Confidence is medium for that public visual state, not proof of successful enterprise authorization.
The issue reports misleading online status; this implementation does not show an unverified Online badge.
The restored public index and original screenshot were inspected. No new images or bundled assets were added.

[GitHub repositories API](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user)
and [authenticated identity API](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)
supply the independent GET and pagination contracts. Results are limited by token permissions and
organization authorization. [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
documents the OS protection and Linux `basic_text` fallback; that fallback is refused. These are high
confidence API/platform sources, not observations of Fork internals.

Linux adaptations: native token-file selection keeps credentials outside React/IPC; session-only is the
default, persistence requires a secure keyring, PAT replacement is manual, and clone authentication stays
with installed Git helpers/agents. Only fixed GitHub.com origins are supported, so self-hosted URLs are
not silently accepted. F30 lists/filters/notifications remain separate. See the
[F29 handoff](../reviews/f29-hosting.md) for verification and limitations.

## GitHub accounts and Preferences correction — 2026-09-23

Re-read `P0-013-general-git-subcase:F1–F4`, original case JSON, screen-0123/screen-0124 and
`batch02-resume/git-verification.json` (Windows 2.22.0.0, captured 2026-09-19). High confidence for the
visible General/Git tabs, compact labelled fields, variable height and no-edit Git invariance;
other preference fields, authentication and factory defaults remain unobserved. Restored the public
reference index (226 existing images, no downloads) and inspected the Accounts screenshot from
[TrackerWin #2826](https://github.com/fork-dev/TrackerWin/issues/2826), dated 2026-07-31,
Windows/version unstated/dark. Medium confidence for its account list, identity header,
Account/Repositories tabs and Update token action. Its reported misleading Online badge is not copied.

Compared generated light/dark login/account, General and Git screenshots against those originals.
Accounts within Preferences is the user's requested adaptation; the public screenshot shows a
standalone Accounts window. Initial avatars use independently drawn text. Clipboard PAT login
preserves the no-renderer-secrets boundary; it is not claimed as observed Fork login or OAuth parity.
The full Preferences inventory stays partial.

Primary technical sources checked 2026-09-23, high confidence for their API/protocol contracts:

- [Git credentials and helpers](https://git-scm.com/docs/gitcredentials): exact credential contexts,
  empty helper reset, useHttpPath and helper get/store/erase semantics. Git Workbench supplies a
  temporary github.com helper without altering global/repository configuration.
- [GitHub PAT documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens):
  HTTPS tokens remain limited by repository grants, expiration and organization policies. SSH uses keys.
- [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps):
  OAuth/device flow requires an application's registered client ID. None is supplied for this application;
  PAT login works independently. Fork's client identity is neither borrowed nor reproduced.

The authenticated local TLS fixture verifies real Git clone/fetch/pull/push and credential rejection
without contacting GitHub. This establishes our implementation, not observed Fork internals or live
private GitHub transport. Native secure-keyring and Windows/macOS behavior remain unverified.
See the [correction handoff](../reviews/github-accounts-correction.md).

## F33 external tools — 2026-09-22

Primary evidence is `P2-009-custom-viewer-subcase:F1–F4` and
`P2-009-configuration-subcase:F1`, Windows 2.22.0.0, captured 2026-09-19: high confidence for
Name/Path/Arguments, native executable Browse, named historical Diff menu entry, `middle` blob
handoff instead of the `latest` checkout, removal confirmation and unchanged Git output. Original
cases, screens 0507/0509/0511/0512/0514, before/after manifests and the 13-output comparison were
inspected. Full external merge invocation remains a catalogue unknown. `P0-013:F1` establishes
Preferences inventory only, not factory defaults or a save policy.

Public supplements accessed 2026-09-22: [JuxtaCode's Fork instructions](https://juxtacode.app/integrations/fork/)
document custom diff/merge executable and arguments on macOS (high confidence for the documented
adapter, no inferred Windows result). [xdg-terminal-exec](https://github.com/Vladimir-csp/xdg-terminal-exec)
documents Linux desktop terminal selection and directory options, with best-effort behavior and
implementation-dependent process waiting; this is an independent Linux adaptation.

Implemented profile tool CRUD, explicit argv configuration, historical/working editor and diff
handoff, terminal cwd and reviewed temporary text merge output. Git bytes stay backend-owned;
exact revision IDs, copied diff sides and conflict snapshot validation prevent implicit checkout
replacement/staging. Existing CLI/second-instance and file-manager routes remain verified separately.
Linux light/dark/narrow captures were compared with the original Integration and file-menu states.
The separate File → External Tools entry, explicit Save/launch review, JSON arguments and draft review
are deliberate deviations. F34's full Settings UI, binary/missing-stage merges, Ctrl+D/default-tool
selection, real GUI daemon/platform matrices and crash cleanup remain partial. See the
[F33 handoff](../reviews/f33-external-tools.md) for implementation/tests, screenshot paths and limits.

## Provider account forms and authentication — 2026-09-24

The [provider accounts handoff](../reviews/provider-accounts.md) supersedes the 2026-09-23 clipboard
acquisition and GitHub-only provider scope. The user's 2026-09-24 description supplies the five-provider
selector and exact field inventory: Gitea (server/token), GitHub (OAuth/username or PAT/token), GitHub
Enterprise (server/PAT), GitLab (PAT), and GitLab Server (server/token), with bottom +/− controls.
Confidence is high for this requested specification; it is not a new black-box Fork observation.

Rechecked `P0-013-general-git-subcase:F1–F4`, its original case, screen-0123 and Git invariance evidence
(Windows 2.22.0.0, 2026-09-19; high confidence for captured preferences composition). P1-012's local
clone dossier retains its authentication unknown. Ran `npm run research:references`, browsed the
preferences/hosting index and compared the restored [TrackerWin #2826](https://github.com/fork-dev/TrackerWin/issues/2826)
Accounts screenshot before and after layout work (2026-07-31, Windows/version unstated/dark; medium
confidence for sidebar/header/detail-tab composition). No private image was changed or copied into
application assets, and no new public screenshots were added.

Public implementation sources, accessed 2026-09-24, high confidence for documented provider protocols
only; these do not establish Fork internals or platform parity:

| Source                                                                                                                                                                        | Use                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)                                                           | Registered public client ID, enabled device flow, fixed browser handoff, interval/slow-down, expiry and identity verification |
| [GitHub Enterprise REST](https://docs.github.com/en/enterprise-server@3.17/rest/using-the-rest-api/getting-started-with-the-rest-api)                                         | Selected HTTPS server with `/api/v3` endpoints                                                                                |
| [Gitea authenticated user](https://docs.gitea.com/api/operations/user-get-current/) and [API](https://docs.gitea.com/api/)                                                    | `/api/v1`, token authorization, identity and repository enumeration                                                           |
| [GitLab API authentication](https://docs.gitlab.com/api/rest/authentication/), [users](https://docs.gitlab.com/api/users/), [projects](https://docs.gitlab.com/api/projects/) | PAT bearer authorization, `/api/v4/user`, member projects and nested namespace paths                                          |

Implemented on Linux with independent TypeScript/TSX: masked direct input, server-aware account
identity, validated provider requests, scoped HTTPS Git credentials, repository lists and configurable
GitHub device OAuth. Direct input is the user-directed exception to the previous clipboard-only secret
boundary: transient write-only input crosses IPC; stored/returned credentials remain main-owned.
Generated light/dark/narrow forms and account details were visually compared with the references.
Removal confirmation, Accounts inside Preferences, secure/session storage choices and device flow
are deliberate adaptations. A real OAuth client registration is still required; live provider/native
keyring/platform coverage and automatic OAuth renewal remain unverified/unimplemented as appropriate.
F29/P11 stay partial. Detailed tests and screenshot paths are in the handoff.
