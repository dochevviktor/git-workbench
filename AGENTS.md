# Working on Git Workbench

Read `docs/implementation-plan.md` and `docs/architecture.md` before implementing a new phase.
Use the requested phase and its acceptance criteria as the scope. Preserve unrelated user changes.

- Author application logic, scripts, tests, and executable configuration in TypeScript/TSX.
  JSON/YAML configuration, HTML, CSS, generated output, and third-party dependencies are allowed.
- Keep Electron, Node, filesystem, process execution, and credentials out of the renderer and shared layer.
  Extend `src/common/ipc/`, the explicit preload capability API, and main-process handlers together.
- Validate IPC inputs and results at runtime. Keep channel names stable. Preserve sender/frame checks,
  context isolation, sandboxing, CSP, and exact subscription cleanup.
- Put Git semantics in backend services; do not expose a generic command executor to the renderer.
  Use temporary repositories for tests. Never exercise mutating Git tests on the user's working repository.
- Use the user-supplied black-box catalogue in `docs/research/fork-reference-new/` as the primary
  Windows 2.22.0.0 reference. Read its `reference/catalogue/START_HERE.md`, the relevant feature dossiers,
  original cases, and linked screenshots/Git evidence. Supplement gaps with public documentation,
  release notes, and screenshots. Do not obtain Fork's application, binaries, source, or bundled assets,
  or run the historical Windows capture harness. Record case/finding IDs or public source URLs, dates,
  confidence, and platform differences in `docs/research/fork-public-surface.md` and its alignment record.
- Use independently authored visual assets and implementation. Do not present inferred behavior as
  observed behavior or a placeholder as an implemented feature.
- Before and after layout or styling work, compare the app with the catalogue's original screenshots
  for the relevant case and state (Linux follows Windows). Consult
  `docs/research/fork-catalogue-alignment.md` for corrections and deliberate adaptations. For public
  reference gaps, run `npm run research:references` and browse the restored git-ignored
  `docs/research/fork-references/INDEX.md` by topic. That command does not restore the private bundle.
  Add new public screenshots to `docs/research/fork-references.json` with source, date, platform, stated
  version, and theme. Preserve the private bundle unchanged; never commit its images or copy them into
  the application. Capture coverage is not implementation completion; retain case-level unknowns.
- Use npm and the committed lockfile. Run relevant tests plus `npm run check` and `npm run build`
  for a completed phase; run the Electron smoke test when changing startup, preload, or packaging.
- Update the plan's progress ledger and feature coverage when a phase is actually verified.
  Report any unverified acceptance criteria and leave the phase partial if needed.

## Local graphical testing

- Detect the host OS. The bridge instructions below apply only to the Linux host. Windows Electron
  tests use native windows; keep them serial and preserve the sandbox. `npm run test:capabilities`
  reports automatic OS/tool/symlink selection. Use `npm.cmd` when PowerShell blocks `npm.ps1`.

- The Linux host uses `wayland-bridge.service` to forward its display through waypipe with `--no-gpu --xwls`.
  `idea.service` inherits `WAYLAND_DISPLAY=wayland-piped` and forwarded PulseAudio, but not `DISPLAY`.
- On Linux, `npm run test:e2e` is headless by default: it runs Electron on Ozone's `headless` platform, drops
  `DISPLAY` and `WAYLAND_DISPLAY` from the child environment, and never opens a window on the user's
  desktop. Use it as is; do not put the test on a real display for routine work.
- To watch a run, set `ELECTRON_TEST_OZONE_PLATFORM=x11` and read the bridge's X11 display from
  `$XDG_RUNTIME_DIR/piped-display` for each launch; do not hardcode a display number or execute the file
  as shell code. Add `ELECTRON_TEST_DISABLE_GPU=1` there, because that display is software rendered.
  Native Wayland Playwright startup times out on this host.
- Reuse the bridge rather than starting another X server. Preserve the Wayland/audio environment and
  Electron sandbox; do not change or restart the user's bridge or IDE services for routine testing.
  See `README.md` for the interactive launch command and native Wayland automation caveat.
- Check window moving, edge resizing, minimize/maximize, and the window frame on native Wayland
  (`npm run dev` chooses it when `WAYLAND_DISPLAY` is set). The bridge's xwayland-satellite ignores
  Electron's requests for those actions, and Electron draws a solid fallback frame there.
