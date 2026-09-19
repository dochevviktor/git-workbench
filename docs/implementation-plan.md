# Git Workbench implementation plan

Baseline: 2026-09-16. Target: an independently implemented, Linux-first desktop Git client covering
Fork's publicly documented workflows. [Research and feature IDs](research/fork-public-surface.md)
define the target; [architecture](architecture.md) defines the boundaries.

**Next implementation request: Continue P05 — clone, background fetch scheduling, and credential prompts.**

This is a staged product plan. The foundation and initial local F01/F02/F03 slices are complete enough
to exercise the shell, without declaring those features complete. A usable daily Git client is the P06
checkpoint; it is not full Fork parity. Later phases cover the remaining documented families.
Unknown behavior is recorded in research and must not be invented and labeled equivalent.

## Progress ledger

| Phase | Deliverable                                                          | Status                                                                                                             | Depends on |
| ----- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| P00   | Vite migration, isolated desktop shell, typed IPC, research and plan | Complete (2026-09-16)                                                                                              | —          |
| P01   | Git runner, capabilities, operations, cancellation, fixtures         | Partial; runner subset, operation registry, progress and cancellation (2026-09-19)                                 | P00        |
| P02   | Repository sessions, open/init/local clone, persistence, tabs        | Partial; F01 local + F02 manager + F03 tab slice (2026-09-16)                                                      | P01        |
| P03   | History graph, references, commit details, revision tree             | Partial; F04 history + graph drawing, F05 collapse, F06 filtering, and F07 revision inspection slices (2026-09-17) | P02        |
| P04   | Changes, diff, staging, commit/amend, safe discard                   | Partial; F08 status + F09 diff + F10 staging + initial F11 commit slice (2026-09-17)                               | P03        |
| P05   | Branches/tags/remotes, authentication, network operations            | Partial; F12 branch/tag/checkout and F13 remote/fetch/pull/push slices (2026-09-19)                                | P04        |
| P06   | Merge/conflicts, stash, cherry-pick/revert, recovery controls        | Planned                                                                                                            | P05        |
| P07   | Interactive rebase and history editing                               | Planned                                                                                                            | P06        |
| P08   | Search, history/blame, reflog, bisect, patches                       | Planned                                                                                                            | P07        |
| P09   | Worktrees, submodules, Git-flow                                      | Planned                                                                                                            | P08        |
| P10   | Binary/image diffs, LFS, signing                                     | Planned                                                                                                            | P09        |
| P11   | Hosting providers, issues/PRs, notifications                         | Planned                                                                                                            | P10        |
| P12   | Command palette, custom commands, external tools, workspace polish   | Started out of order; F34 window chrome/menus slice (2026-09-16); Fork design refresh (2026-09-17)                 | P11        |
| P13   | Statistics and explicitly enabled AI integrations                    | Planned                                                                                                            | P12        |
| P14   | Parity audit, performance, accessibility, Linux release hardening    | Planned                                                                                                            | P13        |

The sequence is the default execution order. Within a phase, complete its numbered slices in order;
each slice can be a separate future request. Refine a slice if public research exposes additional
requirements. Keep the ledger, feature matrix, and evidence current as work lands.

## How to execute a future request

1. Read the requested phase, architecture, related F-items, and repository instructions.
2. Check the current worktree and prerequisite acceptance criteria. Preserve unrelated changes.
3. Refresh only the relevant public Fork/Git documentation. Record dated evidence and unresolved choices.
4. Implement one complete vertical workflow: contracts, service, bridge, UI, failures, and verification.
5. Test with disposable repositories and independent Git CLI assertions. Run `npm run check` and
   `npm run build`; run the Electron smoke test for changes to startup, bridge, or packaging.
6. Update this ledger with actual outcomes and remaining gaps. Mark feature rows implemented only when
   their complete stated behavior is verified; use partial status otherwise.
7. Report what changed, tests performed, limitations, and the next eligible slice.

No phase authorizes publishing releases, uploading repository data, or changing a user's unrelated
repositories. Tests create their own local repositories/remotes. Normal product operations act only
on repositories and actions the user selects.

## Cross-cutting completion criteria

- All authored executable code is TypeScript. Shared contracts are independent of Electron and React.
- Every privileged operation has runtime validation, sender checks, structured failures, and bounded
  resource lifetime. No raw command string, filesystem access, or arbitrary IPC is exposed to React.
- Main remains responsive. Long work uses jobs with progress/cancellation, independent of short IPC deadlines.
- UI shows real data and meaningful empty/loading/error/busy states. Unavailable commands explain why.
- Mutations revalidate repository state and serialize conflicting work. Destructive actions preview their
  exact scope and provide recovery where possible. No automatic force push, hard reset, or lock deletion.
- Persisted data has a schema version, migration, atomic write, and recovery from invalid data.
- Keyboard access, focus management, scaling, and readable contrast are included as each view is built.
- Performance claims include machine/repository details and measurements. Do not use a toy repository as
  evidence of large-repository behavior.

## P00 — Foundation

Scope: modernize the existing starter and establish the implementation baseline.

Implemented:

- electron-vite builds main, sandboxed preload, and React renderer from TypeScript.
- Webpack plugins/loaders, Preact aliases, demo Redux state, and the old event/endpoint classes are removed.
- Named schemas, explicit preload methods, typed result envelopes, sender/frame authorization,
  subscription cleanup, short request deadlines, and correct window ownership.
- Strict type checks for shared/backend/renderer code, lint/format commands, IPC unit tests, Electron smoke test.
- Empty workspace, native menus, appearance selection, backend information, and window controls.
- npm lockfile, Linux AppImage configuration, unpacked packaging, Windows/macOS target definitions.
- Public feature inventory, layout observations, architecture decisions, and this plan.

