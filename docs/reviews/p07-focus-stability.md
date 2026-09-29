# P07 follow-up — rebase shortcuts and focus

Date: 2026-09-29. This correction addresses the intermittent P07 keyboard-action failures retained
in the [P10 handoff](p10-rich-diffs-lfs-signing.md). It changes application focus handling; the
original execution test and its independent Git assertions remain unchanged.

## Cause and runtime evidence

`InteractiveRebaseDialog.focusRow()` updated selection immediately but scheduled DOM focus through
`requestAnimationFrame`. Moving a commit and closing its message editor through OK, Cancel or Escape
all used that path. A later row could receive focus before the queued callback ran. The callback then
returned focus to the previous row, causing the next shortcut to modify the wrong commit.

Six ordinary repeats on starting commit `94cd7eb` passed, confirming that an ungated replay alone
does not reliably expose the problem. Four controlled Electron regressions hold application frame
callbacks, perform Move or one of the three editor exits, focus a different row, release the held
callbacks, and send a real keyboard shortcut. All four fail on the original application.

The recorded browser events directly establish the wrong target. For message OK:

```text
focusin:Pick Add Beta
focusin:Reword Add Delta
keydown:f:Reword Add Delta
```

For Move:

```text
focusin:Pick Add Epsilon
focusin:Pick Add Zeta
keydown:d:Pick Add Zeta
```

This accounts for the previously observed retained Epsilon/dropped Zeta. The same stale focus return
after editing a message can redirect Fixup or Squash, leaving the later combined message without Gamma.
Git then correctly executes the incorrectly edited plan; the backend message/grouping logic is unchanged.

The tests delay only the application's animation callbacks, keeping Playwright's isolated-world
action checks intact. They record focus/key events as attachments, restore the overridden callbacks
and listeners, and cancel the plan with unchanged HEAD/worktree assertions in disposable repositories.
No production timing hook or test-only IPC was added. Before-fix failures and event logs are retained
under the ignored `test-results/p07-focus-before/` directory.

## Correction and coverage

Focus requests are consumed in a layout effect after React has moved the keyed row or removed the
message editor, before subsequent browser input. A request revision also handles navigation to the
already-selected row when browser focus is elsewhere. Initial row/message focus uses the same immediate
layout timing; no callback remains to override newer focus or fire after the dialog closes.

The four controlled regressions verify the focused row, exact action label, and unchanged neighboring
actions. A fifth verifies Home/End/arrow navigation, focus differing from selection, message-entry focus,
Escape restoration and preservation of a subsequent row's focus. The original full workflow still
verifies the combined message, exact commit ordering, dependent branch, retained backup, final file
tree and clean checkout. No delays, retries, skips, timeout increases or weaker assertions were added
to make that workflow pass.

`P1-023-plan-execution-subcase:F1–F3` remains the reference (Fork Windows 2.22.0.0, captured
2026-09-19; high confidence for the sampled actions/messages/Git results). Its dossier, original case,
`screen-0367`, `interactive-messages.txt` and `interactive-files.txt` were rechecked. The catalogue
establishes the expected plan and combined message, not this application's event timing. The controlled
focus interleaving is independent implementation evidence. No layout, style, native frame, private
asset, IPC channel, sender policy, Git execution or recovery policy changes.

## Verification

- Before correction: all four controlled focus cases fail on `94cd7eb`; the event attachments show
  the newer focus replaced and the shortcut delivered to the older row. Six ungated original-workflow
  repeats pass, demonstrating the need for controlled interleavings rather than extra delays/retries.
- After correction: all **27** scenarios in three complete P07 runs pass, including the five new
  focus cases and the four original workflows. No original execution assertion or timeout changed.
- `npm run check`: **630 passed**, one existing opt-in skip; type checks, lint and formatting pass.
- `npm run test:e2e -- --output=test-results/p07-focus-full`: production build passes and all
  **72 routine Electron scenarios pass**, with two existing opt-in skips, zero failures and zero
  automatic retries. This closes the broad-suite caveat in the P10 handoff.
- `git diff --check` passes. Existing dependency-annotation/bundle-size warnings are unchanged.

Linux verification uses the committed npm lockfile and disposable repositories/profiles. The optional
Git LFS 3.8.0 executable from the P10 verification is available on the test PATH so those existing
integration checks also run. Native platform and exact Fork parity limits are unchanged.
