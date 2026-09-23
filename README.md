# Git Workbench

P01 completes the Git execution foundation and aligns Activity with the captured Fork layout.
Git 2.43.0 or newer is required. Existing repositories open for history browsing; choose **Trust
Repository…** to enable working changes, configured Git programs and network operations. The choice
persists across restarts and linked worktrees and can be revoked in Repository Settings. New init/clone
destinations are trusted as explicitly created repositories. Activity remains queryable after closing
its panel or reloading the renderer; cancellation does not promise rollback. See the
[P01 verification and policy](docs/reviews/p01-infrastructure.md).

F37 adds optional AI messages and diff reviews. File → AI Integration (or Preferences → Integration)
lets you enter an OpenAI API text model ID and select a text file containing your API key. Setup is
session-only and makes no network request. In Local Changes, Generate Message previews staged changes;
Repository → AI Code Review previews a branch or commit range. Review the exact material and explicitly
Send before any code leaves the machine. Generated messages are editable drafts; reviews cannot execute
commands or change Git state. Disable forgets the app's key and cancels pending work. Provider billing
and retention still apply; Claude/Codex/Cursor CLI adapters are not implemented. See the
[F37 scope and limits](docs/reviews/f37-ai.md).

F35 adds Repository > Statistics… and Repository Treemap…: local monthly activity, contributor shares,
date filtering and selectable file activity with Commits/Authors details. Reads are cached, cancellable
and bounded; see the [metric rules and limits](docs/reviews/f35-statistics.md).

A Linux-first Git desktop client in early development. **Git Workbench is a working name.**
The long-term target is Fork's captured Windows workflows and publicly documented feature families,
implemented independently with Electron, shared TypeScript contracts, and React. The Windows 2.22.0.0
black-box catalogue now guides the Linux UI; documented platform-specific extensions remain separate.

P02's repository/session foundation is complete for Linux: Repository Manager supports nested logical
folders, display names, filtering, source discovery and a default clone folder; scans can be cancelled.
Filesystem watchers refresh external changes. Missing repositories offer Retry/Locate, and damaged
settings retain recoverable originals. Drafts, tab order and preferences survive restart; reopening a
closed tab selects HEAD. See the [P02 handoff](docs/reviews/p02-repository-sessions.md) for verified scope.

P03's history and revision browser is complete for the Linux baseline. Search includes Commit SHA
(full hash or at least four prefix characters) and ten session-only recent queries. Commit summaries
support inline file expansion; large File Tree directories have Load more and virtualized rows.
Collapsing merges keeps the selected commit visible. The graph, refs, search and tree are verified on
100,000 commits/1,003 refs; see the [P03 handoff](docs/reviews/p03-history.md) for measured budgets,
Fork design comparisons and resource limits. Reproduce the browser benchmark with
`P03_BENCHMARK=1 npm run test:e2e -- tests/e2e/p03-history.test.ts`.

