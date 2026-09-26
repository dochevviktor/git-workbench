# F26 Bisect handoff — 2026-09-22

Follow-up (2026-09-26): the [P08 refresh correction](p08-bisect-refresh.md) resolves the intermittent
Start and classification failures caused by background reads disabling controls during a click.
Controlled interaction and stale-checkout regressions supplement the historical verification below.

Status: bounded F26 workflow implemented and verified on Linux. P08 remains partial for the separate
search/history and patch-import work.

## Evidence

Primary reference: Fork Windows 2.22.0.0, captured 2026-09-19, reviewed 2026-09-22:

- `P2-006:F1`: Repository > Bisect starts without a modal; mark Bad, check out an older revision,
  mark Good, follow the selected midpoint, and Abort to restore the original branch.
- `P2-006-skip-subcase:F1–F3`: Bad/Good/Skip/Abort banner; exact skipped SHA in the Git log; clean
  original branch restored after Abort. Original case JSON, midpoint screenshot `screen-0482`,
  skip/abort evidence, and before/after HEAD/status plus `bisect-log.txt` were inspected.
- High confidence for these captured actions and Git outcomes. Repeated skips and ambiguous results
  are explicitly unknown in the Fork catalogue.
- [Git bisect documentation](https://git-scm.com/docs/git-bisect), accessed 2026-09-22: manual
  classification, skip ambiguity and reset semantics inform the independent implementation.

The supplied assets remain unchanged and are not application assets. No capture harness was run.

## Implementation and adaptations

The backend reads symbolic and resolved HEAD plus worktree-specific `BISECT_START`, `BISECT_LOG`, `BISECT_TERMS`, `BISECT_HEAD`, refs,
HEAD, status and pending operations. Reads have time/output/file-size bounds. State comes from Git,
including after a full application restart; no renderer persistence file duplicates Git's session.
The parser accepts Git versions with quoted or unquoted `bad` in result log entries.

`getBisect()` and `startBisectOperation()` have strict input/output schemas and fixed channels through
preload and the existing owner-checked main handlers. Actions serialize through the common-directory
mutation queue, re-read state and reject stale snapshots. The renderer can request only Start, Bad,
Good, Skip and Reset. No test script, arbitrary revision expression, path or command is accepted.

Repository > Bisect starts immediately. A banner below the tabs provides the current revision,
original checkout, range, skipped revisions and Bad/Good/Skip/Abort buttons. Ordinary Checkout Commit
selects the initial good revision. Successful actions reveal the current midpoint in the graph;
bisect reference chips use short labels with full reference tooltips. Abort runs Git's reset and
restores the original branch or detached revision without a confirmation dialog.

Linux adaptations: the banner adds an explicit range row and links to commits, retains the app's
neutral reference-chip styling, and uses independently authored controls. First-bad is a successful
outcome in the banner/Activity rather than the captured Git Error dialog. Ambiguous skipped candidates
are a distinct outcome, independently tested; this does not claim Fork parity for that unknown case.
Screenshots from the headless Electron scenario were compared with the original midpoint capture
before and after styling. Exact Windows fonts, colors and dimensions are not claimed.

Dirty tracked/untracked files, conflicts, unfinished sequencers and unborn HEAD prevent mutations,
including Abort when local changes exist. The app does not discard or automatically stash them.
Cancellation does not promise rollback; Git remains authoritative on the next refresh/restart.
Externally started sessions with custom terms or no-checkout mode are diagnosed and require Git to
finish them. Automated bisect run/replay, path-limited configuration, merge-heavy histories, SHA-256
repositories and externally interrupted commands mid-write are outside the verified matrix.

## Verification

- `tests/unit/bisect-service.test.ts`: disposable nine-commit fixtures verify the captured midpoint,
  exact skipped SHA, first-bad threshold, repeated-skip ambiguity, fresh-reader restoration, branch/
  index/ref preservation, linked-worktree isolation, detached origin, stale/dirty/pending-operation
  refusal and cancellation before execution.
- `tests/unit/desktop-api.test.ts`: fixed bisect channel, malformed input refusal before invocation,
  structured stale errors and malformed response rejection.
- `tests/e2e/bisect.test.ts`: real sandboxed Electron UI starts Bisect, marks endpoints using the
  Checkout Commit dialog, skips, closes/relaunches the application, aborts to the original branch,
  then finds the known first bad commit and restores the original refs/clean checkout.
- `npm run check`: passed, 343 tests passed and one existing skipped test.
- `npm run build`: passed as part of the Electron test command.
- F26 Electron scenario passed. The broader desktop smoke test fails at
  `tests/e2e/desktop.test.ts:532`: immediately enabling Amend shows the previous commit message
  (`long line base`) instead of `Commit from the composer`. The same failure was reproduced in an
  isolated, unchanged archive of baseline commit `f31ee73`; it is not introduced by F26. Startup,
  preload and the F26 workflow pass, but the full desktop smoke gate remains failing.

Generated visual evidence: `test-results/bisect-F26-start-mark-skip-2682e-abort-and-first-bad-outcome/`
contains `bisect-midpoint.png` and `bisect-result.png` (ignored local artifacts).
