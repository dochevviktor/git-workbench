# F34 settings handoff — 2026-09-22

F34 now has application Preferences and selected-repository Settings, with bounded, working controls.
F34/P12 remain **partial** for the remaining preference inventory, workspace features and platform matrix.

## Implemented behavior

- File → Preferences and Ctrl/Cmd+, work without an open repository. General provides System/Light/Dark,
  a 10–20 px diff font, −/+ marks and the existing automatic-fetch scheduler preference. Commit provides
  a subject-length guide and spellchecking. These presentation/fetch controls apply immediately.
- Git shows the active executable/version, allows native executable selection, validates its Git version,
  and explicitly saves the next-startup selection. System Git returns to GIT_EXECUTABLE/PATH discovery.
  Existing operations keep their current executable. Missing selections cannot replace a valid saved one;
  damaged instance files are preserved and their read failure is visible in Preferences.
- Integration and Custom Commands open the existing working managers. Unsupported Updates and other
  preference fields are described as unavailable; there is no simulated updater or syntax highlighter.
- Repository → Settings and the sidebar gear capture the repository ID, name and path. Identity and
  issue-link edits use Save/Cancel. Blank identity fields remove entries only from the displayed write
  destination. Included, system, global and worktree values are not removed. The effective configured
  value, scope and origin remain visible. Author environment overrides are explicitly distinguished.
- Repository writes target the common Git directory's config, including from linked worktrees. Existing
  `config.worktree` identity takes precedence and is preserved. Remotes and Git-flow handoffs use existing
  dialogs and are disabled while edits are pending or another repository has become active.
- One repository issue rule matches a literal prefix and 1–12 decimal digits; an HTTPS template contains
  one `{id}` in its path/query. Commit details and their inspectors show up to 30 distinct issue buttons.
  Main re-reads the saved rule on an explicit click and opens the URL. No generic URL capability is added.

## Boundaries and persistence

`desktop.settings` has named schemas, preload calls and authorized main handlers. Inspectors can read
their owned repository settings and open issue links; all settings writes, global reads and executable
selection are denied. The settings-changed event carries no configuration and uses exact listener cleanup.
Open commit composers and issue views reload on successful Git settings writes. Presentation preferences
keep the existing localStorage keys and defaults, synchronize within the renderer/across windows, and add
new keys without replacing old layout/draft values. Inspector appearance follows subsequent profile changes.

Git settings reads query only the supported identity/rule keys. A snapshot includes the complete target
file hash and effective identity/origin. Saving holds Git's adjacent `.lock`, edits a private temporary
copy using Git's config writer, rechecks the snapshot, syncs and atomically renames the prepared file.
Unrelated config is preserved. Preparation failure publishes neither identity field. Lock conflicts fail
without removing another writer's lock. Existing symlinks resolve to their target. Temporary files are
private and cleaned after success/failure; no test mutates the development repository or real global config.
Application writes serialize by common directory; global settings use their destination path as queue key.
As with Git's lock convention, an external writer that ignores locks can race the final recheck/rename;
this is not a filesystem-wide transaction or a lock on included files.

Global writes follow Git's explicit GIT_CONFIG_GLOBAL, existing home config, then existing XDG config
selection. They do not edit system or included files. Settings are not stored in tracked repository content.
Git instance selection is a separate versioned atomic profile file with stale revision rejection.

## Evidence and independent choices

- Primary: `P0-013-general-git-subcase:F1–F4`, Windows 2.22.0.0, captured 2026-09-19. Read the original
  case, both General/Git PNGs and `batch02-resume/git-verification.json`. High confidence for visible
  page names, General/Git controls, variable dialog height and no-edit Git invariance. Factory defaults,
  other page details, saves and persistence remain unobserved.
- Existing theme/restart targets: P2-012 and P2-015 retain their limited case scope. This change verifies
  explicit preference persistence independently; it does not claim that all Fork selections/panes persist.
- Public repository existence: [Windows 1.30 release notes](https://git-fork.com/releasenoteswin),
  2019-03-22; [Mac 1.0.75 notes](https://git-fork.com/releasenotes), 2019-03-14. Checked 2026-09-22;
  high confidence for existence/bugtracker support, not complete Windows 2.22 field semantics.
- Public visual gap: restored references, 226 existing files, no downloads/failures. Compared Windows
  [1.38 issue hyperlinks](https://fork.dev/blog/posts/forkwin-1.38/) (2019-08-27) and Mac
  [1.0.79 issue configuration](https://fork.dev/blog/posts/fork-1.0.79/) (2019-06-12).
  The latter shows multiple regex rules/local-shared choices; those formats and semantics are not copied.
  Our single literal-prefix rule, separate buttons, HTTPS policy and config key are independent adaptations.
- [Git configuration documentation](https://git-scm.com/docs/git-config), checked 2026-09-22, supplies
  global/local/worktree/include precedence and config-write semantics. Git, not renderer code, parses config.
- Independently authored compact tabs/labelled rows follow the captured General/Git composition. Larger
  scope/origin explanations, explicit save controls, scrollable small-window layout and no avatar fetching
  are deliberate differences. No private image/assets or capture harness were copied or executed.

## Verification and remaining limits

`npm run check` passes 421 tests with one existing skip; `npm run build` passes. The four headless
Electron scenarios (settings, desktop, catalogue foundation and catalogue changes) pass. Settings and
desktop were rerun against the final config-lock fix. The new unit suite covers
global/local inheritance, two-repository isolation, linked/worktree overrides, includes, external changes,
locks, atomic preparation failure, no-op invariance, symlinks, Git selection/restart storage and invalid
inputs, including preservation of a new writer's lock after atomic publication. Preload tests cover
validation and exact event cleanup. The headless UI scenario covers keyboard
entry/focus, Cancel, errors/reload, issue handoff, font/marks/composer controls and persistence after restart.
An open inspector follows live appearance and issue-rule changes while global settings reads are denied.
Screenshots in ignored `test-results/f34-*.png` cover General dark, Git light and repository light/narrow.
They were compared with the original P0-013 captures and the public issue screenshots.

Still open: full Commit/Git/Updates inventory, source-folder management inside Preferences (the existing
manager remains available), sort-order/syntax controls, verbose Git preference, avatar/network policy,
shortcut customization, multiple/shared/regex issue rules, signing/template editing inside these pages,
workspaces/saved layouts/tab colors, full retention/focus/leak/display matrix and native Wayland frame
verification. Existing recovery/drafts/layout behavior is preserved. Unsupported field inventory is not
declared complete. Windows/macOS packaging, filesystem ACL/network-drive/crash durability matrices and
installed GUI tool behavior remain unverified. Neither the complete F34 family nor P12 is marked complete.
