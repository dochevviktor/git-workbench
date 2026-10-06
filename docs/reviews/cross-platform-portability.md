# Cross-platform portability review — 2026-10-06

This review extends the two Windows compatibility commits (`77fec98`, `461037c`).
The host is Windows 11, build 26200, x64. Tests use disposable repositories and profiles;
no mutating Git command targets the working project or another user repository.
The original Linux verification and P14's remaining release gates remain separate.

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
