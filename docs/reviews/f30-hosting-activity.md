# F30 — GitHub issue/PR discovery and notifications

Date: 2026-09-22. Verified GitHub.com workflow; P11 remains partial.

File → Accounts → Notifications loads a paged inbox with unread/all and participation filters.
Repositories → Browse issues / Browse pull requests opens repository-scoped searches with state,
author, assignee and title phrase filters. Apply filters resets paging; Refresh reloads the current
page. Up to ten recent title phrases per list survive navigation within the Accounts dialog, with
at most forty lists retained. Closing Accounts discards that history; sign-out clears its account.
Rows show repository, title/number, updated time and state or notification reason/unread metadata.
Titles open validated GitHub destinations in the system browser. Unknown notification subject types
open the repository-filtered GitHub inbox. Opening does not issue a mark-read API request.

Requests are explicit GETs, bounded to 100 items and 4 MiB. Search caps at ten pages/1,000 results and
reports incomplete results. Provider error bodies and transport exceptions never cross IPC. Strict
request/result schemas reject extra paths, URLs and secrets. Inspector frames are denied. Main keeps
only the latest activity page per window, validates item selection, aborts sign-out/cancel reads, and
rejects late replies after account/page replacement. Local Git remains usable without accounts.

## Evidence and design comparison

The catalogue entry points and alignment record establish that authenticated hosting is not captured;
there is no matching original Windows 2.22.0.0 case or screenshot to claim for F30. Existing clone
evidence remains F29's P1-012 and was not changed by this work.

Read the public Windows release notes: 1.61 (2021-04-09) adds notifications; 1.62 (2021-05-07) adds
author/assignee filters and recent issue/PR queries. The product-page notification image supplies
repository/title/time grouping, but is undated macOS imagery with unstated version. See the dated
[research entry](../research/fork-public-surface.md#f30-github-lists-and-notifications--2026-09-22)
and [alignment entry](../research/fork-catalogue-alignment.md#f30-alignment-checkpoint--2026-09-22).

Ran `npm run research:references` (226 present). Inspected `site-imagenotifications.jpg` before styling
and compared the independently authored `f30-notifications.png`, `f30-pull-requests.png`, and dark
variant from the headless hosting scenario. The app preserves repository/title/time hierarchy using
existing Accounts navigation and theme tokens. A modal inbox, explicit Refresh/filter controls,
pagination, plain text in place of remote avatars, and no macOS tray surface are deliberate adaptations.
No reference image or bundled artwork enters the application.

## Verification

- `npm run check`: type checks, lint and formatting pass; 376 tests pass, with one existing skip.
- `npm run test:e2e -- tests/e2e/hosting.test.ts tests/e2e/desktop.test.ts`: production build, sandboxed
  preload/startup smoke and hosting workflow pass headlessly. The hosting scenario was rerun after
  the final recent-search/context changes.
- Unit contracts cover scoped queries, author/assignee/phrase handling, search limits, notification
  pagination, hostile subject/Link URLs, malformed and foreign-repository payloads, authentication,
  permission/rate-limit/server errors, window-owned selection, stale pages and sign-out cancellation.
  Shared F29 transport coverage retains offline, oversized-body and timeout/cancellation checks.
- Preload/routing tests check strict requests/results, fixed channels and inspector/subframe denial.
- Electron verifies real issue/PR/notification views, empty filtered results, safe browser paths,
  HTML-like titles as inert text, notification filters, sign-out and no saved credential file.

After implementation, ran the opt-in script:

```sh
npx esbuild scripts/verify-github.ts --bundle --platform=node --format=esm --outfile=out/verify-github.mjs
node out/verify-github.mjs --live
```

Authenticated identity, repository enumeration, issue search, PR search and notification reads passed.
The token was read into memory from `.idea/.githubtoken`, never printed or copied. Only aggregate
pass/failure labels were output; no account, repository, item or raw response details were recorded.
No live remote mutations, browser actions or clones were performed. Live second-page coverage is not
claimed; paging/error cases use synthetic responses.

## Remaining limits

Automatic polling, tray/desktop alerts, remote mark-read/subscription actions, persisted recent
searches, full in-app review editing and non-GitHub providers remain outside this slice. Notifications
need GitHub's supported classic token scopes; fine-grained tokens cannot use that endpoint. Search
depends on GitHub indexing and its 1,000-result cap; it is not an exhaustive offline repository database.
Exact current Windows list geometry and behavior remain unobserved. The broader keyring and native
platform matrix remains F29/P11 work. No window-frame behavior was changed.
