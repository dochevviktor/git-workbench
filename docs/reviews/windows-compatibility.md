# Windows implementation and test selection — 2026-10-01

This follow-up supersedes the feature exclusions and failing-suite status in the
[initial Windows audit](windows-portability-audit.md). Historical Linux evidence is unchanged.
The development host, versions and private-catalogue availability are recorded in that audit.

## Automatic test selection

`npm test`, `npm run check` and `npm run test:e2e` select assertions using the host OS and
the capabilities in `tests/platform.ts`. No list of previously failing tests is excluded.
`npm run test:capabilities` reports the detected environment without running the suites.
Use `npm.cmd` in PowerShell when its execution policy blocks `npm.ps1`.

| Capability                            | Selection and reason                                                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux SSH daemon integration          | Linux only; its fixture uses a Linux sshd, account and agent setup.                                                                                                                                                     |
| POSIX filenames and raw symlink bytes | POSIX only for cases that create wildcard/colon/newline names or non-UTF-8 symlink targets. Parser-only coverage remains active everywhere.                                                                             |
| Symlink creation                      | Probed in a disposable directory. Symlink-specific cases/assertions require this capability; shared binary/CRLF/staging/security cases still run. Windows Developer Mode or suitable privileges can enable these cases. |
| POSIX mode bits                       | Asserted only on POSIX. Windows encryption and credential behavior are tested independently.                                                                                                                            |
| GPG / Git LFS / OpenSSL               | Integration fixtures require installed tools. On Windows, the test process can discover the GPG/OpenSSL shipped alongside Git. No software is installed and the machine's PATH is unchanged.                            |
| Scripted pinentry fixture             | POSIX only. Windows real signing, verification, missing-key and cancellation tests still run with an isolated keyring.                                                                                                  |
| Process cancellation                  | POSIX signal markers on POSIX; actual process disappearance on Windows. Linux zombie checks use `/proc`; other platforms use process existence.                                                                         |
| Native Windows smoke                  | Windows only: window controls, focus restoration, CRLF commit, profile restart and OS encryption.                                                                                                                       |
| Package and benchmarks                | Existing explicit executable/benchmark opt-ins remain.                                                                                                                                                                  |

The inotify/file-descriptor resource benchmark additionally requires Linux `/proc`, even when
`P14_BENCHMARK=1`; portable benchmarks remain selectable on other platforms.

Shared fixture names preserve spaces, Unicode and leading dashes using legal Windows filenames.
Git fixtures use an isolated global configuration. Temporary repository owners are disposed and
their work drained before deletion or relocation. Windows uses two unit workers, a 30-second default
unit deadline and 15-second polling/desktop assertions; the multi-step LFS workflow gets 60 seconds.
Electron tests stay serial because Windows automation uses the native desktop. Linux retains Ozone
headless execution. Automatic retries are not enabled.

## Windows behavior implemented

- F32 custom commands and F33 external tools launch native programs with argument arrays and no
  implicit shell. Bash actions discover Git for Windows' Bash, excluding the WSL system stub.
  An unavailable Bash installation produces an actionable error.
- F37 Claude/Codex/Cursor adapters accept native executables and explicit Node CLI entry points on
  Windows. Windows profile, application-data, temporary-directory and system environment variables
  are included without inheriting arbitrary API keys or `NODE_OPTIONS`. Fixed adapter arguments,
  preview/Send, private stdin, output limits and result validation remain intact.
- Windows Node shebang entry points are run through an installed Node executable, including explicit
  Git wrappers. `.cmd`, `.bat` and PowerShell launchers are not implicitly interpreted. For custom
  tools, configure an interpreter explicitly; for AI, select the native executable or Node entry point.
- Cancellation and time/output limits terminate the active Windows process tree using native
  `taskkill /T /F`, and commands/AI wait for termination before releasing request data. POSIX uses
  process groups. Configure external tools in foreground/wait mode: a launcher that exits and leaves
  detached work behind is not a supported completion/lifetime contract on Windows.
- F08/F27 untracked text, binary and image diffs use Git's portable `/dev/null` path. Node's Windows
  device spelling previously produced empty diffs. Untracked stash patches use the same correction.
- F07 literal path search escapes wildcard characters with bracket classes, which Git for Windows
  does not reinterpret as path separators.
- F21 historical Save As uses the native separator when checking whether a destination is outside
  the repository. It continues to reject checkout/metadata destinations and linked existing files.
- F23 removal reviews display native Windows paths. Worktree/branch identity normalization from the
  earlier audit remains in place.
- Native tests wait for restoration to complete before requesting focus and launch second instances using Electron's real
  executable, rather than Playwright's platform-specific launcher process.
