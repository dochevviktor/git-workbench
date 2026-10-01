# P12 productivity and workspaces — 2026-10-01

This record supersedes the bounded F31–F34/F38 implementation limits where described below.
P12 is complete for the independently specified and verified Linux phase scope. The target is the
independently implemented Linux workflow, with Windows 2.22.0.0 catalogue
presentation as the primary reference. Exact undocumented Fork behavior and native platform
matrices remain separate from implementation completion. Verification results are recorded below.

## Workspaces and ownership

The toolbar workspace dropdown and File → Workspaces select saved workspaces and open Configure
Workspaces. Configuration supports create, rename, confirmed removal, Switch Workspace and Open in
New Window. There are at most 20 named workspaces, each with at most 20 open repository tabs.
One main window owns each open workspace. Selecting an already open workspace focuses its window;
switching closes the source after its replacement loads. A running operation blocks switching that
would close its owner; opening another workspace in a separate window remains available.

Each workspace has its own tab order, active repository, recently closed tabs, repository-list
visibility, tab colors, window geometry and five pane sizes. Layout Save/Restore is explicit and
scoped to the current workspace; Reset Pane Sizes uses the ordinary bounded defaults. The vertical
repository list stays alongside the horizontal tabs and uses the workspace name. Tab Color is in
the tab context menu. The toolbar truncates long names and becomes compact at narrow widths.

The original workspace is named Work and retains the existing tab file and renderer preference keys.
Version-1 tab files migrate through the existing version-2 migration. Named workspaces add a bounded,
versioned atomic metadata file and separate profile-owned tab/window files. Metadata edits have revision
checks. Invalid originals are retained for recovery. Removing a workspace does not remove repositories,
their files or its old tab/layout records. Open workspaces and the original Work identity cannot be removed.
Workspace open/edit actions serialize together to prevent removal racing window creation.

A main window keeps one workspace identity for its entire lifetime. Renderer IDs never name arbitrary
profile files or URLs. Closing an owner releases its sessions, watchers, operations and inspectors;
another workspace using the same repository retains its own sessions. Shared Git writes still use the
common-directory queue. CLI opening targets the active main window. Normal startup opens the last active
workspace; other workspace definitions and saved tabs remain available from the dropdown.

## Preferences and productivity

General retains appearance and diff font/marks and adds source-folder editing, a diff preview, syntax
highlighting, date/topological commit order, compact branch labels, branch-space replacement, tab dirty
indicators and local/hidden author avatars. Initials are independently drawn; no email or avatar request
is sent to an external service. Date order uses Git's `--date-order`, preserving parent constraints;
topological order keeps the existing `--topo-order`. Their page windows and cached selections are distinct.
Compact branch labels show the final path component while the tooltip retains the full reference.

General also exposes the existing automatic-fetch switch, a fetch-tags default and opt-in recursive
submodule update after checkout. Child updates reuse P09's snapshot, dirty-path, topology, queue and
transport policies. A refused/failed child update does not undo or misreport the successful parent
checkout; its message directs the user to inspect Submodules/Activity. Automatic updates start disabled.
Fetch-tags defaults to the application's previous behavior, not an inferred Fork factory setting;
explicit Fetch can override it, while background fetch reads the saved preference.

Commit provides subject guide/warning limits, page-guide column, spelling, monospace font and an
optional reviewed Push handoff. Commit and Push is implemented in the composer and with
Ctrl/Cmd+Shift+Enter. Only a successful commit on the unchanged attached branch opens Push; Cancel
leaves the new local commit and the remote untouched. This explicitly reviewed handoff is a Linux
adaptation of the captured automatic-push preference, not a claim of identical Fork automation.

Git includes executable/version diagnostics, next-startup executable selection, global identity and
verbose operation output. Verbose output records bounded executed operation commands through Activity's
existing credential redaction; it does not enable arbitrary Git trace output. Signing-key, commit/tag
signing defaults and commit-template path can be edited under the expandable defaults group. Repository
Settings exposes the same named defaults at repository scope. Effective value/scope/origin remain visible;
inherit/blank removes only the chosen file's override. Optional fields preserve older save requests.
These writes use the existing Git-lock-compatible snapshot and atomic config transaction. Key creation,
passphrases and signing execution remain with Git's agent and the P10 workflow.

