# P06 — Merge, conflicts, stashes, and recovery (2026-09-24)

This handoff covers the Linux P06 requirements: F15 stash workflows, F16 ordinary merge/rebase,
F17 conflict resolution, F19 single-commit cherry-pick/revert/reset, and the recovery required by
non-fast-forward Pull. Interactive-rebase planning remains P07; Lean Branching remains F38/P12.
The earlier F17/F19 handoffs describe their historical bounded slices. This record supersedes their
P06 limitations where implementation and verification are explicitly described below.

The four P06 requirements and five acceptance criteria are complete for the Linux phase scope below.
This is not a claim of native Windows/macOS verification or full Fork parity.

## Delivered behavior

- Merge retains independent Default/No Fast-Forward/Squash/Don't Commit paths. Compact merge/rebase
  dialogs now predict conflicts through bounded Git tree simulations. They bind execution to the
  reviewed source object, including remote-tracking references which can change during fetch.
  Cherry-pick/revert previews use the selected mainline parent. A prediction never checks out files,
  stages content, moves references, or starts a sequencer. Unavailable, complex or over-budget
  predictions say that conflicts will be checked when the operation starts.
- Recovery sits above the workspace, with the actual operation, Resolve, Continue, supported Skip,
  and an Abort/Cancel dialog. Git's rebase state takes precedence over replay markers; external
  cherry-pick/revert sequences are also detected through their todo. Ordinary rebase continuation is
  available from the composer. Only an actual interactive Edit action enables the amend workflow.
  Continue does not pretend that a failed process completed its remaining Git operation.
- Local Changes shows unmerged files only in Unstaged. Incoming/current side cards offer direct
  selection or the built-in helper. The helper has incoming content on the left, current/base content
  on the right, and an editable result below, with source highlighting, region navigation, resolution
  count, reset choices, and disabled Resolve while markers remain. The 1020×720 preferred workspace
  adapts to smaller windows. The former global 460-pixel dialog-width override is corrected.
- Text supports add/add, delete/modify, multi-region, empty-side, CRLF, diff3 and custom-width markers.
  Per-region choices preserve surrounding merged text; Both inserts incoming then current content.
  Missing stages mean deletion. Rename/rename is represented by its actual index paths, with a previous
  path where the stage relationship is unambiguous; each remaining path must be resolved explicitly.
  The model does not invent a rename relationship from an ambiguous identical blob.
  Nested rename entries remain resolvable when the old directory is gone; source restoration creates
  only the required, checked parent directories. Symbolic-link choices preserve raw target bytes.
- Binary and symbolic-link conflicts require an explicit source/deletion choice. Binary working-file
  staging is explicit; zero text markers never resolves a binary conflict automatically. Submodule
  choices stage the selected gitlink or the inspected checked-out commit without moving the child
  checkout or discarding its local work. Conflicts can subsequently be committed/continued or aborted.
  Existing external merge tools return reviewed text results, including missing-side text conflicts;
  configured editors can edit binary worktree files, followed by Refresh and explicit staging.
- Resolution uses a queryable background operation, preserving progress and cancellation beyond the
  preload deadline. Closing its helper after submission leaves the accepted operation in Activity.
  A cancelled stage restores the prior text only if the index is still unmerged and the worktree still
  contains the submitted text. It does not put markers back after an index write already succeeded.
  Resolve changes files/index; Commit or Continue remains a separate history operation.
- Stash saves all files, selected files, selected hunks, or selected lines. File selections are literal,
  including brackets, and include both paths of a rename. A temporary index prevents native
  path-limited stashing from including unrelated staged entries. Stage new files retains the captured
  two-parent/index-parent semantics. Unselected index/worktree content stays in place.
  An unborn repository is refused before Stage new files can change its index.
- Hunk/line stashes contain only the selected change and preserve whether it was staged. An unstaged
  selection based on an already-modified index uses a synthetic base commit for that file's index
  context; this avoids including the preexisting staged change in the stash delta. The result is a
  normal Git stash with two parents, inspectable/applicable by Git. It is an independent extension,
  not an assertion about Fork's unobserved line-stash internals. A save is published before selected
  content is removed; a later failure retains the stash and reports the remaining work for review.
- App-started stash/recovery applications journal source, HEAD and exact affected paths before running.
  Restart retains stash-specific side labels and Finish/Abort. Abort restores only affected paths,
  retains preexisting untracked files and unrelated edits, and never drops the stash. A conflicted
  pop is retained. A concurrent stash-list change prevents automatic pop deletion. Active-application
  and Recovery stashes are protected against ordinary delete/rename/pop. Rename and inspection remain
  available for ordinary entries; patch import/export stays with the verified F36/P08 capability.
- No-commit cherry-pick/revert retains a native sequencer. Once its single selected commit is resolved,
  Continue clears that sequence without committing or replaying it again; Commit can instead record
  the reviewed result and clear its sequence. Empty committed cherry-picks have explicit Skip/Abort.
  Saved local changes are deferred while a no-commit result is staged. Both mainline parents are
  supported and tested; append-origin and author preservation remain Git-owned.