Acceptance: `npm ci`, `npm run check`, `npm run build`, and a real Linux Electron launch succeed;
the built and unpacked app can reach its preload bridge; startup and IPC tests pass.
Installer signing, publishing, other operating systems, and actual Git workflows are outside this phase.

Verification record (2026-09-16, Fedora Linux x64, Node 24.13.0):

- Clean `npm ci` succeeded; `npm run check` passed all type/lint/format checks and 26 unit tests.
- `npm run package` passed, including the production build and Linux AppImage generation.
- The real Electron smoke test passed against both `out/` and `release/linux-unpacked/git-workbench`,
  using X11 via Xwayland with Chromium sandboxing enabled. These smoke runs used the test's
  `ELECTRON_TEST_DISABLE_GPU=1` option for the virtual display.
- The built application smoke test also passed through the existing `wayland-bridge.service` waypipe
  session, reading `DISPLAY` from `$XDG_RUNTIME_DIR/piped-display`. This is the preferred local
  automation setup; no additional X server or changes to the bridge or IDE services are needed.
- The Vite development renderer passed the same smoke scenario; a main-process edit triggered the
  configured rebuild/restart. Native Wayland launch and backend communication were also checked with
  `--ozone-platform=wayland`; the broader desktop matrix remains P14 work.
- AppImage was generated, not installed on a clean distribution. Windows/macOS builds and the remote
  CI workflow have not been executed here. The product still uses Electron's default package icon.
- Debian packages wait for maintainer contact metadata in P14. Upstream Zod/Rollup annotation warnings
  are non-blocking; no application build or test failure remains.

## P01 — Git execution and operation infrastructure

Coverage: backend prerequisites, F14. This phase supplies services and a small diagnostics/activity surface.
It does not yet need the repository browser.

1. Discover configured/system Git; resolve its executable; expose version and capabilities. Handle
   missing Git and unsupported optional flags. Choose/document a minimum version after testing it.
2. Build a runner around asynchronous child processes with argument arrays, explicit cwd, controlled
   environment, bounded stdout/stderr, exit-code classification, and redacted command logging.
   Never interpolate shell commands. Handle filenames/refs beginning with dashes and option delimiters.
3. Add an operation registry: accepted job ID, status/progress events, completion query, cancellation,
   process-tree termination strategy per OS, and shutdown cleanup. Cancellation reports the state that
   actually remains; it does not promise rollback. Avoid retrying unknown-outcome writes.
4. Coordinate operations by common repository and worktree scope; bound concurrent reads, serialize
   conflicting writes, and keep unrelated repositories independent. Define generation IDs for results.
5. Define repository trust before invoking hooks, filters, credential helpers, diff drivers, or custom
   programs. Honor Git ownership checks; never auto-edit safe-directory configuration or delete lock files.
6. Create TypeScript fixtures for disposable repositories, bare remotes, linked worktrees, merge histories,
   unusual filenames, failures, and slow/cancellable subprocesses.

Acceptance:

- Missing executable, nonzero exit, spawn failure, cancelled child, excessive output, timeout, and
  paths containing spaces/Unicode/newlines/leading dashes produce deterministic outcomes.
- Cancelling a running process does not leave children or watchers behind; cancelling a queued job
  never starts it. Two writes cannot interleave on shared state, while unrelated repositories progress.
- Arguments and private output never become shell code or unredacted credentials in the UI/log.
- A backend job continues to have queryable state after a UI subscription is removed.

F01 currently consumes the runner and discovery subset needed for local repository access. The P01
operation registry, process-tree policy, repository trust model, and broader fixture catalog remain
unverified and keep P01 partial.

## P02 — Repository sessions and persistence

Coverage: F01–F03, F33 foundation.

1. Add open/init/local-clone dialogs and repository discovery. Handle nested paths, bare repositories,
   detached/unborn HEAD, symlinks, and `.git` files. Track working directory, Git directory, and common
   directory separately. Remote cloning waits for P05 authentication.
2. Introduce backend repository IDs, session ownership, typed summaries, close/reopen behavior,
   debounced filesystem invalidation, and stale-response protection. Repositories from separate tabs
   cannot share selected state accidentally.
3. Persist recent repositories, theme, window bounds, tab order, per-repository preferences, and drafts
   using versioned atomic storage. Show recovery options for missing/corrupt settings.
4. Build basic tabs and repository manager; support opening a path from CLI/desktop launch and forward
   a second-instance request to the existing application. Choose shared renderer state management here.
5. Evaluate/introduce an allowlisted application asset protocol before adding repository-content views.
   File content must never navigate the privileged renderer.

Acceptance:

- Open, close, reopen, and restart preserve expected session state; missing/moved repos remain recoverable.
- An initialized empty repo and a linked worktree open correctly. The same canonical path is not
  duplicated unintentionally. No repository is modified just by opening it.
- Switching tabs while a slow request completes cannot display data from the previous repository.
- Tests isolate preferences, watchers, repository fixtures, and local clone destinations.

Verified local F01 slice (2026-09-16, Fedora Linux x64, Git 2.55.0): open an existing repository,
initialize a normal or bare directory, canonicalize nested paths/symlinks, retain separate worktree,
Git, and common-directory paths, classify branch/detached/unborn HEAD, deduplicate an open session,
close/reopen it, and persist a bounded recent list with corrupt-file quarantine. Remote clone, local
clone jobs, filesystem invalidation, CLI/second-instance opening, and the restricted asset protocol
remain unverified.

Started F02 manager slice (2026-09-16): persist up to ten canonical source directories in a separate,
versioned atomic store; scan each source directory for normal, `.git`-file, and bare repository markers;
rebuild deterministic folder hierarchy DTOs; deduplicate overlapping source roots; show missing and
unreadable roots; bound depth, entries, repositories, and warning output; skip symlink entries without
leaving the selected source tree; and open/select discovered repositories through the existing session
boundary. Tests use disposable repositories and verify persistence, nested folders, bare repositories,
overlapping/symlink paths, missing roots, and depth limits. Custom manager folders, repository renaming,
automatic filesystem invalidation, cancellable background scans, and cross-window manager ownership
remain unverified.

