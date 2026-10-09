# P14 audit and Linux release candidate — 2026-10-01

CI toolbar follow-up (2026-10-09): [compact-width correction](ci-releases.md#compact-toolbar-correction--2026-10-09)
adds independent F31/F34 accessible-name coverage for F32/F33/F37 settings entry on native and packaged
apps. The regression reproduces the hosted failure locally. Hosted upload verification is pending;
the feature ledger's case-level unknowns and broader P14 gates remain unchanged. Native macOS package
checks now pass; a separate F02 watcher-limit notification correction is under verification.

CI distribution update (2026-10-08): [versioned installers and Arch packaging](ci-releases.md)
supersedes the original local-only publishing policy below. New CI creates version-gated GitHub
Releases with Windows/Linux/macOS installers and an Arch recipe. Local Linux/Arch checks pass;
the new hosted packaging/publication path and trusted signing remain unverified. P14 stays partial.

Windows implementation update: [OS-aware tests and Windows workflows](windows-compatibility.md)
supersedes the initial Windows feature exclusions. P14 retains the release gates below.

Windows coverage extension (2026-10-01): F07/F08/F21/F23/F27 native path/diff corrections and
F32/F33/F37 process adapters pass the Windows fixtures. Final verification passes 697 unit/integration
tests and all 88 routine desktop scenarios, with 10 and four explicit skips respectively. Live vendor
tools, accounts and the remaining native-platform matrices in the feature ledger stay unverified.
The unsigned Windows NSIS installer also passes installation, all eight installed-app scenarios and
uninstall cleanup; its checksum and evidence are recorded in the follow-up.

Windows follow-up: [the separate portability audit](windows-portability-audit.md) records native Windows
results and NSIS checks from 2026-10-01. It supersedes the statement that Windows has no local verification,
without extending the Linux results below to Windows or marking P14 complete.

P14 is **partial**. The local audit, corrections, reproducible scale checks and unsigned packaging are
implemented. This is a Linux preview verification record, not a declaration of complete Fork parity or
a completed GNOME/KDE/native display and assistive-technology matrix. The remaining gates below are
acceptance criteria, not features silently counted as finished.

## Scope and evidence

The primary baseline remains the private **Fork Windows 2.22.0.0** catalogue dated 2026-09-20:
82 topics, 147 cases, 275 findings and 541 linked screenshots. Read its START_HERE, DESIGN_GUIDE and
GAPS alongside the [full topic crosswalk](../research/fork-catalogue-alignment.md#complete-topic-to-implementation-crosswalk).
Observed capture coverage is not implementation completion. This pass reuses the phase handoffs and
their independent Git assertions, runs the complete routine suite, and adds cross-feature checks.

Original P2-012:F1 light/dark Local Changes screenshots and P2-017:F1 graph screenshots were compared
with the new audit captures before and after the contrast changes. P0-012 staged/tab focus findings,
P2-013 small-window findings, P2-014:F1's **unknown** 125% DPI outcome and P2-015 normal-restart findings
bound the keyboard/scaling/retention claims. The original cases and linked Git manifests distinguish
view-only trials from mutations. P2-011 initialize/download F1–F4 remains the historical LFS card/Save As
reference; version-gated management and authenticated failure handling are independent Linux behavior.
`npm run research:references` restored the public index: 226 existing images, no downloads or failures.
No private images, Fork code, binaries or artwork enter the product, and no historical capture harness ran.

Public implementation sources, checked **2026-10-01**:

- [Git credential-helper protocol](https://git-scm.com/docs/gitcredentials): get/store/erase and scoped
  credential contexts. High confidence for protocol semantics, independent of Fork.
- [Git LFS changelog](https://github.com/git-lfs/git-lfs/blob/main/CHANGELOG.md): `fetch --refetch` was
  introduced in 3.7.0. The app probes installed help, accommodating distribution backports.
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) and
  [renderer lifecycle](https://www.electronjs.org/docs/latest/api/web-contents#event-render-process-gone):
  process isolation, sender checks and explicit crash recovery. High confidence for API requirements;
  platform behavior is claimed only where independently tested here.
- [Electron updates](https://www.electronjs.org/docs/latest/tutorial/updates) and
  [electron-builder Linux](https://www.electron.build/linux/): the preview uses explicit manual replacement;
  no hosted update feed or automatic update implementation is implied.
- [Deque Playwright adapter](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md):
  automated accessibility rules. Electron requires its single-document legacy mode; this renderer has
  no cross-origin frames. Passing rules does not establish screen-reader usability.

## Corrections

| Finding                                       | Reproduction and resulting behavior                                                                                                                                                                                                                                                     | Verification                                                                                                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 — IME can commit unfinished text          | A composing Ctrl+Enter created a real commit. Composition, legacy keycode 229 and AltGr now bypass command shortcuts, commit submission, palette/search input and rebase message navigation.                                                                                            | [Input regression](../../tests/e2e/p14-accessibility.test.ts), [shortcut tests](../../tests/unit/renderer-helpers.test.ts); unchanged HEAD and retained draft.                                          |
| A02 — menu steals modal keyboard input        | Alt+F opened the main menu above Preferences. The title bar now respects prevented events, composing input and an open native dialog.                                                                                                                                                   | Same desktop regression; no menu opens and Preferences retains focus.                                                                                                                                   |
| A03 — inaccessible tab close descendant       | A focusable button inside an ARIA tab caused nested-interactive violations. The visual close affordance remains clickable; the tab owns its standard Delete action and advertises it with aria-keyshortcuts.                                                                            | Axe, keyboard Delete/reopen and existing pointer-close smoke.                                                                                                                                           |
| A04 — unreadable text contrast                | Avatar initials, dim diff/composer text, selected palette metadata, dark primary buttons and native select backgrounds failed 4.5:1 checks. The affected tokens/controls now pass in the audited light/dark states.                                                                     | 17 automated state scans, reference comparisons, forced-color selection and 125%/150% zoom checks. No global pixel-equivalence claim.                                                                   |
| A05 — renderer termination strands the window | Native main-process recovery offers Reload Window or Close Window. Reload reconstructs saved state without retrying Git writes. Main and inspector windows use the same handler.                                                                                                        | Real SIGKILL of the disposable main renderer, native recovery event, restored draft/bridge, unchanged HEAD/index/worktree. Inspector recovery is wired but not independently crash-tested.              |
| A06 — unsupported LFS refetch                 | Ubuntu's LFS 3.4.1 lacks --refetch, but the UI offered it. A backend capability probe drives the validated context and disabled control; execution also rejects unsupported requests before network access.                                                                             | Real 3.4.1 and 3.8.0 fixtures, bridge validation and desktop capability checks.                                                                                                                         |
| A07 — rejected credentials loop               | LFS 3.4.1 repeatedly asked for a credential after erase; the helper returned the same rejected token until cancellation. Erase now marks that exact origin/path rejected in the current broker only. Later fills fail closed, including a concurrent lookup completing after rejection. | The former timeout completes normally; [private helper regression](../../tests/unit/github-git-transport.test.ts) verifies another path and a new operation still work. Saved accounts are not deleted. |
| A08 — incomplete release assets               | Packages used Electron's icon and lacked attribution for bundled JS. An original SVG/PNG, stable existing IDs, module-derived license texts, Debian metadata/dependencies and artifact checksums are now part of the build.                                                             | Installed/extracted-package sandbox, CSP, icon and license checks; desktop-file validation.                                                                                                             |

The initial audit failures are retained in ignored `release/p14/accessibility-before`,
`accessibility-baseline`, and `appimage-diagnostic`. The first tab-accessibility revision was rejected
by the audit because it placed a button directly under a tablist; the final Delete/visual-close design
passes both rules. Crash injection initially used Electron's non-firing forcefullyCrashRenderer route
under this debugger; the final test terminates the exact owned renderer PID and observes native
render-process-gone plus reload. Playwright considers a crashed Page terminal, so post-crash DOM checks
run through the surviving native owner. No assertion tolerance or automatic retry hides those outcomes.

Visual review also caught a high-contrast selection regression missed by the first DOM check: opaque
Canvas and transparent backgrounds differed as strings but looked identical. The stronger test requires
the selected row to use the system Highlight color and differ from Canvas. Forced-color selections now
retain that palette explicitly; normal light/dark styling is unaffected. The failing screenshot and
stronger assertion are retained in `release/p14/forced-colors-before`.

The broad rerun also exposed a smoke-test synchronization error: seeing any hunk button did not prove
that the newly written 2,000-character line was displayed. It measured a 750-pixel viewport before the
expected wide content arrived. The smoke now selects once and waits for those exact bytes before the
original overflow/sticky-action assertions. It no longer retries the selection action. Git outcome
assertions and pixel tolerances are unchanged; the failed trace is retained in `release/p14/full-suite`.

A separate repeated smoke then exposed a real post-commit race: the watcher could refresh the new HEAD
and empty index before the commit job completed. Its completion callback retained the previous context
loader, which replaced the loaded key with an obsolete key and left Amend permanently disabled. The
refresh callback now invokes the current loader. A [controlled Git gate regression](../../tests/e2e/p14-commit-refresh.test.ts)
holds process completion after Git writes the commit, observes the watcher refresh, then releases it;
the original failed deterministically and the correction restores Amend with unchanged commit count/tree.
Evidence is retained in `release/p14/commit-refresh-before` and the corresponding verified run.

## Feature ledger

Release validation follow-up (2026-10-08): [the first hosted-run correction](ci-releases.md#first-hosted-run-correction--2026-10-08)
adds F02/F03 watcher shutdown guarantees and portable F32/F33/F37 package test entry points. The local
742-test check, full 99-scenario desktop suite and all 19 applicable AppImage scenarios pass. The native installers built successfully on
the hosted runners; the new validation corrections and actual publication need a fresh CI run.
Feature-family, native-device, signing and live-service gates below remain separate.

Distribution maintenance (2026-10-08): [CI release verification](ci-releases.md) adds native installer
artifacts, version/commit-bound release publication, complete checksums and a generated Arch recipe.
Linux package smoke preserves the existing sandbox/isolation assertions; the Arch build validates
dependencies, metadata, content and sandbox permissions. No F-item status changes: this is delivery
infrastructure, and the new Windows/macOS package jobs, actual release publication, AUR submission,
trusted signing and the remaining native-device/live-provider matrix still require verification.

Further maintenance (fifth CI follow-up, 2026-10-08): [history-menu readiness](cross-platform-portability.md#fifth-ci-failure-follow-up--2026-10-08)
adds F19/P08 mouse/keyboard and menu-lifetime regressions, preserving the reviewed commit and backend
guards. The original history-operation scenarios remain unchanged and pass repeated one-core runs.
The full local desktop suite passes 99 scenarios and the AppImage passes 19, with explicit skips and no retries.
Hosted Windows/macOS and Linux package results at `6d9c4a4` remain separate from the latest correction;
the broader feature and release gates below are unchanged.

Further maintenance (fourth CI follow-up, 2026-10-08): [the hunk/harness record](cross-platform-portability.md#fourth-ci-failure-follow-up--2026-10-08)
adds F10 click-retention and changed-content refusal checks to native/package smoke. F16/F26/F36 and
P14 fixtures gate specific requests or one real hook while routine reads use native Git. The Linux
check, focused/repeated one-core regressions, 95 desktop scenarios and 15 AppImage scenarios pass;
latest hosted results and limits are kept separate.
Feature-family, native-device and live-service release gates remain unchanged.

Further maintenance (2026-10-08): [the third CI follow-up](cross-platform-portability.md#third-ci-failure-follow-up--2026-10-08)
adds four controlled F12/F16/F31 reference-readiness/refusal regressions to native and packaged smoke.
All ten focused Linux scenarios pass with one CPU core; the full local desktop suite passes 93
scenarios and the AppImage passes 13, with explicit skips and no retries. The observed `facdfb2` macOS job and Linux
package job are green; the latest corrections need another hosted run. Native-device, live-service,
macOS packaging and the broader release gates below remain separate.

Maintenance verification (2026-10-08): the [second CI follow-up](cross-platform-portability.md#second-ci-failure-follow-up--2026-10-08)
adds long Unix socket/GPG-home regressions for F13/F24/F28/F29, post-rebase chooser readiness for F31,
and explicit startup sandbox enforcement for packaged and development Electron. The Linux check and
full desktop suite pass, as do all eight applicable packaged scenarios. These independent implementation corrections preserve the feature-family
statuses and native/live-service release gates below; Windows/macOS reruns remain outstanding.

“Verified” means the stated independently specified Linux scope passes its linked implementation tests.
“Partial” means the broader family retains an explicit gap. No row claims every Fork variant. Original
case/finding details and screenshot/Git links resolve through the catalogue crosswalk above and the
linked phase handoffs. Public-only families retain public sources instead of invented captured cases.

| Feature                        | Status and verified scope                                                                       | Reference                                                                        | Independent checks and retained limit                                                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 Open/init/clone            | Partial: local sessions and controlled HTTPS/SSH clone                                          | P0-002, P1-012; [P02](p02-repository-sessions.md), [P05](p05-network.md)         | [Sessions](../../tests/e2e/p02-sessions.test.ts), [network](../../tests/unit/p05-network.test.ts). Live hosts remain unverified.                                                                                      |
| F02 Manager/workspaces         | Verified: source discovery, hierarchy, cancellation and workspace ownership                     | P0-002 opening; [public manager/P12](p12-productivity-workspaces.md)             | [Manager](../../tests/unit/p02-sessions.test.ts), [workspaces](../../tests/e2e/p12-productivity.test.ts). Pristine Fork manager is unknown.                                                                           |
| F03 Tabs/repository list       | Partial: additive list, reorder/reopen, scoped saved layouts                                    | P0-004–005, P2-015; [P12](p12-productivity-workspaces.md)                        | [Tabs](../../tests/e2e/catalogue-foundation.test.ts), [P14 keyboard](../../tests/e2e/p14-accessibility.test.ts). Native multi-display behavior remains.                                                               |
| F04 Graph/history              | Verified: ancestry, labels, selection and bounded navigation                                    | P0-003/006/007, P2-017; [P03](p03-history.md)                                    | [Graph](../../tests/unit/history-graph.test.ts), [100k browser](../../tests/e2e/p03-history.test.ts). Exact Fork lane geometry is not established.                                                                    |
| F05 Collapse                   | Verified: independent merge projection and retained selection                                   | [Public graph/P03](p03-history.md)                                               | [Projection](../../tests/unit/history-collapse.test.ts), [browser](../../tests/e2e/p03-history.test.ts). Exact Fork collapse rules remain unknown.                                                                    |
| F06 Search/filter              | Verified: fields, SHA, bounded navigation/cancellation                                          | P1-029; [P08](p08-investigation.md)                                              | [History service](../../tests/unit/history-service.test.ts), [investigation](../../tests/e2e/p08-investigation.test.ts). Search bounds remain explicit.                                                               |
| F07 Commit/revision inspection | Verified: metadata, parents, changed files, paged trees and inert blobs                         | P0-007, P1-033; [P03](p03-history.md)                                            | [Revision service](../../tests/unit/revision-service.test.ts), [browser](../../tests/e2e/p03-history.test.ts). General graph Back/Forward is unclaimed.                                                               |
| F08 Working changes            | Verified: staged/unstaged/conflict/ignored and tree/list state                                  | P0-014–017/025; [P04](p04-working-changes.md)                                    | [Status](../../tests/unit/working-tree-service.test.ts), [changes](../../tests/e2e/p04-changes.test.ts). Bounded lists expose truncation.                                                                             |
| F09 Text diffs                 | Verified: split/unified, context, syntax, popup, anchors and explicit large load                | P0-026–028, P2-004/007; [P04](p04-working-changes.md)                            | [Diff](../../tests/unit/diff-service.test.ts), [60k browser](../../tests/e2e/p14-performance.test.ts). 8 MiB explicit load bound remains.                                                                             |
| F10 Stage/discard              | Verified: files/hunks/lines and reviewed tracked Recovery                                       | P0-018–024/032; [P04](p04-working-changes.md)                                    | [Staging](../../tests/unit/staging-service.test.ts), [changes](../../tests/e2e/p04-changes.test.ts). Untracked deletion is not offered implicitly.                                                                    |
| F11 Commit/amend               | Verified: drafts/templates/hooks, amend and reviewed Commit and Push                            | P0-029–031; [P04](p04-working-changes.md), [P12](p12-productivity-workspaces.md) | [Commit](../../tests/unit/commit-service.test.ts), [IME/crash](../../tests/e2e/p14-accessibility.test.ts). Native spelling/IME engines remain unverified.                                                             |
| F12 Branches/tags              | Partial: lifecycle, annotated empty-message tags, guarded checkout/deletion                     | P1-001–005; [P05](p05-network.md)                                                | [References](../../tests/unit/reference-service.test.ts), [network UI](../../tests/e2e/p05-network.test.ts). Pin/hide/custom sorting and lightweight creation UI are unsupported.                                     |
| F13 Remote/network             | Partial: reviewed destinations, leases, credentials, pull modes                                 | P1-007–012; [P05](p05-network.md)                                                | [Network](../../tests/unit/network-service.test.ts), [TLS helper](../../tests/unit/github-git-transport.test.ts), [SSH](../../tests/unit/ssh-agent-transport.test.ts). Live providers remain a gate.                  |
| F14 Activity/cancellation      | Verified: queryable jobs, coalescing, progress and process-tree cancellation                    | P1-008/011; [P01](p01-infrastructure.md)                                         | [Registry](../../tests/unit/operation-registry.test.ts), [scale](../../tests/unit/p14-performance.test.ts). Cancellation never promises remote rollback.                                                              |
| F15 Stashes                    | Verified: partial scopes, new files, index preservation and durable failed-apply recovery       | P1-013–015, P2-005; [P06](p06-merge-recovery.md)                                 | [Stashes](../../tests/unit/stash-service.test.ts), [workflows](../../tests/unit/p06-workflows.test.ts). Broader Fork restoration rules remain unknown.                                                                |
| F16 Merge/rebase               | Verified: four merge modes, previews and operation-aware recovery                               | P1-006/019–022; [P06](p06-merge-recovery.md)                                     | [Modes](../../tests/unit/merge-modes.test.ts), [restart](../../tests/e2e/p06-workflows.test.ts). Branch drag is an independent entry route.                                                                           |
| F17 Conflict helper            | Verified: text/manual/multi-region, delete/rename/binary/gitlink choices                        | P1-015–020/022/025/026; [P06](p06-merge-recovery.md)                             | [Conflicts](../../tests/unit/conflict-editor.test.ts), [workflows](../../tests/e2e/p06-workflows.test.ts). External binary merge tools are not claimed.                                                               |
| F18 Interactive rebase         | Verified: plan/messages, Edit/amend/continue, dependent refs and retained backups               | P1-023–024; [P07](p07-interactive-rebase.md)                                     | [Rebase](../../tests/unit/interactive-rebase.test.ts), [focus/restart](../../tests/e2e/p07-rebase.test.ts). Merge topology policy is independently specified.                                                         |
| F19 History mutations          | Partial: single-commit/mainline/no-commit pick/revert and safe reset modes                      | P1-025–027; [P06](p06-merge-recovery.md)                                         | [History operations](../../tests/unit/history-operations.test.ts), [UI](../../tests/e2e/history-operations.test.ts). Batch history selection is unsupported.                                                          |
| F20 Lost commits               | Verified: reflog view, named recovery and expired-object handling                               | P1-028; [P08](p08-investigation.md)                                              | [History](../../tests/unit/history-service.test.ts), [investigation](../../tests/e2e/p08-investigation.test.ts). Does not manufacture expired objects.                                                                |
| F21 History/Blame              | Partial: rename, directory/code history, attribution and exact Save As                          | P1-030–031/033; [P08](p08-investigation.md)                                      | [Inspection](../../tests/unit/file-history-service.test.ts), [UI](../../tests/e2e/p08-investigation.test.ts). Exact copy-detection/native variants remain.                                                            |
| F22 Worktrees                  | Verified: local/remote/detached lifecycle, lock/prune and shared-state guards                   | P2-001; [P09](p09-topology.md)                                                   | [Worktrees](../../tests/unit/worktree-service.test.ts), [six tabs](../../tests/e2e/p14-performance.test.ts). Native filesystem matrix remains outside this host.                                                      |
| F23 Submodules                 | Verified: nested lifecycle, revision graph, dirty/missing/interrupted and gitlink conflicts     | P2-002; [P09](p09-topology.md)                                                   | [Submodules](../../tests/unit/submodule-service.test.ts), [topology](../../tests/e2e/p09-topology.test.ts). Fork Move/tool variants remain unobserved.                                                                |
| F24 LFS                        | Partial: local payloads, authenticated transfers, tracking and ownership-checked locks          | P2-011 F1–F4; [P10](p10-rich-diffs-lfs-signing.md)                               | [Real LFS](../../tests/unit/p10-lfs.test.ts), [UI](../../tests/e2e/p10-lfs.test.ts). 3.4.1 refetch is explicitly unsupported; live LFS hosts remain unverified.                                                       |
| F25 Git-flow                   | Verified: independently specified native feature/release/hotfix destinations and durable finish | [Public Windows 1.17/P09](p09-topology.md)                                       | [Git-flow](../../tests/unit/gitflow-service.test.ts), [restart](../../tests/e2e/p09-topology.test.ts). Topic publish/remote automation is unsupported.                                                                |
| F26 Bisect                     | Verified: manual endpoints, good/bad/skip/reset, restart and ambiguous outcomes                 | P2-006; [P08](p08-investigation.md)                                              | [Bisect](../../tests/unit/bisect-service.test.ts), [refresh](../../tests/e2e/bisect-refresh.test.ts). Automatic scripts/custom terms are unsupported.                                                                 |
| F27 Images                     | Partial: bounded formats, four modes, zoom/pan and cached historical/LFS previews               | P0-026, P2-003; [P10](p10-rich-diffs-lfs-signing.md)                             | [Formats](../../tests/unit/p10-images.test.ts), [UI](../../tests/e2e/p10-images.test.ts). First-frame, restricted-SVG, color/codec limits remain.                                                                     |
| F28 Signing                    | Partial: OpenPGP commit/amend/tag defaults and verification                                     | [Public signing/P10](p10-rich-diffs-lfs-signing.md)                              | [Agent/settings](../../tests/unit/p10-signing.test.ts), [UI](../../tests/e2e/signing.test.ts). Graphical pinentry and SSH/X.509 verification remain unsupported/unverified as documented.                             |
| F29 Hosting accounts           | Partial: seven provider forms, owned repository lists, credentials and PR handoffs              | [Public providers/P11](p11-hosting.md)                                           | [Providers](../../tests/unit/hosting-providers.test.ts), [accounts](../../tests/e2e/hosting-providers.test.ts). Live OAuth/provider/native keyrings remain a gate.                                                    |
| F30 Hosted activity            | Partial: GitHub/Enterprise issue/PR lists, filters and notifications                            | [Public activity/P11](p11-hosting.md)                                            | [Activity](../../tests/unit/p11-hosting.test.ts), [UI](../../tests/e2e/p11-hosting.test.ts). Other providers use browser handoff; embedded review/tray parity is unsupported.                                         |
| F31 Quick Launch               | Verified: independent fuzzy commands and typed parameter choices                                | P1-032; [P12](p12-productivity-workspaces.md)                                    | [Ranking](../../tests/unit/quick-launch.test.ts), [UI](../../tests/e2e/quick-launch.test.ts). Exact Fork ranking is unknown.                                                                                          |
| F32 Custom commands            | Verified: explicit definitions, previews, inputs, disabled imports and cancellation             | P2-008; [P12](p12-productivity-workspaces.md)                                    | [Commands](../../tests/unit/custom-commands.test.ts), [UI](../../tests/e2e/custom-commands.test.ts). Fork definition format compatibility is unsupported.                                                             |
| F33 External tools             | Partial: configured argv tools, historical text handoff, terminal/file manager and CLI          | P2-009; [P12](p12-productivity-workspaces.md)                                    | [Tools](../../tests/unit/external-tools.test.ts), [UI](../../tests/e2e/external-tools.test.ts). Detached-daemon/binary/native tool matrices remain.                                                                   |
| F34 Shell/settings             | Partial: scoped settings/layouts, keyboard, themes, contrast and crash recovery                 | P0-003–013, P2-012–016; [P12](p12-productivity-workspaces.md)                    | [Settings](../../tests/unit/settings.test.ts), [P14](../../tests/e2e/p14-accessibility.test.ts). Native WM/AT/IME and automatic updating remain outside the verified preview.                                         |
| F35 Statistics                 | Verified: independent UTC/raw-author aggregation, cached bounded treemap/activity               | P2-010; [P13](p13-statistics-ai.md)                                              | [Metrics](../../tests/unit/statistics-service.test.ts), [100k](../../tests/unit/p14-performance.test.ts). Exact Fork aggregation is unknown; benchmark uses empty-tree commits, separately from the monorepo fixture. |
| F36 Patches                    | Verified: bounded import/export/clipboard, applicability, mailbox and merge-parent variants     | P2-005; [P08](p08-investigation.md)                                              | [Patch semantics](../../tests/unit/patch-service.test.ts), [UI](../../tests/e2e/patch.test.ts). Explicit safety refusals remain.                                                                                      |
| F37 AI                         | Partial: explicit previews, saved public choices, adapters, cancellation and editable drafts    | [Public vendor/Fork sources/P13](p13-statistics-ai.md)                           | [Adapters](../../tests/unit/ai-agents.test.ts), [UI](../../tests/e2e/p13-ai.test.ts). Live tools/models/accounts and real Ollama remain unverified; no data was sent to a live provider.                              |
| F38 Lean Branching             | Partial: independent local Start/Sync/Finish and saved base                                     | P0-008-toolbar-dropdown-subcase:F1; [F38](f38-lean-branching.md)                 | [Semantics](../../tests/unit/lean-branching.test.ts), [UI](../../tests/e2e/lean-branching.test.ts). Fork execution effects and remote-ref restoration remain unknown.                                                 |

## Performance record

Fedora 44 x64 VM, kernel 7.1.8-200.fc44, 12 exposed CPUs (AMD Ryzen 9 7900X), 23.39 GiB memory,
Node 24.13.0, Git 2.55.0, Electron 44.4.1. Ozone headless with software rendering; no forced GC or OS
cache eviction. “Cold” means a fresh application read with warm filesystem cache, not cold disk.
Measurements are single local samples, not percentiles or a claim about all hardware. Existing P03
budgets are retained; the new P14 budgets were set before the first run and remain proposed release
budgets pending owner agreement and slower-machine measurements.

| Measurement                                                 |                   Observed |                 Budget |
| ----------------------------------------------------------- | -------------------------: | ---------------------: |
| Empty application startup to connected renderer             |                     277 ms |               5,000 ms |
| 100k commits / 1,003 refs first display                     |                     925 ms |               5,000 ms |
| Same graph warm refresh / keyboard selection                |                433 / 43 ms |         2,500 / 250 ms |
| Oldest commit / SHA lookup                                  |               837 / 829 ms |          3,000 ms each |
| 5,101-file revision tree display                            |                     140 ms |               3,000 ms |
| Six worktree tabs restored / switch to another tab          |               591 / 373 ms |       5,000 / 1,000 ms |
| 60k-line diff display / scroll to final line                |               232 / 131 ms |         3,000 / 750 ms |
| Diff DOM rows / renderer heap / Electron working-set growth | 600 / 52.2 MiB / 214.3 MiB | <700 / <192 / <512 MiB |
| 100k-commit statistics cold / warm                          |             1,154 / 610 ms |      15,000 / 3,000 ms |

The separate backend fixture has 10,001 tracked files, 1,002 directories, 2,001 eventual changes,
eight owners and two worktrees. Initial measurements: shared reads 65 ms, 2,000-file storm writes 47 ms,
status 58 ms, large diff 69 ms, event-loop maximum 16 ms, 16 owner notifications and 25.3 MiB RSS growth.
The process-tree cancellation test asserts the descendant is gone/zombie, not merely that a cancel
request returned. Native inotify watch counts are measured before/open/after disposal in the final run.
Detailed machine measurements and output live in `release/p14/backend-scale.json`,
`statistics-scale.json` and `performance/*/*performance.json`. Existing graph/projection budgets also
pass. No measured bottleneck justified adding worker infrastructure or another cache.

Reproduce independently:

```sh
HISTORY_BENCHMARK=1 npx vitest run tests/unit/history-performance.test.ts
P14_BENCHMARK=1 npx vitest run tests/unit/p14-performance.test.ts
P03_BENCHMARK=1 P14_BENCHMARK=1 npm run test:e2e -- tests/e2e/p03-history.test.ts tests/e2e/p14-performance.test.ts -g budgets
```

## Local release policy and installation

Retain **Git Workbench**, `dev.gitworkbench.desktop`, `git-workbench.desktop`, version 0.1.0 and the
existing profile identity. The original [icon](../../resources/icon.svg) is under the repository MIT
license; its committed PNG is generated from that vector. No Fork asset is used. Each built layer
contains a module-derived `bundled-dependencies.json` and full `THIRD_PARTY_NOTICES.txt`. The package
also preserves Electron's license and Chromium third-party notices.

`npm run package` builds an unsigned AppImage and checksum manifest. `npm run package:deb` requires
`GIT_WORKBENCH_MAINTAINER='Public Name <public@example.org>'`; the public maintainer contact is still
pending. `npm run package:deb -- --test-metadata` explicitly produces a **TEST-ONLY.deb** using an
invalid example address for disposable installation tests. It is not release-ready contact metadata.
`npm run release:manifest` refreshes local SHA-256/byte-size records after any installer build.

Fedora requires the build-only `libcrypt.so.1` for electron-builder's bundled FPM. This audit used the
Ubuntu container's library in a local build directory via a per-command loader path; it did not install
system libraries or alter host services. On this host normal AppImage mounting fails because FUSE 2 is
absent. The supported fallback `APPIMAGE_EXTRACT_AND_RUN=1` passed the real packaged smoke without
disabling sandboxing. Users may instead install their distribution's FUSE 2 package. A clean Ubuntu
24.04 rootless container installed the deb, validated its desktop entry and passed the packaged smoke.
Its Git is 2.43.0. This container shares the Fedora kernel and is **not** evidence of Ubuntu's native
AppArmor/desktop/window-manager behavior.

Updates are manual for this preview. Quit the app, preserve the previous installer and a copy of the
closed application profile, verify the new artifact's checksum, then replace the AppImage or install
the next deb through the package manager. Do not modify Git repositories as part of an app upgrade.
For rollback, quit and reinstall the retained build; if a future version changes profile schemas,
restore the matching closed-profile backup. This phase changes no persisted schema. Existing migration,
atomic-write and damaged-file preservation tests remain authoritative. Renderer recovery preserves
saved drafts; unsaved input at the instant of a process/system crash is not promised. Native Git
sequencer and Recovery artifacts remain authoritative for interrupted writes.

No release was published, no signing identity was used and no automatic updater/feed is configured.
The original release verification below covers Linux. The linked Windows follow-up adds native Windows
and NSIS evidence; macOS remains unverified.

## Verification and remaining gates

Baseline commit: `7c2a8dcea573ae64bf440c945afac2d58c1f8e48`, initially clean. Baseline `npm run check`
passed 693 tests with six tool/opt-in skips; build passed; the full headless desktop suite passed
81 scenarios with three opt-in/tool skips.

Final verification on 2026-10-01:

- Clean `npm ci` succeeds. `npm audit --json` reports zero known vulnerabilities. Upstream build-tool
  deprecations, Zod annotation and renderer chunk-size warnings remain; these are not hidden failures.
- `npm run check` with the locally installed Git LFS 3.8.0 on PATH passes type/lint/format checks and
  **700 tests**, with three explicit scale-test skips. No user's Git LFS installation was changed.
- `npm run build` passes for the final application sources. The final full headless Electron sweep
  passes **86 scenarios**, with four explicit skips and no failures or automatic retries (6.2 minutes).
  The skips are the two opt-in browser benchmarks, packaged-executable verification, and the opt-in
  existing-user-repository statistics test. The benchmarks and packaged checks ran separately; the
  existing-user-repository test stayed skipped because synthetic repositories supply the audit data.
- The 100k/1k service/graph test, both P14 backend scale tests and both browser benchmark scenarios pass.
  Final native watch counts are **0 → 2,018 → 0**, with eight owners sharing two worktrees. The final
  backend sample reports a 14 ms event-loop maximum and 25.3 MiB RSS growth.
- All 17 axe state scans, fractional zoom, modal keyboard/input-method guards, forced-color selection
  and native renderer recovery pass. The deterministic commit/watcher regression passes three explicit
  repetitions and the final full sweep. These do not replace native AT/IME/desktop testing.
- Real LFS 3.4.1 and 3.8.0 transfer/error/ownership tests pass. The 3.4.1 desktop workflow also passes;
  3.8.0 is included in the final broad sweep. The upstream 3.8.0 test-tool archive matched its published
  SHA-256 list; it is retained locally under ignored test tools and is not bundled with the app.
- Final unsigned AppImage and TEST-ONLY deb builds pass. `npm run test:package` passes both desktop and
  package-boundary scenarios against the extracted AppImage. The final deb is installed and passes the
  same two scenarios as a non-root user in Ubuntu 24.04. A separate clean container installed using only
  the deb's declared dependencies and passed both scenarios. Desktop-entry validation also passes.
- Package checks confirm actual renderer `NoNewPrivs=1`, `Seccomp=2`, no no-sandbox switch, unavailable
  renderer Node globals, restrictive production CSP, independent icon and Electron/Chromium/bundled JS
  license notices. Manifest checksums match both final artifacts. Publishing and hosted CI were not run.
- Both disposable Ubuntu containers were removed after retaining their evidence. No bridge/IDE service,
  user repository, installed system library, real account or user keyring was changed.

Reviewable files are `release/Git Workbench-0.1.0.AppImage` (125,424,039 bytes),
`release/Git Workbench-0.1.0-amd64.TEST-ONLY.deb` (99,806,560 bytes), `release/SHA256SUMS` and
`release/artifact-manifest.json`. Final test artifacts are in `release/p14/final-suite`,
`package-verified`, `ubuntu-release-final`, `audit-verified` and `commit-refresh-verified`.
The updated Linux CI workflow runs the routine desktop and packaged AppImage checks but remains
unexecuted on the hosted runners during this local task.

P14 remains partial for:

1. Native GNOME/KDE Wayland/X11 moving, resizing, frame, minimize/maximize and display hotplug/scale
   transitions on clean desktop hosts. Existing headless geometry and zoom tests do not establish them.
2. Real screen-reader operation, alternative hardware keyboard layouts and native IME composition.
   Synthetic event, axe, forced-color and focus checks establish only their stated scope.
3. Native keyring unlock/lock/session behavior and graphical SSH/GPG prompts. Controlled TLS/SSH/GPG
   agent tests and credential fail-closed behavior pass; no user's keyring or credentials were accessed.
4. Live hosting/OAuth/LFS/AI vendor compatibility and real local-inference operation.
5. Public maintainer contact, release signing/distribution decisions and owner acceptance of the new
   P14 performance budgets. Local artifacts remain unsigned and the deb remains explicitly test-only.

Case-level unknowns (including alternate Commit List Layout, lightweight-tag creation, explicit Fork
GUI Skip, universal focus cycles, 125% native DPI and general graph Back/Forward) remain unknown or
explicit project differences. They have not been converted into completion claims by this audit.
