# Review of the implementation through F13

Reviewed **2026-09-19**, baseline commit **475de44**, Fedora Linux x64, Node **24.13.0**,
Git **2.55.0**. The worktree was clean at the start. The original review made no application changes.
The requested remediation was implemented and verified on **2026-09-19**, as recorded below.
Original finding descriptions and line numbers refer to the baseline, not the corrected implementation.

The missing checkout/pull dialogs are real workflow gaps. The Pull screenshot was already available
and was overlooked; a public checkout screenshot has now been located and indexed. The review also
reproduced ten behavioral defects and measured two sources of unnecessary work.

## Remediation verified — 2026-09-19

All twelve findings are addressed, with permanent regression coverage in
[review-regressions.test.ts](../../tests/unit/review-regressions.test.ts) and
[review-workflows.test.ts](../../tests/e2e/review-workflows.test.ts), alongside the existing suites.

| Finding | Resolution                                                                                                                                                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1      | Literal filename policy on file-oriented Git commands; inherited pathspec modes removed. Wildcards, brackets, and leading-colon filenames affect only the selected file. The policy deliberately does not alter Git's internal stash pathspecs.                        |
| R2      | Pull validates its reviewed destination, tip, and reference snapshot inside the common-repository write queue. Network and local writes share that queue.                                                                                                              |
| R3      | Git supplies the exact upstream remote and branch. Push shows editable destination branches and sets upstreams per selected branch, preserving existing tracking in mixed selections.                                                                                  |
| R4      | Full reference namespaces are retained for branch/tag creation and tracking. Remote names and HEAD labels are derived from full refs; branch/tag and local/remote name collisions have regression fixtures.                                                            |
| R5      | Commit and reference channels return accepted jobs; structured terminal results remain queryable. Events have monotonic revisions, and late replies cannot replace terminal state. A real checkout hook exceeding the old 15-second deadline passes the Electron test. |
| R6      | F5 refreshes the selected diff; live working/amend diffs poll with an in-flight guard. Changed snapshots invalidate line selection.                                                                                                                                    |
| R7      | Tab polling reads current HEAD and hashes reference state, invalidating dependent views when external operations change them.                                                                                                                                          |
| R8      | Remote DTOs redact URL credentials. Unchanged display URLs preserve their backend values; edited redaction placeholders are rejected.                                                                                                                                  |
| R9      | Git's full upstream reference and tracking state determine whether it is gone, including local upstreams.                                                                                                                                                              |
| R10     | Activity is constrained to the viewport, including the minimum window and zoom. Its rows support keyboard selection and focus restoration.                                                                                                                             |
| R11     | A no-collapse fast path avoids ancestry scans; active collapse bounds ancestry traversal using topological position.                                                                                                                                                   |
| R12     | Stable topology uses filesystem identity checks; identical in-flight reads are coalesced with bounded concurrency. Writes invalidate read-sharing epochs so mutation-time revalidation cannot reuse a pre-write read.                                                  |

The missing branch workflows are also implemented: local-change checkout choices, explicit-source Pull
with merge/rebase and stash/reapply, inactive-branch fast-forward, mapped Push, and a PR browser handoff.
Pull on an inactive branch explicitly states that it will check that branch out first. Fast-Forward
updates an inactive branch without changing the current worktree. Both refuse branches checked out in
another worktree.

Stash/reapply and checkout Discard retain named recovery copies of staged, unstaged, and untracked work.
A versioned per-worktree journal and pinned Git refs survive restart; Recovery exposes apply, resolution
acknowledgement, and merge/rebase continue/abort. Recovery actions validate the reviewed state again,
including the state captured when Abort confirmation opened. Dismissing a recovery entry leaves Git's
stash list untouched. Nested-repository/submodule changes and oversized previews are refused explicitly.
Conflict files can be edited externally, staged in Local Changes, and continued from Recovery; a full
three-way conflict editor remains P06 work.

Verification on this Fedora host:

- `npm run check`: **239 tests in 19 files**, type checks, lint, and formatting pass.
- `npm run test:e2e`: the production build and **three headless Electron scenarios** pass with sandboxing
  enabled. Coverage includes dialog fields and cancellation, explicit inactive Pull intent, differently
  named upstreams, mixed push selections, live diff refresh, tracking selection, keyboard activity access,
  minimum-window/zoom geometry, a captured PR browser handoff, and tab switching during a real slow hook.
- Disposable-repository tests verify merge and rebase success, conflict continue/abort, staged-state
  preservation, retained recovery copies after restart, stale preview rejection, and linked-worktree
  fast-forward refusal using independent Git assertions.