The earlier feature milestones start F01's local workflow, the first F02 repository-manager slice, the initial
F03 tab slice, the first F04–F07 history, collapse, filtering, and revision-inspection slices, the
F08–F11 working-changes, diff, staging, and commit slices, a first F12 branch and tag slice, an initial
F13 remote and network slice with the F14 operation surface it needs, and an initial F34 workspace-chrome
slice. It includes a Fork-style workspace: a custom title bar
with menus and window controls (native traffic lights on macOS), a toolbar, horizontal repository tabs
with an optional repository list alongside them, a Repository Manager new tab, a repository sidebar with a reference tree and commit
search, a commit table with a collapsible lane graph and colored labels, Commit/Changes/File Tree details,
a Local Changes view with unified or split diffs, and renderer-drawn context menus. It also covers Git
discovery, opening existing repositories, local initialization, recent-repository persistence, persisted
source directories, bounded folder-aware repository scanning, persisted tabs with dirty indicators,
close/reopen shortcuts, paged commit history, file/hunk/line staging with snapshot validation, committing
and amending, annotated tag creation (including empty annotations), branch creation, renaming, deletion, checkout and upstream selection, remote
management, automatic background fetch, fetch, explicit-source merge/rebase pull, inactive-branch fast-forward, mapped push with
optional lease-checked force, a PR browser handoff, and System/Light/Dark appearance. Network work,
commits, and reference actions run as queryable background operations in the activity panel. Checkout
offers preserve, stash/reapply, or discard, with recovery copies of changed tracked and untracked files.
F15 adds stash history, named all-file or selected whole-file stashes, staged-state-preserving
inspect/apply/pop/delete/rename actions, and bounded commit/stash/working-tree patch export.
The bounded F17/F18/F19 slices add text conflict resolution, interactive rebase editing, and
single-commit cherry-pick/revert plus Soft/Mixed/Hard reset with Recovery safeguards. F20 adds a
bounded lost-commit/reflog history mode with Exit and reviewed recovery through those existing actions.
F21 adds bounded rename-aware file History and Blame inspectors with historical diffs, line attribution,
revision selection, and Blame Back/Forward; directory and selected-code variants remain later work.
F23 adds bounded submodule lifecycle inspection with parent/index/child revision cards, dirty-child
state, nested sidebar navigation, safe Add/Initialize/Update/Sync/Remove actions, and backend-resolved
child tabs. F24 adds bounded local Git LFS pointer/materialized inspection, optional repository-local
initialization, exact historical payload Save As with SHA-256 verification, and retrieval progress;
remote/authenticated transfers, push, locks, and remote missing-object recovery remain later work.
Interrupted updates, nested mutation, missing-object recovery, and conflict continuation remain later work.
F25 adds native Git-flow initialization plus feature, release, and hotfix start/finish workflows with
annotated tags, optional develop back-merges, explicit capability checks, and a Git-flow toolbar/menu.
It uses ordinary Git and repository-local `gitflow.*` configuration; remote publishing, topic rebase,
automatic stash/reapply, and specialized conflict continuation remain later work. Lean Branching remains
a separate F38 family: the Branch dropdown and Repository → Lean Branching offer
Start, Sync and Finish with a reviewed base branch. Start checks out a new topic,
Sync rebases, and Finish returns to the base and merges while retaining the topic.
Commit or stash local changes first. Fetch and push are separate actions; conflicts
use Recovery Continue/Abort, then Sync can be run again. See the
[F38 policy and limits](docs/reviews/f38-lean-branching.md).
F26 adds manual Bisect start/Bad/Good/Skip/Abort, visible range and results, and restoration of active
sessions after restart. First-bad and ambiguous skipped-candidate results stay visible until Abort
restores the original checkout; local changes must be committed or stashed before advancing.
F28 adds GPG signing for commits/amends and annotated tags, repository-local signing-key configuration,
Git-default/Unsigned choices, and explicit commit/tag verification with separate trust and failure states.
The installed GPG agent handles passphrases. Key generation/import, global settings UI and SSH/X.509
verification remain outside this workflow; see the [F28 handoff](docs/reviews/f28-signing.md).

F27 adds static PNG/JPEG comparison in working and committed diffs: Side-by-Side, draggable Swipe,
Onion Skin and Pixel highlighting, with dimensions, byte sizes and transparency backgrounds.
Previews are bounded to 4 MiB and 4 megapixels per side; other formats, corrupt and oversized files
retain metadata/fallback states. SVG stays inert. See the [F27 handoff](docs/reviews/f27-image-diffs.md)
for the independent comparison rules and remaining format/LFS limits.

The [F01–F16 catalogue correction pass](docs/reviews/f01-f16-catalogue-corrections.md) adds Clone and Test
Connection, persistent tab reorder/reopen and window bounds, CLI/second-instance opening, scoped history
search with graph highlights and direct distant navigation, full-file/context/wrap and popup diffs,
explicit bounded Load Diff, confirmed tracked-file discard with recovery, a global automatic-fetch
preference, native authentication helper policy, captured stash-new-file semantics, and all four merge
modes. The corrected workflows are verified together; the broader feature families remain partial.
Conflict-editor parity beyond the bounded F17 text slice, F18 merge-preserving/dependent-reference
variants, F19 batch/edge history operations, F20 reflog expiry/named-recovery variants, hunk/line stashes and patch import, syntax/rich image viewers,
and the remaining workspace/platform variants retain their later-phase scope.

Pull shows its remote, source branch, and destination before starting. For an inactive destination it
explicitly checks that branch out first; Fast-Forward updates an inactive branch without switching.
Recovery provides merge/rebase continue/abort and saved-change restoration, including after restart.
Resolve conflicted files externally, stage them in Local Changes, then continue or mark saved changes
resolved. Recovery entries can be dismissed without changing Git's stash list. Before an action starts,
Cancel leaves the repository unchanged; after it starts, Close dismisses the dialog and Activity provides
the operation's cancellation control. Cancellation does not promise rollback.

GitHub HTTPS operations use a connected account when available. Other network operations use installed
Git credential helpers, SSH agents and configured native askpass tools. Background operations suppress
standard prompts; credentials never enter the renderer API. Clone requires a new destination; failed/cancelled
destinations are retained for inspection. A paused autostashed merge completed through the composer
retains its saved copy for explicit Recovery Apply.

