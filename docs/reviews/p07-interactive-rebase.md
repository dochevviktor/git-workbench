# P07 — Interactive rebase and history editing

Verified on Linux, 2026-09-26. This completes the three P07 requirements and their acceptance
criteria within the explicit merge policy below, superseding the initial bounded F18 handoff.
It does not assert complete Fork equivalence or Windows/macOS verification.

## Reference and design comparison

Primary evidence is the supplied Fork **Windows 2.22.0.0**, Windows 11, light appearance, 96-DPI
catalogue, captured 2026-09-19–20:

| Case/finding                                                     | Observed state                                                                                                | Implementation and verification                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `P1-023-dialog-subcase:F1`                                       | Newest-first plan, action menu and shortcuts, revision inspection, unchecked dependent/backup options, Cancel | Compact 22px selectable rows above Commit/Changes/File Tree; action menus and P/E/R/S/F/D, Ctrl+Up/Down, selection arrows; Cancel leaves refs/index/tree unchanged |
| `P1-023-plan-execution-subcase:F1`                               | Reorder, Drop strike-through, inline Reword, Fixup/Squash connectors and automatic Reword target              | Menu, keyboard and drag reorder; separate OK/Cancel message edit; joined rows, generated combined message, author/hash/date columns                                |
| `P1-023-plan-execution-subcase:F2` and the later P1-024 evidence | Alpha/Gamma combined message omits Fixup Beta; reordered Zeta precedes Delta, Epsilon disappears              | Full UI action sequence plus a separately prepared expected repository verify messages, trees, linear parents and branch targets                                   |
| `P1-023-plan-execution-subcase:F3`                               | Author/committer distinction; both optional checkboxes were **unchecked**                                     | Original authors/dates survive; current committer is recorded. Optional branch/update effects are independently specified and tested, not new Fork observations    |
| `P1-023-edit-amend-continue-subcase:F1–F3`                       | Edit quick action, detached pause, automatic Amend/message presentation, Continue restores the branch         | History quick actions, durable Git state, composer prefill, original-change preview without staging old content, restart at pause and after amendment              |

Before changing layout, compared the old application capture with the original `screen-0359`,
`screen-0367`, `screen-0352` and `screen-0355`. Rechecked the resulting plan, combined-message editor
and Edit presentation against those originals. Read the original cases and their linked Git results;
the earlier P1-024 input-driver failure is not interpreted as a Fork defect.

The public library was restored with `npm run research:references` and its interactive-rebase topic
checked. No new public image was needed or bundled. Supplementary primary sources, accessed
2026-09-26:

