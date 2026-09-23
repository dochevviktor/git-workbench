# P04 — Working changes, diff, staging and commits

Date: 2026-09-23. Target: Linux, independently implemented from the supplied Fork Windows
2.22.0.0 catalogue. This record covers the five P04 requirements and four acceptance criteria;
it does not promote other phases or claim exhaustive Fork parity.

## Implementation and acceptance

| Requirement               | Implemented behavior and verification                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status and selection, F08 | Separate index/worktree rows, conflicts, rename/copy and mode metadata, tree/list, multiple selection and visibility counts. Showing ignored files while hiding untracked files now uses a valid Git status request and filters untracked records separately. `working-tree-service`, `changes-catalogue`, `p04-changes` and conflict-editor tests cover the states.                                                                                                                              |
| Text review, F09          | Unified/split diffs, inline changes, search, whitespace/symbol controls, entire-file view, unified wrap, linked popup, bounded Load Diff and paired binary fallback retained. Syntax colors and paired old/new line numbers are added; context buttons now change one line (3 → 4 → 3). Diff/session options are released on tab close. `diff-service`, `diff-syntax`, `changes-catalogue` and `p04-changes` verify them.                                                                         |
| Staging, F10              | Whole-file batches and exact-snapshot hunk/line actions remain backend-owned. Text dragging now selects added/removed lines and the inline action applies that selection. Keyboard-accessible checkboxes remain available on hover/focus. Reverse selections keep unselected new lines as context; partial additions/deletions retain the appropriate file; textual selections leave rename/mode metadata alone. Staging an edit after a staged rename cannot include a new file at the old path. |
| Commit/amend, F11         | Drafts, messages/templates, identity diagnostics, hooks and explicit failure recovery, published-amend warnings, read-only amend preview and merge-parent preservation remain. New detached commits now also show their warning. The compact composer puts Amend left and Commit right, with Signing and Generate Message in Commit options. Hook bypass is offered after a hook failure.                                                                                                         |
| Safe discard, F10         | Exact file/hunk/line preview, Cancel invariance, snapshot revalidation, tracked Recovery copies and unrelated-work preservation remain. Selected-line preview also checks the original selection snapshot. A selected addition can be discarded independently of its paired deletion. A renamed file is restored at its index path; its former name is not an implicit target. Untracked/ignored deletion is not offered.                                                                         |

Independent Git assertions cover index blobs, worktree bytes and committed trees, including partial
staging in an already partially staged file, insertion-only intermediate state and inverse, repeated
selections, CRLF and missing final newline, rename, deletion, symlink, binary and executable-bit changes.
The whole-file matrix now also commits the exact staged tree and unstages the same set without changing
working bytes. Empty commits, stale staged snapshots, failing/rewriting hooks, templates, root and merge
amend remain covered by `commit-service.test.ts`. All mutations run only in disposable repositories.

`p04-changes.test.ts` uses real pointer text selection, verifies exact end-of-line selection boundaries,
insertion-only staging and its inverse,
checks selected-line Cancel and an external edit after preview, verifies a successful selective discard,
and checks retained subject/body/file selection after a hook failure and successful explicit hook bypass.
`changes-catalogue.test.ts` retains the full-file middle-hunk viewport/focus, file/view/repository switches,
popup selection/independent layout, horizontal scrolling, wrap, large-load/search, binary and amend/cancel
checks. Existing interaction/conflict/signing scenarios exercise shared viewers and commit behavior.

## Evidence and design comparison

Primary evidence: original case JSON, linked PNGs and Git records in the unchanged private bundle.
Captured Windows 2.22.0.0, 2026-09-19–20, 96 DPI; high confidence for the bounded observed states.
Relevant dossiers P0-014–032, P2-004/P2-007/P2-016 and the catalogue design/alignment guides were reviewed.

