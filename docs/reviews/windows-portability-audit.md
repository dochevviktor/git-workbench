# Windows portability and installer audit — 2026-10-01

**Windows support is partial.** The application builds and runs on this Windows host, but the complete
test suite is not green. The native smoke and successful NSIS packaging must not be interpreted as
full Windows feature verification. P14 remains partial, and macOS was not tested.

## Environment and scope

- Windows 11 Pro for Workstations, build 26200, x64; approximately 12 GiB RAM.
- Node 24.19.0, npm 11.17.0, Git 2.55.0.windows.3, Git LFS 3.7.1, Electron 44.4.1,
  electron-builder 26.15.3 and Playwright 1.63.0. Existing dependencies were used; `npm ls --depth=0`
  reports no invalid/missing top-level dependency. A clean Windows `npm ci` was not rerun.
- The incoming `package-lock.json` change is retained. No real repository was used for mutating tests,
  no real hosting account was contacted, and no signing identity or publishing destination was used.
- PowerShell blocks `npm.ps1` here; commands use `npm.cmd` without changing execution policy.
- Windows Electron launches use the native desktop. Linux Ozone headless switches do not make Windows
  runs headless. Native E2E runners should be serialized to avoid focus interference.
- The private bundle entry point exists, but its linked `reference/catalogue/START_HERE.md` and original
  images are absent. No visual parity claim, layout change, capture-harness run or reference-asset edit
  was made. Existing catalogue IDs retain the meanings in the alignment record.

## Corrections

1. **Background refresh loop.** Repeated clean `git status` calls caused four native invalidations in
   four reads. `GIT_OPTIONAL_LOCKS=0` prevents optional index rewrites; mandatory mutation locks stay
   enabled. `tests/unit/windows-portability.test.ts` now verifies stable background reads. The formerly
   stuck Bisect and desktop workflows progressed after this correction.
