# F33 — External tools and historical handoff

Date: 2026-09-22. Implemented Linux workflow; broader platform/tool variants remain partial.

## Behavior

File → External Tools works without a repository. It manages up to 32 profile-owned editor, diff,
merge and terminal definitions: Name, absolute executable Path, native Browse, argument array,
Save and confirmed Remove. Close/Escape discard unsaved edits. Saves are versioned, private,
atomic and serialized; revision checks reject stale edits and launches. Invalid stores are preserved.
Repository content never supplies definitions or launches a program automatically.

Commit file menus offer named editor/diff actions. Historical editor opens the exact selected blob;
historical diff compares the first parent with that commit, including additions, deletions and renames.
Working file menus offer editor and staged/unstaged/untracked diff actions. Editor opens the working
file and an editable one-based line parameter. Diff always uses copies, including working content;
modifying those copies does not apply a patch. Staged rename pairs retain both paths.

Repository menus, tab menus and toolbar Open in offer configured terminals; the existing file-manager
handoff remains available. The optional Linux terminal preset saves an explicit
`/usr/bin/xdg-terminal-exec` definition with `["--dir=$REPO"]`; installations elsewhere require Browse.
Missing/non-executable programs produce an actionable error. This preset uses an installed desktop
adapter; Git Workbench does not install a terminal or assume one is available.

Conflict editor offers configured merge tools for bounded text conflicts. Main writes BASE/LOCAL/
REMOTE and a separate MERGED file to a private temporary directory. On successful exit, Review Merge
Output returns that draft to the existing editor. Resolve and Stage remains explicit and revalidates
the original conflict snapshot. Tool success alone never changes Git's unmerged index or finishes
the merge/rebase. Editor/diff/terminal dialogs may close while jobs remain in Activity. Merge review
stays open until completion/cancellation so its draft remains reachable; Discard Merge Output is explicit.
Tools start from the working conflict file; applying their output replaces any unsaved editor draft.

## Independent specification and boundaries

- Arguments are a JSON string array, not a shell command line. Substitution occurs once within each
  argument; spaces, quotes, Unicode, newlines and dollar expressions remain literal data. Executable
  paths do not undergo variable expansion. `$REPO` is the canonical repository folder; editor `$LINE`
  is the explicit line number. Diff `$REMOTE` is before and `$LOCAL` after. Merge `$BASE`, `$LOCAL`,
  `$REMOTE` are Git stages 1/2/3, and `$MERGED` is the temporary output. Rebase stage meanings follow
  the existing conflict editor labels; they are not relabeled by guessed branch semantics.
- Each launch reviews the named tool, executable, configured argv and selected target. Main rechecks
  the saved tool revision and window-owned repository inside the common-directory queue. Inspectors
  cannot invoke any external-tool capability. IPC inputs/results remain runtime validated; launch
  accepts a saved tool identity and a named Git target, never an executable supplied for that run.
- Regular blobs/files are limited to 8 MiB; merge text/output to 2 MiB. Binary historical handoffs
  preserve bytes. Git blob reads use `cat-file` without filters/textconv, with lazy fetching disabled
  for materialization. Symlinks/submodules are refused; working paths are checked component by component.
  Missing sides of additions/deletions become empty files.
- Processes reuse F32's direct-argv supervisor, common-directory exclusion, Activity, cancellation,
  bounded 64 KiB output and five-minute lifetime. Desktop selection/display/audio environment variables
  are allowed through explicitly. Child groups terminate on cancellation/owner close; temporary copies
  are removed after exit, cancellation or failure. Use each GUI tool's wait/foreground option.
- The configured program runs with the user's OS permissions. Temporary copies protect the normal
  handoff path; this is not a sandbox for a malicious program. Editor/terminal changes cannot be rolled
  back by cancelling. Daemon/broker processes that escape supervision, OS crashes and forced main-process
  termination are outside the verified cleanup guarantee.

## Reference evidence and visual comparison

Primary evidence: Windows 2.22.0.0, captures 2026-09-19, high confidence for these specific observations:

- `P2-009-configuration-subcase:F1`: separate External Merge Tools and External Diff Tools lists,
  editable Path/Arguments and the four merge variables; full merge execution was not captured.
- `P2-009-custom-viewer-subcase:F1–F4`: custom Name/Path/Arguments, native executable Browse,
  named historical Diff menu action, Notepad showing `middle` while checkout contains `latest`,
  confirmed removal, and 13 unchanged Git outputs. Original case JSON, before/after manifests,
  `integration-comparison.json`, HEAD/index evidence and screens 0507/0509/0511/0512/0514 were inspected.
- `P0-013-general-git-subcase:F1`: Preferences inventory only; no pristine defaults or save-policy claim.

Original image paths beneath `docs/research/fork-reference-new/`:

