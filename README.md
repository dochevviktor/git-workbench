# Git Workbench

A Linux-first desktop Git client for Linux, Windows and macOS, built with Electron, React and TypeScript.

## Features

- Repository management, tabs and named workspaces.
- Commit graph and search, file history, blame and reflog recovery.
- Unified, split and image diffs; file, hunk and line staging; commits and amendments.
- Branches, tags, remotes, fetch, pull and push.
- Merge conflict resolution, interactive rebase, cherry-pick, revert, stashes and recovery tools.
- Worktrees, submodules, Git-flow, Lean Branching, Git LFS, GPG signing and manual bisect.
- Hosting accounts, GitHub issues/PRs and notifications, and browser handoffs for pull requests.
- Quick Launch, custom commands, external tools, statistics, treemaps and optional AI assistance.
- Light, dark and system appearance.

See the [feature coverage](docs/research/fork-public-surface.md#feature-coverage) for supported scope
and known limitations.

## Installation

Install **Git 2.43 or newer** and make sure it is available on your `PATH`.
Git LFS and GnuPG are optional dependencies for LFS and signing.

For packaged builds, check [GitHub Releases](https://github.com/dochevviktor/git-workbench/releases)
or [CI build artifacts](https://github.com/dochevviktor/git-workbench/actions).

| Platform                    | Package          | Install                                                                                      |
| --------------------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| Linux x64                   | AppImage         | Make it executable and run it. Requires FUSE 2, or launch with `APPIMAGE_EXTRACT_AND_RUN=1`. |
| Windows x64                 | NSIS `.exe`      | Run the installer.                                                                           |
| macOS Intel / Apple Silicon | Universal `.dmg` | Open it and drag Git Workbench to Applications.                                              |

Arch users can extract the release's `git-workbench-bin-<version>.tar.gz`, review `PKGBUILD`
and run `makepkg -si`. The recipe is provided with releases; AUR publication is separate.

Downloads include `SHA256SUMS`. Windows builds are unsigned; macOS builds use an ad-hoc signature
without notarization, so OS trust warnings may appear. Updates are manual.

Open an existing repository, initialize one or clone a remote. Existing repositories open for browsing;
choose **Trust Repository…** to enable working changes and network operations.

## Development and build

Use **Node.js 24.13+ within the Node 24 line**, **npm 11+** and **Git 2.43+**.

```sh
git clone https://github.com/dochevviktor/git-workbench.git
cd git-workbench
npm ci
npm run dev
```

Development runs in an Electron window with React Fast Refresh and main/preload watch mode.
On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

```sh
npm run check        # Type checks, lint, formatting and unit/integration tests
npm run build        # Compile the production application into out/
npm start            # Run the built application
npm run test:e2e     # Build and test the Electron application
npm run package      # Build the host platform's installer into release/
npm run package:dir  # Build an unpacked application into release/
npm run test:package # Test the packaged application
```

Build installers on their respective operating systems: Linux produces an AppImage, Windows an NSIS
installer and macOS a universal DMG. Local packaging does not publish a release.
`package.json` is the sole source of the application release version; `package-lock.json` pins
dependencies and is not used for version checks.

Linux desktop launches require a graphical session and Electron's system libraries. Development uses
Wayland when available; Linux Electron tests run headlessly by default. Windows and macOS tests use
native windows. Run `npm run test:capabilities` to inspect available test tools.

See [contributor instructions](AGENTS.md) for local testing,
[architecture](docs/architecture.md) for the code structure, and
[release documentation](docs/reviews/ci-releases.md) for packaging and publication details.
Development progress lives in the [implementation plan](docs/implementation-plan.md) and
[review records](docs/reviews/).

## Inspiration and credits

With thanks to the developers of [Fork](https://fork.dev/) for the inspiration. Git Workbench began
as an independent attempt to bring a Fork-like experience to Linux, using Electron's flexibility to
support Windows and macOS as well.

Fork screenshots served only as visual references during development. The application code and
visual assets were authored independently: no Fork source code was used, decompiled or reverse
engineered. Reference screenshots and supporting evidence are retained locally and are not bundled
with the application. The [research record](docs/research/fork-public-surface.md) documents the
screenshot references, public documentation and supplied workflow observations.

Git Workbench is an independent project and is not affiliated with or endorsed by Fork.

## License

[MIT](LICENSE).
