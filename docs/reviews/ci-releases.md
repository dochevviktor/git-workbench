# Versioned CI installers — 2026-10-08

Scope: extend the existing three-OS validation with downloadable production builds and a generated
Arch/AUR recipe. The version comes from `package.json`; `package-lock.json` must agree. This is an
independent distribution policy, informed by the version gates in the local `offworktime` workflows.
It does not change any Fork feature or claim new feature-family parity. P14 remains partial.

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

Native Windows/macOS installer builds, the hosted workflow and actual GitHub publication require the
first hosted run. Local macOS/Windows installer execution is not claimed from this Linux host. No
release/tag or AUR submission was published during this work, and no signing credentials were used.