- Soft/Mixed/Hard reset preserve their distinct index/worktree effects, including reset to current
  HEAD. Hard reset retains a tracked Recovery copy and refuses untracked/ignored obstacles that native
  Git could overwrite. Reset does not recursively change submodule checkouts. The history menu now
  permits reviewing a reset to current HEAD so Mixed/Hard can act on local changes.

## Acceptance and independent Git checks

| P06 criterion                                                                  | Evidence                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resume or abort after interruption                                             | Fresh-service merge/binary/delete/add/rename/stash/no-commit tests; fresh Electron merge, binary and external-rebase launches; existing cherry-pick/revert/rebase recovery tests                           |
| Exact content, index stages, refs and operation files; preserve unrelated work | Independent Git reads of stage 0/unmerged stages, parent trees and HEAD; tests retain unrelated staged/unstaged/untracked files and dirty submodule checkouts                                              |
| Operation-specific sides                                                       | Merge/current, rebase base/replayed commit, cherry-picked, reverted and journalled stash labels; incoming-left/current-right Electron assertions                                                           |
| Binary resolution is explicit                                                  | Marker-free binary result initially has disabled Resolve; source choice stages exact bytes and clears unmerged entries; same-size external edits invalidate the review                                     |
| Four merge modes and broader text editing                                      | Existing `merge-modes.test.ts` asserts FF, two-parent No-FF/Don't Commit, and staged single-parent Squash/Abort; common parser and multi-region Electron choices verify the independent text specification |

The new regressions also cover mainline-parent selection, no-commit finish/commit/abort, empty-pick
Skip, same-HEAD reset, ignored/untracked hard-reset obstacles, selected-line stashes, literal filenames,
unrelated staged-stash exclusion, changed HEAD/content, cancellation, IPC validation and inspector denial.
All mutating tests use disposable repositories, never this checkout.

## Reference comparison and provenance

Primary reference: the supplied Fork Windows **2.22.0.0** catalogue, Windows 11, 96 DPI, captured
2026-09-19–20. Dossiers P1-006/P1-013–022/P1-025–027, original cases, linked screenshots, and Git
snapshots were read. Confidence is high for the stated captured observations, not unobserved variants.

Original paths below are relative to `docs/research/fork-reference-new/`:

| Cases/findings                                                  | Original screenshot / Git evidence                                                                                                                                                                                  | Comparison                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| P1-006:F1; No-FF/Squash/Don't Commit subcases                   | `evidence/continuous09/20260919T203457_677342Z_noff-merge-dialog_e54d94/screen.png`; `evidence/continuous10/nocommit-after/graph.txt`                                                                               | Compact rows/options, conflict prediction, independent parents/index/pending-state checks                              |
| P1-013-tracked-subcase:F1; stage-new-files-subcase:F1           | `evidence/20260919T152011_034567Z_continuous02-stash-save-dialog_7cd6a8/screen.png`; `evidence/continuous08/git-verification.json`                                                                                  | Optional message, initially unchecked Stage new files, two parents and new file in index parent                        |
| P1-014:F1; P1-015:F1                                            | `evidence/20260919T151932_421187Z_continuous02-stash-apply-dialog_e52488/screen.png`; `evidence/20260919T164428_144804Z_continuous06-stash-resolver_2c3e44/screen.png`                                              | Apply/delete-after-apply, retained conflicted stash, stash-left/current-right resolution                               |
| P1-016:F1; P1-017:F1; P1-018:F1; P1-019:F1                      | `evidence/20260919T150603_047320Z_continuous02-conflict-file_ac6293/screen.png`; `evidence/20260919T150616_254889Z_continuous02-resolver_3caf64/screen.png`; `evidence/continuous02/conflict-resolved/staged.patch` | Top banner, paired cards, wide two-input/result helper, disabled→enabled Resolve, exact staged result and later commit |
| P1-020:F1; P1-022 abort/continue/empty-result subcases          | `evidence/20260919T150959_478064Z_continuous02-abort-dialog_5b06cb/screen.png`; `evidence/20260919T155854_535599Z_continuous04-rebase-preflight_dc755d/screen.png`                                                  | Abort/Cancel, warning preflight, replay labels, composer Continue Rebase                                               |
| P1-025-success/conflict-continue; P1-026-success/conflict-abort | `evidence/20260919T153606_931650Z_continuous03-cherrypick-dialog_4180f9/screen.png`; `evidence/continuous10/20260919T212206_145597Z_revert-dialog_75231a/screen.png`                                                | Compact commit/options forms, preflight, operation-specific recovery                                                   |
| P1-027 Mixed/Soft/Hard subcases                                 | `evidence/continuous09/20260919T202608_645684Z_soft-selected_e0f04f/screen.png`; `evidence/continuous09/20260919T202851_551397Z_hard-selected_c8df77/screen.png`                                                    | Three reset modes and descriptions; retained project safeguards                                                        |

