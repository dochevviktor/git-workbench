# P08 — Investigation, recovery and patches

Bisect follow-up (2026-09-26): the [refresh correction](p08-bisect-refresh.md) fixes the lost-click
failure subsequently reproduced during P03 verification. Validated controls remain usable during
background reads, while mutation locks and stale-checkout refusals remain intact.

Subsequent viewport verification (2026-09-26): the [P03 correction](p03-viewport.md) resolves the
remaining viewport assertion recorded below. Its runtime trace identified a test synchronization race;
production paging is unchanged. The original P08 test counts below retain their historical meaning.

Date: 2026-09-26. Linux, Node 24.13.0, Git 2.55.0. This record supersedes the earlier
F20/F21/F26/F36 slice limitations within the P08 requirements. Verification is recorded below;
the catalogue's unknown Fork variants and P14 platform gates are retained.

## Delivered scope

| P08 requirement                                                          | Implementation and independent evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message/author/hash/path/changed-content search and bounded cancellation | Existing separate sidebar results, repository/current-branch scopes and graph highlighting are retained. Search and graph requests now carry owned cancellation IDs; new queries, navigation, tab changes and disposal stop obsolete work. Cancel has a visible state and Search again. Tests exercise literal fields, scope, process cancellation, immediate cancellation, owner isolation and late results.                                                                                     |
| File/directory/selected-code history                                     | File Tree directories now open History. Directory revision cards contain the affected files and a file selector, including descendants followed through renames. Selected source text in File Tree or committed diffs opens line history at the exact revision. Git tests follow successive directory renames and exclude edits outside the chosen lines.                                                                                                                                         |
| Blame navigation and historical retrieval                                | Compact attribution rows align with source lines, retain original filenames/line numbers, and link to the correct historical file across renames. The selected revision's additions/deletions are shown with the source. Revision selection, timeline, Back/Forward and child commit details preserve the main selection and checkout. Save As exports exact committed bytes outside the inspected checkout, including binary/CRLF data; linked destinations and repository metadata are refused. |
| Lost commits and named recovery                                          | The existing reflog graph/Exit and Mixed Reset workflow is retained. Electron independently verifies recovery to a named branch and annotated tag without moving HEAD or changing index/worktree. Expiry/pruning tests remove the unreachable object and verify that no phantom row is returned.                                                                                                                                                                                                  |
| Manual Bisect                                                            | Start/Bad/Good/Skip/Abort, known first-bad and ambiguous skipped outcomes, restart restoration and branch/index restoration are reverified. Read generations and operation generations are independent, and refresh retains the last context with controls disabled while reading. The UI test waits for the initial capability read before choosing Start.                                                                                                                                       |
| Patch save/copy/import/apply                                             | Existing native-file/clipboard preflight, staged application, conflict diagnostics and Cancel invariance remain. Merge export requires a selected parent and produces that exact binary-capable diff. Format-patch mailboxes are preflighted in an isolated temporary index and applied as one net staged delta without commits. Quoted tabs/newlines/backslashes/leading dashes round-trip on Linux; byte-oriented file exports retain CRLF and non-UTF-8 bytes.                                 |

Reference refresh after a mutation now installs the post-operation snapshot before releasing the busy
state. This fixes a reproduced branch-recovery → tag-recovery failure where the tag form retained the
pre-branch snapshot. Rapid reflog mode/Exit refreshes cancel obsolete graph reads rather than exhausting
the investigation limit. Pending direct navigation remains the target if a watcher refresh intervenes.

## Design and provenance

Primary reference: user-supplied Fork **Windows 2.22.0.0**, Windows 11, primarily 96 DPI,
captured 2026-09-19–20. Original dossiers, cases, PNGs and linked Git evidence were read, including
`continuous15/git-verification.json` and `continuous16/git-verification.json`. Confidence is high for
the stated captured outcomes, not unobserved variants. Linux follows the Windows composition.