Create Pull Request opens a form on GitHub.com, GitLab.com, Bitbucket.org, or Azure DevOps in the system
browser. It does not submit the form or require storing hosting credentials in this application.

File → Preferences → Accounts provides GitHub login and repository browsing. Copy a personal access
token and choose **Log in with Access Token**; the main process reads it directly from the clipboard.
No token file is needed. **Create token on GitHub…** opens token settings in your browser. Open
Repositories to browse accessible repositories, issues and pull requests, or choose an HTTPS/SSH clone URL.

The same account now authenticates HTTPS clone, Test Connection, fetch, pull and push, including
automatic fetch. Existing saved accounts work without another login. Fine-grained tokens need access
to the intended repositories and Contents read permission for fetch/clone, or read/write for push;
classic tokens generally need `repo` for private repositories. Organization approval and SSO still apply.
SSH remotes continue to use SSH keys; a GitHub token cannot authenticate SSH.

With multiple accounts, **Use as default for Git** selects the account for GitHub HTTPS URLs without
a username. Hosted HTTPS clone URLs include the selected public username, so subsequent operations
keep using that account. You can also use `https://LOGIN@github.com/OWNER/REPO.git` for an existing remote.
Tokens never appear in URLs or Git configuration, and the app does not install a global Git helper.

Accounts default to session-only storage. Remembering a token requires a secure OS keyring; Linux's
plaintext fallback is refused. Tokens never enter the renderer, IPC, repository configuration or logs.
Update token accepts a newly copied token and verifies that it belongs to the same account. Sign out
removes the app's credential and cancels its pending API reads. Already authenticated Git transfers
may finish; future transfers stop using that account. Neither action clears your clipboard nor revokes
the token on GitHub. There is no background hosting polling. Other providers, self-hosted accounts,
and OAuth remain unimplemented. See the [accounts correction](docs/reviews/github-accounts-correction.md).

In Accounts, Notifications lists your GitHub inbox with unread/all and participation filters.
Repositories → Browse issues / Browse pull requests opens paged lists with state, author, assignee
and title filters. Apply filters searches GitHub; recent title phrases are kept while Accounts is open.
Refresh checks for updates. Item titles open in your browser without marking notifications read in
the app. Notifications require a classic token with `notifications` or `repo` scope; GitHub's endpoint
does not support fine-grained tokens. Search is limited to 1,000 results and reports incomplete results.
See the [F30 handoff](docs/reviews/f30-hosting-activity.md) for verification and remaining limits.

## Start

File → Preferences (Ctrl/Cmd+,) provides appearance, diff font/marks, commit presentation, automatic fetch,
global Git identity and Git executable selection, plus access to tools, accounts and custom commands.
Appearance/presentation/fetch apply immediately; identity uses Save/Cancel. Save Git instance takes effect
on the next application launch. Repository → Settings or the sidebar gear edits repository identity and
issue links, showing the destination file and effective value origin. Blank identity fields remove that
file's override; linked worktrees share repository settings. Issue links use a prefix such as `#` and an
HTTPS URL such as `https://tracker.example/issues/{id}`. See the [F34 handoff](docs/reviews/f34-settings.md)
for supported controls and remaining preference/workspace scope.

File → External Tools configures editors, diff/merge tools and terminals. Use an absolute executable
path and a JSON argument array, for example `["--wait", "$LOCAL"]` for a waiting editor. File menus
offer the configured tools; historical actions receive the selected revision, and working editors open
the actual checkout file. Diff sides are copies. Merge tools edit a temporary result that returns to
the conflict editor for review before Resolve and Stage. Output/cancellation remain in Activity.
The Linux terminal preset uses an installed `xdg-terminal-exec`; Browse can select another terminal.
Tools stop after five minutes; configure their wait option so temporary files remain available until
they exit. See the [F33 handoff](docs/reviews/f33-external-tools.md) for variables and limits.

After building, `npx electron . -- /absolute/repository/path` opens a repository from the command line.
Packaged builds accept `git-workbench -- /absolute/repository/path`; a second invocation activates the
existing window. Use `--` before paths beginning with a dash. File Manager remains in Open in and
repository/tab context menus.

