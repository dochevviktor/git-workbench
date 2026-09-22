# F36 patches — 2026-09-22

Implemented the bounded patch workflow: Repository > Apply Patch… uses a native file picker and
applicability dialog; Apply Patch from Clipboard… and Ctrl+V (Cmd+V on macOS) use the same preflight.
Paste in an editable field remains ordinary text editing. Apply stages changes without creating a commit.
Existing commit, stash and selected-working-file Save as Patch routes now offer a Create Patch dialog
with File and Clipboard destinations. Text diff context menus also offer Copy as Patch.

## Reference and adaptations

- `P2-005-mixed-patch-preflight-subcase:F1–F4`, captured 2026-09-20, Windows 2.22.0.0:
  location, applicability, Apply/Cancel, unchanged preflight/Cancel state, and byte-identical staged
  add/edit/rename outcomes. High confidence from original case JSON, screenshots 0471/0473/0476/0477,
  before/applied manifests and `evidence/continuous15/git-verification.json`.
- `P2-005-import-subcase:F1`, captured 2026-09-19: conflict warning, three-way application,
  malformed-input failure and unchanged original patch. `P2-005-export-subcase:F1` establishes
  revision confirmation followed by a native Save dialog and format-patch metadata. Original case
  JSON and export screenshot 0461 were inspected. High confidence within the recorded trials.
- [Windows release notes](https://fork.dev/releasenoteswin), accessed 2026-09-22: version 2.17
  (2026-03-13) documents clipboard paste/preflight; 1.85 (2023-05-26) documents diff Copy as Patch.
  [Mac release notes](https://fork.dev/releasenotes), accessed 2026-09-22: 2.64 (2026-03-06)
  documents Cmd+V. These are documented routes, not new black-box observations.
- [Git apply](https://git-scm.com/docs/git-apply), accessed 2026-09-22, supports the independent
  implementation choice of index checking and three-way application without a commit.

Linux follows the Windows field/button ordering and compact 590px maximum width, using existing
application chrome and independently authored icons. The clipboard selector, explanatory subtitle,
read-only source location and expanding error area are adaptations. There is no file/content preview
in the import dialog. Invalid/unsafe patches disable Apply rather than reproducing Fork's enabled
malformed-input action. Warning-state Apply remains available and attempts three-way application.
The export confirmation identifies the exact commit/stash ID or selected path count; it does not
replicate Fork's revision list or Git-version footer.

## Boundaries and behavior

The named preview/apply/release/copy capabilities use strict shared schemas, the explicit preload API,
existing sender/frame checks and repository ownership. Inspectors cannot invoke them. Main owns native
dialogs, clipboard reads, file bytes and Git arguments. Imported bytes never cross to the renderer;
it receives a location, state, bounded diagnostic and random one-use token. No shell executor is exposed.

File ingestion accepts regular files up to 8 MiB. Git parses patch paths; original headers and parsed
paths are checked for absolute/traversal/Git-metadata paths and existing symlink components. Git-formatted
headers require relative a/ and b/ prefixes. Symlink/submodule changes and multi-commit format-patch
mailboxes are explicitly rejected. Newline/backslash path names are outside the supported slice.
Up to 1,000 changed files and sixteen prepared/in-flight previews are supported; tokens expire after
ten minutes and are released on Cancel, replacement, tab/window close or service disposal.

The token binds immutable source bytes, owner, repository and the existing HEAD/local-change/pending-
operation snapshot. Later file/clipboard edits do not change the reviewed payload. Apply revalidates
the snapshot and path checks inside the common-directory mutation queue. Work uses the existing
operation registry, bounded output, cancellation and a two-minute Git deadline. Source files are never
rewritten. The dialog can close while a job is running; Activity retains its terminal result.

Clean applications stage the input. Three-way conflicts produce a failed job with Git diagnostics and
unmerged index entries available to the existing conflict helper. Resolve and stage them, then commit
explicitly. Git apply creates no sequencer and therefore has no dedicated Continue/Abort operation;
there is no automatic rollback or retry. Pending sequencers and existing conflicts block a new import.
Concurrent external Git writers remain governed by Git's locks and native refusal semantics.

File exports preserve raw bytes, including CRLF and non-UTF-8 content. Clipboard export requires UTF-8
and reports when a file destination is necessary. Root commits export their actual additions; merge
commits are explicitly refused until parent selection is implemented, avoiding format-patch's ancestor
substitution. Generated exports fix a/b prefixes and disable external diff/textconv. Diff Copy as Patch
copies the currently displayed text patch, including its context/whitespace settings, up to one million
UTF-16 code units; binary/oversized/unloaded text and decoding-error content are unavailable there.
Use File export for raw bytes or the broader 8 MiB bound.

## Verification

Disposable-repository tests cover exact mixed staged patch/index/worktree results, HEAD/ref/reflog
invariance, Cancel, stale and cross-owner tokens, one-use/closed-tab tokens, repeated application,
unsafe and malformed paths, three-way conflicts, binary addition/deletion, header-like hunk text,
CRLF/non-UTF-8 bytes, root export and merge-export refusal. Bridge tests validate both directions and
inspector denial. All Git mutations are confined to owned temporary fixtures.

The headless F36 Electron scenario covers native-file selection through a test picker, Cancel,
file/clipboard staged application, Ctrl+V, invalid-input disabled Apply, Escape, diff Copy as Patch,
commit clipboard/file export and a narrow dark dialog. Native picker interaction itself is stubbed;
real OS clipboard and application handlers are exercised.

Final gates: `npm run check` passes 438 tests with one existing skip; `npm run build` passes.
`npm run test:e2e` has 26 passes (including F36 and the isolated-preload desktop smoke), one opt-in skip,
and three existing `review-workflows.test.ts` failures. All three reproduce with identical assertions
in a separate detached worktree at unchanged baseline `e38c344`:

- Line 193: externally added upstream option does not appear within the polling deadline.
- Line 263: saved stash row is not visible after toggling the Stashes group.
- Line 331: the expected rebase menu item does not appear after external checkout.

The F36 test also passes independently after adding export capture, with artifacts under
`test-results/f36-final/`. These results verify this bounded feature; they do not declare the full
Electron suite green or change the unrelated workflows.

Compared original screenshot
`fork-reference-new/evidence/continuous15/20260920T050006_856066Z_patch-selected_fcee0d/screen.png`
with `test-results/patch-F36-file-and-clipboa-87362-ly-invalid-input-and-export/f36-preflight-light.png`.
The generated `f36-invalid-narrow-dark.png` verifies visible controls at 760×640. These generated images
remain local test artifacts; private reference images are unchanged and not application assets.
The final `f36-export-dark.png` was compared with original export screenshot 0461: the source summary
and destination selector are deliberate adaptations to the captured revision-confirmation dialog.

Remaining limits: multi-commit mailboxes, merge-parent export selection, symlink/submodule imports,
exotic filenames, arbitrary non-Git prefix conventions, binary-conflict resolution, dedicated patch
rollback, and native macOS/Windows/Wayland clipboard/picker coverage. Binary round-trip tests establish
independent behavior, not Fork binary-patch parity. P08 remains partial for its broader criteria.
