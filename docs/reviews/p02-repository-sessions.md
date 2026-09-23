# P02 — Repository sessions and persistence

Implementation date: 2026-09-23. Scope: P02's five requirements and four acceptance criteria,
F01–F03's local repository/session/manager workflows, and F33's launch/file-manager foundation.
**Complete for the Linux baseline.**
P05's provider matrix, P12's multiple named workspaces and native window extensions, and P14's
platform/performance audit retain their own scope.

## Reference and design

Primary reference: the private **Fork Windows 2.22.0.0** catalogue, captured 2026-09-19/20 at 96 DPI.
The following original cases, linked screenshots and Git evidence were consulted, with high confidence
for the particular observed states:

- `P0-004-close-restore-subcase:F1`: closing selects the preceding tab and keeps its view; reopening
  selects HEAD. `P0-004-reorder-subcase:F1–F2`: horizontal drag reorder retains the active repository.
- `P0-005-tab-sidebar-subcase:F1` and `P0-005-shell-search-subcase:F1–F3`: repository list and horizontal
  tabs coexist. The original `evidence/20260919T145728_227034Z_continuous01-vertical-tabs_ad8d13/screen.png`
  was inspected. The captured **Work** label belongs to that configured workspace; this application
  retains its single **Workspace** heading until named workspaces are implemented in P12.
- `P2-015-layout-selection-restart-subcase:F1–F4`: tab order, active repository and sidebar persist;
  selection/detail view reset to HEAD/Commit. The before/after Git manifests in
  `evidence/continuous12/layout-{before,after}-restart/` have matching hashes for all 13 commands.
- `P2-016:F1`: external creation, editing and deletion update Local Changes. No particular mechanism or
  latency is inferred from Fork; the watcher policy below is independently specified.
- `P1-012-local-clone-subcase:F1–F3`: URL/Parent Folder/Name, Test Connection, clone progress and automatic
  opening. The case and source/destination evidence retain local-transport and authentication limits.
- `P0-002` remains partial research: it does not establish a pristine empty manager or folder editing.