2. **Worktree identity and branch occupancy.** Git for Windows emits `/` paths while native actions
   use `\`. Normalize paths at the backend boundary so create/list IDs and occupied-branch paths agree.
   Branch occupancy also reads NUL-delimited output, preserving unusual paths. All eight worktree
   service tests and all 27 reference service tests pass in the focused checks.
3. **Test isolation and portability.** Fixture Git configuration no longer inherits user line-ending,
   signing and credential-helper settings. Tests still honor explicit repository-local configuration;
   the Windows native test deliberately enables `core.autocrlf=true`. Common operation/statistics and
   desktop fixtures use legal Windows names while retaining newline coverage on POSIX. Windows unit
   tests allow 30 seconds for real Git workflows; worker concurrency is bounded to two. Unsupported
   feature tests were not silently skipped or converted to passing assertions.
4. **Checkout formatting.** `.gitattributes` enforces the existing LF policy. Text-only normalization
   leaves no unrelated content changes. Prettier excludes the private reference bundle so it stays
   byte-for-byte unchanged. Type checking, lint and formatting pass.
5. **Windows packaging.** The installer and executable use the independent project icon. The ICO was
   generated from `resources/icon.png` with electron-builder's cached icon tool, version 1.1.0.
   Its first conversion failed with `WebAssembly.Memory(): could not allocate memory`; repeating only
   the converter with Node's `--disable-wasm-trap-handler` succeeded. The generated ICO is supplied as a source asset,
   so ordinary Windows builds do not need that converter or workaround.
6. **Packaged verification.** `test:package` resolves the Windows unpacked executable by default and
   accepts an installed executable path. The package test verifies the Windows renderer's actual
   `app.getAppMetrics().sandboxed` value, unavailable renderer Node globals, production CSP, original
   icon and dependency/Electron/Chromium notices. Linux retains its `/proc` seccomp checks.

The icon workaround uses Node's documented lower-virtual-memory WebAssembly execution mode; it does
not disable Electron's sandbox. See [Node CLI documentation](https://github.com/nodejs/node/blob/main/doc/api/cli.md#--disable-wasm-trap-handler)
and [electron-builder NSIS documentation](https://www.electron.build/v26/docs/nsis/), accessed 2026-10-01.

## Application evidence

`tests/e2e/windows-native.test.ts` passed its focused source run. It observes actual native
maximize/restore/minimize states, programmatic moving/resizing, a repository path containing spaces
and Unicode, staging and committing a CRLF working file, clean Git status, LF committed bytes,
profile restart and a synthetic Windows `safeStorage` encryption/decryption round trip. No real token
is stored. The screenshot was inspected in `release/windows/native-source/`. The same scenario later
failed in the full sweep when staging did not appear within five seconds. That failure is retained;
the initial pass does not establish reliable native behavior across all runs.

The broad `desktop.test.ts` also passes after replacing its Windows-invalid newline filename. It
exercises the real preload/renderer, repository creation, history, changes, staging, commit/amend,
hook refusal, branch/remote operations and tab persistence. The source screenshot proves only the
tested display/state; mouse edge-drag, multiple displays, native IME, screen readers and scale changes
remain unverified. Programmatic bounds checks do not establish manual edge-drag behavior.

## Suite results and remaining failures

Initial investigation was deliberately retained: formatting reported 443 CRLF files; the first unit
run was stopped under memory pressure and repeated with two workers. That repeat reported 547 passes,
152 failures and four skips. The initial E2E sweep reported 35 passes, 51 failures and four skips.
Corrections were made during that exploratory sweep, so it is not a clean immutable baseline.

A subsequent `npm.cmd run check` passes type/lint/format and reports 630 passed, 70 failed and four
skipped unit tests, plus one unhandled rejection from an unsupported agent fixture. The two reference
path failures in that run were subsequently corrected and all 27 reference tests pass. The combined
reference/statistics/P01 follow-up reports 43 passes and four P01 helper failures.

The subsequent complete E2E sweep reports **56 passed, 31 failed and four skipped** in 12.2 minutes,
without automatic retries. Its log is `release/windows/e2e-final.log`, and traces/error contexts are
in `release/windows/final-suite/`. It uses the watcher/worktree correction build; the later branch
occupancy parser correction is covered by the 27 service checks and the final rebuilt package smoke.
The four skips are the two opt-in benchmarks, package-only check and existing-user-repository test.
The package-only scenario is exercised separately. No user's repository was supplied for that opt-in test.

Outstanding failures include:

- Unix executable fixtures (`GIT_EXECUTABLE` pointing at a `.ts` file), `/usr/bin/printf`, Bash and
  POSIX process-group assumptions. Windows intentionally requires a native `.exe`/`.com` Git program;
  the application does not weaken that boundary to accommodate tests.
- Explicit product exclusions: F32 custom process commands and F37 agent CLI adapters reject Windows.
  F33 external tools reuse the same process runner and are also unavailable on Windows.
- Unix-only filenames, POSIX permissions/mode assertions, unprivileged file-symlink creation and
  hardcoded slash paths remain in less common fixtures. Symlink and permission failures are not proof
  that NTFS security or application symlink defenses passed.
- `openssl`, `gpg` and related fixture tools are not on this host's PATH. Real remote LFS transport,
  GPG/SSH agent prompts and signed-commit UI remain unverified despite Git LFS itself being installed.
- History search, Git-flow completion and other timed UI assertions still fail in the full sweep.
  These are unresolved failures, not assumed fixture-only problems or silently widened pixel tolerances.
- Image decoding/presentation, submodule dialog path formatting, second-instance selection, settings
  and the native staging scenario also retain failed assertions. Windows filesystem teardown produced
  `EBUSY` in some unit fixtures. These need separate controlled reproductions.
- Live hosting/OAuth/AI services, clean-host prerequisites, native assistive technology, performance
  budgets and macOS remain outside this host's verification.

## Installer and reproduction

`npm.cmd run package` produces a local unsigned x64 NSIS installer in `release/`, plus
`artifact-manifest.json` and `SHA256SUMS`. Authenticode reports `NotSigned`; electron-builder's
"signing with signtool.exe" log line does not mean an actual signing identity was applied.

The silent installer returned zero when installing into `release/windows/installed`, and registered
`Git Workbench 0.1.0` with a Windows uninstaller. This is installation on the development host with Git
already installed, not a clean Windows machine or signed public-release validation. Updates remain
manual; no automatic update feed was added. Preserve application profiles when changing versions.

Final artifact: `release/Git Workbench Setup 0.1.0.exe`, **111,863,225 bytes**, SHA-256
`430153d895690db4ebd1f96ccb5c9f97bc3ad7e1aad43d67d6050a98f9cea332`.
The manifest matches the file. The final installer replaced the earlier audit build successfully
(exit zero); the installed `resources/app.asar` hash matched the final unpacked build.

`npm.cmd run test:package -- <installed executable>` reports **two passed, one failed**:

- The complete desktop workflow passes against the installed executable (56.1 seconds).
- Package security/attribution passes: actual Windows renderer sandbox, no renderer Node globals,
  restrictive production CSP, project icon and all expected license notices.
- The native scenario again fails waiting for the staged row after clicking Stage All. Native controls
  had passed earlier in that scenario; commit/restart/encryption are not claimed for this failing run.
  It retains the earlier focused source pass and both later failures. No automatic retries were used.

Installed traces and the security record are in `release/p14/package-verified/`; the command log is
`release/windows/installed-package.log`. **Packaged verification is not fully green.**
The registered uninstaller returned zero, removed the audit executable and removed its uninstall
registration. The test installation was removed; the installer artifact and evidence remain.
Final type checking/build, lint, formatting and `git diff --check` pass. Windows checks did not rerun
Linux/macOS or close P14's remaining platform, live-service and release gates.

```powershell
npm.cmd run check
npm.cmd run test:e2e
npm.cmd run package
npm.cmd run test:package
npm.cmd run test:package -- "C:\path\to\installed\Git Workbench.exe"
```

Focused native test: `node node_modules/playwright/cli.js test tests/e2e/windows-native.test.ts`.
Local logs and Playwright traces are retained under `release/windows/`; failed tests keep their
original Git assertions. No entire Windows suite or P14 completion is claimed.