File → Custom Commands adds contextual Bash, process and URL actions. Save and enable a command,
then choose it in the Repository menu or the matching commit/branch/Local Changes file/submodule
context menu. Optional forms collect text, branch and file inputs; Review Command shows its directory
and expanded intent before Run Command. Output and cancellation remain available in Activity.
Import/export shares Git Workbench version-1 JSON; imports are disabled until individually enabled.
Bash uses quoted environment variables such as `"$GW_REPO_PATH"` and `"$GW_INPUT_1"`; process arguments
use a JSON array with `${repo:path}` and `${input:1}` placeholders. Commands run with your permissions,
wait for exit, and stop at five minutes or 64 KiB output. See the [F32 handoff](docs/reviews/f32-custom-commands.md)
for the format, context rules and parity limits.

Quick Launch opens with Ctrl+P (Cmd+P on macOS), the toolbar, or File → Quick Launch.
Search commands or recent repositories; choose Rebase/Merge, Checkout Branch, or File History
to search their parameters. Arrow keys select, Enter opens, Escape closes, and Backspace on an
empty parameter input returns to commands. Merge/Rebase retain their confirmation dialogs.
File History searches committed HEAD files, with explicit bounds and a File Tree fallback.
See the [F31 handoff](docs/reviews/f31-quick-launch.md) for verification and remaining limits.

Use Node.js 24.13+ within the Node 24 LTS line and npm 11+. The source, tests, and executable
configuration are TypeScript/TSX. HTML, CSS, JSON, YAML, and documentation are non-code assets.
JavaScript produced by compilation and supplied by dependencies is expected.

```sh
npm ci
npm run dev
```

Vite provides React Fast Refresh; Electron main/preload changes restart or reload through
electron-vite's watch mode. The development renderer listens on `127.0.0.1:5173`.
Open the Electron window: a regular browser has no desktop bridge and shows a connection message.

```sh
npm run check         # strict type checks, lint, formatting, unit tests
npm run build         # type checks and all three production bundles
npm start             # run the built application
npm run test:e2e      # build, then exercise the real Electron application
npm run package:dir   # create an unpacked application in release/
npm run research:references  # download the Fork screenshots listed in docs/research/fork-references.json
npm run package       # build installers for the host OS; never publishes
```

On Linux, packaging targets AppImage. Windows targets NSIS; macOS targets DMG.
Run platform builds on their respective operating systems. Signing, update distribution, product
icons, and final application identifiers are deferred to the release milestone.
Debian packaging is also deferred until a real maintainer email is selected; the initial package command
does not invent release contact information.

On Linux and Windows the window is frameless: the application draws its own title bar, menu bar
(Alt+letter opens a menu), and window controls, and it handles shortcuts itself instead of installing
a native menu. macOS keeps inset traffic lights and a small native application menu.
The window manager still moves, resizes, minimizes, and maximizes the window. On Linux, Electron draws
the shadow and resize margin around it; where the window manager cannot show client-drawn shadows,
Electron draws a solid 4px frame instead.

Linux desktop execution needs Electron's shared libraries and a working graphical session.
Electron chooses Wayland by itself only when `XDG_SESSION_TYPE=wayland`. `npm run dev` and `npm start`
also choose Wayland when `WAYLAND_DISPLAY` is set outside an X11 session; add `-- -- --ozone-platform=x11`
to use X11 instead. Pass `--ozone-platform=wayland` to a packaged executable started without that
session type.

`npm run test:e2e` is headless: it runs Electron on Ozone's `headless` platform, needs no display
server, and never opens a window on the desktop running it. No Xvfb or other virtual display is
required. To watch the same test on a real display, set `ELECTRON_TEST_OZONE_PLATFORM` to `x11` or
`wayland`, and add `ELECTRON_TEST_DISABLE_GPU=1` where that display is software rendered.
The test also supports `ELECTRON_TEST_EXECUTABLE=/absolute/path/to/git-workbench`
for checking an unpacked binary. Renderer sandboxing stays enabled. Test runs use disposable profiles.

The install hook runs Electron's `install-electron` command to ensure its binary is present.
No extra browser download is needed for these Electron tests.

### Local waypipe session

This development host forwards its display through the user service `wayland-bridge.service`.
It runs waypipe with `--no-gpu --xwls --vsock -s 1234 --display wayland-piped` and writes its
Xwayland `DISPLAY` to `$XDG_RUNTIME_DIR/piped-display`. The dependent `idea.service` supplies
`WAYLAND_DISPLAY=wayland-piped` and `PULSE_SERVER=unix:$XDG_RUNTIME_DIR/pulse-vsock.sock`, but does not
import that X11 display into the IDE's environment.

`npm run test:e2e` needs none of this: it is headless and never reaches the bridge. To watch the test on
the bridge's Xwayland display instead (Bash):

