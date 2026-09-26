# P03 — History, graph and revision inspection

Viewport follow-up (2026-09-26): the [runtime diagnosis and regression record](p03-viewport.md)
resolves the recurring 914-pixel assertion retained in later phase handoffs. It was a test race between
metadata rendering, the queued selection reveal and Playwright's automatic scroll before clicking.
The original pixel tolerance remains, with visible-anchor preconditions and additional paging cases;
production history/scroll behavior is unchanged.

Verified 2026-09-23 on Linux. P03's four requirements and three acceptance criteria are complete for
the bounded Linux implementation described here. This closes F04/F05/F07 and the P03 search portion
of F06, plus the existing F34 history-pane foundation. P08 investigation extensions and P12/P14
platform/workspace work remain separately owned. Historical started-slice descriptions are superseded
for this scope; this is not a claim of exact equivalence for every Fork variant.

## Behavior and boundaries

- History retains full object IDs, parent order, author/committer metadata, messages, reference kinds,
  peeled tags, HEAD and tracking information. Empty, detached and disconnected histories remain valid.
  The existing backend owns Git arguments; the renderer receives validated bounded pages.
- Graph rows remain virtualized. Collapse retains the selected secondary commit as a visible keyboard
  target, along with merge and decorated tips. Other hidden edges reconnect to visible ancestry.
  Loading newer pages anchors the visible commit; arrow/Page keys continue across page boundaries,
  and direct parent/HEAD/Home/End navigation uses bounded anchors. Home also scrolls the newly loaded
  first row into view. Sidebar selection navigates without checking out; a separate activation may check out.
- Sidebar search retains the four captured fields and two scopes, separate results and graph highlights.
  Commit SHA adds a case-insensitive full-ID/prefix search, with at least four hexadecimal characters,
  within the requested reachable history. It accepts no revision expression and does not search dangling
  objects. Ten explicitly submitted recent queries retain their field and scope, with recall and Clear.
  Search text/options/recent queries and reference expansion/filter/selection survive panel/tab switches
  within the open session; closing the repository releases them. Normal restart resets to HEAD/Commit.
  Recent-query storage is deliberately session-only; Fork's restart policy was not established.
- Reference trees, revision trees and search results virtualize after 200 rows, retaining the active
  descendant for keyboard navigation. Tree nodes report their actual sibling position/count.
- Commit details use compact headings, full-width separators and aligned metadata. Changed files have
  individual disclosures and Expand All/Collapse All. Inline committed diffs use the existing read-only
  viewer, including binary/large/error states, with viewport-triggered reads and cancellation on exit.
  File names still open the Changes tab. Lists reveal another 100 summary files on request; expanding all
  does not eagerly fetch all diffs. Each inline viewport is bounded at 300 px, a Linux adaptation.
- Immutable revision directories load in 5,000-entry pages using an optional validated offset on the
  existing capability. Further entries have a keyboard/click Load more row; errors retain previous
  entries and offer retry. Restored selections beyond page one load their directory pages again.
  Binary/oversized blob states remain explicit, and text containing HTML/scripts stays inert.

No new executable, dependency, generic IPC channel, remote request or repository mutation is introduced.
The shared schema, existing explicit preload method and main handler carry the directory continuation;
sender/frame/owner checks, inspector restrictions, sandboxing, context isolation and CSP are retained.
Bridge tests reject invalid input offsets and invalid returned continuations.

Limits remain explicit: 100 commits per history response; 200,000 IDs for direct navigation/hash search;
10,000 references; directory offsets up to 100,000 and 8 MiB of Git tree output per read; 10,000 changed
files with truncation indication; and a 1 MiB text-blob preview. Exceeding a read limit produces an
unavailable/error state, not a claim that the omitted data does not exist. The benchmark is not an
unbounded-history or prolonged-session guarantee. Persistent search history, multiple-reference filters,
directory/selected-code history, and general graph Back/Forward are not newly claimed Fork behavior.

## Catalogue and visual comparison

