# Cross-platform portability review — 2026-10-06

The original review extends the two Windows compatibility commits (`77fec98`, `461037c`).
Its host was Windows 11, build 26200, x64; the later CI follow-up used Linux. Tests use disposable repositories and profiles;
no mutating Git command targets the working project or another user repository.
The original Linux verification and P14's remaining release gates remain separate.

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
