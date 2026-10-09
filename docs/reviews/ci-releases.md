# Versioned CI installers — 2026-10-08

Scope: extend the existing three-OS validation with downloadable production builds and a generated
Arch/AUR recipe. The version comes from `package.json`; `package-lock.json` must agree. This is an
independent distribution policy, informed by the version gates in the local `offworktime` workflows.
It does not change any Fork feature or claim new feature-family parity. P14 remains partial.

## Hosted validation — 2026-10-09

[Run 37973746787](https://github.com/dochevviktor/git-workbench/actions/runs/37973746787) validates
`2c64340` on `fix/ci-compact-toolbar`, including both corrections below. The workflow is **successful**:
all three platform jobs build, validate and upload their installers, and the final job assembles the
complete bundle and verifies the Arch recipe in its isolated container.

| Host        | Unit/integration       | Desktop                           | Packaged             |
| ----------- | ---------------------- | --------------------------------- | -------------------- |
| Linux x64   | 745 passed, 5 skipped  | 100 passed, 5 skipped             | 20 passed, 1 skipped |
| macOS arm64 | 744 passed, 6 skipped  | 14 native smoke passed, 1 skipped | 19 passed, 1 skipped |
| Windows x64 | 740 passed, 10 skipped | 15 native smoke passed            | 20 passed            |

Completed reports have no failed or flaky tests and no retries. Skips retain the existing OS,
optional-tool and opt-in benchmark policy. The macOS DMG contains both architectures; these runtime
results exercise arm64. P14's wider native-device, signing and live-provider gates remain partial.
The default branch has not been changed and no version tag or GitHub Release has been published.
The publish job is intentionally skipped for this fix branch. The run's `release-v0.1.0` artifact
contains all three installers, the Arch recipe/archive, `SHA256SUMS` and the source-bound manifest;
the individual `installers-<os>-latest` artifacts are also available. Artifacts expire after 14 days.
Updating the default branch would run the existing versioned-release workflow. The repository is
private, so a GitHub Release would retain that access restriction.

## Compact toolbar correction — 2026-10-09

The [second installer run](https://github.com/dochevviktor/git-workbench/actions/runs/37842844004)
at `5d27bc6` passed all unit tests, builds and native desktop smoke checks on Windows and macOS.
Both installers were built successfully. Each packaged suite then failed the same three scenarios
(F32 custom commands, F33 external tools and P13 AI) at the first Quick Launch click. Windows passed
the other 16 package scenarios; macOS passed 15 and skipped the Windows-only scenario. Linux's entire
job, including its installer upload, passed. Assembly and publication remained blocked.

The shared cause is the toolbar's existing 1080px responsive breakpoint. When the visible text is
hidden, ordinary toolbar buttons derive their accessible names from their tooltips. Quick Launch
therefore becomes `Quick Launch (Ctrl+P)` or its macOS shortcut variant, while disabled Fetch/Pull/Push
buttons become `Open a repository first.`. The exact role/name selector cannot find Quick Launch on
the hosted desktops. A local Electron regression reproduced the name change at 1024px before the fix.

Ordinary toolbar buttons now expose their action label with `aria-label`, as the split and menu
buttons already do. The new regression opens all three settings dialogs before a repository is open
at 1280px, 1024px and 780px, checks stable names and disabled state, and checks that tooltips remain.
It runs in the native smoke and packaged suites on every supported OS. Existing workflow assertions
and the upload gates remain enabled. No layout, CSS, private asset, Git semantic, IPC, sandbox or
credential boundary changes. This is an independent F31/F34 accessibility correction, not a new
Fork observation or visual-parity claim.

Primary references checked **2026-10-09**, high confidence for the documented naming contract:
[W3C HTML accessible names](https://www.w3.org/TR/html-aam/#accessible-name-and-description-computation)
and [Playwright role locators](https://playwright.dev/docs/locators#locate-by-role).
The same breakpoint applies across OSes; the tooltip shortcut and native window size differ.

Local verification on Linux, Node 24.13.0 and Git 2.55.0:

- The new regression fails against the original toolbar and passes after the fix; all three
  previously failing scenarios also pass.
- `npm run check`: types, lint, formatting and **736 unit/integration tests passed**, with 11 explicit
  skips (six require unavailable Git LFS, three opt-in scale cases and two Windows-only cases).
- Production build and AppImage creation passed; all **20 applicable packaged scenarios passed**,
  with one Windows-only skip and no retries. Renderer isolation and sandbox assertions remain enabled.
- The full headless desktop suite passes **99 scenarios with six explicit skips**, without retries
  (5.1 minutes). The final hosted results are recorded above.

Logs and structured reports are retained in `test-results/ci-current`; the original hosted Windows
and macOS reports are retained there separately. P14's wider native-device, assistive-technology,
signing and live-provider gates remain separate.

The first correction run, [37972253744](https://github.com/dochevviktor/git-workbench/actions/runs/37972253744)
at `44ab276`, confirms **14 native macOS smoke passes and 19 packaged passes**, with one Windows-only
skip in each suite. The original three failures are resolved. A separate macOS watcher integration
test failed to observe fallback mode within two seconds, leaving that job red despite passing package
checks. That superseded run was cancelled to release the branch's concurrency slot for the corrected
commit; its passing macOS package evidence and failing watcher report are retained.

The watcher knew its initial directory limit was reached but only notified clients on a native event
or its 30-second polling interval. The old test coupled fallback reporting to a newly created file's
native event. The report does not distinguish missing delivery from event coalescing. A deterministic
regression with real directory enumeration and silent watcher handles reproduced the missing initial
notification on Linux. Watchers now notify through the existing debounce when scan coverage changes;
normal coverage stays quiet. The original integration test checks known fallback without a file write,
and its teardown drains native resources. A separate regression verifies symlink exclusion with ample
watcher capacity. All 18 targeted watcher/session/shutdown tests pass. Final `npm run check` passes
types, lint, formatting and **739 tests with 11 explicit skips** (49.57 seconds). The rebuilt AppImage
passes **20 scenarios with one Windows-only skip**, and all **eight session/window-lifecycle desktop
scenarios pass**, without retries. These final reports are in `test-results/ci-current/watcher-fix`.
The final hosted results above verify this follow-up on all three OSes.

[Node's fs.watch caveats](https://nodejs.org/download/release/v24.13.0/docs/api/fs.html#caveats), checked
**2026-10-09**, document platform-dependent event behavior. Confidence is high for the controlled
coverage-notification regression; the exact cause of the missed native observation remains unclaimed.
The backend change reuses existing invalidations, limits, debounce, polling and shutdown boundaries.

## First hosted-run correction — 2026-10-08

The [first installer run](https://github.com/dochevviktor/git-workbench/actions/runs/37824923781)
at `efedbb4` successfully built the Windows NSIS installer, universal macOS DMG and Linux AppImage.
Validation failures prevented installer uploads and skipped assembly/publication. The preceding
[default-branch validation](https://github.com/dochevviktor/git-workbench/actions/runs/37818583515)
was green. The latest run's reports establish these separate failures:

- macOS's new package suite reached three scenarios that had only exercised the renderer's File
  menu, which is absent on macOS: custom commands, external tools and AI integration. They now use
  Quick Launch's actual menu callbacks, including repository custom commands and terminal launch.
  The complete workflows and backend/Git assertions remain enabled.
- Windows's custom-command editor measured 976px on the runner's narrower desktop. Its 1040px
  assertion ignored the existing responsive width limit. The test now checks complete viewport
  containment, the maximum width and the existing narrow-window overflow condition; no CSS changed.
- The Windows missing-tab fixture attempted to rename a directory after `dispose()`/`settled()`,
  while an asynchronous watcher directory walk could still own a native handle. A controlled test
  reproduced premature settlement on Linux with a real open directory. Watchers now expose a drain
  for walks and close notifications; repository shutdown also joins retired repository/source watchers.
  Service, window and tab cleanup tests verify closure before renaming, without rename retries.
- One Windows Git-flow conflict/stop sequence exhausted its 30-second test deadline. A neighboring
  conflict/resume sequence took 35 seconds in the same run. That multi-step test now uses the same
  90-second Windows integration budget as the adjacent cases; per-Git deadlines, cancellation and
  production/tag preservation assertions remain intact.
- Linux's titlebar-close scenario lost Playwright's click reply when the requested application
  shutdown completed. It now accepts only that closed-target error, while still requiring a recorded
  main-window close call, both windows' close events, clean process/stdio completion and no error boxes
  or uncaught exceptions. Other click errors and crashes still fail.

The release/upload/publication policy is unchanged. Test execution still uses disposable repositories,
headless Linux and the Electron sandbox. The watcher change stays in the backend; no renderer, IPC,
credential or Git mutation capability is added. Confidence is high for the controlled directory-handle
regression; hosted Windows confirmation remains necessary. The source contracts are
[Node directory closure](https://nodejs.org/download/release/v24.13.0/docs/api/fs.html#dirclose) and
[watcher closure](https://nodejs.org/download/release/v24.13.0/docs/api/fs.html#event-close_1), checked
2026-10-08. No Fork layout, visual-parity or private-catalogue changes are claimed.

Final local verification on Linux, Node 24.13.0, Git 2.55.0 and Git LFS 3.8.0:

- `npm run check`: types, lint, formatting and **742 unit/integration tests passed**, with five explicit
  skips (50.19 seconds for tests), including all 21 release-policy tests and three watcher-drain cases.
- `npm run build`, final AppImage creation and local manifest generation passed. Existing dependency
  annotation/chunk-size advisories remain. Historical local installers and the TEST-ONLY Debian file
  were not rebuilt or published.
- Complete desktop suite: **99 passed, five explicit skips**, no retries (5.4 minutes).
- Final AppImage verification: **19 passed, one Windows-only skip**, no retries (1.2 minutes), including
  the three portable command workflows, package assets and sandbox checks.
- Targeted watcher/session/Git-flow/release tests: **43 passed**. The premature watcher settlement
  failed deterministically before the correction; the final service/window/tab cases verify closed
  handles and successful rename. All three window-close routes passed three consecutive runs
  (**nine passes**, 8.7 seconds).

Step logs, JSON/JUnit/HTML reports and the combined summary are in `test-results/ci-release-fix`;
packaged evidence is in `release/p14/package-verified`. The new changes remain local and uncommitted;
no branch, tag, release or AUR submission was published. Hosted Windows/macOS execution of the fixes,
release assembly and first successful publication still require a new run. P14's wider native/signing
and live-service gates remain separate.

## Outputs and triggers

| Target   | Release asset                                                                 | Architecture            |
| -------- | ----------------------------------------------------------------------------- | ----------------------- |
| Windows  | `git-workbench-<version>-win-x64.exe`                                         | x64 NSIS installer      |
| Linux    | `git-workbench-<version>-linux-x86_64.AppImage`                               | x64                     |
| macOS    | `git-workbench-<version>-mac-universal.dmg`                                   | Intel and Apple Silicon |
| Arch/AUR | `PKGBUILD`, `git-workbench-bin.SRCINFO`, `git-workbench-bin-<version>.tar.gz` | x86_64 binary recipe    |

The archive contains `PKGBUILD`, `.SRCINFO` and the MIT license. The separate source-info asset uses
a non-hidden name because GitHub strips leading periods from uploaded asset names. `SHA256SUMS`
covers the installers, Arch files and `artifact-manifest.json`; the manifest records the exact source
commit, app version, lockfile digest, byte counts and artifact digests. Assembly requires the complete
explicit installer set. Historical local artifacts and TEST-ONLY Debian files cannot enter publication.

All branch pushes, PRs and manual runs validate and build installers. Jobs retain each successful
platform's installer as an Actions artifact for 14 days. After every platform passes, a Linux job
assembles the complete bundle and builds the generated recipe using `makepkg` in an isolated Arch
container. Its metadata must match `makepkg --printsrcinfo`, downloads must match the candidate's
checksums, declared dependencies must resolve in Arch's repositories, and the package must contain
the application, command, desktop entry, icon, license and
root-owned mode-4755 Chromium sandbox helper. The recipe build itself has no network access.

Only a push/manual run at the current default-branch commit may publish, with `contents: write`
restricted to the final job. PR code receives no publishing token. Local commands never publish;
the publication entry point also verifies its Actions event, repository default branch and commit.
GitHub Releases is used for binary downloads; GitHub Packages is not a generic executable registry.

## Version and retry policy

Versions are stable `major.minor.patch` numbers. Prerelease/build suffixes are rejected because an
Arch `pkgver` ordering policy has not been defined for them. `npm version patch --no-git-tag-version`
(or `minor`/`major`) updates both metadata files; commit those changes normally. CI creates
`v<version>` only after validation and upload checks. No separate tag push is required.

An equal or newer published version causes publication to skip; validation and downloadable build
artifacts still run. Tags are never moved and published assets are never overwritten. A pending tag
or draft may resume only for its original source commit. A different commit must bump the version.
API/authentication errors fail the release instead of being interpreted as an empty release history.
Release discovery is paginated and compares numeric version components.

Publication first creates a draft tied to the full commit SHA, uploads all assets, and verifies their
server-reported SHA-256 digests and byte sizes. Reruns reuse matching draft assets and may replace
incomplete/different assets only on that same unpublished draft. Unexpected draft assets stop the
release. The workflow serializes publication and rechecks the default branch and tag before making
the draft public. A newer default-branch commit arriving during upload leaves the draft unpublished.
Rerun the original commit to finish an interrupted release while it remains the branch head; otherwise
bump the version. No task in this change pushes tags or publishes a release from the development host.

## Installation, signing and AUR

Git 2.43+ is required separately on Windows/macOS/AppImage installations. Arch declares it as a package
dependency. The recipe downloads the exact release AppImage, verifies it, extracts it without FUSE,
and installs the bundled Electron directly under `/opt/git-workbench`. It retains Electron/Chromium
and app notices, exposes `/usr/bin/git-workbench`, and does not pass `--no-sandbox`. Optional Git LFS,
OpenSSH and GnuPG dependencies are advertised. This deliberately uses the exact bundled Electron
tested by CI instead of silently substituting Arch's Electron version.

For local Arch installation, extract the AUR archive, inspect the recipe and run `makepkg -si` as a
normal user. The generated `.SRCINFO` and recipe can be committed to a separately maintained AUR
`git-workbench-bin` repository. AUR registration, credentials and push automation are not configured;
the existence of a GitHub Release does not make `yay -S git-workbench-bin` available.

Windows installers are unsigned. The universal macOS app is ad-hoc signed after merging architectures,
with hardened runtime disabled for that ad-hoc build; this does not disable Electron's renderer sandbox.
This is not Developer ID signing or notarization, and downloaded apps may encounter OS trust warnings.
Validation jobs have no signing secrets and disable identity discovery, including for fork PRs.
Trusted signing/notarization requires a later explicit credential setup and native verification.
Updates remain manual, with the existing profile-backup/rollback guidance. The new workflow does not
close P14's native-desktop, assistive-technology, keyring, live-provider or signing gates.

## Evidence and verification

Primary references checked 2026-10-08, high confidence for documented contracts:

- [electron-builder v26 macOS configuration](https://www.electron.build/v26/docs/mac/): universal
  targets and signing configuration; the installed 26.15.3 implementation was also inspected.
- [GitHub releases API](https://docs.github.com/en/rest/releases/releases): draft creation, target
  commits, publication and release listing.
- [GitHub release assets API](https://docs.github.com/en/rest/releases/assets): upload digests,
  incomplete uploads and filename normalization.
- [Arch Electron guidelines](https://wiki.archlinux.org/title/Electron_package_guidelines): system
  Electron is an alternative; this binary package deliberately retains the tested bundled runtime.

Local verification on the Linux development host:

- `npm run check` passes type, lint and formatting checks plus **733 tests with 11 explicit skips**.
  Capability-dependent native/tool cases and opt-in benchmarks retain their existing selection policy.
- Production build and AppImage creation pass. The 19 applicable packaged Electron scenarios pass
  without retries, with one explicit Windows-only skip. Tests keep disposable profiles/repositories
  and the headless platform; no window is opened on the user's display.
- `npm run package:aur` and `CONTAINER_ENGINE=podman npm run test:aur` pass against the real AppImage.
  The recipe matches `makepkg --printsrcinfo`; runtime dependencies resolve against Arch repositories;
  offline `makepkg` verifies both source hashes and produces a package with the expected content and
  root-owned mode-4755 sandbox helper. The container check does not claim an installed Arch desktop
  session or native-window smoke test.
- 21 release tests cover metadata/lockfile checks, fixture assembly, hashes, draft retries, partial
  uploads, unexpected assets, pagination, annotated tags, stale commits and local/PR publish refusals.
  Fixture installers are synthetic bytes in temporary directories, not claimed native builds.
- `actionlint` 1.7.7 passes for the updated workflow.

Native Windows/macOS installer generation passed in the first hosted run described above. Complete
hosted validation, release assembly and actual GitHub publication still require a successful run.
Local macOS/Windows installer execution is not claimed from this Linux host. No
release/tag or AUR submission was published during this work, and no signing credentials were used.
