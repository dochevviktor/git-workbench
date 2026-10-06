# Git Workbench

Cross-platform review (2026-10-06): [corrections and verification](docs/reviews/cross-platform-portability.md)
covers Windows environment/symlink/process issues and macOS file-open/shortcut handling. CI now includes
native Windows/macOS smoke scenarios. macOS execution, packaging and native-device checks still need
verification on a Mac; Linux and Windows evidence does not establish those results.

Windows implementation (2026-10-01): the [compatibility follow-up](docs/reviews/windows-compatibility.md)
records native custom commands, external tools, AI adapters and Git/diff/path corrections, plus test
selection by OS and installed capabilities. `npm run test:capabilities` explains this host's selection.
Linux-specific cases are skipped automatically; supported Windows workflows remain tested.
In PowerShell use `npm.cmd` when execution policy blocks `npm.ps1`. `npm.cmd run package` builds
`release/Git Workbench Setup 0.1.0.exe`; `npm.cmd run test:package -- "C:\path\Git Workbench.exe"`
tests an installed executable. Git 2.43+ must be installed separately and available on PATH.
Ozone headless testing is Linux-specific: Electron tests use native windows on Windows.
Windows Bash commands require Git for Windows' Bash. Select native executables or Node CLI entry points
for external tools/AI; Node entry points require an installed Node runtime. Configure external viewers
to wait until closed. Batch and PowerShell launchers require an explicit interpreter for custom tools.

P14's [audit and feature ledger](docs/reviews/p14-release-audit.md) records verified Linux behavior,
remaining parity limits, performance measurements and release gates. The audit fixes composing-input
commits, post-commit Amend refresh, modal keyboard ownership, contrast/tab accessibility, renderer
recovery and old-LFS credential retries. The independently branded 0.1.0 preview has local unsigned AppImage and Debian test artifacts.
Native desktop/assistive-technology/keyring and live-provider validation is still incomplete.

P01 completes the Git execution foundation and aligns Activity with the captured Fork layout.
Git 2.43.0 or newer is required. Existing repositories open for history browsing; choose **Trust
Repository…** to enable working changes, configured Git programs and network operations. The choice
persists across restarts and linked worktrees and can be revoked in Repository Settings. New init/clone
destinations are trusted as explicitly created repositories. Activity remains queryable after closing
its panel or reloading the renderer; cancellation does not promise rollback. See the
[P01 verification and policy](docs/reviews/p01-infrastructure.md).

P13 adds optional AI messages and diff reviews through OpenAI, installed Claude Code/Codex/Cursor CLIs,
or a local Ollama server. File → AI Integration (also Preferences → Commit/Integration) selects the
provider, model and editable default requests. Remember saves public choices; AI starts disabled after
restart. OpenAI/Cursor keys come from a native text-file chooser and stay in memory for the session.
Claude/Codex use their existing terminal login. Ollama uses an already installed local model on port
11434; start its daemon separately with `OLLAMA_NO_CLOUD=1`.

Commit options → Generate Message previews staged changes or the full amended commit; Repository →
AI Code Review previews a branch/commit range. Each request requires preview and Send. Generated
messages stay editable, and review output has no execution or Git mutation action. Disable forgets
app-owned keys and stops pending work. Provider billing/retention and installed-tool policies apply.
Live provider sessions remain unverified; see the [P13 contracts and limits](docs/reviews/p13-statistics-ai.md).

Repository → Statistics… / Repository Treemap… shows local monthly activity, contributor shares,
date filtering and nested file/folder tiles with Commits/Authors details. Calculation options exposes
larger computation budgets and the UTC/raw-author metric policy. Reads are cached, cancellable and
bounded; see the [metric specification](docs/reviews/f35-statistics.md) and P13 handoff.

A Linux-first Git desktop client in preview, independently named **Git Workbench**.
The long-term target is Fork's captured Windows workflows and publicly documented feature families,
implemented independently with Electron, shared TypeScript contracts, and React. The Windows 2.22.0.0
black-box catalogue now guides the Linux UI; documented platform-specific extensions remain separate.

P02's repository/session foundation is complete for Linux: Repository Manager supports nested logical
folders, display names, filtering, source discovery and a default clone folder; scans can be cancelled.
Filesystem watchers refresh external changes. Missing repositories offer Retry/Locate, and damaged
settings retain recoverable originals. Drafts, tab order and preferences survive restart; reopening a
closed tab selects HEAD. See the [P02 handoff](docs/reviews/p02-repository-sessions.md) for verified scope.