Supplementary public sources, accessed **2026-09-24**: the official
[Fork Windows 1.48 article](https://git-fork.com/blog/posts/forkwin-1.48/) (2020-05-05, high-confidence
documentation for selected-file stash and branch drag entry points), and official Git manuals for
[stash](https://git-scm.com/docs/git-stash), [cherry-pick](https://git-scm.com/docs/git-cherry-pick),
[revert](https://git-scm.com/docs/git-revert) and [reset](https://git-scm.com/docs/git-reset). Git's manuals
inform the independently specified index/sequence/safeguard behavior, not Fork UI claims.
`npm run research:references` restored the public topic index (226 existing images, zero failures).
No new public images were required. The private bundle is unchanged and none of its assets enter the app.

Before changes, headless captures showed a narrow resolver, reversed source panes, bottom Recovery and
unmerged entries duplicated in Staged. After comparisons use independently generated captures under
`test-results/p06-after/`: merge, conflict cards, resolver light/dark/880×600, Abort, binary selection,
partial stash, multi-region result and rebase continuation. These files are verification artifacts,
not committed reference assets. `tests/e2e/p06-workflows.test.ts` regenerates them.

## Boundaries and deliberate adaptations

- The helper is an owned renderer modal on Linux, with independent icons/fonts/colors. It presents real
  editable Git markers instead of copying Fork's one-region placeholder row. Both-side order, multi-region
  navigation, binary/gitlink controls, journalled stash Abort and Skip are explicit project behaviors.
  A Fork GUI Skip route and these broader conflict variants remain unobserved in the catalogue.
- Text sides are bounded to 2 MiB, explicit file-version replacement to 8 MiB, and the list to 1,000
  conflicts. Oversized content stays an explicit external/whole-file workflow. Predictions have an
  eight-second deadline and at most 50 ordinary rebase commits; merge-heavy/root replay may report
  unknown. Tree previews can create unreachable Git objects, which normal Git cleanup can collect;
  trusted Git merge-driver configuration still applies.
- Idle Recovery polling does not hash working files. Active recovery hashes at most 8 MiB per path
  group and 64 MiB per snapshot; larger content retains status/size/mode/change-time guards.
  These are independent resource policies, not claimed Fork thresholds.
- The new fixed preview/resolution-start capabilities and existing expanded choice/stash schemas are
  validated in common contracts, preload and main. Inspector, frame, document, repository ownership,
  trust and common-directory queue boundaries remain. The temporary-index option is backend-only;
  inherited `GIT_INDEX_FILE` remains ignored. No generic command/filesystem capability is introduced.
- Git operations started externally retain native recovery. A marker-free external stash/unmerged
  state has no reliable operation provenance; the app uses generic side labels and allows explicit
  resolution, without guessing an application journal or promising reconstruction of unknown old edits.
  Stashing nested submodule work remains a separate P09 concern.
- P06 covers one selected cherry-pick/revert at a time, with both merge-parent choices. Multi-selection
  history editing is not added to the P03 graph by this phase. Merge-preserving/dependent-reference
  interactive rebase remains P07; native Windows/macOS and the broader parity/accessibility matrix
  remain P14. No unsupported platform or capture unknown is promoted to verified parity.

## Verification

Environment: Linux x64, Node 24.13.0, Git 2.55.0, sandboxed Ozone-headless Electron. The user's display
bridge and IDE services were not changed or restarted; no native window-frame change is included.

- `npm run check`: **581 passed**, one existing opt-in skip; types, lint and formatting pass.
- `npm run build`: production main, preload/helper and renderer pass. Existing dependency-annotation
  and renderer bundle-size warnings remain non-failing.
- Final relevant headless run: **18 passed**, including all five P06 scenarios, the desktop/preload smoke,
  F17/F19/F20, F15/F16/F18, checkout-hook lifetime, P05 Pull/network and external merge-tool review.
  This run follows the final recovery-polling and unborn-stash guards.
  After the nested-path/raw-symlink correction, check/build and all **7** conflict/P06/external-tool
  Electron scenarios passed again on the rebuilt application.
- Full routine headless run: **48 passed, 3 failed, 2 existing opt-in skips**. Every new P06 scenario
  passed. Failures were P03 prepend/viewport retention (`914` pixels versus the `<2` assertion),
  Quick Launch File History (`0` options versus `2`), and a Bisect entry visibility assertion.
- An isolated, untouched checkout of starting revision `da111df13e50228e778453196a490128f5a63fd5`
  reproduced P03's identical viewport failure in **both** runs. Quick Launch failed in both baseline
  runs: one earlier dialog dismissal and one identical zero-option File History failure. Bisect passed
  both baseline runs. Two unchanged candidate Bisect retries produced one Git-command failure and one
  pass, consistent with the independently recorded P05 intermittency; its cause is not isolated here.
  The final candidate's separate Bisect run also passed. The temporary comparison checkout was removed;
  its unmodified source remains available at the starting commit and its test traces were retained.

The full application-wide UI suite is not claimed green. No P03/P08/P12 fix, minimum-Git-version rerun,
native Windows/macOS run, or screen-reader matrix is claimed by these results. The failures and remaining
parity questions do not erase the independently verified P06 acceptance results.
