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
- Research Fork from public documentation, release notes, and screenshots only. Do not obtain its
  proprietary application, binaries, source, or bundled assets. Record source URLs, dates, confidence,
  and platform differences in `docs/research/fork-public-surface.md`.
- Use independently authored visual assets and implementation. Do not present inferred behavior as
  observed behavior or a placeholder as an implemented feature.
- Use npm and the committed lockfile. Run relevant tests plus `npm run check` and `npm run build`
  for a completed phase; run the Electron smoke test when changing startup, preload, or packaging.
- Update the plan's progress ledger and feature coverage when a phase is actually verified.
  Report any unverified acceptance criteria and leave the phase partial if needed.

## Local graphical testing

- This host uses `wayland-bridge.service` to forward its display through waypipe with `--no-gpu --xwls`.
  `idea.service` inherits `WAYLAND_DISPLAY=wayland-piped` and forwarded PulseAudio, but not `DISPLAY`.
- For local Electron tests, read the bridge's X11 display from `$XDG_RUNTIME_DIR/piped-display` for each
  launch; do not hardcode a display number or execute the file as shell code. Use
  `DISPLAY="$(< "$XDG_RUNTIME_DIR/piped-display")" ELECTRON_TEST_DISABLE_GPU=1 npm run test:e2e` in Bash.
- Reuse the bridge rather than starting another X server. Preserve the Wayland/audio environment and
  Electron sandbox; do not change or restart the user's bridge or IDE services for routine testing.
  See `README.md` for the interactive launch command and native Wayland automation caveat.
- Check window moving, edge resizing, minimize/maximize, and the window frame on native Wayland
  (`npm run dev` chooses it when `WAYLAND_DISPLAY` is set). The bridge's xwayland-satellite ignores
  Electron's requests for those actions, and Electron draws a solid fallback frame there.