P04's working-changes workflow adds syntax colors, text-selection staging/unstaging/discard, one-line
context controls and a compact composer aligned with the Windows catalogue. Commit options contains
Signing and Generate Message. Discard previews the exact selected changes and keeps a tracked Recovery
copy; external edits require a refresh. See the [P04 handoff](docs/reviews/p04-working-changes.md) for
verified Git semantics, screenshots and resource limits.

P05 aligns branch/tag and network dialogs with the Windows catalogue. Push offers optional tracking,
all tags and a separate review before force push; its exact lease stays fixed across background fetches.
Edit Remote saves name, fetch URL and optional push URL together. Branches/Tags menus support batch
deletion and stale-branch review; remote deletion retains the local reference if the remote refuses.
Pull → Options adds Fast-forward only. See the [P05 handoff](docs/reviews/p05-network.md) for verified
scope, authentication tests and deliberate design adaptations.

P06 completes the Linux merge/conflict/stash/recovery workflow. Merge and rebase dialogs check for
conflicts before starting; a banner above the workspace keeps Resolve, Continue, Skip and Abort
available after restart. Local Changes offers paired source cards and a wide merge helper with
per-region choices and an editable result. Binary, deleted, renamed and submodule entries have explicit
resolution choices. Diff controls can stash a hunk or selected lines, and selected-file stashes exclude
unrelated staged work. Conflicted stash applications retain their stash and can be finished or aborted.
Cherry-pick/revert supports merge-parent and no-commit choices; Hard reset keeps Recovery copies and
refuses untracked/ignored obstacles. See the [P06 handoff](docs/reviews/p06-merge-recovery.md) for scope,
Fork comparisons, verification and retained platform limits.

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
P08 adds rename-aware file and directory History, selected-line history from committed diffs/File Tree,
compact Blame with original-path attribution and Back/Forward, and historical Save As outside the checkout.
Search is cancellable. Lost commits can be recovered to named branches/tags without changing the checkout.
Patch import supports bounded format-patch mailboxes as one staged delta without commits; merge export
lets you choose the comparison parent. See the [P08 handoff](docs/reviews/p08-investigation.md) for limits.
P09 completes the Linux worktree, submodule and Git-flow phase. Worktrees support branch/remote/detached
creation, parent/child identity, lock/unlock and reviewed removal. Submodule views show compact revision
metadata and a child commit graph; nested Add/Initialize/Update/Sync/Remove actions show their scope.
Missing commits, interrupted initialization and gitlink conflicts retain actionable state, and removing
a child closes its tabs. Git-flow initialization includes the version tag prefix; feature finish changes
develop only, while release/hotfix workflows support annotated tags and optional develop merges.
Interrupted finishes survive restart with Continue Git-flow and Stop Finish controls. See the
[P09 handoff](docs/reviews/p09-topology.md) for verification and screenshots; the
[stability follow-up](docs/reviews/p09-test-stability.md) resolves its initial full-suite failures.

P10 adds Repository → Git LFS → Manage Git LFS for explicit object download/refetch/upload, tracking
rules and server-verified file locks. Initialize installs repository-local LFS configuration/hooks.
Historical Save As retrieves missing payloads and verifies their size/SHA-256 outside the checkout;
the working pointer stays unchanged. Selecting a row never downloads an object. Transfers use installed
Git LFS and the existing account credentials or native Git helpers, with progress/cancellation in Activity.
Only your own verified locks can be unlocked. Review tracking changes in Local Changes before committing.
Git LFS 3.4.1 and 3.8.0 are tested optional versions; neither is bundled or installed automatically.
Downloading cached objects again is enabled only when the installed tool supports `fetch --refetch`
(introduced in 3.7). Rejected account credentials stop retrying within that operation; updating the
account and starting a new operation remains possible.
Git-flow uses ordinary Git and repository-local configuration; specialized remote publishing, topic
rebase and automatic stash/reapply remain outside P09. Lean Branching remains
a separate F38 family: the Branch dropdown and Repository → Lean Branching offer
Start, Sync and Finish with a reviewed base branch. Start checks out a new topic,
Sync rebases, and Finish returns to the base and merges while retaining the topic.
Commit or stash local changes first. Fetch and push are separate actions; conflicts
use Recovery Continue/Abort, then Sync can be run again. See the
[F38 policy and limits](docs/reviews/f38-lean-branching.md).
F26 adds manual Bisect start/Bad/Good/Skip/Abort, visible range and results, and restoration of active
sessions after restart. First-bad and ambiguous skipped-candidate results stay visible until Abort
restores the original checkout; local changes must be committed or stashed before advancing.
F28 adds GPG signing for commits/amends and annotated tags, atomic repository-local key/commit/tag defaults,
explicit inheritance, Git-default/Unsigned choices, and commit/tag verification with separate trust and failure states.
The installed GPG agent handles passphrases. Key generation/import, global settings UI and SSH/X.509
verification remain outside this workflow; see the [F28 handoff](docs/reviews/f28-signing.md).