- The same synthetic 4,001-commit projection measured approximately **7 ms**, down from **694 ms**.
  Routine Git process counts changed from **8/14/9/16** to **1/9/2/11** for working changes, reference
  context, remotes, and commit context respectively. These measurements are not a large-repository
  performance certification.
- Light/dark dialog captures and activity output were compared with the local Fork library before and
  after UI work. All **226** public references remain git-ignored and outside application assets.

The PR action opens the hosting site's form for GitHub.com, GitLab.com, Bitbucket.org, or Azure DevOps;
it does not submit a PR or add account integration. The live provider forms, other operating systems,
screen readers, native window-manager interactions, full history virtualization, and the planned
100,000-commit performance baseline were not verified here. Phase statuses remain partial.

## Priority findings

P1 means a correctness issue that can change something other than the user's selected target.
P2 means a functional, confidentiality, responsiveness, or usability issue to address in stabilization.
The reproductions below use disposable repositories and local bare remotes; no mutating test ran
against the development repository or a real hosting account.

### R1 — P1: selecting one filename can stage other files

[staging-service.ts](../../src/backend/repositories/staging-service.ts), lines 228–236, passes filenames
directly to `git add`/`reset`/`rm` after `--`. That ends option parsing but does not disable Git pathspec
patterns. The same problem exists in [diff-service.ts](../../src/backend/repositories/diff-service.ts),
which can return changes from more than the selected file.

Reproduced: commit files literally named `note*.txt` and `notes.txt`, modify both, then call the service
to stage only `note*.txt`. An independent `git diff --cached --name-only` lists **both files**.
This violates the selected-file boundary and can put unrelated content in a commit.

