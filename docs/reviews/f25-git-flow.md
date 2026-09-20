# F25 Git-flow handoff — 2026-09-20

Status: bounded F25 implementation verified. F25 is public-only in the research catalogue; the supplied
Fork Windows 2.22.0.0 bundle contains no Git-flow execution case. This record therefore separates public
capability evidence, the independent workflow specification, implementation choices, and verification.

## Evidence and scope

Public sources accessed 2026-09-20:

- [Fork product page](https://fork.dev/) — vendor feature overview lists Git-flow for the Mac/Windows
  product family (**D**, high confidence for family existence; no Linux support claim).
- [Fork Windows release notes](https://fork.dev/releasenoteswin) — records a Git-flow hotfix integration
  fix (**D**, historical Windows evidence; exact UI/defaults are not specified).
- [Fork Mac release notes](https://fork.dev/releasenotes) — records a no-fast-forward feature-finish
  option and an option not to merge a release into develop (**D**, historical Mac evidence; platform
  defaults are not established for Linux).
- [git-flow presentation](https://git-flow.readthedocs.io/en/latest/presentation.html),
  [features](https://git-flow.readthedocs.io/en/latest/features.html),
  [releases](https://git-flow.readthedocs.io/en/latest/releases.html), and
  [hotfixes](https://git-flow.readthedocs.io/en/latest/hotfix.html) — public ordinary-Git model and
  documented branch/tag outcomes (**D**, high confidence for the independent workflow specification;
  not Fork implementation evidence).

The catalogue alignment keeps F25 separate from `P0-008-toolbar-dropdown-subcase:F1` / F38 Lean
Branching. No private screenshots or Fork binaries were copied into this implementation, and no
historical capture harness was run.

## Implemented vertical slice

`src/backend/repositories/gitflow-service.ts` owns all Git-flow semantics. It reads the repository-local
`gitflow.branch.master`, `gitflow.branch.develop`, `gitflow.prefix.feature`,
`gitflow.prefix.release`, and `gitflow.prefix.hotfix` keys, validates branch/ref names with Git, and
returns a compare-and-swap snapshot. The named IPC path is:

`getGitFlow()` → capability/context DTO → `startGitFlowOperation()` → operation event/result.

The renderer adds an independently authored Git-flow toolbar/menu and dialogs for:

- initialization, including creation of a missing develop branch from the selected production branch;
- feature, release, and hotfix start, with the documented develop/production bases;
- finish, with explicit no-fast-forward, release/hotfix annotated tag message, optional develop
  back-merge, and topic-branch retention choices.

Finish requires the selected topic to be checked out in the current worktree. It leaves feature finishes
on develop; release/hotfix finishes merge into production, tag the production result, and then merge the
topic into develop when selected. Topic deletion occurs only after the requested merges succeed.

## Safety and deliberate adaptations

- The implementation uses ordinary Git argument arrays and does not require an installed `git-flow`
  executable. This keeps ordinary Git available when the extension is absent and avoids exposing a
  generic command executor to the renderer.
- Initialization/start/finish refuse detached or unborn heads, dirty or untracked worktrees, conflicts,
  pending sequencers, stale snapshots, missing bases, duplicate branches/tags, invalid names, and
  missing tagger identity. Refusals are typed results; they do not silently discard local work.
- A merge conflict remains an unfinished Git operation and is reported as a failed Git-flow operation
  with a fresh context. Existing Recovery/Conflict controls remain the continuation route. No automatic
  rollback is attempted after an earlier production merge or tag has already succeeded.
- Remote publish/track/delete, topic rebase, automatic fetch, automatic stash/reapply, multiple-hotfix
  configuration, linked topic worktrees, signed tags, and exact Fork defaults are outside this bounded
  slice. These are limits, not claims that Fork lacks those variants.

## Verification

- `tests/unit/gitflow-service.test.ts` uses disposable repositories to verify initialization, develop
  creation, feature/release/hotfix start and finish, annotated tags, branch cleanup, content reaching
  develop, dirty refusal, and stale-snapshot refusal.
- `tests/e2e/gitflow.test.ts` creates a disposable repository, initializes Git-flow through the real
  Electron UI, then runs all three lifecycles through the validated preload/main operation path and
  asserts tags, refs, and checked-out content with independent Git reads.
- `npm run typecheck`, `npm run lint -- --no-warn-ignored`, production build, the F25 headless Electron
  scenario, and the F25 unit suite passed on 2026-09-20.

The owning phase P09 remains partial because the broader F22/F23 acceptance matrix and the public-only
F25 variants above are not complete. F38 remains planned and is not implemented by this handoff.