Started F03 tab slice (2026-09-16): add bounded porcelain-v2 worktree summaries with clean, dirty,
unavailable, and unknown states; refresh open-tab status on a five-second renderer poll; persist
canonical tab order, active tab, and vertical/horizontal orientation in a separate versioned atomic
store; restore persisted tabs when the repository service is recreated; and add close controls plus
Ctrl/Cmd+1–9, Ctrl/Cmd+Tab, Ctrl/Cmd+W, and Ctrl/Cmd+Shift+T tab shortcuts. Disposable-repository
unit tests verify newline-containing filenames, dirty counts, preference persistence, and tab restore;
the Electron test verifies two tabs, external dirty-state refresh, orientation switching, and shortcut
reopening. Full-app closed-tab history across restart, filesystem watchers, drag reordering, multiwindow
ownership, and the remaining P12 workspace polish remain unverified.

Started F04 history slice (2026-09-16): add a bounded `repository:get-history` capability backed by
machine-formatted Git log/reference reads; return full commit IDs, parents, author/committer identities
and dates, subjects/bodies, branch/remote/tag/stash labels, detached HEAD labels, and tracking counts;
validate the DTO at the IPC boundary; assign independently computed graph lanes; and render a selectable
history list with full-hash commit details, inert commit messages, reference chips, refresh, and incremental
page loading. Disposable merge/tag/unborn fixtures compare commit IDs and parents with `git rev-list`,
and the Electron test selects a real commit through the isolated preload. The initial reference/commit
filtering slice is recorded under F06 below. File/path/content search, selection/scroll persistence, virtualization, detached and
multiple-root integration fixtures, and the 100,000-commit/1,000-ref performance baseline remain
unverified, so P03 and F04 remain partial. The merge-collapse portion is covered by the partial F05
slice below; the F07 revision-inspection portion is recorded below.

Workspace chrome, graph drawing, and context-menu slice (2026-09-16, requested ahead of sequence):
align the workspace with the public Fork layout recorded under F34 in the research document. Linux
and Windows now use a frameless window with a renderer-drawn title bar, menu bar with Alt mnemonics,
and window controls; macOS keeps inset traffic lights and a reduced native menu. The shell uses a Fork
style toolbar, equal-width tabs with `*` dirty markers and middle-click close, a Repository Manager new
tab, a repository sidebar with view switching, filter, and a keyboard-navigable reference tree, a
headerless commit table with avatars, lane-colored reference labels, HEAD emphasis and unreachable
commit dimming, resizable panes, and Commit/Changes/File Tree details. The lane algorithm was replaced
by stable columns with join/branch elbows. Renderer context menus cover commits, references, tabs,
repository-manager items, text fields, and selected text. Implemented actions include copying SHAs,
messages, names, and paths; opening repository folders in the file manager; closing tabs; and
switching appearance and tab orientation. Planned Git operations are present but disabled with their
phase. New IPC capabilities are validated and backed by unit tests; the Electron test verifies the
title-bar buttons reach the main-process window methods, menus, appearance, the About dialog, graph
elbows on a real merge, context-menu focus and clipboard copy, tabs, and the Repository Manager.

Started F05 collapse slice (2026-09-17): add a pure loaded-history projection that collapses the
unique ancestry of non-first merge parents, reconnects hidden edges at visible boundaries, retains
merge and decorated tips as navigation handles, and preserves selected-commit metadata when a row is
hidden. Merge-tip buttons expose collapse/expand state; Left/Right work from the commit list; and the
graph context menu supports Collapse All Branches and Expand All Branches. Unit tests cover merge-base
reconnection, stale IDs, decorated tips, and nested merges; the Electron fixture verifies click,
keyboard, context-menu, and restoration behavior. Cross-page collapse stability, full nested-merge
interaction, large-history performance, and exact Fork visual parity remain unverified.

Started F06 reference/commit filtering slice (2026-09-17): add a validated history-filter contract,
reference context-menu actions that scope `git log` to a selected commit target, and a bounded
case-insensitive fixed-string commit-message search with generation-safe replacement paging. The
renderer exposes a search field, clear controls, a no-match state, and an enabled sidebar search action;
the 2026-09-17 design refresh below moved the search into a sidebar panel. Disposable Git tests compare reference results with `git rev-list` and verify literal
search text; the Electron fixture covers reference filtering, clearing, search, and no-match behavior.
File-list filtering, path history, diff-content search, author/hash search, recent-query persistence,
and large-history search performance remain unverified, so F06 remains partial.

Started F07 revision-inspection slice (2026-09-17): add validated commit-change, revision-tree, and
bounded revision-blob contracts; read raw committed paths with rename/copy, mode, and object metadata;
read one revision-tree directory at a time; and expose text previews while explicitly classifying binary
and oversized blobs. The Commit detail tabs now load real Changes and File Tree views with retry, empty,
truncation, directory navigation, parent metadata, and inert text states. Disposable Git tests compare
changed paths and tree entries with independent CLI reads, including a newline-containing filename; the
Electron test covers a root commit's changed file, tree entry, and text preview; unit tests also cover
binary and oversized blob states. Merge diff presentation, tree caching/virtualization, selected path persistence, detached and
multiple-root integration, and large-tree performance remain unverified, so F07 and P03 remain partial.

