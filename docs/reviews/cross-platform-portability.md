# Cross-platform portability review — 2026-10-06

The original review extends the two Windows compatibility commits (`77fec98`, `461037c`).
Its host was Windows 11, build 26200, x64; the later CI follow-up used Linux. Tests use disposable repositories and profiles;
no mutating Git command targets the working project or another user repository.
The original Linux verification and P14's remaining release gates remain separate.

## Fourth CI failure follow-up — 2026-10-08

The [next Actions run](https://github.com/dochevviktor/git-workbench/actions/runs/37772577061)
tested `eb0702b`. GitHub job metadata and all three report archives were read with the existing token;
no credential was persisted elsewhere and no remote write or rerun was requested.

- Windows was green: 713 unit/integration tests and all eight native scenarios passed (ten unit skips).
- macOS passed 717 unit/integration tests and six native scenarios (six unit skips and one Windows-only
  desktop skip). Its single failure was the aggregate smoke's hunk Unstage action. All four newly added
  reference-readiness scenarios passed; this was a different failure from the previous branch review.
- Linux passed 718 unit/integration tests, build and packaging. Desktop had 90 passes, three failures
  and five skips; AppImage verification had 12 passes, one failure and one skip. Bisect retained its old
  displayed HEAD after a fixture checkout. The other desktop failures, and the package failure, timed
  out during initial history loading in fixtures that wrapped every Git invocation with Node.

The hunk regression deliberately holds a validated diff response between mouse-down and mouse-up.
Before the correction the existing displayed action became disabled solely because a refresh began.
Stage/Unstage now remain available for the displayed patch and its existing snapshot while the same
target refreshes. Missing/different targets, non-normal whitespace and active mutations remain guarded.
A second regression changes the actual file during the held refresh and verifies backend refusal,
unchanged index and preserved new contents. Both new regressions failed before the fix and now pass.
This is a controlled reproduction of the click-loss mechanism consistent with the macOS symptom;
the original artifact did not contain renderer state proving its exact intermediate event order.
Desktop smoke now captures an accessibility snapshot and screenshot on failure to preserve that evidence.

The test harness no longer substitutes a Node wrapper for every Git call in these scenarios. A shared
main-process IPC gate holds only the requested read/acknowledgement, then calls or returns the original
validated handler. Git work, snapshots, operation results and sender/frame authorization remain real.
Bisect also waits for terminal operations before the fixture performs external checkouts. The commit
regression delays its acknowledgement until real Git and watcher/context refresh have completed, then
verifies draft clearing and Amend; it no longer delays every incidental status/history read.

F16 uses one generated TypeScript-authored `post-merge` hook to keep the real merge process running
after the merge commit exists. Its running/terminal operation checks and Git ancestry assertions remain.
The hook behavior follows [Git's post-merge contract](https://git-scm.com/docs/githooks#_post_merge),
checked **2026-10-08** (high confidence). Patch-copy and staging refresh checks also use the IPC gate.
No new timeout increase, retry, skipped failure, renderer capability or sandbox exception is introduced.
The new hunk regressions run in native smoke and package verification on every supported test OS.

Final local verification on Linux, Node 24.13.0, Git 2.55.0 and Git LFS 3.8.0:

- `npm run check`: type checks, lint, formatting and **718 unit/integration tests passed**, with five
  explicit skips (49.33 seconds for tests).
- `npm run build`, AppImage creation from that output and manifest generation passed. The existing
  TEST-ONLY Debian artifact was not rebuilt; existing dependency/chunk-size advisories remain.
- Complete desktop suite: **95 passed, five explicit skips**, no retries (5.1 minutes).
- AppImage verification: **15 passed, one Windows-only skip**, no retries (1.0 minute), including
  the original desktop scenario, new hunk regressions and kernel sandbox checks.
- Eleven focused scenarios passed with one CPU core (40.1 seconds). F16 variants took roughly three
  seconds each, versus roughly 20–22 seconds with the previous wrappers on the same one-core host.
- The final Bisect/hunk/commit regressions passed three consecutive one-core runs: **18 passed**,
  no retries (1.1 minutes). The new terminal-operation waits were included in these repeated runs.

Logs and JSON/JUnit/HTML reports are in `test-results/ci-fourth-fix`; controlled baseline failures and
repeated runs are in `test-results/ci-fourth-*`, and package evidence is in `release/p14/package-verified`.
The changes remain local and uncommitted; no remote branch was pushed or workflow rerun. The green
Windows result applies to `eb0702b`; this correction still needs its own hosted run, especially on
macOS. P14 remains partial for its native-device/live-service/release gates. Existing Fork case-level
unknowns are unchanged; no layout or visual-parity work is claimed.

## Third CI failure follow-up — 2026-10-08

The [2026-10-08 Actions run](https://github.com/dochevviktor/git-workbench/actions/runs/37745728545)
tested `facdfb2`. Its job metadata and all three validation archives were read through GitHub's API.
The token remained in memory; no Git credential configuration or remote write was made.

- **macOS passed**: 717 unit/integration tests, six explicit skips; build and three native desktop
  scenarios passed, with the Windows-only scenario skipped. The previous socket/GPG fixes now have
  hosted macOS evidence. This does not establish macOS packaging or native-device coverage.
- **Linux**: 718 unit/integration tests, build, packaging and all eight applicable package scenarios
  passed, including the hosted SUID-helper/AppRun sandbox route. The desktop suite had 86 passes,
  two failures and five explicit skips. Both failures were F16 rebase-menu readiness after checkout.
- **Windows**: 713 unit/integration tests and build passed, with ten explicit skips. Native lifecycle
  and Windows controls passed. Aggregate desktop smoke retained its Create Branch dialog after
  submission; the injected `--no-sandbox` scenario exited before creating its first window.

Four controlled Electron regressions exercise the reference races independently of runner speed.
Holding validated reference responses reproduced an enabled Create Branch action against an older
HEAD and a context menu that did not acquire the new branch's Rebase action when the read finished.
Holding both tab and reference responses also reproduced an old commit ID in the branch review.
A reference change after opening the dialog was rejected by the backend, but its error was only
reported behind the modal. All four regressions failed before their corresponding corrections.
The Windows artifact lacks the dialog's backend error; the stale-review diagnosis is supported
by these controlled reproductions alongside its assertion/step trace.

Reference actions now require context HEAD and the active tab's HEAD to agree. Menus opened during
that transition use the existing scoped update handle when matching data arrives, including fresh
current-branch flags; closed or replaced menus retain their existing invalidation behavior. Create
Branch obtains a fresh context before displaying its review and updates named-reference commit
details from that read; explicitly selected commits remain pinned. Changes after review still fail
the original backend snapshot check, with the refusal visible in the dialog. IPC and Git semantics
are unchanged. The four regressions run in both native CI smoke and package verification.

The F16 workflow now dismisses Activity once and opens the branch menu once, then waits up to 15
seconds for its updated action. It no longer repeatedly closes/reopens the menu with a 500ms probe.
This retains the real merge/rebase, operation-completion and independent Git assertions.

Sandbox checks now exercise normal native launch on every OS and the AppImage disabling-flag
override on Linux. The previous test incorrectly applied AppRun's Linux scenario to Windows:
Chromium skips its alternate desktop setup when it starts with `--no-sandbox`, before application
JavaScript can call `enableSandbox`. Enabling sandboxing from JavaScript cannot redo that native setup.
The app's sandbox enforcement remains enabled; Windows still asserts the renderer's sandbox metric,
and Linux still verifies the kernel sandbox and the actual packaged launcher.

Implementation references checked **2026-10-08**, with high confidence for the documented startup order:

- [Electron 44.4.1 Windows entry point](https://github.com/electron/electron/blob/v44.4.1/shell/app/electron_main_win.cc)
  initializes native sandbox information before entering the application.
- [Chromium's Windows sandbox initialization](https://github.com/chromium/chromium/blob/main/sandbox/policy/sandbox.cc)
  conditionally creates the alternate desktop before threads/windows exist.

Final local verification on Linux (Node 24.13.0, Git 2.55.0, Git LFS 3.8.0):

- `npm run check`: type checks, lint, formatting and **718 unit/integration tests passed**, with five
  explicit skips (47.71 seconds for tests).
- `npm run build`: passed. AppImage creation from that output and manifest generation also passed;
  the existing TEST-ONLY Debian artifact was not rebuilt.
- All **93 routine desktop scenarios passed**, with five explicit skips and no retries (5.8 minutes).
- All **13 applicable AppImage scenarios passed**, with the Windows-only scenario skipped and no
  retries (1.0 minute), including all four reference regressions and both sandbox launch modes.
- All **ten focused scenarios passed with one CPU core** (1.6 minutes): four reference races, all four
  F16 startup variants, and both Linux sandbox launch modes. The deterministic failures and passing
  rerun are retained under `test-results/ci-third-*`.

Step logs and JSON/JUnit/HTML reports are in `test-results/ci-third-fix`; packaged evidence is in
`release/p14/package-verified`. The renderer's kernel sandbox checks still pass. Existing dependency
annotation and renderer-size build advisories remain.

These corrections are local and uncommitted. No branch was pushed or remote workflow rerun. The new
native Windows test path and reference corrections require a fresh hosted run; the green macOS and
Linux package results above apply specifically to `facdfb2`. P14 remains partial for its broader
native-device, live-service and release gates. No Fork observation, visual-parity claim or case-level
unknown changes.

## Second CI failure follow-up — 2026-10-08

The [2026-10-07 Actions run](https://github.com/dochevviktor/git-workbench/actions/runs/37686272121)
tested `8ebb21b`. Its API results and the three `validation-*-1` artifacts were inspected using the
user-supplied credential in memory. No credential was copied to Git configuration, reports or source.
All three application builds passed; the job failures were validation failures:

| Runner      | Unit/integration results              | Desktop/package failures                                                                                                                                    |
| ----------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux x64   | 716 passed, five skipped              | Six of 92 desktop cases failed; three of eight package cases failed.                                                                                        |
| Windows x64 | 713 passed, eight skipped             | Aggregate desktop smoke exceeded 90 seconds; native-controls and lifecycle cases passed.                                                                    |
| macOS arm64 | 708 passed, seven failed, six skipped | Six GPG fixtures could not connect to their agent; the aliased-temp LFS case failed. Desktop smoke looked for an absent renderer menubar; lifecycle passed. |

Corrections are scoped to these failures:

- **Credential socket length (F13/F24/F29).** The LFS fixture's nested temporary directory exceeds
  Darwin's 104-byte Unix socket address limit. The broker now chooses a short private directory when
  the complete UTF-8 socket path would exceed that limit; Windows keeps its named pipe. A long,
  multibyte-path regression reproduced `listen EINVAL` on Linux before the fix, then authenticated
  real Git and checked mode 0700 plus socket-directory cleanup after it. Nonces, origin/path checks,
  token lifetime and redaction remain enforced.
- **GPG fixture socket length (F28).** macOS's long default temporary path also overflows GPG's
  agent socket names. Signing fixtures account for the longest agent suffix and use a canonical short
  temporary parent when needed. A real signed-commit/verification regression runs with an overlong
  inherited temporary path. Existing protected-key, cancellation and agent-cleanup tests stay enabled.
- **AppImage sandbox (P14).** The installed builder's launcher injects `--no-sandbox` when its user
  namespace probe fails, even with a correctly installed SUID helper. Main now calls
  `app.enableSandbox()` before readiness; Electron removes that switch and enables its full sandbox.
  AppImage desktop arguments also explicitly omit the builder's legacy default disabling flag.
  A new desktop/package regression supplies the flag and checks its removal, the enable switch,
  renderer isolation, Linux kernel sandbox state and Windows sandbox metrics. The packaged check
  still launches AppRun. No test bypasses the launcher or relaxes the sandbox assertion.
- **Native smoke.** Windows' trace reached remote creation before its 90-second aggregate deadline.
  That one workflow receives 180 seconds on Windows; assertion deadlines are unchanged. Remote
  management now opens through the existing sidebar menu on every OS, including macOS.
- **Gated Linux scenarios.** All five Bisect/staging/commit/patch failures were reproduced locally
  with one CPU core. Each fixture starts Node for every Git subprocess; its valid refresh/preflight
  exceeded the five-second assertion deadline. Those three test files use 15-second assertions and
  bounded 60-second gates, retaining all mouse-down/refresh, stale-snapshot and Git-state assertions.
  Failed commit tests release their gate before cleanup.
- **Quick Launch (F31).** The exact detached-input failure reproduced with two CPU cores: the test
  selected a command after rebase completed but before reference refresh reached the renderer.
  Parameter commands now wait until their reference HEAD agrees with the current repository session.
  The test waits for the displayed rebased HEAD and command availability before selection; external
  checkout must still dismiss a stale chooser.

Final local verification on Linux, Node 24.13.0, Git 2.55.0, GnuPG 2.4.9 and Git LFS 3.8.0:

- `npm run check`: types, lint, formatting and **718 unit/integration tests pass**, with five explicit
  skips (48.85 seconds for tests).
- `npm run build`: passed. The resulting output was packaged with the committed builder config;
  AppImage creation and manifest generation passed. The existing TEST-ONLY Debian artifact was not rebuilt.
- Complete headless desktop suite: **88 passed, five explicit skips**, no retries (5.7 minutes).
- `npm run test:package`: **eight passed, one Windows-only skip**, no retries (52.7 seconds).
  The real AppImage launcher and the forced disabling-flag regression both retain the sandbox;
  packaged renderer checks confirm `NoNewPrivs: 1` and `Seccomp: 2`.
- Controlled load: all five formerly failing gated cases pass with one CPU core (2.9 minutes).
  Quick Launch plus the sandbox regression pass three consecutive runs with two cores (15.1 seconds).
- Long temporary parent: **13 GPG/LFS integration tests pass** (7.37 seconds), supplementing the
  permanent multibyte-path broker and signed-commit regressions. This simulates the path condition
  on Linux; it is not native macOS execution.

Logs and structured reports are in `test-results/ci-fix`, desktop output in `test-results/desktop`,
and packaged evidence in `release/p14/package-verified`. Git LFS was downloaded from its official
3.8.0 release, checked against the API-provided SHA-256 and added only to verification processes' PATH.
Existing dependency-annotation and renderer-size build advisories remain.

The changes are local and uncommitted; no remote branch was pushed or workflow rerun against unchanged
code. A green hosted matrix still needs a new revision on GitHub. Native Windows/macOS corrections
and the privileged hosted Linux SUID-helper route require that rerun. P14 remains partial for its
existing native-device, live-service and release gates. No Fork layout, visual asset, capture status
or case-level unknown is changed.

Primary implementation references checked **2026-10-08** (high confidence for documented contracts):

- [Apple's Unix-domain socket structure](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/un.h)
  defines a 104-byte `sun_path`.
- [GnuPG's socket-path discussion](https://lists.gnupg.org/pipermail/gnupg-devel/2019-June/034367.html)
  explains the address-length constraint for temporary agent homes.
- [Electron enableSandbox](https://www.electronjs.org/docs/latest/api/app#appenablesandbox) requires
  the call before readiness. The
  [44.4.1 implementation](https://github.com/electron/electron/blob/v44.4.1/shell/browser/api/electron_api_app.cc)
  removes `--no-sandbox` before enabling the sandbox.
- [electron-builder AppImage documentation](https://www.electron.build/docs/appimage/) describes
  legacy desktop arguments and the launcher's namespace probe. The exact installed 26.15.3 source
  was inspected; no dependency upgrade is part of this correction.

## CI failure follow-up — 2026-10-07

The [2026-10-06 Actions run](https://github.com/dochevviktor/git-workbench/actions/runs/37511356832)
tested `7d810f1`. Linux passed 709 unit tests, the build and packaging, then 87 desktop scenarios failed
to launch because Chromium's SUID helper had unsuitable ownership/mode. Windows failed 32 unit tests;
macOS failed seven. These are observed CI outcomes, separate from the earlier native verification below.
The working branch was fast-forwarded from `461037c` to this already-published revision before fixes.

The correction adds a shared backend credential-file reader for F13/F37. It rejects non-regular
entries before opening, compares the selected/opened/path identities and metadata before and after
a bounded read, and clears its temporary buffer on every outcome. The existing credential formats
and public error messages remain. `O_NOFOLLOW` is retained where available; Windows also receives the
identity checks. Real symlink and replacement regressions run with the no-follow flag disabled on Linux
so this protection does not depend on the development host. Existing native capability checks remain.

Fixture TEMP/TMP paths now use canonical Windows paths, just as TMPDIR already did for macOS. This
addresses the runner's `RUNNER~1` versus `runneradmin` assertions and identifier lookups. F24 LFS
inspection canonicalizes its own temporary directory and worktree before stripping the synthetic
info-attribute prefix; a real-Git-LFS regression exercises a directory alias. The macOS redaction test
uses unique synthetic secrets while retaining a `private` directory and assertions across every log field.

Patch fixtures wait for repository disposal to settle before deleting files. Git-flow fixtures propagate
test cancellation and drain Git processes before removal. The two aggregate Git-flow cases, the P01
topology sequence and the long LFS sequences receive explicit Windows integration budgets; ordinary
unit deadlines and per-operation assertions remain. These budgets need measurement on hosted Windows.
GPG fixtures have bounded key-generation/listing/agent-stop subprocesses, phase-specific failure output,
test cancellation and cleanup registered before setup finishes. Their integration suites have a 60-second
budget rather than the five-second macOS default. The original GPG stall was not reproduced on Linux;
the native rerun must establish whether a tool/agent issue remains.

CI installs the development SUID helper with root ownership and mode 4755. Package verification on the
Linux runner explicitly extracts the AppImage, configures that copy's helper, exercises AppRun, and
removes the extraction after Playwright closes. Chromium sandbox assertions, headless Linux execution,
sender/frame checks, preload capabilities, CSP and renderer isolation remain enforced. The privileged
helper script refuses to run outside Linux GitHub Actions; no host policy or desktop service is changed.

Each CI step now retains its combined console log, exit status and duration. Unit JSON/JUnit and desktop
JSON/HTML reports feed a summary and structured failure list. Separate desktop/package output directories
retain available traces and screenshots. A final always-run upload creates one archive per OS/attempt,
including setup/check failures; subsequent independent checks cannot turn an earlier failure into success.
Reports include selected runner/tool metadata, never a full environment or the local GitHub token.

Local verification on Linux, Node 24.13.0, Git 2.55.0, GnuPG 2.4.9 and Git LFS 3.8.0:

- `npm run check` through the CI step wrapper passed type checks, lint, formatting and **716 tests**,
  with **five explicit skips** (three scale cases and two Windows-only cases; 48.74 seconds for tests).
  The first check caught a type-import lint issue in the new regression, corrected before this full pass.
- `npm run build` and `npm run package` passed. Existing dependency annotation and renderer-size
  advisories remain; no public release was created.
- Six focused headless Electron scenarios passed: desktop/preload isolation, AI, hosting, LFS, GPG
  signing and window lifecycle (40.2 seconds; no retries).
- `npm run test:package` through the wrapper passed seven AppImage scenarios, with the Windows-only
  scenario skipped (51.2 seconds). This exercises the normal local extraction route; privileged CI
  helper installation and the explicit hosted extraction branch still require the hosted runner.
- Reporting regressions verify failure exit propagation, log capture, nested desktop/unit failure
  summaries, skipped steps and exclusion of unrelated environment variables. Actual JSON/JUnit/HTML
  reports, step logs and available captures are retained in `test-results/ci`, `test-results/desktop`
  and `release/p14/package-verified`.

Git LFS was downloaded from its official 3.8.0 release, checked against the release API's SHA-256,
and added only to the verification processes' PATH; no bundled application asset or dependency changed.
Hosted Windows/macOS execution, the privileged hosted Linux sandbox route, and broader P14 release
gates remain unverified until CI runs. No Fork layout, screenshot parity, research-case completion or
native macOS result is inferred. The fixes are local working-tree changes; no remote branch was pushed.

Primary references checked 2026-10-07 (high confidence for documented platform/reporting contracts):

- [Node file-open constants](https://nodejs.org/download/release/v24.14.0/docs/api/fs.html#file-open-constants)
  identifies the limited Windows flags; `O_NOFOLLOW` is unavailable there.
- [Chromium's helper selection and permission checks](https://raw.githubusercontent.com/chromium/chromium/main/sandbox/linux/suid/client/setuid_sandbox_host.cc)
  explain why each bundled helper needs configuration, including the extracted package.
- [Vitest reporters](https://vitest.dev/guide/reporters),
  [Playwright reporters](https://playwright.dev/docs/test-reporters) and
  [Actions artifact upload](https://github.com/actions/upload-artifact) define the report/artifact contracts.

## Corrections

- **Windows Git environment names (F01/F13).** Copying the environment into a plain object lost
  Windows' case-insensitive lookup. Uppercase-only deletions left `git_dir` and `Git_Work_Tree`
  effective. A real-Git regression returned the foreign worktree before the fix. Names now merge
  according to the host's rules before filtering redirects, configuration injection, traces,
  pathspec options and authentication prompts. Later explicit overrides win, POSIX retains distinct
  case-sensitive variables, and unrelated names retain their spelling for Bash hooks/proxy tools.
  No additional credential or renderer capability is exposed.
- **Text-backed symlink conflicts (F17).** Source selection always called the native symlink API.
  With `core.symlinks=false`, Windows returned `EPERM` even though ordinary Git checkouts use a
  regular file. Resolution now respects that configuration while retaining index mode `120000`
  and the exact target bytes. Real-Git regressions check the resulting clean worktree and rollback
  when an external index lock prevents staging. Native POSIX link-byte coverage remains enabled.
- **Git process lifetime (F01/F13).** Git had a separate fire-and-forget Windows `taskkill` path.
  It now shares the awaited process-tree terminator with custom commands and AI. Cancellation,
  timeout and output-limit completion drain termination before releasing the request or credential
  broker. POSIX process groups, the final escalation and a direct-child fallback remain. Native
  regressions cover Git, custom commands and AI, including the child's absence at Windows completion.
- **Configured executable paths (F01/F34).** Relative executable paths using `/` are recognized
  explicitly on Windows instead of being searched relative to unrelated PATH entries. The regression
  removes those incidental PATH matches. Native executable/Node-entry validation is unchanged.
- **macOS repository opening (F01/F03).** Main registers `open-file` before readiness, queues early
  requests and uses the existing repository-opening service. Opening after all windows close restores
  a main workspace; simultaneous activation/open requests recheck ownership before creating it.
  The native Electron lifecycle scenario injects the OS event to check routing without reload.
  A macOS-only continuation covers reopening the final closed window; actual Finder/Dock delivery
  still needs a Mac host.
- **macOS shortcuts (F31/F34).** Command+Option shortcuts can receive a symbol or `Dead` instead
  of a letter. Matching and shortcut capture share a physical letter/digit fallback for that case;
  ordinary layout-provided letters remain unchanged. IME and AltGr guards remain. The shortcut
  editor now requires the platform's actual command modifier. Synthetic events cover this rule;
  native macOS keyboard/layout/IME behavior remains a verification gate.
- **Portable test selection.** Application shortcut scenarios use Playwright's `ControlOrMeta`;
  rebase's explicitly Control-based row-move shortcut stays Control. POSIX fixture temporary paths
  are canonicalized so macOS `/var` aliases match Git's `/private/var` paths. The smoke/lifecycle
  launchers apply Ozone switches on Linux only. CI retains full Linux desktop coverage and adds
  serial native desktop, lifecycle and Windows-control smoke scenarios on Windows/macOS, plus
  capability reports on every OS. Adding a CI job does not claim that it has run successfully.

## Verification

- `npm.cmd run check`: passed type checks, lint, formatting and **704 unit/integration tests**, with
  **10 explicit capability/benchmark skips** (65 passing files, three skipped files; 397.69 seconds).
- `npm.cmd run build`: passed. Existing dependency annotation and renderer chunk-size advisories remain.
- Targeted service checks: **62 passed, one POSIX-only skip**. After narrowing environment
  normalization to preserve unrelated names, **33 environment/shortcut regressions passed**.
- Native Electron verification: **nine passed in 1.8 minutes**, serially, with the sandbox enabled and
  no retries. Scenarios cover desktop/preload isolation and Git workflows, Windows controls/CRLF/
  restart/encryption, CLI/second-instance and injected file-open routing, conflicts, custom commands,
  external tools, workspace/shortcut preferences, cancellation and AI adapters.
- The initial controlled regression run retained two failures (foreign worktree and symlink `EPERM`),
  both corrected. This was a targeted desktop pass, not a rerun of the complete 92-scenario desktop suite.

Local command logs are `.portability-*.log` (git-ignored); Playwright output is in
`test-results/portability-review/`. The final production build contains the environment refinement.

## Evidence and limits

The private bundle's linked `reference/catalogue/START_HERE.md` and original images are absent on
this host. No Fork behavior, visual parity, layout/style change or private-asset modification is
claimed. These are independently specified implementation corrections. Confidence is high for the
Windows cases exercised and synthetic event/contract behavior; native macOS behavior is unverified.

Primary references consulted on **2026-10-06**:

- [Node child-process environment rules](https://nodejs.org/api/child_process.html): Windows ignores
  environment-name case and duplicate aliases can select an unintended value.
- [Git core.symlinks](https://git-scm.com/docs/git-config#Documentation/git-config.txt-coresymlinks):
  disabled symlinks use regular worktree files while retaining the link index entry.
- [Electron open-file and activation events](https://www.electronjs.org/docs/latest/api/app#event-open-file-macos):
  macOS event delivery differs from Windows argv and can occur before readiness.
- [W3C keyboard key values](https://www.w3.org/TR/uievents-key/) and
  [physical key codes](https://www.w3.org/TR/uievents-code/): modified characters/dead keys differ
  from physical key identity. The bounded Command+Option fallback is an independent application policy.

This review did not run Linux or macOS. Clean-host installation, macOS package
smoke support, signing/notarization, native keyboard/assistive-technology/display matrices and live
provider/agent integrations remain unverified. `test:package` still explicitly supports Windows/Linux;
this review does not promote P14 to complete or claim an OS-agnostic release has been certified.