F27 compares PNG/JPEG, GIF first frames, static WebP, BMP, TGA and restricted SVG in working/committed
diffs: Side-by-Side, Swipe, Onion Skin and Pixel, with dimensions, sizes, transparency and Fit/25–400% zoom.
Drag a zoomed viewport to pan; keyboard scrolling remains available. File Tree previews historical images,
and cached LFS image cards offer Compare images. SVG source is accessible through Show source diff.
Previews are bounded to 4 MiB and 4 megapixels per side. Unsupported variants, corrupt and oversized files
retain explicit fallbacks. SVG scripts, external content and unsupported constructs never render.
See the [P10 handoff](docs/reviews/p10-rich-diffs-lfs-signing.md) for verification, source evidence,
independent format policies and remaining platform/provider limits.

The [F01–F16 catalogue correction pass](docs/reviews/f01-f16-catalogue-corrections.md) adds Clone and Test
Connection, persistent tab reorder/reopen and window bounds, CLI/second-instance opening, scoped history
search with graph highlights and direct distant navigation, full-file/context/wrap and popup diffs,
explicit bounded Load Diff, confirmed tracked-file discard with recovery, a global automatic-fetch
preference, native authentication helper policy, captured stash-new-file semantics, and all four merge
modes. The corrected workflows are verified together; the broader feature families remain partial.
F18 merge-preserving/dependent-reference variants, batch history selection, F20 reflog expiry/named-recovery
variants, additional image formats, and the remaining workspace/platform variants retain their later-phase
scope. P04 syntax, P06 conflict/partial-stash and F36 patch import are covered by their newer handoffs.

Pull shows its remote, source branch, and destination before starting. For an inactive destination it
explicitly checks that branch out first; Fast-Forward updates an inactive branch without switching.
Recovery provides merge/rebase continue/abort and saved-change restoration, including after restart.

History → commit context menu → Interactive Rebase opens a compact newest-first plan with revision
inspection. Reword/Edit/Squash/Fixup/Drop quick actions preconfigure the plan; P/E/R/S/F/D and
Ctrl+Up/Down edit rows, and dragging reorders linear plans. Inline messages have OK/Cancel; Squash
combines messages and Fixup omits its message. Autosquash previews matching `fixup!`/`squash!` commits.
Update dependent branches is opt-in and excludes branches in another worktree. Merge histories keep
their topology and order; individual commits can be edited/dropped and merge messages reworded.
Published-history rewrites require acknowledgement.

Interactive rebase retains the original history in Recovery until you confirm the result. Inspect it,
recover it as a branch, or dismiss the internal backup; a requested temporary backup branch remains
available separately. Edit pauses detached, opens Amend presentation, and Continue restores the branch.
Staged, unstaged and untracked changes saved before rebase survive restart and recovery. See the
[P07 handoff](docs/reviews/p07-interactive-rebase.md) for the merge policy, verification and Fork limits.

Resolve files through the built-in helper or an external tool, then Commit/Continue or mark saved changes
resolved. A submodule source choice stages its revision without changing the child checkout. Recovery
entries can be dismissed without changing Git's stash list. Before an action starts,
Cancel leaves the repository unchanged; after it starts, Close dismisses the dialog and Activity provides
the operation's cancellation control. Cancellation does not promise rollback.

HTTPS operations use a connected account for its configured server when available. Other network operations use installed
Git credential helpers, SSH agents and configured native askpass tools. Background operations suppress
standard prompts. Clone requires a new destination; failed/cancelled
destinations are retained for inspection. A paused autostashed merge completed through the composer
retains its saved copy for explicit Recovery Apply.