- [Fork for Windows 1.23, 2018-11-10](https://fork.dev/blog/posts/forkwin-1.23/): visual plan actions.
- [Git rebase 2.43.0 manual, 2023-11-20](https://git-scm.com/docs/git-rebase/2.43.0): merge recreation,
  dependent refs/worktree exclusion, sequencer continuation and empty commits. This is Git behavior,
  not evidence of Fork's private implementation.

Confidence is high for the captured states and independently verified Linux outcomes. Exact Fork
backup names/lifetimes, dependent-branch algorithms, merge-preserving editing and 125%-DPI behavior
remain unknown. The application uses an owned Electron modal, its existing tokens/assets, responsive
columns, and separate inspection state; no reference assets are copied. The internal history backup,
published-history acknowledgement, autosquash preview button and recovery controls are deliberate
product adaptations. The File Tree inspector remains available as an existing product capability.

Local, git-ignored comparison artifacts are produced by `tests/e2e/p07-rebase.test.ts` under
`test-results/p07-after/`: `plan.png`, `plan-dark.png`, `plan-small-125.png`, `combined-message.png`
and `edit-pause.png`. Tests use a 1280×820 window and an 880×600 window with Electron zoom at 1.25;
the latter checks usable controls, not native Windows DPI parity. Test output directories are ephemeral.

## Execution and recovery policy

- Plans contain at most 500 commits and review at most 10,000 branch/remote refs. Backend snapshots
  include the checked-out head, exact base, original rows, local branch targets, upstream associations,
  remote-tracking tips and worktree occupancy. Execution revalidates in the common-directory write queue.
  A fetched/moved upstream or dependent branch invalidates the review; the selected base never silently
  follows a moving name. Local changes have their own reviewed fingerprint.
- Linear plans support Pick/Reword/Edit/Squash/Fixup/Drop, reordering, root and empty commits. Autosquash
  previews `fixup!`/`squash!` matching by object prefix, exact subject then subject prefix, retaining manual
  message edits. Reword and final combined messages use private files, not command interpolation.
  An edited combined message is final; Fixup text is omitted. Squash after an Edit pause appends to the
  actual amended message, retaining user changes made during the pause.
- Merge plans use native `--rebase-merges=no-rebase-cousins`. Git's generated labels, resets and merge
  instructions are retained and only reviewed commit instructions are replaced. Ordinary nodes permit
  Pick/Reword/Edit/Drop; merge nodes permit Pick/Reword. Reordering, autosquash and combining nodes in
  merge plans are deliberately refused to keep the reviewed topology. Merge resolution may need to be
  repeated, as with Git. Exotic/octopus/cousin/strategy matrices are not claimed as Fork parity.
- Update dependent branches is opt-in and previews eligible local branch names. Branches pointing
  into a squash/fixup group move to its final combined commit. Dropped-row branches, checked-out branches,
  tags, remote-tracking refs and the optional backup branch stay unchanged. Native sequencer ref updates
  use their expected old IDs. Continue/Skip additionally refuses a dependent branch changed, removed or
  checked out in another worktree during the pause. Abort remains available.
- Configured rebase defaults cannot enable unreviewed autosquash, merge flattening or dependent updates.
  The sequence editor is authored in TypeScript and built beside main; it receives only a main-created
  bounded plan. No shell helper source, generic renderer executor or user-configured editor is launched.
  Channel names, exact sender/frame/owner checks, trust, context isolation, sandbox and CSP are unchanged.
- Native sequencer files remain authoritative across restart. Continue does not regenerate the todo or
  message files, and recovery snapshots include todo/done/update-refs. External todo edits therefore
  invalidate stale Continue without being overwritten. A successful identical-message amendment is
  recorded in the active sequencer directory so it can proceed after restart.
- Each run retains an internal original-head ref with versioned private metadata; the record is written
  by atomic rename. Cancel, pause and Abort do not remove the ref. Recovery offers inspection, creation
  of a branch at the original head, and explicit result confirmation/dismissal. Dismissal compare-checks
  the original ref and removes only its own artifact directory. A requested `rebase-backup/...` branch
  remains until the user deletes it through ordinary branch actions. At most 100 records are retained
  before another rebase requires review. Legacy F18 refs/artifacts remain intact.
- Stash-and-reapply preserves staged, unstaged and untracked local changes. Interrupted or conflicting
  work retains the stash and rebase backup; completion/Abort uses existing Recovery and conflict services.
  Published-history warnings use local remote-tracking evidence and require acknowledgement. No fetch,
  push or force push is implicit, and remote state beyond the last fetch cannot be inferred.

## Acceptance evidence

`tests/unit/interactive-rebase.test.ts` covers the independently prepared expected repository,
rewritten graph/trees/messages/author dates, root and empty commits, merge topology, opt-in ref updates,
worktree exclusions, moved upstream/ref rejection, explicit published-history acknowledgement refusal,
rebase-default isolation, autosquash, content amendments, identical-message amendments, manual todo
edits, conflict restart/Continue, cancellation, Abort, retained/dismissed backup refs, and staged/unstaged/
untracked recovery across restart. `tests/unit/desktop-api.test.ts` validates new payloads/results and
rejects command/editor injection at the existing preload boundary.

Four new headless Electron scenarios verify the visual states and actual Git outcomes: compact action
sequence and final message, optional refs/backup and Recover as Branch, quick Edit with two application
restarts, published warning/Cancel/root/drag, light/dark and small-window 125% presentation. Existing
P06/review/conflict/history-operation and production desktop smoke scenarios cover the shared composer,
recovery and compiled helper boundaries. Native window chrome was not changed.

Verification environment: Linux, Node **24.13.0**, Git **2.55.0**, committed npm lockfile. All mutating
tests use disposable repositories; the working project and private catalogue are not test fixtures.
Exact command totals are recorded in the phase ledger after the final checks. Broader P14 platform,
accessibility and exact Fork option semantics remain separate; no P07 acceptance criterion is being
left unverified within the stated Linux policy.