Accounts remains the P11 panel. Integration and Custom Commands now embed their working editors in
Preferences. The independent File-menu entry points also remain. Shortcuts offers recorded bindings for
15 primary workflows, with duplicate/reserved-key validation, per-action Reset and Restore All. Custom
bindings use Mod+Alt+letter, optionally Shift; editing/navigation and native accelerators are reserved.
One resolver feeds menu labels, Quick Launch hints, accessibility labels and matching handlers.

Custom commands add Wait for Exit and Always Show Output. Foreground runs may show output only on
failure; background runs close the review after acceptance and remain cancellable in Activity. Process
supervision, the five-minute/64-KiB bounds and owner-close cancellation remain in force. The version-1
sharing format preserves these optional fields; imported commands remain disabled. Tool defaults are
saved per kind, with Ctrl/Cmd+D for the selected working/historical diff and Ctrl/Cmd+Alt+T for a terminal.
Console now opens configured terminal actions; Ctrl/Cmd+Alt+O reaches the existing file-manager handoff.
Saved definitions and revisions stay main-owned. Default changes invalidate stale tool reviews.

Quick Launch continues to project implemented menu actions and use the captured command → parameter →
review flow. Workspace, tool and command entries participate through the same callbacks. Lean Branching
retains its independently specified local Start/Sync/Finish and P06 recovery policy; the explicitly chosen
base now persists per repository. Missing bases remain an actionable selection state, not a silent retarget.

## Retention and acceptance matrix

| State                                              | In-session behavior                                                                      | Normal restart / display change                                  | Evidence                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Tabs, order, active repository and repository list | Separate per workspace; repeated open/close and tab switches                             | Restore saved workspace tabs; missing paths retain Recovery      | P02 scenarios and P12 workspace test; tab-store migration tests |
| Selected commit and detail tab                     | Existing per-open-tab retention; an already open workspace keeps its window              | New/reopened window selects HEAD and Commit                      | P02/P03/catalogue scenarios, P12 restart assertion; P2-015      |
| Pane sizes and saved layout                        | Five explicitly scoped dimensions; keyboard splitters; Save/Restore/Reset                | Restore persisted sizes, clamped to available viewport           | P12 saved-layout test; existing splitter/125% graph tests       |
| Window geometry                                    | Each workspace owns its window-state file                                                | Existing workarea/off-screen recovery; compact toolbar at 880 px | Window lifecycle/bounds tests and P02 narrow-window assertion   |
| Diff target/line anchor and hunk focus             | Existing P04 target/session behavior preserved                                           | No new promise to restore stale diff content                     | Catalogue changes/interaction/P04 scenarios                     |
| Drafts and interrupted Git operations              | Drafts remain keyed by canonical repository; shared across windows using that repository | Drafts and Git/recovery journals survive                         | P12 draft assertion; P02/P06/P07/P08 restart scenarios          |
| Presentation, shortcuts, tools and custom commands | Profile choices propagate to windows; menus follow saved revisions                       | Versioned preferences and explicit migrations retain choices     | P12 and F32/F33/F34 UI tests; preload cleanup tests             |
| Global/local Git settings                          | Frozen destination, effective origin, Save/Cancel, stale-write checks                    | Git owns inheritance; linked worktrees share common config       | F34 unit/UI tests and P12 defaults tests                        |

All tests use disposable repositories/profiles; Git outcomes are asserted independently. No private
reference image, Fork binary, bundled asset or historical capture harness is shipped or executed.

## Reference comparison

Primary catalogue, Windows 2.22.0.0, captures 2026-09-19/20; high confidence for the bounded visible states:

- `P0-008-toolbar-dropdown-subcase:F3`: Workspaces heading, Home/Work/checkmark and Configure;
  `P0-005-tab-sidebar-subcase:F1`: additive named repository list. Workspace storage/window semantics
  are independently specified because the catalogue did not exercise configuration/switching.
- `P0-013-general-git-subcase:F1–F4`: General and Git inventory, compact tabs/groups and no-edit Git
  invariance. Original PNGs/UIA and `batch02-resume/git-verification.json` were inspected. Visible
  settings do not prove defaults. General keeps bounded scrolling at the supported Linux minimum.
