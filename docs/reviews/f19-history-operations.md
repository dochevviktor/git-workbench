# F19 history operations — 2026-09-20

This handoff implements the bounded F19/P06 slice as an independent Linux-first workflow. It uses the
supplied Fork for Windows 2.22.0.0 catalogue as behavioral evidence; it does not claim Fork equivalence,
reuse Fork artwork, or reproduce the Windows capture geometry.

## Evidence and implementation traceability

| Catalogue evidence                                                                                                    | Git Workbench implementation                                                             | Verification                                                                         |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `P1-025-success-subcase:F1`: clean cherry-pick, original subject/author, clean result                                 | `history-operation-service.ts`, typed history-operation IPC, History context menu/dialog | `tests/unit/history-operations.test.ts`, `tests/e2e/history-operations.test.ts`      |
| `P1-025-conflict-continue-subcase:F1–F4`: conflict, operation-aware sides, staged resolution and commit               | Git `CHERRY_PICK_HEAD` state, F17 resolver labels/staging, Recovery Continue             | disposable conflict fixture asserts index, worktree, pending state and final message |
| `P1-025-conflict-abort-subcase:F1`: conflict abort restores the original state                                        | shared Recovery `cherry-pick --abort` route with fresh state reads                       | disposable cherry-pick conflict/abort coverage through the existing Recovery service |
| `P1-026-success-subcase:F1`: clean revert and generated message                                                       | backend-owned `git revert --no-edit` plan with optional no-commit mode                   | disposable revert and staged no-commit assertions                                    |
| `P1-026-conflict-resolve-subcase:F1`, `P1-026-conflict-abort-subcase:F1–F3`: revert side semantics and abort          | operation-specific `Reverted '<commit>'` label, F17 helper, Recovery Continue/Abort      | revert conflict abort coverage and shared conflict inspection                        |
| `P1-027-mixed-subcase:F1–F2`, `P1-027-soft-reset-subcase:F1–F2`, `P1-027-hard-reset-subcase:F1–F2`: three reset modes | preview/CAS token, explicit Soft/Mixed/Hard dialog choices, backend reset plan           | independent HEAD/index/worktree assertions; hard reset Recovery restore              |
| `P1-022-abort-subcase:F1`, `P1-022-continue-subcase:F1`: durable operation recovery                                   | unchanged common queue and Recovery state machine, extended to cherry-pick/revert        | existing F17/F16 recovery tests plus F19 conflict continuation                       |

The original catalogue cases are Windows 11, predominantly 96 DPI, captured 2026-09-19–20. Their Git
manifests establish operation semantics; screenshots establish the reference dialog/menu states. The
application uses independently authored renderer controls and does not copy those images.

## Delivered behavior

- Cherry-pick and revert accept one backend-validated commit ID, preserve Git's author behavior, support
  explicit commit/no-commit choices, cherry-pick origin annotation, and mainline-parent selection for
  merge commits.
- A read-only preview returns the current branch, target metadata, local-change paths, pending/conflict
  state, and a compare-and-swap token. The mutation re-reads all of it inside the common-repository
  queue; stale refs, content, pending operations, and external changes cannot silently redirect it.
- Conflicts leave Git's authoritative `CHERRY_PICK_HEAD` or `REVERT_HEAD` state in place. The existing
  two-input/editable-result helper labels current/incoming content for the operation, and Recovery
  Continue/Abort works after a fresh service state read.
- Soft reset moves HEAD while retaining the index/worktree; Mixed moves HEAD and resets the index while
  retaining worktree files; Hard reset requires explicit confirmation and saves tracked local changes as
  a durable Recovery copy before invoking Git. Untracked files remain governed by native Git hard-reset
  semantics and are not claimed to be captured Fork behavior.
- New commands are named IPC capabilities. The renderer receives no Git arguments or revision syntax;
  operations are queryable through the existing Activity channel and refresh the history/changes views.

## Deliberate limits and unknowns

- This slice covers one selected commit at a time. Batch cherry-pick/revert, empty-commit policy,
  signed-operation prompts, and all provider/platform variants remain outside the verified scope.
- The catalogue's exact Windows geometry, defaults across fresh profiles, and its untested merge-parent,
  no-commit, append-origin, dirty-worktree, and untracked reset variants are not presented as parity.
- Hard-reset Recovery protects tracked changes through an application-owned retained stash/ref. It does
  not claim to delete ignored/untracked files, and the catalogue did not establish those variants.
- F17's non-text conflict limitations, F18's merge-preservation/dependent-reference limits, and the
  bounded project Recovery Skip capability remain unchanged. This handoff does not establish a Fork GUI
  Skip route.

## Verification

- `npm run check`: passed with 320 tests passed and 1 existing skip.
- `npm run build`: production main, preload, and renderer bundles passed.
- `npm run test:e2e`: all 13 headless Electron scenarios passed, including the F19 scenario.
- All Git assertions use disposable repositories and compare refs, parents, index, worktree, conflict
  stages, and Recovery state independently of renderer DTOs.

The P06 phase remains partial: this handoff verifies the bounded F19 workflows and their composition with
F17 Recovery, while the broader conflict-family, stash provenance, external-tool, and platform/accessibility
matrices remain open.
