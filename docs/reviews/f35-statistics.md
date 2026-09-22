# F35 repository statistics — 2026-09-22

The bounded Statistics/Treemap workflow is implemented through Repository > Statistics… and
Repository > Repository Treemap… (also discoverable through the existing Quick Launch projection).
P13 remains partial: F37 AI integrations are separate and unimplemented by this change.

## Evidence and independent semantics

Primary anchor: `P2-010:F1`, Windows 2.22.0.0, captured 2026-09-19, high confidence for the
sampled date range, monthly chart, contributor table/donut and selected-path Commits/Authors sidebar.
Read the original case JSON, screen-0515/0516/0517 and linked before/after manifests and graphs.
Those manifests span recovery operations; they do not establish read-only isolation or metric rules.
[Git log documentation](https://git-scm.com/docs/git-log), accessed 2026-09-22, supports NUL path
output, raw author fields and first-parent merge diffs. The following rules are independently authored:

- Resolve HEAD once, then traverse every reachable commit once. Other branches, reflogs and worktree
  edits are excluded. Empty commits and merge commits contribute to the total. Bare and detached
  repositories work; an unborn branch is empty. Shallow repositories explicitly show their limitation.
- Filter inclusively by author date converted to UTC. Months are calendar months in UTC with zero
  buckets between the endpoints. Empty endpoints mean the first/last matching commit date. This
  deliberately avoids Git's committer-date traversal pruning. Dates use four-digit ISO calendar years.
- Contributor identity is exact stored author name plus email. Do not apply mailmap, lowercase emails,
  or merge aliases. The table gives counts and shares; the donut shows five leaders and a remainder.
  The chart is the total per month, not a separate series for every contributor.
- A file count is the number of commits touching its exact path, including deletion and binary changes.
  Root changes compare with an empty tree; merges compare with their first parent. Renames count as
  delete/add, without historical path joining. A merge can therefore touch a file already touched by
  a side-branch commit. This is an activity measure, not an additive attribution of lines or bytes.
- File tile area is proportional to touches; folder area sums child-path touches. Recursive weighted
  binary splits alternate orientation. Select folders to drill down; root/up and a path filter support
  navigation. File selection supplies commit subjects/dates and author counts. An accessible path list
  and monthly-count table supplement the graphics.

## Boundaries and limits

`statistics.ts` defines strict input/output schemas, including count/reference consistency checks.
Named preload capabilities route through the existing sender/frame checks and repository ownership.
Inspector windows cannot call them. Main owns Git commands and metric computation; no renderer Git
executor, filesystem API, network operation or credential handling was added.

`StatisticsService` first scans compact HEAD-reachable object IDs and author timestamps, applies the
UTC date filter, and then reads metadata/file changes only for matching commits with `--no-walk --stdin`.
This preserves non-monotonic author dates without Git's committer-date pruning. At most two date-metadata
snapshots and two small range snapshots are cached for 60 seconds. Metadata keys include path, HEAD and
shallow status; range keys additionally include dates and limit scale. Range snapshots larger than
8 MiB of Git output are not retained. Refresh bypasses the cache; HEAD changes invalidate it.
Deepening a still-shallow repository may require Refresh or
TTL expiry. Replacement objects, mailmap, notes, external diff and textconv are disabled for this read.
The UI labels its snapshot and requires explicit Refresh rather than silently changing displayed totals.

Standard range bounds: 10,000 matching commits, 100,000 commit/path associations, 2,000 matching paths
and 16 MiB detailed log output. The user can choose Standard, 2×, 5× or 10× in Computation limit, then
Apply range/Refresh. The warning explicitly identifies CPU/memory cost, UI slowdown and the selected
deadline. This choice lasts while the dialog is open and resets to Standard on reopening. Shared schemas
validate the four choices and maximum result bounds; limits are enforced in main even on cached reads.
Errors name the exceeded range limit and suggest narrowing dates or raising the limit.

Independent safety bounds remain: a compact scan of 500,000 commits/40 MiB/10 seconds, 12,000 month
buckets, bounded strings and four concurrent reads. Metadata-scan-limit errors explicitly say they apply
before date filtering. Detailed log time scales from 8 to 80 seconds; overall cancellation deadlines
scale from 23 to 95 seconds. Only the named statistics preload request gets an extended deadline,
ten seconds beyond its backend budget. Other IPC deadlines are unchanged. Parsing/aggregation yield
periodically. Exceeding a bound returns an error, never a partial total.
Cancel calculation, unmount, tab close, window disposal and application disposal abort work; late
renderer results are discarded. Cancellation returns the existing structured Git cancellation error.
Cache is in memory only; no statistics file is written into a repository or user profile.

## Visual comparison and adaptations

Compared the original light Windows screenshots before styling and the generated Linux light/dark
screens afterward. The monthly orange line, contributor table beside a donut, neutral file tiles,
blue selected outline and right Commits/Authors sidebar follow the captured composition. Screenshot
review found and corrected an inherited narrow-dialog width, now guarded by an Electron assertion.
No private image or Fork artwork was copied into application assets.

Deliberate adaptations: one large owned modal with two views instead of separate native windows;
explicit date inputs and Refresh/Cancel; total monthly series; exact Unicode filenames; folder drill-down
rather than expanded nested folder tiles; defined weighted sizing; accessible tables/lists; and a
stacked layout at narrow widths. Fork's metric algorithms, date defaults and tile algorithm remain
unknown. Native independent-window controls, 125% scaling, screen-reader parity, invalid-UTF-8 filename
round-tripping and the P14 100k-commit performance baseline are not established by this slice.

## Verification

SillyTavern regression (2026-09-22): reproduced the old range-independent error in headless Electron
against the user-requested repository (HEAD `06bde939`, 11,805 commits). Its unfiltered scan hit 10,000
before the date filter. After correction, 2026-09-01–2026-09-14 returns 9 commits, 6 contributors and
102 paths at Standard; 2× returns all 11,805 commits, 488 contributors and 1,614 paths. Independent Git
timestamps/counts agree. An isolated application profile disables automatic fetch before opening;
refs, index entries and porcelain status are compared before/after and unchanged. No mutating fixture
commands run against that repository. The opt-in test is `statistics-existing-repository.test.ts` with
`STATISTICS_TEST_REPOSITORY` set explicitly; ordinary CI skips it.

A separate disposable fast-import fixture has 10,005 commits, deliberately out-of-order author dates
and different committer dates. It verifies that a two-commit range reaches both oldest and newest
commits, reads only those two diffs, an empty range succeeds, Standard all-history reports its exact
limit, 2× succeeds, and lowering the limit cannot reuse a larger cached result. The normal Electron
workflow checks the selector/warning and applies the raised limit.

- `tests/unit/statistics-service.test.ts`: independent fixture counts; UTC boundary, inclusive range,
  empty commits, merges, renames/deletions, Unicode/newline paths, empty repository, aliases despite
  mailmap, detached/bare/shallow repositories, cache reuse/refresh/HEAD change, malformed contracts,
  inspector denial, window ownership, active cancellation/tab-close/window-disposal and scan limits.
- `tests/e2e/statistics.test.ts`: actual production IPC, both menu views, contributor totals, path and
  folder selection, Authors details, date filter/empty state, Refresh after an external fixture commit,
  modal width, keyboard dismissal and visible Close at 760×640. Tests use temporary repositories.
- `npm run check`, production build and the Electron startup/preload smoke test are required gates.
  The command results and test totals are recorded in the implementation ledger.

Local screenshots are generated under the git-ignored
`test-results/statistics-F35-statistics--028b0--refresh-and-keyboard-close/` directory:
`f35-statistics-light.png`, `f35-contributors-light.png`, `f35-treemap-light.png`,
`f35-treemap-dark.png` and `f35-statistics-narrow-dark.png`.