- `P2-008-create-execute-remove-subcase:F1–F5`: custom editor, action types, script, checked wait/output,
  completion and removal. Original case and `continuous10/custom-comparison.json` retain all 13 unchanged
  Git outputs. Unchecked wait/output modes and our JSON/variable conventions are independent policies.
- `P2-009-configuration-subcase:F1`, `P2-009-custom-viewer-subcase:F1–F4`: grouped external tools,
  Name/Path/Arguments, Ctrl+D and exact historical `$LOCAL`. Original case, screenshots and
  `continuous10/integration-comparison.json` distinguish historical content from checkout bytes.
- `P1-032:F1`, `P0-012:F1`, `P2-012:F1`, `P2-013-small-clipping-subcase:F1–F3`,
  `P2-015-layout-selection-restart-subcase:F1–F3`: command/parameter flow, view keys, theme, constrained
  sizing and limited restart behavior. Linux preserves keyboard escape and reachable controls.

Public supplements, accessed 2026-10-01: [Quick Launch](https://fork.dev/blog/posts/quick-launch/)
(2019-10-23, Mac/Windows), [Windows shortcuts](https://github.com/fork-dev/Docs/blob/master/keyboard-shortcuts-windows.md),
[Windows release notes](https://fork.dev/releasenoteswin) (source folders 2.15, verbose output 2.16),
[Lean Branching proposal](https://github.com/fork-dev/TrackerWin/issues/1432) (2022-01-20; proposal,
not execution proof), [Git log ordering](https://git-scm.com/docs/git-log) and
[Git configuration](https://git-scm.com/docs/git-config). The restored public library contains 226 files;
the Windows Commit screenshot from [TrackerWin #2808](https://github.com/fork-dev/TrackerWin/issues/2808)
(2026-06-22, version unstated, light) supplements guide/spelling fields. The latest Windows 2.23 notes
do not replace the private 2.22.0.0 baseline. No new public image was downloaded or added to the manifest.

Implementation captures are under ignored `test-results/p12-*.png`, alongside the existing F31–F34 and
P02/catalogue captures. They compare light/dark General, embedded editors, workspace configuration,
shortcuts and narrow layouts. Independent assets and the application's existing theme tokens are retained.

## Verification and remaining limits

Final verification, 2026-10-01:

- `npm run check`: type checks, lint, formatting and 670 tests pass; six existing skips.
- `npm run build`: all production bundles pass; existing dependency annotation/chunk-size warnings remain.
- Full headless Electron suite: 80 passed, three existing opt-in skips, no failures or automatic retries.
- After final Preferences and tool-target corrections: all 13 affected desktop scenarios pass, including
  startup/preload isolation, F31–F34, P11 and the two P12 scenarios. The last General-page sizing correction
  passes the three settings/workspace scenarios on the final build.
- `git diff --check` passes. Light/dark and narrow captures were inspected against the original references.

The first full run recorded 78 passes, two failures and three skips: an 880-pixel toolbar overflow and
a test shortcut sent before the reloaded workbench mounted. The original zero-overflow and Git assertions
were retained. Test development also corrected implicit-label and duplicate Cancel selectors. Repeated
workspace-window cycles found a real last-active-workspace restoration error; closing another main
window now persists the remaining active workspace and quit waits for that metadata write. Review found
Ctrl+D could reuse a Changes selection while File Tree was active; the final scenario switches to a
different historical file and verifies its exact content. Dialog footer/field layout was then compared
again; controls remain accessible with one scrollable page and a visible Close action.

No acceptance criterion remains unverified within the documented Linux policies. Native tests below
are not inferred from the headless results, and the retained bounds are not blanket Fork parity claims.

Native Windows/macOS execution, real GUI tool daemon behavior, forced-crash cleanup, screen readers and
physical Wayland frame/display transitions remain P14 verification gates. Headless geometry/zoom checks
do not claim those results. Updates belongs to P14 and is not exposed as a functioning preference page.
Remote avatars, arbitrary key remapping, Fork-format imports, remote-ref restoration in Lean Branching,
unrestricted binary merge output and unobserved Fork defaults remain outside this independently specified
Linux implementation. The captured current-setting values and public-only variants retain their unknowns.
