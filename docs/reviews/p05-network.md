# P05 — References, remotes and network operations

Linux implementation and verification, 2026-09-23; starting revision `e5c6c4f`.
This record covers P05's four numbered requirements and four acceptance criteria, using real Git
against disposable local remotes and authenticated loopback transports. It does not establish live
hosting-provider equivalence, Windows/macOS runtime behavior, or Fork's uncaptured variants.

## Behavior

- Branch creation, rename, tracking, clean/dirty/detached checkout, worktree guards and annotated-tag
  creation retain the existing snapshot and Recovery safeguards. Rename selects the complete name on
  opening, F2 opens it, and Delete opens local branch/tag confirmation. Create Branch suggests existing
  slash-separated folder prefixes. The captured empty Message still creates an annotated tag.
- Branches and Tags section menus now offer multi-reference deletion. Every selected reference is
  validated before Git starts; current and occupied branches are unavailable. Unmerged branches need
  an explicit choice. Stale Local Branches preselects branches whose configured upstream is gone in a
  review dialog; Cancel changes nothing. Batch deletion is local only and limited to 100 references.
- Delete Branch offers the captured corresponding-remote option, disabled without an existing remote
  upstream. Its exact remote/branch mapping is shown, including a differently named upstream. Remote
  deletion runs first and preserves the local reference on failure. Tag deletion has the same policy,
  reports any already-completed remotes, and rechecks local references after network work. No rollback
  across multiple servers is claimed. A created tag remains local if its subsequent push fails.
- Edit Remote saves the reviewed name, fetch URL and optional separate push URL in one visit. It
  validates all requested values before the first write and checks an opaque snapshot of the original
  URLs. Unchanged redacted URLs preserve their privileged values. Existing Git rename behavior updates
  branch tracking and the app carries over the automatic-fetch preference. Git commands remain
  sequential: an external lock/error after a successful step reports partial completion and rereads
  actual values. It does not promise an atomic transaction across config and remote-tracking refs.
- Push defaults to a compact single-branch source/destination form. A separate choice expands the
  existing multi-branch workflow. Create tracking reference is initially checked for untracked branches
  and can be declined. Push all tags includes lightweight and unrelated annotated tags; when unchecked,
  even configured `push.followTags` cannot publish additional tags. Individual tag pushes remain available.
- Force push first produces a backend-owned review: each destination, source ID, last-fetched remote
  ID and number of remote-only commits. Confirmation consumes a one-use token tied to window, repository,
  selection, exact source objects, tags and destination URL. Git receives an explicit expectation for
  each remote branch and exact object IDs as sources. Background fetch cannot change those expectations.
  An unknown remote tip requires that branch not exist; an existing unseen branch is refused. Changed
  local refs/URLs, cross-window tokens, reuse and expiry require a fresh review. Ordinary push never
  retries as force. Review uses no network request and assumes no current knowledge beyond fetched refs.
- Fetch retains prune/tags under Options; all-remotes starts unchecked. Pull retains explicit source
  and destination, merge/rebase and stash/reapply, with Fast-forward only under Options. A divergent
  FF-only pull reports a refusal; dirty rebase pull restores the local edit and retains a named Recovery
  copy, as the existing independently specified policy requires.
- Clone, Test Connection, automatic fetch and Activity retain their existing job/cancellation lifetime.
  Successful connection tests are green and running tests offer Cancel. Tag transfers now stream
  progress/output and use the network timeout. HTTP 401/403, SSH host-key errors, unreachable hosts,
  invalid destinations, missing upstreams and remote rejection give actionable messages.

## Authentication and resource boundaries

Connected GitHub accounts continue to use the main-process credential broker. Other HTTPS remotes use
installed Git credential helpers; SSH uses the user's configured SSH client, agent and native askpass.
Explicit work can prompt; background work suppresses standard prompts. No credential field, command
executor, token or filesystem access is added to renderer/shared code. Account retention remains opt-in
secure-keyring storage, with session-only fallback and refusal of plaintext persistence.

