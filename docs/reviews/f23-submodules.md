# F23 submodules — 2026-09-20

This handoff implements the bounded F23/P09 submodule lifecycle and inspection slice independently.
The supplied Fork Windows 2.22.0.0 catalogue is behavioral and visual evidence only; Git Workbench
does not ship Fork assets or claim cross-platform equivalence.

## Evidence and implementation traceability

| Catalogue evidence                                                                                                            | Git Workbench implementation                                                                                                                 | Verification                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `P2-002-clean-dirty-watcher-subcase:F1–F4`: clean parent, dirty child refresh, unchanged parent gitlink, and child navigation | `repository:get-submodules`, `submodule-service.ts`, `use-submodules`, Submodules sidebar, dedicated `SubmodulePreview`                      | `tests/unit/submodule-service.test.ts`; `tests/e2e/submodule.test.ts`                                           |
| `P2-002-view-subcase:F1`: nested sidebar path, old/new revision cards, one-up changed indicator, and Open Submodule           | backend gitlink HEAD/index/child-HEAD DTO, nested folder projection, revision-card renderer, `repository:open-submodule`                     | F23 Electron scenario; independent parent/child Git reads                                                       |
| `P2-002-missing-update-subcase:F1–F3`: missing child and explicit Update route                                                | operation-backed `init`/`update` action, bounded local transport policy, structured failure/context result                                   | disposable missing-child update test; F23 Electron scenario verifies successful local initialization            |
| P09 acceptance: add/sync/remove lifecycle entry points and safe removal                                                       | typed add/init/update/sync/remove actions, snapshot guard, exact dirty-path refusal, explicit force removal, common-directory mutation queue | unit add/read/action coverage and IPC schema/type/build checks; broader nested/interrupted variants remain open |

The original observations are Windows 11, Fork 2.22.0.0, predominantly 96 DPI, captured 2026-09-19–20.
The original screenshots and Git records remain private/local references:

- [`P2-002` dossier](../research/fork-reference-new/reference/catalogue/features/P2-002.md)
- [revision comparison](../research/fork-reference-new/evidence/20260919T160335_478895Z_continuous04-submodule-diff_2393b1/screen.png)
- [dirty child refresh](../research/fork-reference-new/evidence/continuous10/20260919T211313_606627Z_parent-dirty-refresh_f3a61f/screen.png)
- [missing-child Update menu](../research/fork-reference-new/evidence/continuous10/20260919T210708_894995Z_submodule-missing-menu_6de70e/screen.png)
- [opened child tab](../research/fork-reference-new/evidence/20260919T160434_745849Z_continuous04-submodule-open_ae1f5a/screen.png)

## Delivered behavior

- The backend reads `.gitmodules`, recursive `git submodule status`, parent commit and index gitlinks,
  child HEAD/detached state, child dirty paths/counts, missing children, missing expected commits, and
  parent conflict/staging state. A backend-issued submodule ID and compare-and-swap snapshot cross IPC.
- Add, Initialize, Update, Synchronize URL, and Remove are named capabilities. Init/Update use an explicit
  operation-owned local file transport allowance so Linux disposable local sources can complete; the
  recursive choice is visible in the operation command and the action is serialized by Git common directory.
  No generic command or renderer path is accepted.
- Removal refuses dirty or conflicted child state unless the user chooses the separate force action. The
  refusal reports child paths prefixed with the exact parent submodule path; the force command names only
  that path and never recursively targets unrelated parent content.
- The renderer replaces the planned placeholder Submodules section with nested folders and state labels.
  Local Changes uses a dedicated gitlink comparison card instead of a text diff, shows the parent baseline
  and current index/child revision, reports dirty-child count and paths, offers Update/Initialize, and
  opens initialized children through backend-resolved IDs. Child tabs use the captured `parent: demo` label.
- Successful and failed operations remain queryable through the existing operation registry. A fresh result
  context is returned after each action; stale snapshots and changed topology are rejected before mutation.

## Deliberate limits and unknowns

- The supplied capture proves dirty refresh and an Update failure, not successful initialization. The
  successful local initialization in this project is an independent Linux Git test and is not presented
  as an observed Fork outcome.
- Unit/Electron coverage exercises clean, dirty, changed-revision, missing-child, dirty-removal refusal,
  force removal, child opening, and local Update. Nested submodule mutation, missing object recovery,
  detached-child presentation beyond the returned state, interrupted/cancelled update recovery, and
  submodule conflict resolution are not promoted as complete acceptance variants.
- The captured Console, Explorer, History, Move, provider authentication, and network cancellation routes
  remain outside this bounded slice. Git-flow F25 and Lean Branching F38 remain separate.
- Linux uses independently authored icons, spacing, labels, and dialogs. Windows pixel geometry, native
  frame behavior, and Fork artwork are not implementation assets.

## Verification

- `tests/unit/submodule-service.test.ts` uses disposable repositories to assert clean/dirty/changed
  revision cards, missing-child state and successful local update, dirty removal refusal, force removal,
  parent-content preservation, and `.gitmodules` cleanup.
- `tests/e2e/submodule.test.ts` uses a disposable parent/source pair to assert the nested sidebar route,
  dirty-child Local Changes card, `parent: demo` tab, missing state, operation completion, and child bytes.
- `npm run check` passes with 333 tests passed and one existing skip; `npm run build` passes; and the full
  headless Electron matrix passes all 17 scenarios, including the F23 scenario. P09 remains partial
  because the broader acceptance variants above are unverified.
