# F20 reflog recovery — 2026-09-20

This handoff implements the bounded F20/P08 lost-commit workflow independently. The supplied Fork
Windows 2.22.0.0 catalogue is behavioral and visual evidence only; Git Workbench does not ship Fork
assets or claim cross-platform equivalence.

## Evidence and implementation traceability

| Catalogue evidence                                                                    | Git Workbench implementation                                                                                                                      | Verification                                                                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `P1-028:F1`: View → Show Lost Commits (Reflog), enabled banner/Exit, dimmed lost rows | `repositoryHistoryModeSchema`, `history-service.ts` reflog mode, history hook mode/session state, View menu, reflog banner                        | `tests/unit/history-service.test.ts`; `tests/e2e/history-operations.test.ts` F20 scenario                  |
| `P1-028:F1`: lost-row context actions include reset and export/recovery entry points  | Existing typed History context actions reuse full commit IDs; F19 preview/CAS reset and F12 branch/tag actions remain backend-owned               | F19 history-operation tests plus F20 Electron reset route; inherited branch/tag and patch capability tests |
| `P1-028:F1`: Mixed Reset to `5428b7c` recovers `main`; Exit returns to normal graph   | Reflog rows are resolved to commit objects; existing Mixed Reset moves the selected branch with the reviewed token, then refreshes normal history | `tests/unit/history-operations.test.ts`; independent `rev-parse`, index, worktree and history assertions   |

The original case is Windows 11, Fork 2.22.0.0, predominantly 96 DPI, captured 2026-09-19. The
original screenshots are local private references:

- [`P1-028` dossier](../research/fork-reference-new/reference/catalogue/features/P1-028.md)
- [`reflog mode`](../research/fork-reference-new/evidence/20260919T153956_445197Z_continuous03-reflog_41e2b4/screen.png)
- [`lost commit menu`](../research/fork-reference-new/evidence/20260919T154029_641792Z_continuous03-reflog-menu_213950/screen.png)
- [`recovered graph`](../research/fork-reference-new/evidence/20260919T154049_208301Z_continuous03-reflog-recovered_b6fa2d/screen.png)

## Delivered behavior

- The validated history request accepts `normal` or `reflog` mode. Reflog mode is limited to the complete
  repository history and reads `git log --reflog --all --not --all` through the backend runner.
- Reflog-only commits are parsed with the same bounded full metadata contract as ordinary history and are
  paged before the reachable graph. The cap is 20,000 lost commits; over-cap output fails explicitly.
- Direct commit and oldest navigation accounts for the lost-commit prefix. The renderer keeps mode in its
  per-repository session key, so paging, selection, repository switching, and Exit do not mix normal and
  reflog results.
- The existing reachability projection dims lost rows. The row menu retains named New Branch/New Tag,
  reset, checkout, cherry-pick, revert, and patch actions; no reflog selector or generic Git command crosses
  IPC. Reset continues to use F19's preview/CAS state machine and operation activity surface.
- Exit requests normal mode and refreshes the ordinary graph. A successful reset makes the selected commit
  reachable through normal `git log --all`; Mixed Reset retains native Git's worktree semantics while its
  index and branch target are independently asserted.

## Deliberate limits and unknowns

- Reflog expiry, unavailable objects, reflog configuration variants, and the catalogue's sequential small
  fixture limits are not represented as parity claims. An empty reflog simply yields the normal graph.
- New-branch/new-tag recovery is exposed through the existing typed reference actions but is not separately
  promoted as a full F20 variant; provider, worktree, detached/unborn, and cross-platform matrices remain
  open. Patch export is the existing bounded F36/F15 capability.
- The 20,000-commit cap is a Git Workbench safety bound, not an observed Fork threshold. Linux follows the
  captured Windows layout with independently authored controls and colors.
- This slice does not alter F17 conflict handling, F18 merge-preservation/dependent-reference limits, F19
  batch/edge operation limits, or the project-only Recovery Skip capability.

## Verification

- Disposable repository unit tests cover mode schema validation, lost-commit paging, direct reflog
  navigation, normal-history exclusion, Mixed Reset recovery, branch/index/worktree state, and refresh.
- The headless Electron scenario opens a disposable repository, enters View → Show Lost Commits (Reflog),
  checks the dimmed lost row and banner, resets it with the default Mixed mode, independently checks Git,
  closes Activity, and uses Exit to return to the normal graph.
- `npm run check` passed with 322 tests passed and one existing skip; `npm run build` passed; and the full
  headless Electron suite passed all 14 scenarios. The feature row stays partial because the broader P08
  and catalogue variants are not verified.