Create Pull Request opens a form on GitHub.com, GitLab.com, Bitbucket.org, or Azure DevOps in the system
browser. It does not submit the form or require storing hosting credentials in this application.
Self-hosted Enterprise/GitLab/Gitea/Bitbucket destinations require an account registered for that server.

File → Preferences → Accounts has an account sidebar with **+** to add and **−** to remove an account.
Choose Gitea, GitHub, GitHub Enterprise, GitLab, GitLab Server, Bitbucket or Bitbucket Server. Enter your
token directly in the masked field; self-hosted providers also require an HTTPS server URL. Bitbucket
Cloud uses your Atlassian email and an API token; Bitbucket Server uses your username and a personal
HTTP access token. For Bitbucket Cloud, enable `read:user:bitbucket`, `read:workspace:bitbucket` and
`read:repository:bitbucket`; add `write:repository:bitbucket` for push. API-token permissions do not
implicitly include each other. GitHub offers Personal
access token or OAuth. Open Repositories to browse accessible repositories and choose an HTTPS/SSH clone
URL. GitHub and Enterprise have built-in issue/PR lists and notifications; other providers open those pages
in your browser. GitLab supports nested groups. Self-hosted API requests require a trusted HTTPS
certificate and do not follow redirects.

The same account now authenticates HTTPS clone, Test Connection, fetch, pull and push, including
automatic fetch. Existing saved accounts work without another login. For GitHub, fine-grained tokens need access
to the intended repositories and Contents read permission for fetch/clone, or read/write for push;
classic tokens generally need `repo` for private repositories. Organization approval and SSO still apply.
SSH remotes continue to use SSH keys; a GitHub token cannot authenticate SSH.

With multiple accounts, **Use as default for Git** selects the account for that server's HTTPS URLs without
a username. Hosted HTTPS clone URLs include the selected public username, so subsequent operations
keep using that account. You can also use `https://LOGIN@SERVER/OWNER/REPO.git` for an existing remote.
Tokens never appear in URLs or Git configuration, and the app does not install a global Git helper.
Bitbucket Cloud clone URLs select the account by its opaque ID; the private helper supplies Bitbucket's
static API-token Git username. Bitbucket Server SSH defaults to port 7999; review its Clone URL for a
custom host/port. Accessible Bitbucket workspace pages include shared repositories.

Accounts default to session-only storage. Remembering a token requires a secure OS keyring; Linux's
plaintext fallback is refused. Direct entry is a narrow exception to the earlier no-renderer-secrets
policy: the token passes once from an uncontrolled password field through the validated login capability
to main. The field clears on submission, provider/method/server changes and dismissal; tokens are never
returned to the UI, stored in React/presentation state, repository configuration or logs.
If hosting preferences are damaged, Accounts shows a warning while keeping credential creation,
replacement and sign-out available. Automatic notification choices default off and the damaged file is
preserved. Repair `hosting-preferences.json` in the application profile while the app is closed and
restart to restore saved notification choices/searches; account credentials do not need to be reset.
Update token verifies that the replacement belongs to the same account and server. Failed updates retain
the old credential. Sign out
removes the app's credential and cancels its pending API reads. Already authenticated Git transfers
may finish; future transfers stop using that account. Neither action clears your clipboard nor revokes
the token on the provider. **Manage tokens/Manage authorization** opens that provider's settings so you
can revoke it remotely; the app does not claim that opening the page revoked a credential.

GitHub OAuth uses device authorization in your system browser and checks the optional username against
the authorized account. Configure the application's registered public client ID before launch:
`GIT_WORKBENCH_GITHUB_CLIENT_ID=YOUR_CLIENT_ID npm run dev`. Enable **device flow** in that GitHub OAuth
App's settings. No client secret is bundled or required. Without registration, the OAuth option explains
the missing setup and token login remains usable. OAuth requests `repo`, `read:user` and `notifications`;
Cancel or closing Preferences stops authorization. When GitHub returns expiring device credentials,
access/refresh tokens stay together in main and are renewed automatically before expiry. Remembered
pairs use the same encrypted store; legacy non-expiring tokens still work. Expired/revoked refresh
tokens or a changed client registration require Reauthorize. The flow also requests `offline_access`.
No real OAuth registration or live provider credentials were used for the
[P11 verification](docs/reviews/p11-hosting.md). Other SSH clone URLs assume the server's conventional
`git` user and port 22; adjust the Clone URL for custom SSH routing.