Started F08 working-changes slice (2026-09-17): add a bounded `repository:get-working-changes` capability
backed by NUL-delimited Git porcelain-v2 status; return separate staged, unstaged, untracked, and ignored
entries, preserve partial-stage duplication, conflict visibility, rename/copy similarity, mode metadata,
and truncation counts; and render per-repository tree/list views with persisted untracked/ignored visibility
toggles and refresh polling. Disposable Git tests compare status categories, paths, rename metadata, and
executable-bit changes, parser tests reject malformed records, the preload contract is validated, and the
Electron fixture covers staged/unstaged partial changes, untracked/ignored toggles, and list mode. Actual
merge-conflict fixture behavior and selection persistence remain unverified; staging and hunk discard are
covered by F10, while commit workflows remain in F11, so F08 and P04 remain partial.

Started F09 diff slice (2026-09-17): add a validated `repository:get-diff` capability with backend-owned
argument construction for staged, unstaged, untracked, ignored, and committed targets; support normal and
three whitespace-comparison modes; bound patch output; and classify binary, oversized, and conflict states
explicitly. The renderer now shows real unified or split text diffs in both Local Changes and committed
Changes, highlights adjacent-line inline edits, provides literal search with navigation, and can display
spaces, tabs, and CR characters. Disposable Git tests compare working and committed patch content and
whitespace behavior; parser, preload, and Electron tests cover line metadata, target validation, split mode,
search, and visible whitespace. Syntax rendering, image/binary viewers, and exact merge-diff presentation
remain unverified; F10 now covers the mutation slice, so F09 and P04 remain partial.

Started F10 staging slice (2026-09-17): add a validated `repository:apply-working-change` capability
for whole-file stage/unstage, hunk and line stage/unstage, and hunk/line discard. Working diffs now carry
backend-issued filesystem/index snapshot tokens; the backend re-reads the target diff immediately before
each mutation, rejects stale snapshots, serializes writes per repository, and builds selected patches from
fresh Git output rather than trusting renderer text. The renderer enables Fork-style pane Stage/Unstage
buttons, per-hunk Stage/Unstage/Discard controls, and explicit added/removed-line selection. Disposable
Git tests verify partial staging reconstruction, repeated selections, CRLF and missing-final-newline
handling, stale edits, unborn repositories, rename/deletion/symlink/binary/mode file actions, and selective
hunk discard; the preload contract, repository service, and Electron flow are covered as well. Whole-file
discard, conflict-specific staging policy, selection persistence, hook failures, and exact current Fork
parity remain unverified, so F10 and P04 remain partial.

Started F11 commit slice (2026-09-17): add validated `repository:get-commit-context` and
`repository:commit` capabilities. The context read reports the identity Git would use (configured,
guessed, or missing), the commit an amend would replace with whether a remote-tracking ref already
contains it, a `commit.template` with comment lines removed, pending merge/cherry-pick/revert/rebase
state with Git's own prepared message, recent messages, the executable commit hooks present, and a
compare-and-swap token over HEAD, that pending state, and the staged entries. Committing re-reads the
context inside the per-repository mutation queue, refuses a stale token, and runs one
`git commit --cleanup=whitespace --file=-` with the message on standard input. Hooks run because a commit
is an explicit user action; their output is returned as bounded inert text and `--no-verify` is offered
only as a separate action after a hook failure. The composer now keeps per-repository subject and body
drafts, counts down from a 50-character subject guide, offers recent messages, prefills an amend from the
previous message, labels the button "Commit N Files", and explains published-amend, detached-HEAD,
pending-merge, identity, and signing situations. Disposable Git tests cover the first commit of an unborn
repository, partial staging, amend (including author-date preservation and unchanged commit count), empty
message, nothing staged, stale snapshots, a failing pre-commit hook with its output and an explicit skip,
a commit-msg hook rewriting the message, templates, recent-message de-duplication, published detection,
merge commits, unmerged refusal, dash-prefixed paths, and comment-like message bodies; the preload
contract, repository service, and a full Electron commit/amend/hook flow are covered as well. Signing,
`--signoff`, co-authors, commit-and-push, spell checking, a configurable subject limit, and prepare-commit-msg
drafting are not implemented, so F11 and P04 remain partial.

