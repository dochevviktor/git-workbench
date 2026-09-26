# P03 viewport verification correction — 2026-09-26

Subsequent Bisect correction (2026-09-26): the [P08 follow-up](p08-bisect-refresh.md) addresses the
independent F26 failure recorded at the end of this report. These original test outcomes remain historical.

The recurring 914-pixel prepend assertion was caused by a test synchronization race. The production
history paging and scroll calculation are unchanged. This closes the P03 viewport caveat retained in
the earlier P06/P08 records without reclassifying their historical test results.

## Runtime evidence

The failure reproduced on the committed P08 baseline `a36d852`. Temporary instrumentation recorded
the commit-list scroll position, first-row coordinates, `scrollTop` writes and `scrollIntoView` calls
inside the sandboxed Electron renderer. The trace is in the ignored
`test-results/p03-viewport-trace/` directory, attached as `viewport-trace`.

| Transition                                                                | Scroll position | First retained row Y |
| ------------------------------------------------------------------------- | --------------: | -------------------: |
| Test sets the list to the top after seeing the selected commit's metadata |               0 |                  124 |
| The pending selection-reveal animation frame runs                         |             914 |                 −790 |
| Test records its supposed visible anchor                                  |             914 |                 −790 |
| Playwright scrolls the paging button into view before clicking it         |               0 |                  124 |
| Application prepends 100 rows and compensates by 100 × 24 pixels          |           2,400 |                  124 |

The selected commit's metadata appears before the queued reveal scroll. Waiting two animation frames
after setting `scrollTop = 0` allowed that pending callback to overwrite the test's requested position.
The resulting assertion compared the row's offscreen position with its position after Playwright's
automatic scroll. The application preserved the position visible when the paging action actually ran.

## Correction and regression coverage

- The original scenario now waits until the selected commit is in the viewport before moving the list
  to its top. It verifies that the starting anchor is visible, and retains the original `<2 px` tolerance.
- Row selectors include `data-testid="history-commit"`, so a merge's graph-toggle button cannot be
  mistaken for its row.
- Two additional scenarios page from the oldest window through all 425 commits. They cover the switch
  to virtualized rows, expanded/collapsed branches, removal of the newer-page bar and 125% Electron zoom.
  They bring the paging control fully into view before measuring a visible row, check unchanged
  selection, bound mounted virtual rows, and independently assert unchanged HEAD, refs and worktree state.
- Geometry snapshots query the current DOM and measure it atomically in the renderer. This also avoids
  sampling an element handle detached during a refresh. Coordinates are retained as
  `viewport-coordinates.json` artifacts. Temporary prototype instrumentation has been removed.
  There are no sleeps, relaxed coordinate assertions or application/Git/IPC changes.

This preserves the existing `P2-017:F1` distinction between scrolling and selected commit details,
documented for Fork Windows 2.22.0.0 at 96 DPI (2026-09-19). The dossier and original case were reviewed.
High confidence applies to that captured distinction and the separate runtime trace. Prepend/virtualization
boundaries are independent Git Workbench regression cases, not newly observed Fork behavior. No layout,
styling, assets, capture coverage or native-window/DPI claims change.

## Verification

`npm run check` passes **603 tests**, with one existing opt-in skip, including type, lint and format
checks. The production build passes. All three P03 scenarios pass in three consecutive repetitions:
**nine passes** in `test-results/p03-viewport-settled/`. The six repeated boundary cases record
**24 prepends with zero pixel drift**, including the virtual-row transition and removal of the paging bar.
The full headless suite reports **59 passed, 1 failed, 2 existing opt-in skips**. All three P03
scenarios and the desktop/preload smoke pass. The separate failure is F26 Bisect at
`tests/e2e/bisect.test.ts:63`, waiting for the midpoint after marking Good. Neither Bisect nor any
application code changed in this correction. Full-run artifacts are in `test-results/p03-viewport-full/`;
the P03 failure is closed without claiming the entire UI matrix is green.
A separate unchanged Bisect recheck also fails, at the initial banner assertion (`bisect.test.ts:50`);
its artifacts are in `test-results/p03-unmodified-bisect-recheck/`. That independent issue is left visible.
All fixtures and Electron profiles are disposable; the user's repository and graphical services are untouched.
