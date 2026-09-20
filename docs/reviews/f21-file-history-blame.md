# F21 file history and blame — 2026-09-20

This handoff implements the bounded F21/P08 file-history and blame workflow independently. The supplied
Fork Windows 2.22.0.0 catalogue is behavioral and visual evidence only; Git Workbench does not ship Fork
assets or claim cross-platform equivalence.

## Evidence and implementation traceability

| Catalogue evidence                                                                                            | Git Workbench implementation                                                                              | Verification                                                                |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `P1-030-file-history-subcase:F1`: separate History window, timeline, revision cards, selected historical diff | `repository:get-file-history`, `FileHistoryInspector`, bounded `git log --follow --name-status -z` parser | `tests/unit/file-history-service.test.ts`; `tests/e2e/file-history.test.ts` |
| `P1-030-rename-follow-subcase:F1–F3`: old/new names, rename card and empty rename diff                        | rename-aware `RepositoryFileHistoryRevision` paths/status; committed diff reuses `path`/`previousPath`    | disposable four-commit rename fixture; F21 Electron scenario                |
| `P1-031:F1`: separate Blame window, attribution groups, linked historical commit details                      | `repository:get-blame`, `BlameInspector`, line-porcelain parser, typed `openCommitDetails` handoff        | disposable blame assertions; F21 Electron scenario                          |
| `P1-033-blame-history-navigation-subcase:F1–F4`: revision selector and Blame Back/Forward                     | bounded file-history revision list plus session-only navigation cursor in `BlameInspector`                | F21 Electron scenario; Git HEAD/status/bytes assertions                     |

The original observations are Windows 11, Fork 2.22.0.0, predominantly 96 DPI, captured 2026-09-19–20.
The original screenshots and Git records remain in the private bundle:

- [P1-030 dossier](../research/fork-reference-new/reference/catalogue/features/P1-030.md)
- [P1-031 dossier](../research/fork-reference-new/reference/catalogue/features/P1-031.md)
- [P1-033 dossier](../research/fork-reference-new/reference/catalogue/features/P1-033.md)

## Delivered behavior

- File History accepts one backend-issued repository ID, exact commit ID, and normalized relative file path.
  It follows one path through committed renames, returns full commit metadata and revision-local paths, and
  loads each selected commit's bounded text diff without touching the checkout.
- Blame reads a committed blob at the selected revision with line porcelain and bounded `-M -C -C`
  attribution. Binary and oversized blobs remain explicit non-text states; repository content is rendered
  as inert text.
- History and Blame are separate owned child windows. Their context DTOs contain no repository filesystem
  path beyond the selected relative file path, and their main-process sessions permit only committed reads,
  clipboard/editing/window controls, and the named inspector-to-commit-details handoff.
- Blame's revision selector is populated from the same rename-aware timeline. Selecting an older revision
  creates a session-only Back/Forward history; selecting an attribution opens the existing read-only commit
  details window.
- File/directory history and selected-code history are not implemented by this slice. Copy similarity,
  multiple successive renames, branch divergence, restart persistence, and general main-graph Back/Forward
  remain unverified or explicitly outside the bounded target.

## Verification

- Disposable repositories cover a four-commit old-name → Unicode-new-name rename, revision-local paths,
  rename metadata, historical diff loading, line attribution, unsafe path rejection, and unchanged HEAD,
  worktree bytes, and status.
- The headless Electron scenario opens File History and Blame through the isolated preload, selects the
  pre-rename revision, checks Blame Back availability and line content, opens linked commit details, and
  reasserts Git state.
- `npm run check` passes with 325 tests passed and one existing skip; the production build and all 15
  headless Electron scenarios pass, including the F21 scenario.
