# Git Workbench

A Linux-first Git desktop client in early development. **Git Workbench is a working name.**
The long-term target is the publicly documented functionality of Fork, implemented independently
with Electron, shared TypeScript contracts, and React.

The current milestone starts F01's local workflow. It includes a desktop workspace, appearance controls,
native menus, window commands, Git discovery, opening existing repositories, local initialization, and
recent-repository persistence. History, changes, clone, and the remaining Git operations are later work.

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
npm run package       # build installers for the host OS; never publishes
```

On Linux, packaging targets AppImage. Windows targets NSIS; macOS targets DMG.
Run platform builds on their respective operating systems. Signing, update distribution, product
icons, and final application identifiers are deferred to the release milestone.
Debian packaging is also deferred until a real maintainer email is selected; the initial package command
does not invent release contact information.

Linux desktop execution needs Electron's shared libraries and a working graphical session.
For a Wayland-only desktop, launch with `npm run dev -- -- --ozone-platform=wayland`
(or pass `--ozone-platform=wayland` to the packaged executable).
For automation without a display, use `xvfb-run -a npm run test:e2e` where Xvfb is installed.
The smoke test can select native Wayland with `ELECTRON_TEST_OZONE_PLATFORM=wayland`.
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

Use the existing forwarded display for local tests and interactive development (Bash):

```bash
DISPLAY="$(< "$XDG_RUNTIME_DIR/piped-display")" ELECTRON_TEST_DISABLE_GPU=1 npm run test:e2e
DISPLAY="$(< "$XDG_RUNTIME_DIR/piped-display")" npm run dev -- -- --disable-gpu
```

Read the display file for each launch; do not hardcode its current display number or source it as shell
code. These commands preserve the Wayland and audio environment and keep Electron's sandbox enabled.
The smoke test passed through this bridge. Native Wayland application startup was also checked, but
native Wayland Playwright startup previously timed out amid virtual-driver diagnostics; use the
bridge's Xwayland path for automation here. No additional X server or service changes are needed.
The GPU switch is local to this software-rendered testing setup, not a production application default.

## Project map

```text
src/backend/electron/   Main process: windows, menus, validated IPC handlers
src/backend/preload/    Sandboxed bridge: fixed capabilities and subscriptions
src/backend/git/        Argument-array Git executable resolution and bounded process runner
src/backend/repositories/ Repository topology, sessions, and recent-repository persistence
src/common/ipc/         Runtime schemas, DTOs, result envelopes, public API types
src/frontend/react/     React desktop shell (no Electron or Node imports)
tests/unit/             IPC validation, sender checks, timeouts, subscription cleanup
tests/e2e/              Real Electron startup and bridge smoke test
docs/                   Research, architecture, and implementation roadmap
```

All three bundles are generated under `out/`. Packaged applications go under `release/`.
Both directories are ignored. Application dependencies are currently fully bundled.

## Continue development

- [Implementation plan](docs/implementation-plan.md): ordered phases, dependencies, acceptance criteria,
  and a prompt for the next step.
- [Fork research](docs/research/fork-public-surface.md): dated public sources, feature coverage,
  observed layout, and unresolved questions.
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
