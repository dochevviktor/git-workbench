# F22 worktrees — 2026-09-20

This handoff implements the bounded F22/P09 worktree lifecycle independently. The supplied Fork
Windows 2.22.0.0 catalogue is behavioral and visual evidence only; Git Workbench does not ship Fork
assets or claim cross-platform equivalence.

## Evidence and implementation traceability

| Catalogue evidence                                                                                                                                 | Git Workbench implementation                                                                                                                                     | Verification                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `P2-001-create-remove-subcase:F1`: Checkout Branch as Worktree has a branch and editable location; creation opens a linked tab and shows Worktrees | `repository:get-worktrees`, `repository:start-worktree-operation`, `worktree-service.ts`, `WorktreeDialogs.tsx`, Worktrees sidebar, existing open-tab capability | `tests/unit/worktree-service.test.ts`; `tests/e2e/worktree.test.ts`  |
| `P2-001-create-remove-subcase:F2`: current linked worktree cannot be deleted; parent can remove it and the Worktrees section disappears when empty | backend current/main guards, explicit Remove dialog, common-directory queue, removal of deleted worktree sessions/tabs                                           | unit dirty/locked/current topology assertions; F22 Electron scenario |
| `P2-001-open-subcase:F1`: worktree context exposes Open, file-manager handoff, Delete and Copy Path; Open creates a separate tab                   | backend-issued worktree IDs, fixed `worktree` file-manager location, linked-tab marker, sidebar context menu                                                     | F22 Electron scenario; IPC schemas/type checks                       |
| `P2-001-open-subcase:F1` occupied-branch state: branch checked out in another worktree is not an ordinary checkout target                          | existing reference `worktreePath` guard plus worktree create preflight and structured `checked-out` result                                                       | `tests/unit/worktree-service.test.ts`; reference-service regressions |

The original observations are Windows 11, Fork 2.22.0.0, predominantly 96 DPI, captured 2026-09-19.
The original screenshots and Git records remain private/local references:

- [P2-001 dossier](../research/fork-reference-new/reference/catalogue/features/P2-001.md)
- [create dialog](../research/fork-reference-new/evidence/continuous09/20260919T205304_083826Z_worktree-create-dialog_32a39f/screen.png)
- [created linked tab](../research/fork-reference-new/evidence/continuous09/20260919T205406_395044Z_worktree-created_f81423/screen.png)
- [linked-worktree menu](../research/fork-reference-new/evidence/20260919T152414_200425Z_continuous03-worktree-menu_accc54/screen.png)
- [occupied-branch menu](../research/fork-reference-new/evidence/20260919T152441_511695Z_continuous03-occupied-branch-menu_cf6ae2/screen.png)

## Delivered behavior

- The backend reads bounded `git worktree list --porcelain -z` records, branch/head identity, current and
  main worktree state, missing/prunable registrations, lock metadata, and an independent working-tree
  summary. The context returns a backend-issued ID and a compare-and-swap snapshot.
- Create supports an existing local branch and a remote-tracking branch with an explicitly named local
  branch. Destination paths are validated in the main process, branch sources are re-read, and all
  mutations serialize by Git common directory.
- Remove refuses the current or main worktree and requires an explicit force choice for dirty or locked
  linked worktrees. Locked removal uses Git's stronger repeated-force requirement. Prune only invokes Git's
  stale-registration cleanup; it never recursively deletes an arbitrary path.
- Worktree operations use the existing typed operation registry, bounded output, sender/frame checks,
  cancellation lifetime, and operation events. Successful removal closes matching linked sessions/tabs;
  successful creation is opened through the normal repository session path.
- The renderer shows a Worktrees section before branches, provides Open/file-manager/Delete/Copy Path and
  prune actions, adds Checkout as Worktree to local and remote branch menus, and marks linked tabs in both
  visual and accessible labels.

## Deliberate limits and unknowns

- The catalogue observed clean create/open/remove and explicitly left dirty/locked removal untested. The
  dirty/locked policy above is an independently authored Linux-safe adaptation, verified against Git's
  disposable local repositories, not a claim about Fork's unobserved dialogs or defaults.
- Worktree creation is limited to local and remote-tracking branches. Detached-commit creation, branch
  rename/move, lock/unlock commands, nested worktree policy, and automatic default-location rules remain
  outside this slice.
- The captured parent-group double-click behavior is not copied as a requirement; Git Workbench opens a
  worktree on its row activation and keeps repository tab selection explicit.
- No submodule lifecycle or Git-flow behavior is included. Those remain F23/F25/P09 work.
- Linux uses independently authored icons, spacing, labels, and file-manager integration. Windows pixel
  dimensions, native frame geometry, and the captured Fork artwork are not implementation assets.

## Verification

- Disposable repository tests cover local creation/removal, remote-tracking creation, occupied branches,
  dirty and locked force guards, stale-registration pruning, parent branch preservation, and worktree
  registration state.
- The headless Electron scenario opens a disposable repository, creates a linked worktree through the
  branch context menu, checks the separate tab and linked marker, removes it from the parent Worktrees
  row, and independently checks Git registration and tab cleanup.
- `npm run check` passes with 330 tests passed and one existing skip; `npm run build` passes; and all 16
  headless Electron scenarios pass, including the F22 scenario. The feature row stays partial because the
  broader P09 and catalogue variants are not verified.
