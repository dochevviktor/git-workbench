# P09 follow-up — history refresh, patch copying and operation completion

Date: 2026-09-29. This follow-up addresses the three Electron failures retained in the
[P09 handoff](p09-topology.md). No test is skipped, retried automatically, given a looser assertion,
or granted a larger timeout to obtain a passing result.

## Findings and corrections

| Failure                                                                | Evidence                                                                                                                                                                                                                                                                                                              | Correction                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P03 collapsed/125%-zoom paging loses its visible row                   | Reproduced twice in four runs on `505b6f5`. Temporary browser instrumentation showed an ordinary refresh replacing the oldest 99-row collapsed window with the newest page, then loading a 51-row window around the selected root and calling `scrollIntoView` again. The user's loaded pages and viewport were lost. | Refresh reads the current window's first bounded page. If its commits, HEAD and references are unchanged, it retains the complete window and selection without issuing another reveal. Invalidations during paging/navigation are coalesced behind the active read. Actual history changes still reload from the tip and relocate the selection. |
| F36 Copy as Patch stays disabled                                       | A controlled Git read gate held a same-target refresh after the text patch was already displayed. The unchanged application disabled Copy as Patch solely because `loading` was true, and the context menu retained that disabled state.                                                                              | Copy availability is based on the valid displayed patch. The menu captures those bytes when opened; a background refresh does not invalidate them. Target/whitespace/options ownership, error checks, size limits and decoding guards remain intact.                                                                                             |
| F16 ordinary merge/rebase fixture issues another Git command too early | The old test waited for a two-parent HEAD and then ran an external checkout. A controlled post-command gate proves HEAD is observable while the backend merge operation is still running. The original failure was a Git command error; ten isolated ungated runs did not reproduce its precise command diagnostic.   | The fixture waits for the operation's successful terminal result before the external checkout, and verifies the rebase's terminal result before cleanup. Git failures now include fixture command/stderr diagnostics. Production merge/rebase semantics are unchanged.                                                                           |

The history issue is an application refresh defect, distinct from the test-only offscreen-anchor
sampling error fixed in the earlier [P03 viewport correction](p03-viewport.md). The existing `<2 px`
tolerance, bounded virtual-row assertions, unchanged selection and independent Git checks are preserved.
Both expanded and collapsed paging cases now explicitly refresh an unchanged repository before each
prepend, checking the same loaded row count and visible anchor through refresh as well as paging.

The TypeScript `gated-git.ts` fixture delegates to the real installed Git executable. A test-owned file
holds only a selected command before execution or after process completion. The patch test checks
that the diff is actually refreshing and compares the clipboard with the exact displayed patch.
The merge test checks the real merge's parents while the job remains running, releases the gate,
then waits for success. These fixtures do not change production IPC or introduce a renderer command API.
All mutating Git work remains in disposable repositories and profiles.

## Reference and architecture

`P2-017:F1` (Fork Windows 2.22.0.0, captured 2026-09-19; high confidence for the sampled UI/Git outcome)
separates scrolling from selected details and establishes Home/End navigation with unchanged Git state.
Its dossier, original case and matching before/after HEAD evidence were rechecked. The new refresh/paging
interleavings are independent application regressions, not additional Fork captures or native-DPI claims.

`P2-005`'s dossier/export case and `P1-006-noff-subcase:F1–F2` were rechecked for patch and merge outcomes.
Diff Copy as Patch retains the independently specified displayed-text policy in the
[F36 handoff](f36-patches.md); the catalogue does not establish its background-read timing. No layout,
styling, native frame, private assets, channel names, sender checks or Git mutation policy changes.

The existing history read bounds and cancellation/generation checks remain. An unchanged refresh
compares at most one 100-commit page plus bounded references, rather than reloading all retained pages.
An actual changed-history refresh uses the existing first-page and selection-location paths.

## Verification

- Before-fix repetitions: 10 passed and 2 failed across the original three scenarios; both failures
  were the collapsed viewport case. Controlled before-fix history/patch scenarios both fail.
- After-fix targeted run: **12 passed**, covering expanded paging, collapsed/zoomed paging, controlled
  patch refresh and controlled merge completion, each repeated three times. All 24 measured prepends
  have zero pixel drift, including eighteen after virtualization is active.
- `npm run check`: **618 passed**, one existing opt-in skip; types, lint and formatting pass.
- Production build passes. The complete headless Electron suite passes **65 tests**, with the two
  existing opt-in skips and **zero failures**. The desktop/preload smoke and all P09 scenarios pass.

Artifacts remain ignored under `test-results/p09-test-fixes-before/`, `p09-viewport-trace/`,
`p09-controlled-before/`, `p09-test-fixes-targeted/` and `p09-test-fixes-full/`.
The temporary browser tracing code has been removed; its captured `history-trace` attachment remains
in the reproduction traces. The private reference bundle and desktop bridge/IDE services are unchanged.