- `evidence/20260919T162659_098632Z_continuous05-integration_05d178/screen.png`
- `evidence/continuous10/20260919T213213_937597Z_integration-path_2cbd1a/screen.png`
- `evidence/continuous10/20260919T213415_552180Z_integration-file-menu_169a4e/screen.png`
- `evidence/continuous10/20260919T213433_208081Z_integration-launch_7c6c31/screen.png`
- `evidence/continuous10/20260919T213648_676493Z_integration-remove-confirm_00b899/screen.png`

Public supplements, accessed 2026-09-22: [JuxtaCode's Fork integration](https://juxtacode.app/integrations/fork/)
documents custom diff/merge arguments on macOS (high confidence for its documented adapter, not Windows
execution parity). The [xdg-terminal-exec project](https://github.com/Vladimir-csp/xdg-terminal-exec)
documents desktop terminal selection, working-directory arguments and variable process-wait behavior;
its specification remains a proposal. Linux preset behavior is our independent adaptation.
`npm run research:references` restored/checked 226 existing public images; the Integration and staged
external-diff entries in its INDEX were consulted. No new public screenshots or private assets were added.

Implementation captures (git-ignored): `test-results/f33-settings-light.png`, `f33-settings-dark.png`,
`f33-settings-narrow.png`, `f33-historical-light.png`, and `f33-merge-review.png`. Compared against the
original states before and after UI work. Grouped tool lists and Name/Path/Arguments preserve the
captured information structure. A single detail form, explicit Save, JSON argv, launch review, inline
removal confirmation and a dedicated File-menu entry are deliberate Linux adaptations. The complete
F34 Preferences inventory is not implied. Private references remain unchanged and outside app assets.

## Verification

`tests/unit/external-tools.test.ts` uses disposable repositories and real subprocesses. It checks exact
historical/binary bytes, CRLF, unchanged checkout/refs/index, staged/unstaged/untracked and renamed/deleted
pairs, line/cwd/argv, symlink/oversize/missing-tool refusal, conflict draft invariance and stale rejection,
settings restart/CAS/corruption/write failures, wrong owners/inspector denial, output limits, cancellation,
and repeated owner-close cleanup. Preload tests cover new channels and malformed input/results.

`tests/e2e/external-tools.test.ts` verifies no-repository settings, native Browse, keyboard dismissal,
light/dark/narrow layout, historical `middle` handoff, terminal cwd, merge draft review before staging,
restart, unsaved-edit cancellation and confirmed removal through the real sandboxed bridge.
The existing desktop isolation, CLI/second-instance, custom-command and conflict workflows are included
in the affected regression run. Commands and final outcomes are recorded in the plan checkpoint.
Verification exposed a commit-readiness race after conflict staging: the visible file list refreshed
before the commit context, briefly enabling Commit with the old snapshot. Runtime UI evidence showed
the backend's stale-snapshot refusal. The context hook now ties its value to repository/change identity
and invalidates it during the same render; the composer refuses submission while refreshing. Backend
snapshot validation remains intact and there is no automatic retry. The unchanged F17 scenario passed
three consecutive runs after the fix, and the F33 scenario also finishes its reviewed merge commit.
The hook-failure retry button follows the same readiness gate, preventing a click from being ignored
while the fresh commit context is loading.

Final checks:

- `npm run check`: 410 passed, one existing skip; type checks, lint and formatting pass.
- `npm run build`: all production bundles pass (existing dependency annotation/chunk-size warnings).
- `npx playwright test tests/e2e/desktop.test.ts tests/e2e/external-tools.test.ts`: both pass on the final build.
- The affected run also passes `custom-commands.test.ts` and `window-lifecycle.test.ts`.
- `npx playwright test tests/e2e/conflict-editor.test.ts --repeat-each=3`: all three pass after the
  commit-readiness fix. Earlier stale-snapshot and hook-retry failures led to the fixes described above;
  they are not suppressed, automatically retried in the product, or left as outstanding failures.
- `git diff --check` passes. No user-repository mutating Git tests, real display tests, live external
  services, private reference changes or packaging/publication operations were performed.

## Remaining scope

Windows/macOS execution, native desktop terminal/editor GUI matrices, arbitrary GUI daemon lifetimes,
fractional scaling and screen readers remain unverified. The Linux adapter tests use controlled programs,
not installed commercial diff tools. Non-text/missing-stage conflicts, LFS payload expansion, directory
diffs, history-inspector handoffs, a default-tool Ctrl+D shortcut, automatic editor detection, process
lifetimes beyond five minutes and abrupt-crash cleanup are not implemented in this slice. Exact Fork
argument parsing, bundled presets, unknown merge behavior and full Preferences integration remain open.
CLI opening/file-manager capability already existed and is regression-tested, not newly attributed to F33.
P12 remains partial for its broader workspace/settings and retention matrix.
