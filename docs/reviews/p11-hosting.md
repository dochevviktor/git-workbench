# P11 — Hosting integrations

Implementation date: 2026-09-30. Linux baseline: Git 2.55.0, Node 24.13.0, npm 11.6.2 and the
committed Electron dependencies. This supersedes the dated F29/F30 and provider-account slices
within the researched Linux matrix below. It does not claim live provider authorization or exact
Fork parity for uncaptured integrations.

The [review correction below](#review-correction--2026-09-30) supersedes the original verification
statement. The saved F16 failure was missing from this handoff; a passing rerun did not resolve its
startup race. The corrections are now verified by 660 passing unit tests and 78 passing routine
Electron scenarios, with the original Git assertions retained.

## Phase requirements and provider matrix

| Provider                       | Account and repository workflow                                                                                                          | Activity and lifecycle                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub                         | PAT or registered public-client device OAuth; accessible repositories, paging, HTTPS/SSH clone selection and branch PR form              | In-app issues/PRs, state/author/assignee/title filters, saved searches, notifications; automatic renewal for returned expiring device credentials |
| GitHub Enterprise              | HTTPS server root, PAT, accessible repositories, paging, clone and branch PR form                                                        | In-app issues/PRs and notifications on the selected server; explicit PAT replacement                                                              |
| GitLab / GitLab Server         | PAT, HTTPS installation paths, member projects and nested namespaces, paging, clone and branch MR form                                   | Issues/MRs in the provider browser; explicit PAT replacement                                                                                      |
| Gitea                          | HTTPS installation path, PAT, repository paging, clone and branch comparison/PR handoff                                                  | Issues/PRs in the provider browser; explicit PAT replacement                                                                                      |
| Bitbucket Cloud                | Atlassian email and API token; paged accessible workspaces and owned/shared repository pages, clone and PR handoff                       | Issues/PRs in the provider browser; explicit API-token replacement                                                                                |
| Bitbucket Server / Data Center | Username and personal HTTP access token; HTTPS installation path, offset-based repository paging, clone and branch comparison/PR handoff | Provider browser; explicit token replacement; no fictitious built-in issue tracker                                                                |
| Azure DevOps                   | Existing account-independent branch PR handoff for dev.azure.com and SSH URLs, plus legacy visualstudio.com                              | Public evidence establishes PR creation, not a Fork Azure account form or in-app work-item browser                                                |

This table implements P11's provider interface/coverage requirement and the documented account,
enumeration, clone-selection, lifecycle, discovery and link workflows. Public Fork evidence establishes
GitHub notification and issue/PR discovery; other providers use their actual websites. Full review
editing remains unresolved as specified by the plan. Azure account enumeration is not invented from
its PR entry point. Alternative OAuth registrations for Bitbucket/GitLab/Gitea are not claimed.

Lifecycle policy: Sign out/Remove removes the app's credential and stops its API reads and notification
checks. **Manage tokens/Manage authorization** opens the selected provider's fixed credential-management
page for the user to revoke access remotely. It does not report that a remote credential has been revoked
merely because a browser was opened. PAT/API-token renewal is verified replacement; it does not create
tokens on the user's behalf. GitHub device OAuth renews returned refresh-token pairs automatically;
legacy non-expiring credentials remain readable. Expired/revoked refresh credentials or a changed
client registration require Reauthorize. No confidential client secret is bundled.

## Reference evidence and design

Read the catalogue START_HERE, dossiers, original cases and linked evidence:

- `P0-013-general-git-subcase:F1–F4`, Windows 2.22.0.0, 2026-09-19: preference tabs/grouped controls,
  original `screen-0123`, and Git invariance report. High confidence for that sampled composition only;
  its unobserved account forms remain unknown.
- `P1-012-local-clone-subcase:F1–F3`, same platform/date: original `screen-0295`, case and clone-after
  manifest. High confidence for the retained URL/Parent Folder/Name review and local Git outcome,
  not authenticated provider cloning. The account browser still hands off to that existing Clone form.

Ran `npm run research:references`: 226 public images present, no downloads/failures. Inspected
`win-2026-07-31-trackerwin2826-1-preferences-dark.png` (Windows, version unstated, dark) from
[TrackerWin #2826](https://github.com/fork-dev/TrackerWin/issues/2826), plus
`site-imagenotifications.jpg` (undated macOS light, version unstated) from the
[Fork product page](https://fork.dev/) and `mac-2026-02-25-tracker2562-1-toolbar-dark.png`
from [Tracker #2562](https://github.com/fork-dev/Tracker/issues/2562). Accessed 2026-09-30;
medium confidence for visible account controls and two-line notification cards. These are public
gaps, not newly captured Windows 2.22 cases.

Before comparison used the unmodified production build's legacy hosting captures. After comparison
used `test-results/p11-hosting-P11-opt-in-not-fff2a-tart-and-credential-removal/`:
`p11-account-light.png`, `p11-account-dark.png`, `p11-notifications-light.png` and
`p11-notifications-dark.png`. Provider forms/repositories and 780×600 dark captures are in
`test-results/p11-hosting-P11-Bitbucket--37012-ons-and-small-window-access/`.
Account actions and Enable Notifications align with the detail-value column. The compact bell,
repository/time card header and issue/PR title row follow the reference organization with independent
artwork and typography. Linux uses an app toolbar popover rather than macOS menu-bar integration.
At narrow widths toolbar labels collapse while explicit accessible names and every control remain.
The 880px legacy and 780px new overflow assertions pass without relaxed tolerances. The private
bundle is unchanged and no reference images/icons/avatars enter application assets.

Fresh public protocol sources, dates and confidence are recorded in
[the research record](../research/fork-public-surface.md#p11-hosting-source-refresh--2026-09-30).
In particular current GitHub documentation now supports expiring OAuth App device credentials and
client-secret-free renewal; the old assumption that device OAuth always requires manual renewal is
superseded. Bitbucket uses current API tokens and paged workspace enumeration, not obsolete app
passwords or the older global permission-list route.

## Ownership, persistence and bounds

New named notification/preferences/credential-management capabilities extend common runtime schemas,
explicit preload calls and authorized main handlers together. Old channels remain stable. All hosting
channels are denied to inspectors; change events go only to registered main windows on their exact
application document. Subscription cleanup removes the exact wrapper. Renderer code has no network,
filesystem, Git command or credential-storage capability. The established transient uncontrolled token
field is retained; tokens never become presentation state or response metadata.

One opt-in scheduler runs per GitHub/Enterprise account across main windows. It checks the first 100
unread items every five minutes, obeys X-Poll-Interval/Retry-After/rate-reset deadlines, backs off up to
one hour on ordinary failures and suspends authentication failures until explicit retry/replacement.
The inbox identifies additional pages rather than presenting a truncated count as a complete total.
The existing Accounts notification browser supplies paging/filters. Disabling, removing, replacing or
closing the last owner aborts/discards stale reads; revision guards protect snapshot delivery. No OS
desktop alert, remote mark-read mutation or polling for unrelated providers is claimed.

`hosting-preferences.json` is a separate version-1, atomic mode-0600 public preference file. It stores
notification choices and ten recent title phrases per account/repository/list kind, at most 40 groups.
Sign-out removes that account's preferences/history. Invalid originals remain untouched. Credentials
stay in the existing encrypted version-1 store; refresh pairs are encrypted inside the same secret
field, preserving legacy tokens and file layout. Renewal coalesces concurrent users, serializes with
credential writes and cannot restore a removed account. A 15-second private Git-helper socket budget
allows the existing bounded 10-second OAuth HTTP request; a real 5.2-second renewal regression verifies it.

All provider JSON reads are bounded to 4 MiB and requests deny redirects. Bitbucket workspace and
repository continuations are locally constructed, capped at 10,000 visible pages; server offsets are
translated into ordinary Previous/Next pages. Returned links never receive credentials. Bitbucket API
email/user and token are encrypted together; Git receives only the actual password and a safe username.
Cloud clone URLs use the opaque account ID to select the intended account, then the private helper
supplies `x-bitbucket-api-token-auth`. Bitbucket Server SSH defaults to port 7999 and explicitly requires
review for a different SSH host/port. Other existing conventional SSH defaults remain documented.

Self-hosted branch PR handoff requires a registered account origin/installation path; unknown origins,
escaped/traversing repository paths and ambiguous SSH installations are refused. It uses the existing
owned repository/local-branch/remote capability and preserves mapped upstream branch names. Public
hosting and Azure PR entry points still work without an account. Browser handoffs do not submit forms.

## Initial verification and limits

- `npm run check`: 652 passed, six existing opt-in/tool-dependent skips; type, lint and format checks pass.
- The original handoff reported build success and **74 passing Electron scenarios**, three skips and
  no failures. That statement did not acknowledge the saved F16 failure described below and is
  superseded by the review correction's verification record.
- Targeted P11/P02 Electron run: all seven scenarios pass. The production preload/renderer smoke and
  existing hosting/provider scenarios passed in the earlier focused run; the final full matrix includes them.
- Unit contracts cover pagination, origin/workspace guards, malformed responses, rate limits, expiration,
  revocation, offline errors, token replacement, renewal concurrency/restart/cancellation, notification
  opt-in/backoff/owner lifetime, preference corruption and credential removal. Shared IPC tests cover
  both-direction validation, sender/frame/inspector denial and exact event cleanup.
- Disposable Git verifies credential-helper delivery and unchanged HEAD/index/worktree through PR handoff.
  Routine API/OAuth/keyring responses are synthetic; no existing token file or real credential is read.

The initial broad run recorded 72 passes, three skips and one new 880px toolbar overflow failure.
After compacting the bell the first correction left 3px overflow; the final responsive correction
passes the original P02 assertion and the independent 780px P11 assertion. No tests were weakened.
The first new checkbox trial exposed delayed controlled-state feedback, corrected with immediate
selection and rollback on save failure. A subsequent locator used textbox for a datalist input;
using its existing label corrected that test without changing search behavior.

Live OAuth registration, provider organization/SSO policies, actual native keyring unlock/save,
Windows/macOS execution and native Wayland/display/accessibility matrices remain unverified. A live
check requires a deliberately configured test account, as the plan specifies. Provider browser pages
and remote revocation were not exercised live; generated URLs and UI handoffs were checked with fixtures.
Exact Fork authentication choices, tray behavior, default polling interval, alternate in-app provider
activity and full review editing remain unclaimed. The review correction below owns the current
verification status; broader parity/platform questions do not change the catalogue's capture status.

## Review correction — 2026-09-30

The review of `419b999` found the retained failure for
`tests/e2e/review-workflows.test.ts:274`, “F16 starts ordinary merge and rebase jobs from branch menus”.
It timed out after 30 seconds finding `Merge 'feature' into 'main'…`; Git had not started a merge.
The original artifacts remain in
`test-results/review-workflows-F16-start-54db7-base-jobs-from-branch-menus/` and `.last-run.json` records
that failed run. A fresh audit passed 74 routine scenarios and ten F16 repetitions, but a controlled
delay of the initial reference-context response reproduced the missing menu item. The test waited for
history, which can render before branch-action metadata. Context menus captured their initial entries
and never acquired Merge/Rebase when that metadata arrived. This code predates P11.

Corrections:

- Account creation, token replacement, account listing, sign-out and current issue/PR results no longer
  fail because optional preferences cannot be read or saved. Bounded public warnings use the existing
  validated account/activity/inbox response contracts. Unreadable notification choices default off;
  damaged originals remain unchanged and preference writes still report errors. Credentials remain
  visible and removable. Repair the preference file while the app is closed and restart to restore
  persistent choices/searches; no credential-store reset is required.
- Bitbucket Cloud guidance names `read:user:bitbucket`, `read:workspace:bitbucket` and
  `read:repository:bitbucket`, plus `write:repository:bitbucket` for push. A denied workspace read now
  identifies the missing permission to check. The mock workflow covers successful identity, denied
  enumeration, token replacement and successful enumeration. These are distinct API-token scopes in
  [Atlassian's documentation](https://developer.atlassian.com/cloud/bitbucket/rest/intro/#forge-app-and-api-token-scopes),
  checked 2026-09-30; the [workspace endpoint](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-workspaces/#api-user-workspaces-get)
  specifically requires workspace read. High confidence for provider semantics, not observed Fork behavior.
- Server notification deadlines live separately from inbox contents and timers. Disabling/re-enabling,
  replacing credentials or closing/reopening the last owner in the running app preserves the deadline.
  Both manual checks and newly scheduled checks consult it before fetching. Mock `Retry-After: 3600`
  trials verify that those resets cannot issue another check before the hour expires.
- Bitbucket repository continuation state is isolated by browsing owner and account and is released on
  cancellation, account replacement/removal or owner disposal. Cloud and Server tests interleave pages
  across two owners and verify cancellation cleanup. The current desktop exposes one main window;
  this closes the service-level defect found during review without claiming a new multiwindow UI.
- A reference menu opened before its initial metadata arrives can update only that still-open menu.
  The request handle becomes invalid when the menu closes or is replaced. Refreshing its initial entries
  resets highlight/submenu indices so an old index cannot select a different action. Repository identity
  is checked before updating; later normal refreshes still retain the reviewed menu snapshot. Backend
  Git preconditions and the original merge/rebase Git assertions are unchanged.

Reference evidence: `P1-006-noff-subcase:F1–F2`, original case, `screen-0246` and noff-after refs/graph
were inspected (Windows 2.22.0.0, 2026-09-19, high confidence for the captured menu route and Git result).
The delayed-read correction is independently specified Linux behavior, not an inferred Fork timing rule.
The previously inspected P0-013/P1-012 preferences/Clone evidence and public Accounts references retain
their limits. No reference assets, application styling or captured Git semantics changed.

Verification history for this correction:

- Before the fix, four new unit cases failed: corrupt preferences and three deadline-reset variants.
  The controlled F16 loading case also failed against the unchanged production build at the same
  missing Merge item (32.3 seconds total). Its trace is under
  `/tmp/git-workbench-p11-fixes-AxVPzP/before/` on this host.
- The first corrected targeted desktop run passed all four P11 cases and the ordinary/delayed F16
  cases. Two new fixture variants failed: the gate was installed before IPC registration, and a popup
  covered the attempted right-click target. The fixtures now wait for desktop readiness before
  installing the gate and click the other row's exposed edge; no assertion or timeout was weakened.
- `npm run check`: 660 passed, six existing skips; type, lint and formatting checks pass.
- All four F16 variants pass in the focused correction run. The controlled loading case falls from
  its pre-fix timeout to successful merge/rebase execution; dismissal/replacement retain their menu
  ownership checks. All four P11 desktop cases also pass, including credential management across restart
  with a damaged preferences file. The generated warning and Bitbucket guidance captures were inspected.
- `npm run test:e2e -- --output=/tmp/git-workbench-p11-fixes-AxVPzP/full-suite`: build passes and
  **78 scenarios pass**, with three existing skips, no failures and no automatic retries (5.2 minutes).
  This includes startup/preload isolation, legacy hosting, narrow-window assertions, all four F16
  variants and window lifecycle. The original failed artifacts were preserved; the fresh run's
  `.last-run.json` and screenshots are in the separate output directory above.
- A final formatting check and `git diff --check` pass after recording these results.

Tests use disposable repositories/profiles, synthetic credentials and provider responses. Live provider
authorization, actual OS-keyring behavior and native-platform parity remain unverified as above.