Follow-up fixes in the same slice (2026-09-17): the Unstaged and Staged panes now support
Ctrl/Cmd-click, Shift-click and Shift+arrow multiple selection; their button acts on that selection and
reads "Stage All"/"Unstage All" only when nothing is selected; and one request carries every chosen file,
so staging a selection is a single `git add` instead of one round trip per file. Whole-file actions
revalidate each named file against a fresh status read, while hunk and line actions keep the exact content
snapshot. Ticking Amend now previews the amended commit in the Staged pane from
`repository:get-amend-changes` (the index compared with HEAD's parent, or the empty tree for a root commit)
with a matching `amend` diff target; it is a read, so nothing is reset and unticking restores the ordinary
panes. Disposable Git tests cover batched staging, a selection that no longer matches the working tree, the
amend preview including a root commit, and the amend diff; renderer tests cover the selection model; and
the Electron test exercises Ctrl+click staging and the amend preview.

Design realignment with this slice (2026-09-17): the F08 placeholder metadata list (Status, Area,
Previous path, Mode, Blob) above the diff was removed from both the working-change and committed-change
previews, because Fork's published local-changes and Changes views put the diff directly under the file
header. Rename and mode facts now appear as one muted line beside the path, and the status stays available
through the badge's label. Light and dark screenshots of a disposable repository were compared with the
local reference library before and after the change.

Informal check on this Fedora host with software rendering (not the P03 performance baseline): a
local mirror of a public project with 15,318 commits, 2,939 merges, and 116 refs showed its first
50-commit page in about 0.2 s, loaded 2,050 rows by scrolling, and drew up to 13 lanes. Skipping
off-screen row rendering (`content-visibility`) reduced a keyboard selection step with 2,050 rows from
about 78 ms to 31 ms, measured over two animation frames. At 125% and 150% device scale, a pixel scan
found no breaks in lane lines at row boundaries.

This slice does not complete F06 file/path/content filtering, F07's remaining merge/tree-scale work, P04's
remaining whole-file discard and conflict work,
or P12 command availability. On the forwarded Xwayland test display, `BrowserWindow.maximize()` and
`minimize()` had no effect even for a normal framed window, so real maximize/minimize, title-bar
double-click, and edge resizing were not verified there. macOS and Windows chrome, screen-reader output
for the custom menus and tree, fractional scaling, and very wide graphs remain unverified.

Frameless window follow-up (2026-09-17): on that display the title bar could not move the window, edges
did not resize it, the minimize and maximize buttons did nothing, and a light frame surrounded the window.
The bridge's xwayland-satellite 0.8.2 logged that it rejected Chromium's move/resize requests
(`_NET_WM_MOVERESIZE` with button 0) and did not recognize `WM_CHANGE_STATE`. Its source handles only
full screen in `_NET_WM_STATE`. The frame was Electron's solid 4px fallback, drawn because that window
manager cannot show client-drawn shadows. Electron chooses Wayland only from `XDG_SESSION_TYPE`, so
development launches now set it when `WAYLAND_DISPLAY` is reachable outside an X11 session. Over native
Wayland to the host's KDE Plasma session, the title-bar Maximize, Restore, and Minimize buttons changed
the real window state, and Electron used its shadow margin instead of the solid frame. Moving by the
title bar, edge resizing, and title-bar double-click need real pointer input and were not verified
automatically. With the Vite development server on native Wayland, the hidden window never received
`ready-to-show` although the page rendered, so no window appeared; the event arrived only after the window
was shown. The window now also shows when the page finishes loading, and the development run then mapped
and presented the window on the host.

Fork design refresh (2026-09-17, requested after the F05–F08 slices): the public screenshots used for
comparison are listed in `docs/research/fork-references.json`, and `npm run research:references` restores
them into the git-ignored `docs/research/fork-references/` library; the research record lists the dated
observations. Commits are now drawn as dots and merges as rings with a collapse chevron; remote markers
sit in their own label boxes, tags keep a fixed color, and subjects with a message body show an
indicator. The toolbar is compact, with a Branch menu button and a Console button that stay disabled
with their phases, and tabs mark uncommitted changes with a dot. Commit search moved from a bar above
the list into a sidebar Search Commits panel: its results are separate backend-paged queries, and
choosing one selects that commit in the unfiltered list after loading at most 40 further history pages.
A reference filter shows a Filtered by strip with Clear filter. Right-clicking the graph column opens
Collapse, Expand All, and Collapse All, which also end the commit menu. The Commit tab lists changed
files. Changes and File Tree start with a one-line commit summary and place a resizable file list beside
a change-metadata or line-numbered text preview; the File Tree loads folders lazily and lists them first.
Local Changes uses Unstaged and Staged panes with an options menu for tree/list and untracked/ignored
visibility and a commit composer; F10 enables Stage, Unstage, and selected hunk/line actions with
snapshot validation, and F11 enables the composer itself. The F11 slice also dropped the earlier
change-metadata list above the diff, which Fork does not show. Verified on Fedora
Linux with `npm run check`, `npm run build`, the Electron test
through the bridge's X11 display (covering search results, the filter strip, the graph menu, the options
menu, and the dirty-tab dot), and light and dark screenshots of a disposable repository compared with
the references. Exact current palettes and spacing, the Mac segmented detail tabs, View as Combined List,
search scopes other than commit messages, and the eye toggle remain unverified or unimplemented.

## P03 — History, graph, and revision inspection

Coverage: F04–F07, F34 foundation.

1. Parse paged history and references into stable DTOs. Include full IDs, parents, author/committer,
   dates, subject/body, decorations, HEAD, and tracking information. Handle empty and disconnected histories.
2. Implement an independently designed graph lane algorithm and virtualized commit rows. Preserve
   connectivity across page boundaries, multiple parents, branch filtering, and merge collapse/expand.
3. Connect sidebar refs, text/author/hash filters, commit selection, parent navigation, details, changed
   files, and revision tree/blob inspection. Render repository text as inert text.
4. Add resizable graph/detail panes, keyboard selection/navigation, accessible labels, theme tokens,
   and selection/scroll persistence. Keep graph colors distinguishable without relying on color alone.

Acceptance:

- Compare graph ancestry and selected revision data against CLI results for merges, octopus merges,
  reordered dates, tags, detached HEAD, and multiple roots.
- Paging and collapse do not lose selected commits or show incorrect parent edges.
- Record baseline cold/warm performance using at least 100,000 commits and 1,000 refs. Establish budgets
  for first-page display, memory, and interaction latency before accepting further rendering work.

## P04 — Working changes, diff, staging, and commits

Coverage: F08–F11, F34; basic text review is the first local-use checkpoint.

1. Read index/worktree state using a stable machine format; show separate staged/unstaged files, conflicts,
   ignored/untracked toggles, rename/copy metadata, executable-bit changes, and tree/list selection.
2. Build unified and side-by-side text diffs with inline highlighting, context controls, whitespace mode,
   search, syntax rendering, and explicit large-file/binary fallbacks.
3. Implement whole-file stage/unstage first. Then hunk and line selection with a tested patch model,
   index/worktree snapshot validation, and useful refresh/retry feedback when files changed externally.
4. Add commit/amend, subject/body drafts, recent messages, templates, identity diagnostics, hook output,
   and detached/published-commit warnings. Preserve drafts and selections after a failed commit.
5. Add discard with exact file/hunk/line preview, confirmation, and recoverable backups where possible.
   Explain what cannot be recovered; never include untracked files implicitly in a broader operation.

Acceptance:

- Independently check working tree, index, and committed tree after each action. Cover partial staging
  with both staged and unstaged edits in one file, CRLF, missing final newline, rename, deletion, symlink,
  binary, mode change, empty commit rejection, and a hook failure.
