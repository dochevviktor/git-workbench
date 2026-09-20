# F24 — bounded local Git LFS handoff

Verified 2026-09-20 on Fedora Linux with Git 2.55.0, Node 24.13.0, and the supplied Fork Windows
2.22.0.0 catalogue as the product reference.

## Scope

This handoff implements the evidence-backed local slice of F24:

- `P2-011-initialize-download-subcase:F1–F4`: the Repository → Git LFS → Initialize Git LFS entry,
  LFS pointer/materialized-state inspection, historical payload size presentation, Save As, retrieval
  progress, and unchanged pointer/worktree state.
- `P2-011-local-lfs-subcase:F1`: the LFS badge, historical size, Save As entry point, and the retained
  uncertainty around initialization and transfer completion.
- The Git LFS pointer format and `git lfs install --local` semantics are independently sourced from the
  [Git LFS specification](https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md) and
  [install manual](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-install.adoc), accessed
  2026-09-20. These are Git/LFS semantics, not observations of Fork.

Authenticated servers, remote LFS transfers, push, locks, track/untrack editing, missing-object recovery
through a remote, and LFS error matrices remain outside this handoff. A missing local object is reported
as unavailable; selecting a row never starts an implicit network download.

## Implementation

- `src/common/ipc/contracts.ts`, `api.ts`, preload, IPC registration, and the inspector policy add named,
  runtime-validated LFS reads, initialization, Save As, and `lfs` operation DTOs. No generic command or
  filesystem capability crosses into the renderer.
- `src/backend/repositories/lfs-service.ts` parses bounded committed pointer blobs, checks Git
  attributes, reports current pointer/materialized/missing state, locates only the repository's local
  LFS object cache, and streams a verified SHA-256 payload through a temporary file to the native Save As
  destination. The source object is never exposed through IPC.
- `RepositoryService` runs `git lfs install --local` through the existing cancellable operation registry,
  and runs Save As as a queryable operation with progress, cancellation, bounded output, and a structured
  saved result. It reports Git LFS as unavailable when the optional executable is not installed.
- `CommitDetails` shows an independently authored LFS card in Changes and File Tree. It displays the
  historical payload size rather than the pointer byte length, keeps the worktree pointer note visible,
  disables Save As when the local object is missing or invalid, and routes progress to the activity/event
  surface.

## Verification

- `tests/unit/lfs-service.test.ts` creates a disposable repository, commits a 130-byte-style pointer,
  installs a synthetic 32,768-byte local object, checks the pointer/materialized metadata, saves the
  payload, asserts the exact SHA-256 and bytes, and proves the pointer and Git status are unchanged. It
  also covers a missing local object, cancellation cleanup, and no partial Save As destination.
- `tests/e2e/lfs.test.ts` opens the real Electron application headlessly, checks the historical LFS card,
  mocks only the native Save As dialog, saves through the IPC/operation path, and repeats the unchanged
  pointer/status assertions.
- The bounded result is partial by design: Git LFS installation is capability-detected and may fail with
  an actionable missing-tool message on systems without `git-lfs`.

## Deliberate deviations and unknowns

Linux follows the existing independent shell and operation/activity implementation; the catalogue's
Windows menu geometry and icon artwork are not copied. The captured case says Initialize remains offered
after initialization and does not establish why; this implementation keeps the entry available whenever
the repository has a worktree and lets the backend report the installed-tool result. The catalogue's
HTTP/authenticated services, locks, push, and remote/missing-object behavior remain unknown and are not
claimed by this slice.
