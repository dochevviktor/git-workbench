# Git Workbench

A Linux-first Git desktop client in early development. **Git Workbench is a working name.**
The long-term target is the publicly documented functionality of Fork, implemented independently
with Electron, shared TypeScript contracts, and React.

The current milestone starts F01's local workflow, the first F02 repository-manager slice, the initial
F03 tab slice, the first F04–F07 history, collapse, filtering, and revision-inspection slices, the
F08–F11 working-changes, diff, staging, and commit slices, a first F12 branch and tag slice, an initial
F13 remote and network slice with the F14 operation surface it needs, and an initial F34 workspace-chrome
slice. It includes a Fork-style workspace: a custom title bar
with menus and window controls (native traffic lights on macOS), a toolbar, equal-width repository tabs or
a vertical tab column, a Repository Manager new tab, a repository sidebar with a reference tree and commit
search, a commit table with a collapsible lane graph and colored labels, Commit/Changes/File Tree details,
a Local Changes view with unified or split diffs, and renderer-drawn context menus. It also covers Git
discovery, opening existing repositories, local initialization, recent-repository persistence, persisted
source directories, bounded folder-aware repository scanning, persisted tabs with dirty indicators,
close/reopen shortcuts, paged commit history, file/hunk/line staging with snapshot validation, committing
and amending, branch and tag creation, renaming, deletion, checkout and upstream selection, remote
management, fetch, fast-forward pull, push with optional lease-checked force, and System/Light/Dark
appearance. Network work runs as a cancellable background operation with progress, command, and output in
an activity panel. Toolbar and menu entries for Git operations from later phases are shown disabled with
the phase that will enable them. Clone, background fetching, credential prompts, whole-file discard,
merge and conflict resolution, custom manager folders, filesystem watchers, and the remaining Git
operations are later work.

## Start

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
  observed layout, and unresolved questions.
- [Fork reference screenshots](docs/research/fork-references.json): public images for design comparison.
  `npm run research:references` downloads them into the git-ignored `docs/research/fork-references/`
  folder with a browsable `INDEX.md`; the images are never committed or used in the application.
- [Architecture](docs/architecture.md): process boundaries, IPC conventions, and Git service direction.
- [Contributor instructions](AGENTS.md): conventions for future implementation work.

The research baseline is 2026-09-16. It uses public documentation and vendor screenshots only;
Fork's application, binaries, private source, and assets are not part of this repository.

## Migration notes

The old Webpack configuration, Preact compatibility aliases, numeric `PEventClass` channels,
global IPC objects, endpoint round robin, and demonstration Redux state have been retired.
`src/common/class/Event.ts` is replaced by the contracts in `src/common/ipc/`, with transport
implementations confined to the backend and preload.

The starter's Yarn 1 lockfile was replaced by `package-lock.json`; use `npm ci` for reproducible installs.
`start:dev` and `build:prod` remain as aliases. Publishing scripts were removed because no release
destination or signing identity exists. The original MIT license is preserved.