| Cases/findings                                                          | Original screenshot/evidence                                                                                            | Result and deliberate adaptation                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-030-file-history-subcase:F1`, `P1-030-rename-follow-subcase:F1–F3`  | `evidence/continuous11/20260919T215608_332416Z_rename-history_bd5a17/screen.png`, older/rename cards 0416–0417          | Compact three-line revision cards, narrow left column, shared horizontal timeline above list/diff, selected-path header and working diff controls. Native Linux child windows and existing independent icons remain. The keyboard-accessible timeline selects revisions; Fork's timeline range dragging is unestablished. |
| `P1-031:F1`, `P1-033-blame-history-navigation-subcase:F1–F4`            | `evidence/continuous16/20260920T050902_636835Z_blame-navigation-open_65899d/screen.png`, earlier/back/forward 0428–0430 | Replaced tall per-line attribution cards with compact rows; original-path links, revision navigation and change highlighting. Deleted rows identify the commit removing the line. Author details remain in tooltips.                                                                                                      |
| `P1-029:F1`                                                             | Search results/filter/empty/clear 0407–0410                                                                             | Retained sidebar scopes/results and graph highlighting; Cancel and hash search are independent extensions.                                                                                                                                                                                                                |
| `P1-028:F1`                                                             | Reflog mode/menu/recovered graph 0404–0406                                                                              | Retained dimmed graph and Exit. Named branch/tag and expired-object behavior are independently tested; the catalogue did not exercise those variants.                                                                                                                                                                     |
| `P2-005-mixed-patch-preflight-subcase:F1–F4`, import/export subcases F1 | Preflight 0471/0473, staged result 0476/0477, export 0461                                                               | Retained location/applicability/Apply/Cancel layout and staged, non-committing outcome. Mailbox summary and merge-parent selector are independently specified extensions. No patch-content browser is claimed.                                                                                                            |
| `P2-006:F1`, `P2-006-skip-subcase:F1–F3`                                | Midpoint 0482, skipped 0483, restored 0484                                                                              | Retained top banner and Bad/Good/Skip/Abort; first-bad and ambiguous outcomes remain explicit outcomes rather than a Git Error dialog.                                                                                                                                                                                    |

Public gap research, accessed **2026-09-26**:

- [Fork Windows release notes](https://fork.dev/releasenoteswin): 1.52 (2020-07-16) documents directory
  history; 2.14 (2025-11-21) documents selected-code history through a diff context menu; 1.81
  (2023-01-27) records the File Tree Save As route. High-confidence documented capabilities;
  no additional black-box behavior is inferred.
- [Git log](https://git-scm.com/docs/git-log): numeric `-L` tracks a range from a single revision.
  [Git blame](https://git-scm.com/docs/git-blame) describes original paths/line attribution.
  [Git apply](https://git-scm.com/docs/git-apply) informs index/three-way application. These support
  the independent backend semantics, not Fork's exact implementation.
- `npm run research:references` restored the public library, and its history/patch topic entries were
  consulted. No new public screenshot was needed. The private bundle was not changed or copied into
  the application, and no Fork binary/source or historical capture harness was used.

Before captures: the unchanged initial F21 run established the oversized cards, missing shared timeline
and stretched blame lines. An untouched baseline replay retains those original application states at
`/tmp/git-workbench-p08-baseline-pczujF/test-results/f21-file-history.png` and `f21-blame.png`.
After captures are in the ignored `test-results/p08-final-targeted/p08-investigation-*/` directories: `directory-history-light.png`,
`directory-history-dark-narrow.png`, `selected-code-history.png`, `blame-light.png`,
`mailbox-preflight.png`, `merge-parent-export.png`, and `named-reflog-recovery.png`.
They were compared with the original images above. The 760×600 inspector retains accessible actions;
native moving/resizing/frame behavior is unchanged and not newly claimed.

## Boundaries and explicit policies

- Existing channel names remain stable. Scope/read-ID/merge-parent fields extend strict DTOs; named
  `cancelInvestigation` and `saveRevisionFile` capabilities extend common contracts, preload, handlers
  and the inspector allowlist together. Sender/frame/document/owner checks, sandbox, isolation, CSP
  and exact subscription cleanup remain intact. No command, arbitrary destination path or patch bytes
  cross from the renderer as execution authority.
- Investigation reads have a 20-second overall deadline and at most four active reads per window,
  plus the existing process/output bounds. Aborted reads do not consume new-read slots. Search/graph
  generations reject stale replies; tab/window close terminates owned requests. Inspector timeline
  reads stop on window disposal; switching a Blame revision cancels its previous attribution request.
- File history retains Git's rename policy. Directory history scans up to 2,001 ancestral commits and
  reports truncation after 2,000, tracking renamed descendant paths without inferring that one moved file
  renamed an entire directory. A revision can expose up to 10,000 affected paths, under a 16 MiB output
  bound. Line history is a numeric committed-file range, limited to 100,000 lines and intersected with
  the bounded rename-aware timeline. Working/index-only source lines have no committed attribution.
- Save As supports exact blobs up to 8 MiB, uses an application-owned temporary file and atomic rename,
  and rejects destinations inside the selected worktree/Git/common directory, symlinks and hardlinks.
  It does not apply filters, check out revisions or materialize LFS payloads; existing LFS Save As remains
  its separate capability. File/Blame sessions are session-only; restart does not reopen inspectors.
- Blame retains its 4 MiB/100,000-line/2,000-attribution-commit bounds. Current source attribution and
  original-path links are authoritative; the displayed removed lines belong to the removing revision.
  Binary/oversized files keep explicit fallback states. Copy/merge ambiguity remains Git's behavior,
  not a new exact-Fork parity claim.
- Patch input/output remains bounded to 8 MiB and 1,000 paths; mailboxes allow at most 100 format-patch
  messages. Preflight uses only an isolated index; it may add unreachable Git objects, but changes no
  HEAD/ref/reflog/real-index/worktree state. A conflicting mailbox is rejected with its failing message
  number, for separate resolution. Cover letters and zero-net-change mailboxes are not applied.
  Source bytes stay immutable in main and tokens remain one-use, owned, expiring and snapshot-bound.
- Single-patch three-way conflicts retain unmerged index entries and actionable Git diagnostics.
  No automatic commit, retry, rollback, mailbox author recreation or `git am` sequencer is introduced.
  Symlink/submodule patches, unsafe traversal/absolute paths and existing symlink components remain
  explicit refusals. Linux backslash/newline filename support does not claim Windows support.
- General main-graph Back/Forward, inspector restart restoration, exact Fork copy/rename thresholds,
  arbitrary patch prefix conventions, native Windows/macOS and fractional DPI parity remain outside
  the specified Linux phase. The original catalogue's unknowns remain unknown.

## Verification

`npm run check` passed **603 tests**, with one existing opt-in skip, including all three type checks,
lint and formatting. Production build passed. All mutating tests use disposable repositories and profiles.

All **14 focused headless Electron scenarios passed** on the rebuilt application: P08's three new
workflows, F21, F26, F36, catalogue search, desktop/preload smoke, both F19/F20 workflows and four P02
session/lifecycle scenarios. Artifacts are in `test-results/p08-final-targeted/`. A final directory
inspection follow-up also checks that Open Commit Details uses the selected file within its revision,
and each file has its own diff position key.

The broad headless Electron run reports **57 passed, 1 failed, 2 existing opt-in skips**. Every P08
scenario and the desktop/preload smoke passed. The remaining failure is the existing P03 prepend
viewport assertion at `tests/e2e/p03-history.test.ts:113`: 914 px displacement versus `<2`.
An untouched archive of starting commit `3c34324078d3343b878fe0f64aae2f02910c7766`, built independently
in `/tmp/git-workbench-p08-baseline-pczujF`, reproduces the identical assertion in **both** runs.
This matches the earlier P06 record; the full application-wide UI matrix is not claimed green.
Artifacts: `test-results/p08-final-full/` and the baseline's `test-results/p08-baseline/`.

The first broad run had 56 passes and two failures. The catalogue test now waits for Home's completed
page before scrolling; the pending-navigation correction also preserves distant search/ref targets
through watcher refreshes. The delayed-repository test now verifies cancellation rather than waiting
for the obsolete Git child to complete. Both pass in the subsequent broad run. The three new P08
scenarios also pass independently, including the added and removed sides of a committed diff selection.

New tests cover selected-code/directory lineage, attribution paths, binary Save As and destination
guards, immediate/owner/disposal cancellation, expired reflogs, exact merge-parent deltas, mailbox
Cancel/net staging, unusual path bytes and blame change projection. Three new Electron scenarios
cover the visible workflows, and existing F20/F21/F26/F36, search, desktop/preload and reference
workflows provide regression coverage. The delayed-history fixture now expects process cancellation
when switching repositories, while still asserting that the active tab never shows obsolete matches.