The new `repository:preview-push` capability is validated in contracts, preload and main. Inspector and
foreign-frame calls are denied. Reviews expire after five minutes, are capped at 64, are released on
tab/window disposal, and cannot repopulate a closed/reopened session. Reads have a ten-second total
deadline and two-MiB output bounds. Push has at most 50 branch targets; force plus all tags is bounded
to 1,000 tags and one push URL. More complex remotes remain available for ordinary Git operations, but
are not silently forced. The common-repository mutation queue revalidates and consumes the review.

Cancellation means the local process tree terminated, not that a remote write was undone. The new
accepting-receiver tests cancel during pre-receive and post-receive: the first leaves the old remote
tip, while the second retains the accepted new tip. Both terminate the fixture hook and preserve a
queryable cancelled Activity record. The existing message explicitly asks the user to refresh.

## Reference comparison

Primary reference: Windows 2.22.0.0, captured 2026-09-19–20, 96 DPI. Read the catalogue guide,
P1-001–005/P1-007–012 dossiers, original cases and linked Git records. Confidence is high for the
following captured states, not for unobserved variants:

| Case/finding                                                                   | Original screenshot under `docs/research/fork-reference-new/`                                                                                                                          | Applied comparison                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-001-create-rename-delete-subcase:F1–F2                                      | `evidence/continuous09/20260919T201951_926378Z_branch-rename-dialog_7554bd/screen.png`; `20260919T202059_551877Z_branch-delete-confirm_3ac564/screen.png` in the same directory family | Selected rename text, compact 500 px form, 570 px delete form and corresponding-remote checkbox.                                                                                      |
| P1-004-create-delete-tag-subcase:F1–F2; P1-004-empty-message-tag-subcase:F1–F3 | `evidence/continuous09/20260919T202145_484387Z_tag-dialog_58dadb/screen.png`; `20260919T202358_395328Z_tag-details_446b63/screen.png`                                                  | 590 px creation, 650 px inspection, optional annotation and Push, tagger/date above message. `evidence/continuous14/tag-object.txt` confirms the empty annotated object.              |
| P1-007:F1                                                                      | `evidence/20260919T163921_316479Z_continuous06-remote-edit_5e42c9/screen.png`                                                                                                          | 630 px Edit Remote, aligned name/URL, unchanged Edit disabled, green successful Test Connection.                                                                                      |
| P1-008-stale-fetch-subcase:F1–F4                                               | `evidence/continuous11/20260919T214913_332790Z_fetch-dialog_67b628/screen.png`                                                                                                         | 490 px Fetch, default remote, unchecked all-remotes and tracking refresh.                                                                                                             |
| P1-009-pull-rebase-subcase:F1–F3                                               | `evidence/continuous11/20260919T214254_082569Z_pull-dialog_d7e183/screen.png`                                                                                                          | 520 px Pull, explicit source/target and separate rebase/stash controls.                                                                                                               |
| P1-010-upstream-subcase:F1–F2                                                  | `evidence/continuous11/20260919T214555_926794Z_upstream-push-dialog_be8961/screen.png`                                                                                                 | 490 px Push, source/destination, checked tracking and unchecked tags/force. Linked upstream-after refs/status establish Git outcomes.                                                 |
| P1-011-delayed-local-cancel-subcase:F1–F5; P1-012-local-clone-subcase:F1–F3    | `evidence/continuous17/20260920T051942_106116Z_cancel-activity-open_14d5c9/screen.png`; `evidence/continuous09/20260919T203206_259878Z_clone-ready_e769d0/screen.png`                  | Existing separate cancellation-request/terminal states; compact Clone URL/parent/name and success feedback. Accepting-remote and credential outcomes come from our independent tests. |

Before/after Electron captures compare Fetch/Push with the initial built revision. Final light/dark,
880×600, rename, tag/create/details/delete, force-review, stale-branch and Pull captures are generated
by `tests/e2e/p05-network.test.ts` under ignored `test-results/`. The forms retain independently drawn
icons, Linux fonts, accessible focus, modal backdrop and accent-filled affirmative buttons. Additional
Options, Signing, hosted-repository handoff and explicit destructive review make some forms taller
than the captured Windows examples; widths and field alignment follow the observations. The first
visual pass exposed a CSS specificity collision; the final pass fixes it and tests icon/title separation.