- An external edit between diff rendering and action is detected and never silently discarded.
- Repeated partial staging reconstructs the intended tree exactly, not merely a visually plausible diff.

## P05 — References, remotes, and network operations

Coverage: F01 remote clone, F12–F14.

1. Add create/rename/delete/checkout for branches and lightweight/annotated tags; upstream selection,
   stale-reference indicators, and safe handling of dirty working trees and checked-out worktree branches.
2. Manage remote URLs and names with validation. Implement credential-helper/SSH-agent integration,
   controlled prompt/askpass handling, and platform secret storage only where secrets must be retained.
3. Add clone/fetch/push with progress, cancellation, background fetch scheduling, tracking counts,
   branch/tag selection, and clear authentication/network errors. Avoid duplicate background operations.
4. Add fast-forward-only pull first. Merge/rebase pull options are enabled only when P06/P07 recovery
   paths are ready. Support lease-based force push only with explicit preview and confirmation.

Acceptance:

- Use disposable bare remotes for clone/fetch/push/divergence/lease-rejection tests; keep offline checks deterministic.
- Credential cancellation, expired credentials, unreachable hosts, denied push, invalid ref, and an
  upstream deleted on the remote all leave an actionable state.
- Progress and output are redacted. Force push requires an explicit user action and never silently
  falls back from a rejected ordinary push.

Electron test hosting (2026-09-19): `npm run test:e2e` now launches Electron on Ozone's `headless`
platform and removes `DISPLAY` and `WAYLAND_DISPLAY` from the child environment, so the suite needs no
display server, no Xvfb, and never opens a window on the desktop running it. Setting
`ELECTRON_TEST_OZONE_PLATFORM` to `x11` or `wayland` still puts the same test on a real display for
watching it. This changes only how the test is hosted, not what it checks.

Started F12 branch/tag slice (2026-09-19): add validated `repository:get-reference-context` and
`repository:apply-reference-action` capabilities. The context read returns the local branches with their
upstream, a stale-upstream flag, the linked worktree that has each branch checked out, and whether each
tip is merged into HEAD; the tags with their peeled commit and whether they are annotated; the remote
names and remote-tracking branch names; the working-tree, conflict, and pending-sequencer state; and a
compare-and-swap token over HEAD, the local branches, and the tags. Remote-tracking refs are deliberately
outside that token, so a future background fetch cannot invalidate a dialog the user is still filling in.
The action capability takes exactly one named action — create, rename, or delete a branch, set or unset an
upstream, check out a branch, a remote branch, or a commit, and create or delete a tag — re-reads the
context inside the per-repository mutation queue, refuses a stale token, and runs one Git invocation with
backend-built arguments. A start point is either a commit this window already saw or a reference the same
read reported, so revision syntax such as `HEAD@{1}` never reaches Git; names are bounded by the shared
schema and then validated by Git's own `check-ref-format`. Refusals come back as structured results
naming the exact obstacle — a name already in use, an unmerged branch, a branch another worktree has
checked out, the current branch, local changes a checkout would overwrite with the paths Git listed, a
running merge or rebase, or a missing tagger identity — and only an unmerged deletion offers an explicit
force. The renderer adds Fork-style Create Branch, Create Tag, Rename, Tracking, Delete, remote-checkout,
and detached-checkout dialogs with live name validation, a toolbar Branch menu with a checkout submenu,
real branch/remote/tag/commit context-menu commands, a Ctrl/⌘+Shift+B shortcut, a status strip that
reports what changed or why it did not, and a "gone" marker on branches whose upstream no longer exists.
Disposable Git tests cover the context lists, a deleted upstream, a linked-worktree checkout, branch
creation with and without checkout and tracking, rename, merged and unmerged deletion, current-branch and
worktree refusals, upstream set/unset, branch/commit/remote checkout, a checkout Git refuses because of
local changes, a checkout refused during a merge, lightweight and annotated tags, duplicate names,
invalid names, an unknown start point, and a stale token; the preload contract, the repository service,
and an Electron flow that creates, checks out, tags, and deletes through the real UI are covered as well.
Deleting a branch on a remote, pushing a tag from the create dialog, multiple-reference selection and
deletion, branch folders and moving, pinning, sorting, hiding, "Select Stale Local Branches", checkout as
a worktree, branch-folder autocomplete, and Fork's F2 and ⌘B shortcuts are not implemented, so F12 and
P05 remain partial.