For that manager gap, `npm run research:references` restored/verified the existing 226 public assets.
The official [Windows manager Summary image](https://fork.dev/images/carousel/carousel_repomanagerWin1.jpg) and
[Statistics image](https://fork.dev/images/carousel/carousel_repomanagerWin2.jpg) establish the tree, title/path/Open,
compact metadata, Summary divider and branch/tag rows; their application version and original publication
date are unstated (accessed 2026-09-23). The
[1.0.79 article](https://git-fork.com/blog/posts/fork-1.0.79/) (2019-06-12, Mac) documents hierarchy
import, rescanning and a default source folder. Confidence is high for those advertised outcomes,
but exact Windows folder edit and scan rules remain unknown. Logical groups, display aliases,
the default-source context action, resource bounds and recovery controls are independent Linux choices.
Statistics continues to use its existing F35/P13 inspector.

The old manager was captured before editing. Final comparisons use independently generated repositories
and `test-results/p02-manager-{light,dark,narrow}.png`; the minimum supported 880×600 window retains
all toolbar controls and scrolling details. Folder icons and all implementation remain independently
authored. No reference images are copied into application assets or committed.

## Implemented behavior

- Open/init/local clone retain canonical worktree, Git and common-directory identities, including
  symlinks, nested paths, bare/unborn/detached repositories and linked worktrees. Initialize now offers
  an explicit form with Browse, bare choice and Cancel. Clone uses the configured default source folder.
  Existing clone jobs, cancellation, CLI/second-instance activation and file-manager capabilities remain.
- Manager sources are profile-owned; scans recognize filesystem markers without running Git. Opened
  repositories remain in the manager independently of source directories. Users can create nested logical
  folders, rename/move/remove folders, assign repositories, edit display names, filter by name/path,
  rescan and choose a default source. Removing a logical folder promotes its children; no disk folder
  or Git repository is renamed or deleted. Cycles and unknown IDs are rejected.
- Selecting a repository reads actual commit counts, initial/latest commit dates, local branches, tags
  and redacted remotes without opening a session or granting trust. Untrusted working status says it
  requires trust. The summary is bounded to 20 branches, 20 tags and 100 remotes; dates/counts describe
  locally available history across refs, not remotely available or expired history.
- Main owns queryable scan jobs. Start returns immediately; a separate status read reports scanning,
  complete, cancelled or failed. Cancel retains the last complete snapshot. Repeated starts coalesce;
  invalidation during a scan schedules a follow-up. Window disposal aborts its scan and prevents late
  snapshots from restoring manager ownership. Existing synchronous scan channels remain compatible;
  the UI uses the job path, including adding source directories.
- Main-owned watchers cover worktree content, per-worktree Git state, common refs and source discovery.
  They share open-repository resources across owners, skip directory symlinks/object stores, debounce at
  180 ms with a one-second burst ceiling, and reconcile added/replaced directories. Git lock noise is
  ignored only in Git directories; ordinary files such as `Cargo.lock` remain watched. Every watcher
  has a 1,024-directory / 50,000-entry / 24-depth bound and a 30-second fallback/resubscription pass.
  Existing five-second tab/working-change polling and manual Refresh provide additional fallback.
  Close/disposal releases watchers, timers and listeners. Fork's latency is not claimed.
- Validated owner-scoped invalidation events refresh views even when file contents change without a
  changed-file-count change. Read generations reject replies from closed/reopened sessions; a late
  topology/head read cannot resurrect a closed tab. Individual reads no longer overwrite newer published
  tab summaries. Switching retains per-repository history/detail/file/scroll state; closing releases
  that transient presentation. Reopening and normal restart select HEAD/Commit. Drafts remain durable.
- Source configuration migrates from version 1 to 2; logical groups/defaults/aliases persist atomically.
  Recent writes now serialize and commit in-memory state after atomic replacement. Tab/order/active/
  closed-tab persistence and off-screen window recovery remain. Renderer preferences/drafts accept legacy
  values and write version-1 envelopes using atomic localStorage entries. Invalid values/files retain
  originals and expose recovery controls. Missing tabs support Retry, Locate and Remove Saved Tab;
  missing recent entries also support Locate. Relocation preserves aliases/order and copies existing
  draft/presentation keys without overwriting values at the destination. It also works at tab capacity.
  It does not carry repository trust to a different canonical location.

Limits: 20 open/saved tabs and recently closed entries; 10 source roots by default; 200 logical folders;
5,000 manager repositories in aggregate. Each source scan stops at depth 12, 25,000 entries or 2,000
repositories and reports truncation. Cancellation, unavailable sources and scan limits have explicit
states. These are project limits, not measured Fork limits.

## Asset boundary evaluation

P02's protocol evaluation is complete without adding a repository-serving protocol. Repository text
continues through bounded, typed reads and React text rendering; raster previews use the existing
validated static PNG/JPEG path. No repository URL becomes an application document. Exact-document,
top-frame and inspector authorization, blocked navigation/new windows, sandboxing, context isolation
and production `connect-src 'none'` remain. A general file/asset scheme is unnecessary for these flows
and would add a new URL authorization surface; changing the application document origin would also
require migration of existing renderer-profile preferences/drafts. Any future streaming asset protocol
must retain an explicit token/owner/type allowlist. No generic file or command API was added.

## Verification

The permanent P02 unit suite uses isolated profiles and repositories for metadata migration, concurrent
recent writes, hierarchy/cycle validation, aliases/defaults, missing and corrupt settings, relocation at
capacity, cancellation/owner isolation, external changes, linked worktrees, replacement directories,
symlink/limit behavior and delayed closed-session reads. Preload tests validate scan results/events and
exact subscription removal. Four P02 headless Electron scenarios cover visible manager edits/discovery,
light/dark/narrow layout, defaults, Cancel/bare initialization, tab/view isolation, close/reopen semantics,
same-count diff changes, distinct drafts, normal restart, moved-path/corrupt-file recovery and a real
delayed Git history process. Existing clone, desktop, CLI, worktree, inspector and operation tests cover
the retained foundation. Git assertions check unchanged index/HEAD/worktree state for read-only flows.

Final verification (Linux x64, Node 24.13.0, Git 2.55.0): `npm run check` passes **504 tests** with one
existing opt-in skip, including type/lint/format checks. `npm run build` passes through `npm run test:e2e`;
the full headless suite passes **40 scenarios**, with one existing opt-in statistics scenario skipped.
After the final cache cleanup correction for `commit:repository:…` diff-position keys, a rebuilt run of
all six P02/history/desktop scenarios also passes. A dedicated regression covers clearing both key
formats and suppressing late unmount writes into a closed session.
All mutating tests use disposable repositories/profiles; no user's repository is used as a fixture.

An intermittent Quick Launch file chooser failure (zero options after checkout, expected two) appeared
in earlier full/focused runs and was reproduced with
the same lockfile/dependencies in an untouched archive of starting commit
`ef55ca2c7bb32e0f3d89396be697080363ccfe69`, at `/tmp/git-workbench-p02-baseline-QjLlhu`.
Its trace and error context remain there. The final full run passes that scenario; no Quick Launch
implementation change was made, and the existing F31/P12 race is not claimed fixed by P02.

Native Windows/macOS testing, filesystem-specific watcher behavior beyond this Linux host, multiple named
workspaces/windows, tab colors and tear-off tabs remain P12/P14. No native frame behavior changed, and
the user's Wayland bridge/IDE services were not modified. Catalogue unknowns remain unknown; this record
does not claim all Fork feature families or all operating systems are complete.
