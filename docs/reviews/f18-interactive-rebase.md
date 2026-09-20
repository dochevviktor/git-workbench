# F18 interactive rebase — 2026-09-20

This handoff implements the bounded F18/P07 interactive-rebase slice as an independent Linux-first
workflow. It uses the supplied Fork for Windows 2.22.0.0 catalogue as behavioral evidence; it does not
claim Fork equivalence, Linux support in Fork, or reuse Fork artwork, binaries, or capture tooling.

## Evidence and implementation traceability

| Catalogue evidence                                                                                                                      | Git Workbench implementation                                                                                                            | Verification                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `P1-023-plan-execution-subcase:F1–F3`: newest-first plan, reorder, Pick/Edit/Reword/Squash/Fixup/Drop, combined message and final graph | `repository:get-interactive-rebase-plan`, `InteractiveRebaseDialog.tsx`, backend todo/message generation and controlled sequence editor | `tests/unit/interactive-rebase.test.ts` action/graph assertions; `tests/e2e/review-workflows.test.ts` F18 scenario |
| `P1-023-edit-amend-continue-subcase:F1–F3`: detached Edit pause, automatic Amend presentation, amended message and Continue             | `readRebaseEditState`, `RepositoryCommitContext.rebaseEdit`, `CommitComposer`, `RecoveryPanel`, operation-aware `rebase --continue`     | disposable-repository Edit → amend → Continue assertions                                                           |
| `P1-024:F1`: later message-edit/final-graph case resolved the earlier input-driver failure                                              | bounded subject/body editing in the plan dialog and Git message-file execution                                                          | plan message and parent/tree assertions in the unit suite                                                          |
| `P1-022:F1/F4`: unfinished rebase state and operation-specific recovery                                                                 | existing conflict helper plus interactive rebase Recovery state, abort and continue paths                                               | interactive conflict/abort test and existing F17 rebase-side tests                                                 |

The original catalogue screenshots inspected for this slice are the plan/editor sequence at
`evidence/continuous09/` (`screen-0359`–`screen-0369`) and the Edit sequence at
`evidence/continuous10/` (`screen-0352`–`screen-0358`). They are Windows 11, predominantly 96 DPI,
captured 2026-09-19–20 (**B-UI/B-Git** evidence). The implementation uses independently authored
Linux controls and keeps the captured newest-first ordering, connectors, dropped-row treatment and
inline message editing without copying Fork presentation.

## Delivered behavior

- A backend-owned, bounded plan read accepts only the checked-out named branch and a selected ancestor
  commit or root. It returns newest-first commit rows, author/committer metadata, local-change preview,
  a compare-and-swap plan token, and an explicit merge-commit count.
- The renderer can reorder rows, choose Pick/Reword/Edit/Squash/Fixup/Drop, edit subject/body text,
  enable autosquash, and request explicit stash-and-reapply of local changes. The backend revalidates
  row identity, plan freshness, action constraints and local-change snapshots before mutation.
- Execution uses an application-created sequence-editor script and message files. Renderer input never
  supplies a command string or executable; the only `exec` lines are backend-generated amendments for
  reviewed message changes and combined Squash messages. Temporary backup refs and artifact files remain
  while Git is paused and are removed after confirmed completion or Recovery abort.
- Edit pauses remain a failed/paused operation outcome with Git's rebase state authoritative. The
  current detached commit is exposed as `needs-amend`; the existing Commit composer automatically enters
  Amend presentation, then exposes Continue Rebase only after the amendment is committed. Recovery blocks
  premature Continue and supports fresh-launch Abort/Continue.
- Squash combines reviewed messages; Fixup omits its message. Empty commits are passed with
  `--empty=keep`; root plans and local-change recovery are covered by disposable repositories.

## Deliberate limits and unknowns

- Merge-preserving interactive rebase is refused with a structured explanation. Dependent-branch updates,
  user-visible backup/dependent-reference checkboxes, drag gestures, and exact Fork keyboard bindings were
  not independently established by the cases and are not presented as implemented parity.
- The project always creates an internal backup ref for safety; it is not exposed as a general reflog or
  reset surface. F19 cherry-pick/revert/reset remains separate. Explicit Fork GUI Rebase Skip remains an
  unverified catalogue behavior; the existing Recovery Skip is retained as a project capability.
- The controlled sequence-editor scripts are independently authored generated artifacts. Linux uses a
  POSIX script; the Windows path is bounded to a `.cmd` copy helper, but cross-platform runtime behavior
  and Fork's Windows geometry/defaults remain unverified.

## Verification

- `npm test`: 312 tests passed, 1 existing skip.
- `npm run check`: passed; 312 tests passed and 1 existing skip.
- `npm run build`: production build passed.
- `npm run test:e2e`: 12 headless Electron scenarios passed, including the F18 plan/execution scenario.

The phase remains partial: the verified bounded workflow is implemented, while merge preservation,
dependent-reference updates, broader empty/history edge matrices and final cross-platform/accessibility
gates remain open.