```bash
DISPLAY="$(< "$XDG_RUNTIME_DIR/piped-display")" ELECTRON_TEST_OZONE_PLATFORM=x11 \
  ELECTRON_TEST_DISABLE_GPU=1 npm run test:e2e
```

Read the display file for each launch; do not hardcode its current display number or source it as shell
code. This command preserves the Wayland and audio environment and keeps Electron's sandbox enabled.
The smoke test passed through this bridge. Native Wayland Playwright startup times out here, so use the
bridge's Xwayland path when a visible run is needed. No additional X server or service changes are needed.
The GPU switch is local to this software-rendered testing setup, not a production application default.

Run the application itself natively on Wayland: `npm run dev` chooses it from the IDE's
`WAYLAND_DISPLAY`, even when `DISPLAY` is also set. The bridge's X11 window manager, xwayland-satellite,
cannot manage the frameless window. It rejects Chromium's title-bar move and edge-resize requests and
ignores minimize and maximize requests; even a normal framed window does not maximize or minimize there.
It also cannot show client-drawn shadows, so Electron draws the solid frame in system theme colors, which
stand out against the app's dark appearance.
Over native Wayland to the host's KDE Plasma session, the title-bar buttons maximized, restored, and
minimized the real window. The Electron test checks only that the title-bar buttons reach the
main-process window methods, because the bridge cannot change the window state.

## Project map

```text
src/backend/electron/   Main process: windows, menus, validated IPC handlers
src/backend/preload/    Sandboxed bridge: fixed capabilities and subscriptions
src/backend/git/        Argument-array Git executable resolution and bounded process runner
src/backend/operations/   Long-running Git work: job records, progress events, cancellation
src/backend/repositories/ Repository topology, sessions, history, references, remotes, recent/tab persistence, status, and manager scanning
src/common/ipc/         Runtime schemas, DTOs, result envelopes, public API types
src/frontend/react/     React desktop shell (no Electron or Node imports): components/, menu/, hooks/, lib/
tests/unit/             IPC validation, sender checks, timeouts, subscription cleanup
tests/e2e/              Real Electron startup and bridge smoke test
scripts/                Development scripts, such as restoring the local Fork reference screenshots
docs/                   Research, architecture, and implementation roadmap
```

All three bundles are generated under `out/`. Packaged applications go under `release/`.
Both directories are ignored. Application dependencies are currently fully bundled.

## Continue development

- [Implementation plan](docs/implementation-plan.md): ordered phases, dependencies, acceptance criteria,
  and a prompt for the next step.
- [Fork research](docs/research/fork-public-surface.md): dated public sources, feature coverage,
  captured behavior, observed layout, and unresolved questions.
- [Catalogue alignment](docs/research/fork-catalogue-alignment.md): the 2026-09-20 audit, design rules,
  corrections, and all 82 capture topics mapped to implementation work.
- [Private catalogue entry point](docs/research/fork-reference-new/START_HERE.md): the user-supplied
  Windows 2.22.0.0 screenshots, cases, and Git observations. The evidence directories are git-ignored;
  retain the complete bundle locally with its relative paths. Public screenshot downloads do not restore it.
- [Fork reference screenshots](docs/research/fork-references.json): public images for design comparison.
  `npm run research:references` downloads them into the git-ignored `docs/research/fork-references/`
  folder with a browsable `INDEX.md`; the images are never committed or used in the application.
- [Architecture](docs/architecture.md): process boundaries, IPC conventions, and Git service direction.
- [Contributor instructions](AGENTS.md): conventions for future implementation work.

The public research began on 2026-09-16; the plan was realigned on 2026-09-20 against the supplied
Windows capture catalogue. Its 70 observed, 11 partial, and one blocked topic describe research coverage,
not completed Git Workbench features. The F01–F16 correction pass and bounded F17/F18/F19/F20/F21/F24/F25 slices are
verified with the limits in their review records; the bounded F21 slice is implemented in P08. Fork binaries,
private source, and bundled product assets
are excluded; reference screenshots stay private/local and are never application assets.

## Migration notes

The old Webpack configuration, Preact compatibility aliases, numeric `PEventClass` channels,
global IPC objects, endpoint round robin, and demonstration Redux state have been retired.
`src/common/class/Event.ts` is replaced by the contracts in `src/common/ipc/`, with transport
implementations confined to the backend and preload.

The starter's Yarn 1 lockfile was replaced by `package-lock.json`; use `npm ci` for reproducible installs.
`start:dev` and `build:prod` remain as aliases. Publishing scripts were removed because no release
destination or signing identity exists. The original MIT license is preserved.