| Case/finding                                                                           | Original evidence and comparison                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P0-014:F1–F2`, `P0-015:F1`, `P0-016:F1`, `P0-017:F1`                                  | `evidence/20260919T131346_409195Z_acceptance-working-tree-before_c0a0cd/screen.png`: vertical file panes, diff to the right, compact composer below; duplicate partially staged path and side-specific actions. New default file-column width is 280 px; existing saved widths are retained.                                                        |
| `P0-022:F1–F2` and inverse subcase                                                     | `evidence/20260919T142223_458178Z_batch05-line-selected_487168/screen.png`, `batch05-lines/git-verification.json` and staged/unstaged patches prove the old line remains alongside the selected addition. Native text selection now reaches that same intermediate index state. Reverse replacement variants are independently verified extensions. |
| `P0-023:F1`, `P0-023-hunk-subcase:F1`                                                  | File/line confirmation, Cancel and unrelated-work preservation. The existing exact preview and retained Recovery copy are deliberate Linux protections beyond the compact captured confirmation.                                                                                                                                                    |
| `P0-025-untracked-toggle-subcase:F1–F3`                                                | Visibility/menu/header/count states, with unchanged Git. The combined hidden-untracked/shown-ignored setting is an independently verified extension of the captured separate toggles.                                                                                                                                                               |
| `P0-026:F1`                                                                            | Rename-only empty diff, removed text and paired binary metadata retained. Broader codecs remain P10.                                                                                                                                                                                                                                                |
| `P0-027-whitespace-context-wrap-subcase:F1`                                            | `evidence/20260919T194500_502102Z_continuous08-diff-context-increase_f800d4/screen.png` and `continuous08/git-verification.json`: one context-line increment/decrement; whitespace and wrap do not mutate Git.                                                                                                                                      |
| `P0-028-scroll-persistence-subcase:F1–F4`, `P0-032-scroll-focus-staging-subcase:F1–F3` | In-session anchors, selected side and post-stage focus. Retained large-diff virtualization and bounded splitters are project implementations.                                                                                                                                                                                                       |
| `P0-029:F1`, `P0-030:F1`, `P0-031-cancel-subcase:F1`, `P0-031-submit-subcase:F1`       | Empty/ready/committed form, read-only amend/cancel and message-only merge amend. `continuous01/verify-commit.json` and original merge-amend case/PNG/Git records establish the captured scope.                                                                                                                                                      |

The public reference library was restored with `npm run research:references` (226 existing assets,
zero failures) and browsed by topic. [Windows 1.38](https://fork.dev/blog/posts/forkwin-1.38/)
(2019-08-27) supports inline search/split review; the [Windows release notes](https://fork.dev/releasenoteswin)
(2.20, 2026-06-05; accessed 2026-09-23) document token-oriented inline highlighting and pane improvements.
These are high-confidence public descriptions, not a specification of Fork's tokenizer or exact colors.
No new public screenshot was needed and no private image was copied into the application.

Before: the original changes-catalogue scenario passed and its captures were retained at
`/tmp/git-workbench-p04-before-20260923/`. Comparison exposed missing syntax colors, permanently visible
checkboxes, missing old line numbers, three-line context increments, and a crowded composer.
After: the same catalogue captures and `test-results/p04-changes-*/p04-light.png`, `p04-dark.png`,
`p04-hook-failure.png`, `p04-narrow.png`, `p04-narrow-light.png` document the corrected states.
The 880×600 checks exercise the bounded divider and ensure the composer remains usable.

Deliberate adaptations: labelled search/layout controls, explicit keyboard line checkboxes, a 280 px
initial file column, bounded composer scrolling, Signing/Generate Message in Commit options, retained
pane preferences and richer discard preview/Recovery. Exact Fork fonts/colors, pristine defaults,
Combined List behavior, cross-restart diff anchors, full native focus cycles and Windows/macOS behavior
remain unclaimed. Native window-frame/move/resize code was not changed.

## Resource and scope limits

Syntax rendering is an independent lexical colorizer for JS/TS, C-family/Java/Kotlin/Go/Rust/Swift,
Python, JSON, CSS, shell, YAML and SQL extensions. It emits React text spans, never HTML or evaluated
repository content. Each hunk has separate before/after multiline state; omitted context is not inferred.
Unsupported formats remain plain text. Coloring stops at 1,000,000 characters or 100,000 token ranges;
logical lines over 16,384 characters stay plain. This is lexical assistance, not a complete language parser.
Search, inline-change highlights, hidden characters and selection retain original text/offsets.

The existing 512 KiB/10,000-line initial diff gate, explicit 8 MiB cap, cancellation and 600-row large-hunk
viewport remain. Text selection is within one hunk. File discard previews accept at most 100 tracked
files/8 MiB and require a successful Recovery copy; backup failure refuses the discard. Untracked and
ignored files are never silently deleted. Broader image formats/signing platform coverage remain P10;
commit-and-push remains P05. Public assistance variants such as sign-off/co-author autocomplete and
prepare-commit-msg drafting are not asserted as implemented by the five P04 requirements.

No new IPC channel, renderer privilege, dependency or application asset is introduced. Existing runtime
validation, sender/frame/owner checks, mutation queues, trust, CSP and sandbox remain in place.

## Verification

`npm run check`: **518 tests pass**, one existing opt-in benchmark skip; type checks, lint and
formatting pass. Production build passes. The full headless Electron run executes 44 scenarios:
**38 pass, two opt-in skips, four failures**. P04, catalogue changes, desktop smoke, conflict editor,
image diffs, interaction corrections, signing and AI all pass. The final rebuilt focused run passes
P04, catalogue changes and both history workflows; it retains the Quick Launch and Bisect failures
(four pass, one opt-in skip, two fail). No full-suite green result is asserted.

Failures: catalogue history initially remained at 100/200 rows (passes focused rerun); P03's history
anchor moved 914 px (passes focused rerun); Quick Launch reports zero/two file options; Bisect sometimes
does not display its banner after Start. An untouched archive of starting commit
`5b5637f98f4713131a2898eecaf1b6cf44cdcaa4`, built with the same lockfile/dependencies at
`/tmp/git-workbench-p04-baseline-xl8MQw`, reproduces the identical 914 px history-anchor and Quick Launch
failures. A bounded three-run baseline Bisect check reproduces its missing banner once and passes twice.
These are not claimed fixed by P04. Baseline traces remain in that directory's `test-results/` and
`bisect-repeat/`; final working-tree focused results remain in `working-results/`. Full-suite traces
and comparison screenshots remain in this checkout's ignored `test-results/`.

The final selection-boundary regression first reproduced an unwanted second selected line when the
range ended at that line's first character. Clipping the native range to each line's actual text fixes
that case. After the correction, a fresh production build and all three P04/catalogue/interaction
scenarios pass (14.8 s); their traces and captures are under the baseline directory's `final-p04/`.

No P04 acceptance criterion remains unverified for the stated Linux baseline. Native Wayland framing,
moving/resizing, other operating systems and the P14 accessibility/scaling matrix were not changed or
reverified. No desktop window was opened; tests used the normal sandboxed headless Electron route.