In Accounts, Notifications lists your GitHub inbox with unread/all and participation filters.
Repositories → Browse issues / Browse pull requests opens paged lists with state, author, assignee
and title filters. Apply filters searches the selected GitHub server; recent title phrases survive
restart and remain scoped to the account, repository and list kind.
Refresh checks for updates. Item titles open in your browser without marking notifications read in
the app. Notifications require a classic token with `notifications` or `repo` scope; GitHub's endpoint
does not support fine-grained tokens. Search is limited to 1,000 results and reports incomplete results.
Enable Notifications in the Account tab for automatic checks and a compact toolbar inbox. Checks run
while the app is open, share one schedule across its windows, respect the server's polling/rate limits
and stop on disable or sign-out. Server retry deadlines survive toggling notifications, credential
replacement and closing/reopening the last window within the running app. No desktop alert or remote
mark-read action is implied. The inbox shows up to 100 unread items per account; Accounts supplies
further pages. See the
[P11 handoff](docs/reviews/p11-hosting.md) for verification and live/native/parity limits.

## Start

The toolbar workspace menu (initially **Work**) and File → Workspaces manage named workspaces.
Each has its own window, tabs/order/colors, repository list, window bounds and pane sizes. Configure
Workspaces creates/renames/removes sets and opens another window; switching focuses an existing window
or replaces the current one after its replacement loads. A running operation blocks closing its owner
through Switch Workspace. Save Current Layout, Restore Saved Layout and Reset Pane Sizes affect only
that workspace. Tab colors are in the tab context menu. Normal startup reopens the last active workspace;
other saved sets remain available. See the [P12 handoff](docs/reviews/p12-productivity-workspaces.md).

Preferences now embeds external tools and custom commands. General adds source folders, syntax,
date/topological ordering, compact labels, branch-space replacement, dirty indicators and local/hidden
avatars. Commit adds font/guide controls and optional reviewed Push after commit. Ctrl/Cmd+Shift+Enter
commits then opens Push; Cancel keeps the local commit without sending it. Git's expandable defaults
edit signing and commit-template configuration with explicit scope, origin and inheritance. Shortcuts
records Ctrl+Alt+letter (Cmd+Option on macOS) bindings with conflict checks and Reset.

Custom commands can continue in Activity with Wait for Exit disabled, or show foreground output only
on failure. Imported definitions still require explicit enabling and every execution retains review.
External tools have per-kind defaults: Ctrl/Cmd+D opens a selected historical/working diff for review;
Ctrl/Cmd+Alt+T opens the configured terminal, and Ctrl/Cmd+Alt+O opens the file manager. Lean Branching
remembers the chosen base across restart. Git verbose output, fetch-tag defaults and safe opt-in
submodule updates after checkout are profile preferences; no automatic updater or avatar network request
is implied.

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
npm run test:package  # verify the built AppImage's sandbox, assets and desktop workflows
npm run package:deb -- --test-metadata  # marked test-only deb for disposable installation checks
```

On Linux, default packaging targets AppImage; the separate Debian command requires explicit metadata.
Windows targets NSIS and macOS targets DMG, but neither is part of this preview's verified release scope.

Linux network integration tests use Git, OpenSSL and OpenSSH (`sshd`, `ssh-agent`, `ssh-add`,
`ssh-keygen`). They create temporary keys and loopback servers, without touching installed services,
user SSH configuration or real hosting repositories.
Run platform builds on their respective operating systems. The original icon, existing application IDs,
bundled third-party notices and SHA-256 manifest are included. Signing and publishing remain separate.
For a real Debian artifact, set `GIT_WORKBENCH_MAINTAINER='Public Name <public@example.org>'` and run
`npm run package:deb`, followed by `npm run release:manifest`. Test metadata is intentionally marked
TEST-ONLY and must not be presented as release contact information. Building debs on Fedora may require
the build-only `libxcrypt-compat` library for FPM.

AppImages need FUSE 2, or the tested `APPIMAGE_EXTRACT_AND_RUN=1` fallback. Keep the Electron sandbox
enabled; disabling it is not an installation workaround. This preview uses manual updates and rollback;
see the [release policy](docs/reviews/p14-release-audit.md#local-release-policy-and-installation). No hosted
update feed, automatic updater, signing identity or publishing credential is configured.

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
