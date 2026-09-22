# F32 — contextual custom commands — 2026-09-22

Implemented a bounded Linux workflow: File → Custom Commands manages profile-owned definitions;
enabled commands appear in the Repository menu and commit, branch, Local Changes file and submodule
context menus. The Repository menu also supplies repository commands to existing Quick Launch.
Definitions support Bash Command, Start Process and Open URL, optional text/branch/file input forms,
explicit review, supervised output/cancellation, native JSON import/export, editing and confirmed removal.
General Preferences remains F34; external editor/historical-blob adapters remain F33.

## Reference and independent decisions

Primary: Windows 2.22.0.0, captured 2026-09-19, reviewed 2026-09-22:
`P2-008-create-execute-remove-subcase:F1–F5` and `P2-008-menu-subcase:F1`. The original cases,
screens 0497–0506 linked in the dossier, before/after manifests and `custom-comparison.json` establish
the five targets, three action choices, repository-menu placement, Bash editor, completion Details,
removal confirmation and 13 unchanged Git records. Confidence is high for those observations only.
The capture does not establish forms, variable substitution, nonzero exits or asynchronous execution.

The [Windows release notes](https://git-fork.com/releasenoteswin), checked 2026-09-22, document
UI text/branch/file controls in 1.85 (2023-05-26) and shared-definition/variable changes in 1.84
(2023-04-28). These establish feature families, not exact execution semantics or an import schema.
Existing restored references `win-2026-06-22-trackerwin2807-1-preferences-dark.png` and
`mac-2026-05-12-tracker2629-1-preferences-light.png` supplement the action/form presentation;
their versions are unstated, and the latter is a macOS reference, not Windows evidence.
No new public image was downloaded; `npm run research:references` restored the existing index.

Independently specified Linux behavior:

- The dedicated manager combines the captured list, target/name, action editor and variable help.
  Input controls are inline; no unimplemented Preferences tabs or UI/Action radio modes are presented.
  Save commits a draft, Close discards unsaved edits. Imports append disabled copies with new IDs.
- Up to 100 commands, eight inputs, 64 process arguments, and a 2 MiB profile/import file. Version 1
  `git-workbench-custom-commands` JSON is our sharing format; Fork JSON compatibility is not claimed.
  No repository file is discovered or executed automatically. Import uses explicit native selection.
- Commands run in the canonical selected repository path. Commit targets are exact object IDs;
  branch targets resolve existing full refs; file/gitlink paths are checked against Git's index/untracked
  listing. File commands explicitly refer to a working path, not historical blob contents.
- Process arguments are a JSON array passed directly without a shell. `${repo:path}`, `${repo:name}`,
  `${git}`, `${sha}`, `${sha:abbr}`, `${branch}`, `${file}`, `${file:name}`, `${submodule}` and
  `${input:1}` (through 8) expand only when available. URL values are percent encoded; final destinations
  must be HTTP(S), without embedded credentials.
- Bash uses quoted environment values, e.g. `"$GW_REPO_PATH"`, `"$GW_INPUT_1"`; there is no textual
  insertion into shell source. This intentionally differs from Fork's template syntax. The editor
  explains the distinction. Scripts remain authored programs with the user's permissions, not a sandbox.
  They must handle their own Git semantics, option terminators, sensitive output and recovery.
- Branch form values are full refs with resolved tips checked again before execution. File form values
  resolve to existing files, relative to the repository if typed. Inputs are transient, not persisted.
- Every invocation reviews the working directory, expanded action and Bash environment values. The
  resulting five-minute, one-use token is owned by the window and bound to the saved revision, enabled
  state, repository identity/HEAD, selected ref and input-branch tips. Stale plans require fresh review.
- All process commands wait for exit and display combined stdout/stderr as inert text. The app supervises
  the process group with a five-minute timeout and 64 KiB captured-output limit; cancellation sends TERM
  then KILL. Closing the output dialog keeps the job in Activity; closing its owner cancels it. Deliberately
  detached external daemons are outside the lifecycle guarantee. Cancellation never promises rollback.
- Custom work shares the common-Git-directory mutation queue. Window/frame authorization and inspector
  denial apply to every capability; run accepts a token, never a command string. The child environment
  excludes inherited Git redirection, shell startup hooks and arbitrary application environment values.
  Profile writes serialize, use private atomic files, reject stale edits, and preserve corrupt stores.

## Verification

Final checks: `npm run check` passes 394 tests with one existing skip; production `npm run build`
passes. The F32 headless Electron scenario and `tests/e2e/desktop.test.ts` startup/isolation smoke pass.

`tests/unit/custom-commands.test.ts` uses temporary repositories and verifies captured read-only output
plus unchanged refs/index/status, persistence, disabled import/export, stale edits/preview ownership,
HEAD changes, all five context resolvers, invalid paths, branch/file inputs, literal unusual values in
Bash/argv, URL validation, process failure, stderr, output bounds, timeout, cancellation, linked-worktree
serialization and queued-owner cleanup. Runtime schemas reject extra execution payloads and inspectors
deny the new channels. Existing preload/routing tests remain applicable.

`tests/e2e/custom-commands.test.ts` exercises the real isolated Electron bridge: author without a
repository, save/enable, menu/review/run, visible output, native import/export selection, removal Cancel
and confirmation, required text inputs and injection-like literals, nonzero exit, cancellation, URL
handoff, editing to Start Process, and restart without automatic execution. Native dialogs/browser
handoffs are mocked; command execution and Git checks are real and local. The desktop smoke scenario
checks the exact expanded capability surface and isolation.

Local screenshots (git-ignored): `test-results/f32-editor-light.png`, `f32-editor-dark.png`,
`f32-editor-narrow.png`, `f32-output-light.png`, `f32-form-preview.png`. Compared before/after against
the original Bash/editor/output states and restored public dark/form references. The list/editor/help
relationship, target/name/action fields, multiline script, Details output and confirmation flow are
retained. Inline editing, explicit enabling/review, no artwork, responsive scrolling, and the dedicated
File-menu entry are deliberate adaptations. A shared 460px dialog rule initially clipped the editor;
the final selectors override it and the Electron test asserts full width and no narrow horizontal overflow.

## Remaining parity limits

F32 is verified only within this explicit workflow; P12 remains partial. Unchecked Wait for Exit,
hidden-output mode, nested menu names, native shortcuts, complete Fork variable aliases and JSON import
compatibility are not implemented. Context-menu integration for historical file paths is deferred to
the external-tool/historical-content specification; Local Changes is the file entry point. Full GUI
execution for every commit/branch/submodule combination, macOS/Windows process execution, fractional
scaling, multi-display and native Wayland interaction remain unverified. General settings and command
palette parameter routing for non-repository custom commands remain separate work.