Public supplements accessed 2026-09-23: [Git push](https://git-scm.com/docs/git-push) documents explicit
lease expectations and the interaction with background fetch; [Git credentials](https://git-scm.com/docs/gitcredentials)
documents helper/askpass ordering. [Fork Windows release notes](https://git-fork.com/releasenoteswin)
(1.74, 2022-05-20; 2.16, 2026-02-20) document multi-reference deletion and stale-branch selection;
[Mac notes](https://git-fork.com/releasenotes) (2.10, 2021-07-23) document branch-folder completion.
Confidence is high for these published capabilities; our selection dialog and exact-lease policy are
independent designs. The public screenshot cache was restored (226 present, no downloads) and browsed
by topic. No private evidence changed and no reference image or Fork asset enters the application.

## Verification

Environment: Linux x64, Node 24.13.0, Git 2.55.0, installed OpenSSH, sandboxed headless Electron.

- `npm run check`: **531 passed**, one existing opt-in skip; types, lint and formatting pass.
- `npm run build`: production main, preload/helper and renderer bundles pass. Existing upstream
  annotation and renderer bundle-size warnings remain non-failing.
- Relevant Electron regression run: **15 passed**, covering P05, desktop/preload isolation, catalogue
  clone/tags, mapped pushes and checkout/pull/recovery, hosting/signing and all three close routes.
  The three P05 scenarios also pass after the final URL-guard hardening; the Clone form has an
  additional successful Test Connection/Cancel capture with no destination created.
- Full routine Electron run: **43 passed, two opt-in skips, two failures**. Quick Launch's file-history
  chooser returned zero options; it fails identically on untouched starting revision `e5c6c4f` in all
  three isolated baseline replays. Bisect had a transient Git command failure, then passed the unchanged
  targeted replay and all three baseline runs. An earlier desktop long-line-layout timing assertion also
  passed both subsequent runs. No fix to those P08/P12 checks is claimed and the full suite is not green.
- `git diff --check` passes. No production dependency or lockfile changes were needed.

- Disposable Git tests cover clone/fetch/push/divergence, ordinary rejection, explicit lease rejection
  after a later fetch, source/URL/token guards, all-tag semantics and tracking opt-out, remote editing,
  local/remote deletion, batch worktree/current guards and deleted-upstream state.
- Existing authenticated TLS tests execute real clone, connection test, fetch, pull, push, expired-token
  rejection and account sign-out through a loopback-only proxy. Redaction and unchanged Git config are
  asserted; no provider is contacted.
- A new real OpenSSH test starts a fixture-only loopback sshd and agent with disposable host/user keys,
  unlocks an encrypted key through askpass, and completes clone/fetch/FF pull/push in silent mode using
  the agent. Removing the key produces an authentication failure. No installed service or user SSH file
  changes. A separate real Git credential prompt is cancelled and its askpass PID is verified gone.
- New preload/IPC tests validate request and result schemas, sender/frame/inspector restrictions.
- Three new Electron workflows cover compact forms, remote rename+URL save, tracking opt-out and setup,
  all-tag push, annotated empty-message tag push/details/Delete-Cancel, FF-only refusal, dirty rebase
  pull, frozen force review, stale multi-delete/Cancel, F2 selection, and light/dark/small-window geometry.

Live provider authorization/rate limits, actual OS-keyring unlock/save, Windows/macOS helper dialogs,
hardware SSH keys and native Wayland window mechanics are unverified. They remain platform/provider
matrix work; this phase does not claim to reproduce uncaptured Fork authentication. No live account,
remote repository or desktop bridge/IDE service was changed. Broader public reference pinning/hiding,
custom sorting and worktree deletion integration are not represented as part of P05's verified lifecycle
requirements; the larger F12 family retains these explicit limits.