Fix direction: use literal pathspecs consistently for file-oriented commands and normalize inherited
pathspec environment flags. Cover wildcard characters, brackets, leading colons, and pathspec magic in
both read and mutation tests. Git documents this distinction in its
[pathspec controls](https://git-scm.com/docs/git#Documentation/git.txt---literal-pathspecs).

### R2 — P1: a queued Pull can update the wrong branch

[repository-service.ts](../../src/backend/repositories/repository-service.ts), lines 575–608, captures
HEAD and plans the operation before acquiring the mutation queue. The queued callback neither
revalidates that HEAD nor binds the command to it. [network-service.ts](../../src/backend/repositories/network-service.ts),
lines 68–75, executes a pull against whichever branch is current when Git starts.

Reproduced with a controlled runner gate: start checkout from `main` to `topic`; while checkout is
queued/running, request Pull; release checkout. The operation reports **Pull 'main': succeeded**, but
`main` stays unchanged and `topic` advances to its own upstream. Both mutations used the real service
and Git; only their scheduling was controlled.

Fix direction: capture the user-selected target in the request and revalidate HEAD/upstream inside
the queue immediately before execution. Reject changed intent with an actionable refresh result.
Coordinate shared-ref writes across linked worktrees as well as per-worktree writes.

### R3 — P1: Push ignores a differently named upstream destination

[NetworkDialogs.tsx](../../src/frontend/react/components/NetworkDialogs.tsx), lines 193–201, always sets
`remoteBranch` to the local branch name. It uses the upstream only to infer a remote and does not show
the destination branch. The backend contract already accepts a separate destination.

Reproduced through the actual Electron UI: local `topic` tracks `origin/main`; click Push and confirm
the preselected branch. The app creates **origin/topic**, while tracking remains **origin/main**.
The intended upstream is not updated. This is a misleading default in an implemented action, beyond
the documented absence of an arbitrary destination editor.

Fix direction: obtain the exact configured remote and destination ref from the backend, show both,
default to that mapping, and permit deliberate overrides. Test differently named branches, remotes
whose names share a prefix, separate push URLs, and mixed selections with/without upstreams.

### R4 — P1: shortening an explicit branch ref can tag the wrong commit

[reference-service.ts](../../src/backend/repositories/reference-service.ts), line 449, resolves an
explicit `refs/heads/topic` selection back to the ambiguous name `topic` before invoking Git.

Reproduced: a tag `topic` points at an older commit and branch `topic` points at a newer commit.
Create Tag from that branch reports success but the new tag points at the **older tag's commit**.
Create Branch from the same selection instead fails with an ambiguous-object error.

Fix direction: retain full ref names or resolve and pin the selected object ID while checking the
snapshot. Preserve explicit tracking separately. Cover branch/tag and local/remote-name collisions.
[Git's revision disambiguation rules](https://git-scm.com/docs/git-rev-parse#_specifying_revisions)
explain why the short name does not preserve the selected namespace.

### R5 — P2: slow commits outlive the request that reports their outcome

[create-desktop-api.ts](../../src/backend/preload/create-desktop-api.ts), lines 16–30, gives every
ordinary request 15 seconds. [commit-service.ts](../../src/backend/repositories/commit-service.ts)
allows a commit 120 seconds, as does checkout in the reference service. These operations do not use
the job mechanism introduced for network work.

Reproduced using the real preload adapter and a service runner delayed for 16 seconds before commit:
the caller received **TIMEOUT at 15,000 ms**, then Git successfully created the commit. The renderer
has no completion subscription for it, retains the draft, and can offer another attempt. The checkout
case shares the same lifetime mismatch; it was inspected in code, not separately delayed in this run.

Fix direction: extend queryable operations to commits/checkouts that can run hooks, filters, or signing
programs. Preserve drafts while the result is pending; do not interpret a request timeout as failure
or invite retries before reconciling the outcome.

### R6 — P2: external edits leave the selected diff stale, even after F5

[use-repository-diff.ts](../../src/frontend/react/hooks/use-repository-diff.ts), lines 94–105, reloads
only when the repository, target key, or whitespace mode changes. Status polling changes none of
those. [ChangesView.tsx](../../src/frontend/react/components/ChangesView.tsx), lines 326–331, handles
F5 by refreshing the list without refreshing the selected diff.

Reproduced in Electron: display `first draft`, replace it externally with `later draft`, press F5,
and allow a polling interval to pass. The diff still displays **first draft**. Backend snapshot
validation protects hunk mutations, but the advertised refresh cannot repair the stale preview.

Fix direction: make explicit refresh invalidate the diff and use bounded content-aware invalidation
for external changes. Preserve selection, but replace obsolete snapshots and line selections together.

### R7 — P2: tab polling preserves an obsolete HEAD

[repository-service.ts](../../src/backend/repositories/repository-service.ts), lines 972–976, refreshes
only `workingTree` when `listOpen()` is polled. The old `head` is spread back into the result.

Reproduced: open `main`, externally check out `topic`, then call the normal tab polling endpoint.
It still returns **main**. In the History view there is no periodic HEAD/history refresh to repair it;
another query or explicit refresh is needed. The toolbar can therefore name the wrong current branch.

Fix direction: invalidate/publish HEAD and reference generations along with worktree status. Keep the
toolbar, sidebar, history, diff, and action availability on the same repository generation.

### R8 — P2: configured URL credentials cross into renderer state

[remote-service.ts](../../src/backend/repositories/remote-service.ts), lines 33–42, returns the raw
fetch and push URLs. IPC validates their string shape but does not redact them. The URL-redaction
code used by operation output does not cover these DTOs.

Reproduced with a dummy credential in a temporary remote URL, without contacting a server:
`listRemotes()` returns the embedded credential in `fetchUrl`. These DTOs feed renderer state and
the remote-edit fields. This violates the repository rule keeping credentials out of the renderer.

Fix direction: separate display URLs from privileged connection data. Editing an unchanged displayed
URL must preserve the backend value without a secret round trip; an intentional replacement should
have explicit semantics. Cover fetch URL, push URL, and Git URL rewrites.

### R9 — P2: an existing local upstream is marked gone

[reference-service.ts](../../src/backend/repositories/reference-service.ts), lines 105–109, treats an
upstream absent from the remote-branch set as deleted. The upstream action and Git also support a
local branch as upstream.

Reproduced: set `topic` to track local `main`, which exists. The context reports `upstream: main`
and **upstreamGone: true**. The sidebar consequently gives an incorrect stale-branch warning.

Fix direction: determine existence from the full configured upstream ref, not membership in only
the remote-tracking namespace. Test both local and remote upstreams and genuinely deleted refs.

### R10 — P2: the activity panel extends outside the supported window

[styles.css](../../src/frontend/react/styles.css), lines 3014–3022, anchors a 720px activity panel to
the centered repository control without constraining its right edge. The declared minimum window
width is 880px.

Reproduced in headless Electron at that supported size: the panel's right edge is **1053px** in an
**880px** viewport. Its command/result details are clipped. The existing F13 smoke screenshot also
shows this, despite the test passing. This is a geometry defect independent of pixel-perfect Fork parity.

Fix direction: position within viewport bounds and test supported minimum size and zoom. The activity
list additionally has mouse-only selection in code; keyboard access should be included in its acceptance.

## Measured inefficiencies

### R11 — P2: graph collapse analysis runs even when nothing is collapsed

[history-collapse.ts](../../src/common/history-collapse.ts), lines 55–69, traverses the ancestry of
every merge even with an empty collapse set. The history view executes this synchronously in the
renderer whenever the loaded commit list changes.

A synthetic repeated-merge history, with no collapsed commits, took approximately:

| Loaded commits | Merge commits | Projection time |
| -------------- | ------------- | --------------- |
| 1,001          | 500           | 46 ms           |
| 2,001          | 1,000         | 163 ms          |
| 4,001          | 2,000         | 694 ms          |

This isolates an algorithmic cost; it is **not** a real-repository performance baseline or satisfaction
of P03's 100,000-commit criterion. Add a no-collapse fast path, avoid repeated ancestor traversal when
collapse is active, and profile with actual merge-heavy history. DOM `content-visibility` cannot reduce
this computation. Full row virtualization also remains unfinished, as the plan already acknowledges.

### R12 — P2: routine reads repeatedly rediscover and rescan the same repository

[repository-service.ts](../../src/backend/repositories/repository-service.ts) calls `discover()` from
`refreshOpenRepository()` for most queries. Discovery issues six topology/HEAD commands plus status;
the domain service then performs its own reads, often including another status.

Instrumenting a one-commit repository with no remotes produced:

| Query             | Git processes | Status scans |
| ----------------- | ------------- | ------------ |
| Working changes   | 8             | 2            |
| Reference context | 14            | 2            |
| Remotes           | 9             | 1            |
| Commit context    | 16            | 2            |

The working-changes query repeats every five seconds while that view is open, alongside the independent
tab status poll. Remotes add two processes per configured remote. Counts are measured; the larger
repository impact is unmeasured. Cache stable topology, coalesce compatible reads, bound concurrent
refreshes, and invalidate mutable data by generation. Keep mutation-time revalidation.

## Baseline missing workflows and design drift

The current plan consistently labels F01–F13 as **partial**, but its slice narrative allowed command
availability to stand in for completion of the user workflow. That is the central planning problem.

| Workflow raised by the user                           | Current implementation                                                                                          | Review conclusion                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Checkout local branch                                 | Sidebar and toolbar invoke checkout immediately; Git may carry safe local changes or refuse conflicting changes | Missing local-change policy dialog and the associated preservation/discard recovery workflow              |
| Fast-forward selected local branch to upstream        | No menu entry or backend action; only current-branch `pull --ff-only` exists                                    | Missing F13 workflow; inactive-branch fast-forward is not equivalent to current-branch pull               |
| Pull selected remote branch into a named local branch | Toolbar/menu starts an operation immediately; the request contains only `kind` and `prune`                      | Missing dialog and explicit source/destination contract                                                   |
| Push to source remote                                 | Generic Push dialog exists                                                                                      | Partial; destination bug R3 must be corrected and the mapping shown                                       |
| Create Pull Request on source remote                  | No branch action or browser-handoff capability                                                                  | Deferred by the original hosting plan, but an important early workflow gap under the user's stated target |

The local branch menu in [App.tsx](../../src/frontend/react/container/App.tsx), starting at line 960,
goes from checkout to disabled merge/rebase, then new branch/tag, then push. It lacks the requested
fast-forward, pull, and pull-request group. The two dialog request unions and shared contracts cannot
express the missing choices, so adding labels alone would not implement them.

The evidence is stronger than the original research recorded:

- The complete Windows Pull screenshot from **2025-11-25** was already downloaded. It shows source
  selectors, the Into branch, both checkboxes, and action buttons.
- Two public Windows screenshots from an article published **2023-04-29** have been added: the
  checkout local-change radio group and a full Push dialog with separate source/destination fields.
  They establish historical visible controls, not current defaults or internal behavior.
- The already downloaded official **2018-11-10** fast-forward screenshot was categorized as a dialog
  despite showing a branch menu. It has been recategorized by workflow.
- The existing **2026-03-24**, stated Windows **2.18.0.0**, cropped branch menu shows upstream
  fast-forward, push, and pull-request creation. A crop cannot establish the full menu.

Exact URLs, dates, confidence, and platform qualifications are recorded in the
[research correction](../research/fork-public-surface.md#f01f13-workflow-audit-and-reference-correction)
and [reference manifest](../research/fork-references.json). Linux follows the Windows target.

The original P05 plan explicitly defers merge/rebase pulls to recovery work in P06/P07, and stash
recovery is in P06. That explains why those behaviors were not enabled, but not why the dialog itself
and its missing dependencies disappeared from acceptance criteria. Under the requested usefulness
target, bring the necessary stash and conflict recovery work forward with these dialogs. A disabled
checkbox or a successful happy-path invocation must not be presented as a completed option.

Likewise, distinguish a validated browser handoff for creating a PR from the account setup, PR lists,
and notifications currently grouped in P11. The handoff can have independent acceptance criteria without
completing all of P11.

## Recommended stabilization sequence and acceptance

1. **Correct mutation targets and operation lifetimes.** Address R1–R5 and R8 before expanding the
   mutation surface. Regression fixtures must verify selected/unselected paths, full ref identity,
   destination refs, queued branch changes, slow hooks, and terminal operation outcomes independently
   with Git. Capture expected state before user confirmation and revalidate it inside the write queue.
2. **Complete the branch interaction workflows.** Share action definitions across sidebar, toolbar,
   and menus; add explicit fast-forward and pull targets, the checkout local-change dialog, and the
   Pull dialog. Include the minimum recovery services needed by each enabled option. Add the earlier
   PR browser handoff separately from full hosting integration.
3. **Repair refresh, scale, and accessibility.** Address R6–R7 and R9–R12, maintain one repository
   generation across dependent views, and verify keyboard selection and minimum-window geometry.
4. **Review every acceptance workflow against evidence.** Keep F01–F13 partial until their remaining
   criteria actually pass. Record implementation, missing controls, failure states, and evidence
   separately; screenshot collection alone must never count as verification.

For the two requested dialogs, acceptance should explicitly include:

- Checkout cancellation changes nothing. Preserving changes either carries them safely or explains
  Git's refusal. Stash/reapply preserves intended staged/unstaged state, retains recoverable data on
  checkout failure or apply conflict, and exposes recovery after restart. Discard previews its exact
  tracked/untracked scope, requires explicit intent, and revalidates the displayed state.
- Pull shows the selected remote, source branch, and read-only destination before starting. It handles
  no upstream, a deleted upstream, differently named branches, divergence, dirty files, and branch
  changes while queued. Rebase/stash options preserve recovery state on conflict or cancellation and
  report the operation that actually ran. Fast-forwarding an inactive branch leaves the current
  worktree untouched and refuses a branch checked out in another worktree.
- Menu availability and fields are exercised in Electron for current/inactive/local-only/tracking
  branches, with Keyboard/Cancel paths, light/dark comparison, and the supported minimum window.

These were the proposed implementation criteria at review time. The remediation record above now
supersedes the baseline for this stabilization slice; wider phase acceptance remains open.

## Original review verification and limits

- `npm run check`: passed type checks, lint, formatting, and **214 tests in 18 files** at baseline.
- `npm run test:e2e`: passed the existing **one headless Electron scenario** and its production build;
  sandboxing remained enabled and no window was opened on the user's display.
- Ten additional temporary diagnostic cases exercised the real services, a controlled scheduling gate,
  the real preload deadline, a second headless UI run, and the two measurements above. Their assertions
  identify the current defects; they are not a replacement regression suite or claims of correctness.
- `npm run research:references` restored the initial **224** references. The updated manifest adds two
  public screenshots and gives the relevant existing images workflow topics and precise descriptions.
- Diagnostic sources and extra screenshots are local temporary artifacts in
  `/tmp/git-workbench-review-8Gg0tT/`; repository fixtures and isolated Electron profiles are removed
  after each case. Application/test source files in the worktree were not modified.

The local diagnostic harness can be rerun from the project root with
`npx --no-install vitest run --config /tmp/git-workbench-review-8Gg0tT/vitest.config.ts --reporter=verbose --disableConsoleIntercept`.
It deliberately asserts the observed faulty behavior to make these findings reproducible; remediation
should turn the scenarios into regression tests of the corrected behavior. The temporary harness is not
part of the committed test suite.

This was a targeted cross-feature audit, not exhaustive parity certification. It inspected plan/research
coverage through F13, application service and renderer boundaries, the selected workflow implementations,
and existing tests. The documented gaps in cloning/authentication, watchers, history/search completeness,
merge/conflict/recovery, binary/image handling, and real large-repository performance remain open.
Windows/macOS runtime behavior, real remote authentication, network failures at scale, native Wayland
window interactions, and screen-reader behavior were not verified in this review.

The original review also identified out-of-order operation replies and tab changes during mutations as
code-inspection risks. The follow-up adds monotonic operation revisions and generation/ownership guards,
with the slow-hook Electron scenario checking that completion in one tab preserves another tab's open
dialog and history. They are covered by the remediation, in addition to R1–R12.
