# F17 conflict helper — 2026-09-20

This handoff implements the bounded F17 slice in P06. It is an independent Linux implementation, not
a claim of Fork equivalence. The supplied Windows 2.22.0.0 evidence remains private and unchanged.

## Evidence and implementation traceability

| Catalogue evidence                                | Git Workbench implementation                                                                                                 | Verification                                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| P1-016:F1, conflict card and operation banner     | `get-conflicts` inspection, conflict row action, operation-aware labels, staged-file counts                                  | `tests/unit/conflict-editor.test.ts`, `tests/e2e/conflict-editor.test.ts`                                 |
| P1-017:F1, two source panes above editable result | `ConflictResolver.tsx`, bounded base/ours/theirs/result DTOs, inert `CodePreview` panes                                      | headless Electron workflow and original `20260919T150616_254889Z_continuous02-resolver_3caf64/screen.png` |
| P1-018:F1, selected result stages exact blob      | backend compare-and-swap snapshot, marker validation, restore-on-stage-failure path, `git add`                               | disposable merge fixture asserts worktree, index and unmerged stages                                      |
| P1-019:F1, subsequent merge commit                | existing Commit composer and pending merge state remain the completion route                                                 | two-parent commit assertion in unit and Electron tests                                                    |
| P1-020:F1, abort and Cancel                       | existing Recovery abort path is preserved; resolver Cancel is read-only; merge cancellation remains an operation outcome     | interruption/cancel/abort unit coverage                                                                   |
| P1-022:F1/F4, rebase side semantics               | detached rebase reads `rebase-merge/head-name`/`rebase-apply/head-name`; the replayed commit is labeled as the incoming side | rebase conflict unit assertion                                                                            |
| P1-015:F1, stash conflict retention               | the helper can inspect generic unmerged text states without dropping a stash                                                 | stash-specific side provenance remains unestablished; the existing stash-retention test remains unchanged |

## Delivered behavior

- The backend reads bounded stage 1/2/3 blobs, the current worktree result, operation/sequencer state,
  and conflict-marker regions. It validates paths, object IDs, modes, byte sizes, and renderer results.
- The helper displays current/incoming source panes above an editable result, counts unresolved regions,
  offers whole-file and per-region source choices, rejects remaining markers, writes the exact UTF-8 result,
  and stages it through the repository mutation queue.
- A stale snapshot, external result edit, binary blob, submodule, missing stage, symbolic link, or
  oversized content cannot be silently marked resolved. Non-text states remain available for external
  resolution and later staging in Local Changes.
- Existing operation, Recovery, Commit/Continue, common-directory queue, sender validation, sandbox,
  and IPC response validation boundaries are unchanged.

## Deliberate limits and unknowns

The helper uses an independently authored main-renderer modal on Linux; it does not copy Fork artwork or
claim the captured Windows window geometry. Stash/pop provenance has no durable Git marker that can be
reliably distinguished from another externally-created unmerged state, so it is presented with generic
current/incoming labels until a source hint is available. Delete/modify, rename, binary, submodule and
external-tool flows are inspected and kept safe but are not claimed as built-in text editing parity.
F18 interactive rebase plan editing is implemented in the separate [F18 handoff](f18-interactive-rebase.md);
F19 cherry-pick/revert/reset remains separate planned work.

## Verification

- `npm run check`: passed, with 307 tests passed and 1 existing skip.
- `npm run build`: passed.
- `npm run test:e2e`: passed; all 11 headless Electron scenarios passed, including the F17 scenario.
- The P06/F17 ledger remains partial because the handoff deliberately excludes full Fork parity and F19.