Primary observations: Windows **2.22.0.0**, 96 DPI, captures on **2026-09-19–20**, inspected **2026-09-23**.
Confidence is high for the recorded states, not for unexercised variants. Original cases, linked Git
snapshots and screenshots were read; `P0-007`'s before/after Git verification records unchanged checkout,
index, refs and worktree. The private bundle was neither changed nor copied into application assets.

| Case/finding                                    | Evidence and implementation comparison                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P0-003-baseline-subcase:F1–F2`, `P0-007:F1–F3` | `evidence/20260919T134747_498767Z_batch03-history-shell_530226/screen.png` and parent/Changes images `20260919T134839_792030Z_batch03-parent-selected_072ff7`, `20260919T134922_495972Z_batch03-parent-changes_e3b60b`: graph, underlined Commit/Changes/File Tree tabs, author/refs/SHA/parents, full-width separators and changed-file disclosures. |
| `P0-006:F1`                                     | `evidence/20260919T163205_531953Z_continuous06-sidebar-selection_7180da/screen.png` and `20260919T163323_343283Z_continuous06-sidebar-collapsed_484ead`: slash folders, checked current branch and independent selected revision.                                                                                                                     |
| `P1-029:F1`                                     | `evidence/20260919T152544_426406Z_continuous03-search-results_334a46/screen.png`, filters/empty/clear companion images: separate results, text highlights, graph markers and retained nonmatching rows. SHA and recent-query controls are documented extensions, not observed in this case.                                                           |
| `P2-017:F1`                                     | `evidence/20260919T160744_066549Z_continuous05-graph-top_1d8ac6/screen.png` and `20260919T160849_696248Z_continuous05-graph-bottom_4caa0b`: scrolling retains details; Home/End select the extrema. Its 351 commits establish no performance threshold.                                                                                               |
| `P0-011`, `P1-033`, `P2-015`                    | Retained bounded splitters, first/second-parent and HEAD navigation, in-session selection, and restart-to-HEAD/Commit policy. General graph Back/Forward and alternate Commit List Layout remain unestablished.                                                                                                                                       |

The public reference library was restored with `npm run research:references` and browsed by topic.
The [collapsible graph article](https://fork.dev/blog/posts/collapsible-graph/) (2020-08-03, Mac/Windows,
accessed 2026-09-23, high-confidence documentation) supports tip/arrow/context-menu collapse actions.
The [Windows 1.21 article](https://fork.dev/blog/posts/forkwin-1.21/) (2018-09-25, accessed 2026-09-23)
and its existing `blog-2018-09-25-forkwin-1.21-filelist-in-revision-summary.png` supplement inline
expansion, which P0-007 did not exercise. [Mac 2.9 release notes](https://fork.dev/releasenotes)
(2021-06-25, accessed 2026-09-23) document recent queries; applying them to Linux is an independent
extension. Neither source establishes current Windows matching/persistence rules.

Before: the existing catalogue-history Electron test passed and produced light/search/dark captures.
Compared with the originals, summary files lacked disclosures/Expand All, the message was oversized,
separators were inset and localized dates clipped at the right edge. After: P03's light inline-diff,
revision-tree, dark history and 880×600 captures show the added controls, aligned metadata, full-width
separators and sufficient date space. Accessible labels, checked HEAD, merge rings, lane geometry and
distinct focus/selection states convey information beyond color. Exact Fork fonts/colors and native
Windows/macOS framing are not asserted; GPG verification and the Linux minimum-size policy are retained.
Generated captures live under `test-results/p03-history-*/` and remain uncommitted.

## Verification and performance

`npm run check`: **507 tests pass**, one existing opt-in benchmark skip, with type/lint/format checks.
Production build passes. The routine graph/history/revision tests compare Git CLI ancestry, metadata,
trees and blobs for ordinary/octopus merges, reordered dates, tags, detached HEAD and multiple roots.
New tests cover SHA scopes/literal safety, retained collapse selection, 5,101-file directory paging,
bridge validation, inert content, second-parent navigation, recent queries, inline diffs and restoration
of a selected file beyond the first directory page. All fixtures and profiles are disposable.

The full headless Electron run executes 43 scenarios with the browser benchmark enabled: 40 passed,
one existing statistics skip, an obsolete collapse assertion, and the previously recorded F31/P12
Quick Launch chooser race (zero files after checkout). The collapse assertion was updated to require
the selected row to remain visible. The chooser failure matches the independent baseline reproduction
recorded in the [P02 handoff](p02-repository-sessions.md); P03 does not claim to fix it.
The final focused rebuilt run passes the five P03/history/desktop/interaction scenarios, including
the updated smoke test and the browser benchmark. Quick Launch reproduces the same independent
P12 failure in that run; the complete suite is therefore **not** claimed green.
After the final navigation correction, both rebuilt P03/catalogue-history workflows pass again,
including visible-row coordinates across prepend, arrow traversal into the newer page and Home's
selected-row visibility. The separate final browser benchmark also passes: first/warm display
926/449 ms, selection 41 ms, End 850 ms, tree paint 106 ms, SHA search 812 ms,
renderer heap 24.3 MiB and process growth 178.9 MiB.
An additional untouched archive of the current starting commit
`9edfd7f2d5504bd88c1f6a8fcfd56cc17d6cfe9c`, built with the same dependencies, reproduces the identical
Quick Launch failure at line 127. Its trace/error context are retained in
`/tmp/git-workbench-p03-baseline-FAHiBQ/test-results/`; this confirms the failure predates this phase.

Hardware: AMD Ryzen 9 7900X, 23.39 GiB exposed RAM, Fedora Linux x64 kernel 7.1.8-200.fc44,
Node 24.13.0, Git 2.55.0, committed Electron/Chromium dependencies. Electron uses the normal headless
software-rendered test route, with sandboxing enabled. No desktop bridge/IDE services were changed.

`P03_BENCHMARK=1 npm run test:e2e -- tests/e2e/p03-history.test.ts` creates **100,000 commits,
1,000 merge commits, 1,003 refs and 5,101 files**. Budgets were set before its first run. First display
and interactions await rendered state plus two animation frames; warm refresh observes actual
loading/completion. Cold means first application history read after reload, with an already-warm OS
filesystem cache; it excludes fixture construction and full process startup. Memory below is the
end-of-workload CDP heap and Electron process working-set growth, without forced GC, not a sampled peak.

| Browser measurement (full-suite run)       |          Observed |    Budget |
| ------------------------------------------ | ----------------: | --------: |
| First-page display                         |          1,467 ms | <5,000 ms |
| Warm refresh                               |            432 ms | <2,500 ms |
| Keyboard selection                         |             28 ms |   <250 ms |
| End to oldest commit                       |            817 ms | <3,000 ms |
| First large-tree paint                     |            125 ms | <3,000 ms |
| SHA search results                         |            813 ms | <3,000 ms |
| Renderer JS heap                           |          22.1 MiB |  <128 MiB |
| All Electron processes' growth             |         208.5 MiB |  <512 MiB |
| Mounted rows: graph / refs / tree / search | 40 / 32 / 22 / 41 | <150 each |

The separate `HISTORY_BENCHMARK=1 npx vitest run tests/unit/history-performance.test.ts
--reporter=verbose --silent=false` also passes on **100,000 commits/1,002 refs**: cold/warm backend
pages 312/314 ms, full graph 77 ms, collapse projection 129 ms, distant anchor 740 ms and sampled
read-operation peak RSS growth 284.6 MiB (512 MiB budget). This includes Vitest overhead and is separate
from browser memory. The first browser trial recorded 885/399 ms cold/warm display; the larger
full-suite observation is retained above rather than selecting the fastest run.
The final focused run records 934/430 ms first/warm display, 27 ms selection, 821 ms End,
125 ms tree paint, 813 ms SHA search, 41.9 MiB renderer heap and 181.4 MiB process growth;
all budgets pass, with the same bounded row counts.

Native Wayland frame/move/resize behavior was not changed or reverified. Native platform, screen-reader
and fractional-scale matrices remain P14; F21 directory/code-history work remains P08. No P03 acceptance
criterion is left unverified for the stated Linux baseline.