Started F13 remote and network slice, with the F14 operation surface it needs (2026-09-19): add a
main-process operation registry and the validated `repository:start-network-operation`,
`repository:list-operations`, and `repository:cancel-operation` capabilities, plus a
`repository:operation-changed` event routed to the window that started the work. A network request is
accepted and answered with a running record, so the preload's short deadline never decides the outcome of
a fetch or a push; progress, output, and completion arrive as events, the record stays queryable after
every listener has gone, and a closed window cancels its own work. One network operation runs per
repository at a time, which is how duplicate background work is refused, and a pull additionally takes the
per-repository mutation queue because it writes the index and working tree. The runner now streams
standard error for progress and, on POSIX, gives each child its own process group so cancelling a fetch
also stops its transport helper and ssh. Fetch (one remote or all, with prune and tags), fast-forward-only
pull, push (several branches, optional upstream creation, annotated tags, and `--force-with-lease`), and
deleting a branch on a remote are each one Git invocation with backend-built arguments; a push refspec can
only name a local branch, and a rejected ordinary push never falls back to a force. Failures are
classified into authentication, network, rejected, lease, no-upstream, not-fast-forward, local-changes,
not-found, cancelled, and timeout, each with one actionable sentence, and every line of output is stripped
of terminal escapes and of credentials embedded in a URL. `repository:list-remotes` and
`repository:apply-remote-action` add, rename, retarget, and remove remotes with Git's own
`check-ref-format` validation; an `ext::` URL, which would make Git run a local command, is declined
because repository trust is a later phase. The reference read now also reports each branch's ahead and
behind counts, which the sidebar shows beside its name. The renderer adds Fork-shaped Fetch, Push, and
Remotes dialogs, an activity panel with each operation's command, progress, output, and a cancel control,
toolbar Fetch/Pull/Push buttons with live progress, a Ctrl/⌘+Shift+F shortcut, and Remotes sidebar menus.
Disposable Git tests use a local bare remote to cover push with upstream creation, fetch, prune, a
fast-forward pull, a pull that is refused because the branches diverged, a rejected push that reports it
could be retried with a lease, a lease refused as stale and then accepted after a fetch, deleting a branch
on the remote, an unreachable remote, cancellation, the duplicate refusal, the tracking counts, and remote
management including a declined `ext::` URL; parser tests cover progress, redaction, and every failure
class; the registry, the preload contract, and an Electron flow that adds a remote, pushes, fetches, and
pulls through the real UI are covered as well. Merge and rebase pulls, background-fetch scheduling,
interactive credential and passphrase prompts, platform secret storage, clone, pushing a single tag,
pushing to a differently named remote branch, and fast-forwarding several branches at once are not
implemented, so F13, F14, and P05 remain partial.

## P06 — Merge, conflicts, stashes, and recovery

Coverage: F13 completion, F15–F17, F19. Daily-use checkpoint after this phase.

1. Model merge/rebase/cherry-pick/revert sequencer states, including operations started outside the app.
   Add continue/skip/abort where Git supports them and show the exact in-progress operation.
2. Build merge workflows and a three-way conflict view with base/ours/theirs and editable result.
   Cover delete/modify, rename, binary, and submodule conflict states; offer external-tool handoff.
3. Add stash creation, selection/partial stash, inspect/apply/pop/drop, staged-state preservation, and
   autostash recovery. A conflicted pop must not be reported as a successful deletion.
4. Add cherry-pick/revert including merge-parent selection, safe reset variants with previews, and
   conflict recovery. Enable non-fast-forward pull and ordinary rebase once these paths are verified.

Acceptance:

- Every supported conflict workflow can finish or abort from a fresh app launch after interruption.
- Check content, index stages, refs, and sequencer files against the CLI; preexisting unrelated work survives.
- Display ours/theirs in terms of the current operation so rebase does not misleadingly reverse user intent.
- Never label a binary conflict resolved just because it has no text markers.

## P07 — Interactive rebase and history editing

Coverage: F16 completion, F18.

1. Build a reviewed rebase plan with reorder/pick/reword/edit/squash/fixup/drop, autosquash, quick actions,
   root handling, and dependent-reference updates when supported. Decide explicit merge-preservation support.
2. Execute through controlled sequence-editor integration, with temporary recovery refs and job state.
   Preserve user-authored todo/message edits and handle pause/resume without running arbitrary editor commands.
3. Integrate conflict resolution, continue/abort, published-history warnings, and discoverable recovery.
   Add drag gestures only after equivalent keyboard/menu actions are correct.

Acceptance:

- Compare resulting trees, parent graph, messages, and updated refs with independently prepared expected
  repositories. Cover root, empty commits, conflicts, interrupted execution, and a changing upstream.
- Cancel/abort preserves recovery refs until the result is confirmed. No existing local work disappears.

## P08 — Investigation, recovery, and patches

Coverage: F06 expansion, F15 patch export, F20–F21, F26, F36.

1. Add author/message/hash/path/content history search, rename-aware file/directory history, selected-code
   history, blame navigation, and historical file retrieval without overwriting the checkout.
2. Show reflog entries and recover a selected lost commit to an explicitly named reference.
3. Add bisect start/good/bad/skip/reset with a visible range and state restored after app restart.
4. Add patch save/copy/import/apply, applicability preview, conflicts, and option to apply without committing.
   Reject traversal/absolute paths and validate the selected repository and current state before application.

Acceptance:

- Validate blame attribution, file history, recovery refs, and bisect result on known fixtures.
- Preserve bytes/line endings when exporting/importing patches and explain rejected hunks.
- Search remains cancellable and bounded; changing the repository invalidates obsolete matches.

## P09 — Worktrees, submodules, and Git-flow

Coverage: F22–F23, F25.

1. Worktree list/create/remote-checkout/open/remove/prune with linked-branch visibility and safe
   dirty/locked-worktree handling. Keep worktree tabs distinguishable and respect shared refs.
2. Submodule list/add/init/update/sync/remove, nested status, pointer diffs, navigation, and conflict handling.
   Make network or recursive mutation scope visible.
3. Git-flow initialization and feature/release/hotfix workflows with explicit dependency/capability checks.
   Keep ordinary Git available when the extension is absent.

Acceptance:

- Test shared/common directory coordination, dirty and locked worktrees, nested submodules, missing commits,
  detached submodule HEAD, and interrupted updates.
- Worktree removal and submodule removal preview exact paths and never recurse into unrelated content.
- Complete one feature, release, and hotfix lifecycle and verify branches/tags against expected Git state.

## P10 — Rich diffs, LFS, and signing

Coverage: F24, F27–F28.

1. Implement safe image decoding and side-by-side/swipe/overlay/pixel comparison, plus binary metadata and
   bounded large-file handling. Isolate SVG rendering and avoid executable embedded content.
2. Add LFS capability detection, pointer/materialized state, on-demand content, transfer progress,
   tracked patterns, lock/unlock, and failures. Do not download large objects just by selecting a row.
3. Add signing configuration and verification for documented GPG workflows. Research other signing
   backends independently and record any extension beyond the documented target.

Acceptance:

- Test corrupt/large images, alpha differences, missing LFS objects, cancelled transfers, lock ownership,
  signing failure/cancel, unavailable keys, and an invalid signature.
- Secrets/passphrases remain outside renderer state and logs. Unsigned results are never labeled verified.

## P11 — Hosting integrations

Coverage: F29–F30.

1. Define a provider interface and a provider-specific coverage table from fresh public evidence.
   Start with GitHub, then GitLab, Bitbucket, Azure DevOps, and Gitea where documented workflows apply.
2. Implement account setup, repository enumeration/clone selection, pagination, token refresh/revocation,
   self-hosted URL policy, and durable secure credential references.
3. Add documented issue/PR discovery, filters, browser handoff, notifications, and relevant repository links.
   Treat full in-app review editing as unresolved until research establishes its target behavior.

Acceptance:

- Mock service contracts cover pagination, rate limits, expiration, revocation, offline mode, and errors.
- No provider account is required for local Git. Signing out removes local secrets and stops background polling.
- Use a deliberately configured test account only for any future live network validation.

## P12 — Productivity and workspace completion

Coverage: F02–F03 completion, F31–F34.

1. Quick Launch with fuzzy commands, branch/file/repository lookup, discoverable shortcuts, and consistent
   action availability across keyboard, menus, toolbars, and context menus.
2. External editor/diff/merge/terminal/file-manager adapters with explicit executable/argument configuration,
   Linux desktop defaults, missing-tool diagnostics, and line/repository handoff.
3. User-defined contextual commands, optional input forms, shared definitions, variable expansion, output
   and cancellation. Imported definitions never auto-execute; preview expanded intent before first execution.
4. Finish repository grouping/scanning, tab orientations/reopening/colors, multiwindow ownership, saved
   layouts, preference migrations, issue-link rules, avatars, and accessible focus/shortcut customization.

Acceptance:

- All primary workflows are keyboard operable. Pane/tab state restores across restart and display changes.
- Fuzz command-variable quoting and unusual paths. A repository-provided command definition cannot
  escalate into execution without the user selecting and enabling it.
- Repeat open/close/reload cycles without leaked listeners, processes, or repository watchers.

## P13 — Statistics and optional AI integrations

Coverage: F35, F37. These are separate slices; AI is never required for normal Git use.

1. Statistics: cached aggregate activity, contributor/time summaries, and repository treemap.
   Bound computation and keep large repositories cancellable. State the definition of each metric.
2. AI adapters: research each publicly documented tool and platform, then add explicitly configured
   commit-message and branch/range-review requests. Preview the repository material being sent,
   support cancellation, and handle missing tools or authentication.
3. Generated messages are editable drafts. Review output cannot execute commands or mutate a repository
   automatically. Keep provider selection, retention behavior, and local versus remote execution visible.

Acceptance:

- Compare aggregate values with independent fixture calculations; time zone/author alias choices are explicit.
- No code leaves the machine merely by opening a repo or diff. Disabling an integration stops its activity.
- No model/provider credentials enter shared DTOs, screenshots, or logs.

## P14 — Parity audit and Linux distribution

Coverage: every F-item and accumulated platform differences.

1. Revisit the dated research baseline; publish a feature-by-feature verified/partial/unsupported ledger.
   Resolve undocumented assumptions or state them as deliberate differences.
2. Benchmark large/deep histories, many refs, huge diffs, large monorepos, watcher storms, concurrent tabs,
   and worktrees. Profile actual bottlenecks; add workers/caches only where justified.
3. Exercise accessibility, keyboard layouts, IME, fractional scaling, high contrast, multiple displays,
   Wayland/X11, GNOME/KDE, keyrings, SSH/GPG agents, permissions, and package installation on clean Linux hosts.
4. Finalize independent name/icons/app IDs, license attribution, signing, installer metadata, update strategy,
   settings migrations, crash recovery, and rollback. Build/test Windows/macOS separately if release scope includes them.

Acceptance:

- Smoke-test installed AppImage/deb distributions and the supported Linux matrix, with sandbox enabled.
- Every claimed feature links to public evidence and tests/manual verification; remaining gaps are explicit.
- Agree measured startup, memory, graph/diff latency, and cancellation budgets using recorded hardware/data.
- Release artifacts are reviewable locally. Publishing and signing-identity use are separate release actions.

## Test data and evidence strategy

Maintain a TypeScript fixture catalog, introduced in P01 and expanded by phase:

| Fixture family    | Essential cases                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Repository shape  | Empty/unborn, normal/bare, detached HEAD, nested path, `.git` file, linked worktrees                |
| History           | Linear, merge/octopus, unrelated roots, renamed paths, empty commits, signatures                    |
| Worktree/index    | Partial stage, conflict stages, untracked/ignored, CRLF, no final newline, modes, symlinks          |
| Paths and content | Spaces, Unicode, newlines, leading dashes, case differences, binary/large/malformed data            |
| Operations        | Interrupted sequencer, dirty checkout, locks, concurrent external edits, cancelled process          |
| Remotes           | Local bare remotes, divergence, rejected lease, missing upstream, controlled auth failure           |
| Scale             | At least 100k commits, 1k refs, many changed files, large diffs; record machine and repository size |

Use parser unit tests for format edge cases, integration tests against real Git for semantics, and Electron
tests for complete workflows. Assert repository state independently of the application's own parser.
Keep live provider tests opt-in; routine tests remain local and deterministic.

## Suggested next request

> Continue P05 from docs/implementation-plan.md. Add the clone workflow, then background fetch
> scheduling that cannot duplicate work, and controlled credential and passphrase prompting with
> platform secret storage only where a secret must be retained. Keep the F13 operation registry, its
> per-repository lane, and its structured failures intact. P04's whole-file and multi-file discard with
> an exact preview, confirmation, and recoverable backups is still open and can be taken first.