- Resize assertions wait for native layout to settle without relaxing size limits. Crash-recovery
  automation waits for repository restoration after preload connects; branch selectors distinguish
  local and remote refs while watcher refreshes are in flight.
- The broad desktop fixture waits for a newly committed file's final Modified status and exact diff
  before selecting lines. A previous file can have the same hunk/line count, so that count alone did
  not establish readiness after external fixture writes.
- Stage/Unstage retain existing file actions during background reads. A controlled real-Git gate
  reproduced a disabled button between mouse-down and mouse-up before the fix; the same test now
  completes staging and unstaging with unchanged HEAD and worktree bytes. Initial loading, mutation
  locks and backend validation remain enforced.
- Repository issue-link fields wait for settings to load before accepting edits. Batch deletion and
  upstream and Pull dialogs read fresh reference data and retain the matching reviewed snapshot, so delayed
  watcher refreshes cannot mix old selections with new choices.

These are independent Git Workbench implementation observations, not newly observed Fork behavior.
No renderer Node/process capability, IPC channel, sandbox exception or credentials DTO was added.
The private catalogue is absent here; no layout/style or screenshot-parity claim is made.

## Verification

- Final `npm.cmd run check`: **passed**, including type checking, lint, formatting and **697 unit/integration
  tests passed, 10 explicitly skipped** (64 passing files, three skipped files; 451.54 seconds).
  The skips cover three scale opt-ins, the Linux SSH fixture, POSIX-only filename/pinentry cases and
  unavailable symlink creation. Real GPG and Git LFS tests ran. A preceding concurrent desktop/unit
  run exceeded the aggregate LFS deadline; both serial full runs passed with the same 60-second deadline.
  The earlier serial run passed 696 tests with 11 skips; narrowing a mixed image-security test's
  symlink guard retained its portable assertions in the final run.
- The Linux resource benchmark remains skipped on Windows with `P14_BENCHMARK=1`, verified separately.
- Focused desktop regression rerun: **20 passed**, including every scenario that failed the first
  broad Windows desktop pass. A later full pass exposed four additional readiness/snapshot failures;
  all six affected/related scenarios passed after their corrections.
- An earlier complete Playwright pass recorded **86 passed, four explicitly skipped
  and one smoke-fixture readiness failure** (16.6 minutes). After correcting that fixture, the smoke
  test passed separately (1.1 minutes).
- The added pointer/refresh regression and existing post-commit refresh scenario both passed. A
  native harness failure showed that requesting focus before restore completed could be ignored;
  sequencing those steps then passed three consecutive native runs. The earlier installed smoke
  recorded five passes and a staging failure; its evidence and the controlled reproductions are retained.
- Final `npm.cmd run test:e2e`: **88 passed, four explicitly skipped, zero failures** in one complete
  run (18.6 minutes), including the added staging regression and native Windows scenario. No automatic
  retries were enabled. The four skips are the package-only case, two opt-in scale scenarios and the
  existing-large-repository opt-in.
- Final `npm.cmd run package`: **passed**. The rebuilt x64 NSIS installer installed successfully into
  an isolated workspace directory (exit 0). `npm.cmd run test:package -- "<installed executable>"`
  then passed **all eight scenarios** (2.6 minutes): desktop smoke, custom commands, external tools,
  AI adapters with stand-ins, both refresh regressions, packaged sandbox/attribution and native Windows.
  Silent uninstall returned 0; the installation directory and per-user uninstall registration were removed.

The retained installer is `release/Git Workbench Setup 0.1.0.exe` (111,863,759 bytes), **unsigned**.
Its SHA-256 is `2063b6d83c1cb2f1821e8f13c76afcc288f7b68c21903535f19d304f1d1f8617`, independently
checked against `release/artifact-manifest.json`. No signing identity or publishing destination was used.

Local logs are retained in `release/windows/compatibility/`; final full-suite Playwright evidence is in
`release/windows/compatibility-desktop-final/`. The preceding sweep remains in `release/windows/port-verified/`
and its corrected smoke in `release/windows/port-desktop-final/`. Installed-app evidence is in
`release/p14/package-verified/`; installation, checksum and uninstall records are in the compatibility directory.

Live AI/provider authentication, detached vendor launchers, clean-machine installation, signing a
public installer, macOS execution, Linux regression execution and P14's broader hardware/accessibility
matrix are not established by this Windows run. P14 remains partial.

## Public implementation references

Accessed 2026-10-01; high confidence for the published platform/runtime contracts, not live vendor
compatibility: [Node child-process behavior](https://nodejs.org/download/release/v24.19.0/docs/api/child_process.html)
documents Windows batch-file execution requirements; [Cursor installation](https://cursor.com/docs/cli/installation)
documents a Windows PowerShell installation route. Vendor responses in tests are deterministic stand-ins;
no real provider request or credential was used.
