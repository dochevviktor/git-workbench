# Fork: public feature and layout baseline

Research date: **2026-09-16**; F05 source refresh: **2026-09-17**. Scope: independently implementing
publicly described workflows, with Linux as the primary target. This document is a requirements
inventory, not a claim of verified equivalence.

Only the public website, official release notes, official blog posts, and published screenshots were
consulted. No Fork installation, application execution, binary download, decompilation, or proprietary
source inspection was used. Screenshots were viewed as references and are linked below; they are not
application assets and are not copied into this repository. Code, branding, icons, wording, and styling
for this project must be independently authored.

## Baseline and confidence

The public release pages list **Mac 2.70 (2026-09-04)** and **Windows 2.22 (2026-08-28)**.
Both list vertical repository tabs. The Mac page additionally names Cursor for generated commit messages;
older Mac entries name Codex integration. Do not assume every integration is identical on Windows.
Sources: [Mac releases][mac], [Windows releases][win].

The product website offers Mac and Windows downloads, with no Linux download listed.
Source: [Fork product page][home].

Evidence labels:

- **D**: explicitly documented by the vendor. Historical posts establish the advertised workflow,
  but do not prove every detail remains unchanged in the current release.
- **O**: visible in a public screenshot, without interactive verification.
- **I**: our implementation/design inference. It must not be described as observed Fork behavior.
- **U**: unresolved through the material examined. Verify from further public material before claiming parity.

The matrix covers documented feature families. Hidden preferences, all shortcut bindings, exact
dialog defaults, error paths, and platform discrepancies need additional research as their phases start.
F01, the first F02 slice, the initial F03 slice, the initial F04 slice, the initial F05 slice, and
the initial F34 workspace chrome slice are **partial** in this project; all other F-items remain
**planned**.

### F01 source refresh

Accessed **2026-09-16**. The [Fork product page][home] explicitly advertises creating, cloning, or
adding existing repositories and quickly opening recent repositories. This is high-confidence
evidence for the advertised outcomes on Fork's listed Mac and Windows platforms, but it does not
specify dialog fields, persistence format, recovery behavior, or Linux support. The product page
lists Mac and Windows downloads and no Linux download.

For repository topology, this project uses the public [git-rev-parse documentation][rev-parse], which
documents separate working-tree, Git-directory, common-directory, bare, and top-level queries, and
[git-init documentation][init], which documents creating or reinitializing normal and bare repositories.
These are Git CLI semantics, not observations of Fork. The current implementation was tested with Git
2.55.0 on Fedora Linux; Windows/macOS path and dialog differences remain unverified.

Current project status: F01 is partial. Local open, initialize, canonical topology discovery, recent
entries, close/reopen sessions, and corrupt recent-file recovery are implemented and tested. Remote
clone, authentication, and long-running clone jobs remain deferred to P01/P05; local clone and the
remaining repository-manager workflows remain deferred to P02/P12. The first F02 source-scan slice
and initial F03 tab slice are recorded below.

### F02 source refresh

Accessed **2026-09-16**. The [Fork 1.0.79 manager article][manager] explicitly says that Fork can
recreate the source-folder structure in its Repository Manager, automatically import repositories into
their respective folders, rescan source directories manually, and select a default source folder in
Preferences. This is high-confidence **D** evidence for the advertised Mac workflow; the article is
tagged Mac and does not establish Windows behavior or exact scan rules.

The current [Mac release notes][mac] document multiple source-code directories in Fork 2.60 and
automatic discovery of new repositories in 2.56. The [Windows release notes][win] document the same
multiple-source-directory outcome in Fork 2.15 and automatic new-repository discovery in 2.12; older
Windows notes document Repository Manager subfolders and a performance improvement for rescanning.
These are **D** outcomes on the respective listed platforms. Exact recursion depth, symlink handling,
repository-marker rules, folder edit semantics, scan cancellation, and default-directory persistence
remain **U**.

This project’s first slice is an **I** choice: source roots are persisted separately from recent/open
sessions; the folder tree is regenerated from canonical filesystem paths; normal repositories are
recognized through `.git` entries and bare repositories through their standard top-level markers;
directory symlinks are not followed; overlapping roots are deduplicated; and bounded scans report
warnings instead of silently claiming completeness. These choices are not observations of Fork.

### F03 source refresh

Accessed **2026-09-16**. The [Fork 1.0.79 manager article][manager] and the current [Mac release
notes][mac] and [Windows release notes][win] document repository tabs, including the newer vertical-tab
option in the listed platform releases. This is **D** evidence for the advertised tab outcome on Mac
and Windows; it does not establish Linux support, exact shortcut bindings, dirty-state calculation,
tab persistence, or multiwindow ownership.

This project’s initial F03 slice is an **I** choice: tabs are owned by a window session, canonical tab
records and active selection are persisted atomically, Git porcelain-v2 status supplies a visible
clean/dirty/unknown indicator, vertical tabs are the default with a persisted horizontal alternative,
and Ctrl/Cmd+Shift+T reopens the most recently closed tab during the renderer session. These are
independent implementation decisions, not observed Fork behavior. The slice is partial: closed-tab
history is not yet restored after a full application restart, automatic invalidation uses polling rather
than a filesystem watcher, and P12 still covers multiwindow ownership, drag ordering, colors, and layout
refinements.

### F04 source refresh

Accessed **2026-09-16**. Fork’s public [history screenshot][history-image] is **O** evidence for a
history workspace with a commit table, graph lanes, reference decorations, and selected-commit details;
the image is a 2020 Windows view and is not a current spacing or Linux specification. Fork’s
[collapsible graph article][graph], tagged for Mac and Windows, is high-confidence historical **D**
evidence that its graph represents merge ancestry and supports branch-focused inspection, but collapse
behavior is outside the initial F04 slice. Platform differences beyond the tagged article remain **U**.

The public [git-log documentation][git-log] defines the underlying observable history semantics used by
this project: commit logs follow parent links, default output is reverse chronological, `--max-count`
and `--skip` support bounded pages, and decoration can expose ref names. The [git-for-each-ref
documentation][for-each-ref] supplies the reference enumeration contract. These are Git CLI semantics,
not observations of Fork, and are used here to keep the backend machine-readable and independent of
Fork’s implementation.

This project’s initial F04 slice is an **I** choice: `--all --topo-order` supplies a bounded local stream;
separate ref enumeration keeps full names and tracking metadata; a pure lane pass preserves parent edges
when already-loaded pages are recomputed; and commit messages are rendered as inert text. It is verified
against disposable merge/tag/unborn repositories and a real Electron selection flow. Detached-head and
multiple-root integration fixtures, large-history performance, collapse/filtering, changed-file details,
and revision-tree inspection remain unverified.

### F05 source refresh

Accessed **2026-09-17**. The official [collapsible graph article][graph], published **2020-08-03** and
tagged for **Mac and Windows**, explicitly documents collapsing and expanding merge commits by clicking
their graph tips or using `←`/`→`, and collapsing all branches from the graph context menu before
expanding the branches of interest. This is high-confidence historical **D** evidence for those
advertised platform workflows. The article does not establish Linux support, the exact merge-boundary
rules, nested-merge behavior, persistence, paging behavior, or accessibility details.

This project’s first F05 slice is an **I** choice: collapsing a merge hides loaded commits reachable
only from its non-first parent, keeps merge tips and reference-decorated tips visible as navigation
handles, reconnects hidden edges at the nearest visible ancestor, and keeps collapse state scoped to
the active repository view. Left/Right keyboard commands, merge-tip buttons, and graph context-menu
actions are covered by unit tests and a disposable-repository Electron flow. Paged-history continuity,
large-history performance, exact current Fork visuals, and cross-platform pointer behavior remain
unverified; Linux follows the project’s independent implementation because Fork publishes no Linux
build.

### F34 workspace chrome, graph drawing, and context-menu refresh

Accessed **2026-09-16**, prompted by a request to bring the layout, graph drawing, context menus, and
title bar closer to Fork. Only the public images and release-note pages linked below were used; images
were viewed in a temporary working directory and are not stored in this repository. Frames of the
public blog GIFs were inspected individually.

Observed in public images (**O**; contents date from 2019–2020, so current spacing may differ):

- Windows window chrome ([history image][history-image], [manager image][manager-image]): a
  custom-drawn top row holds File/View/Repository/Window/Help menus, a centered title, and
  minimize/maximize/close buttons. Below it, an icon-over-label toolbar has Quick Launch, Fetch, Pull,
  Push, and Stash with a dropdown; a centered repository panel with an activity button, repository
  name (`*` when dirty), and current branch; New Branch; then Open in, Console, Appearance, and
  Feedback. Equal-width repository tabs follow, with `*` for uncommitted changes and a `+` button.
- The manager image shows a new tab titled Repository Manager with a Recent/Repositories tree, a
  details pane with an Open button, "Welcome to Fork! Open a repository to start" in the toolbar
  panel, and only File/Window/Help menus while no repository tab is active.
- The [Mac history image][mac-history-image] shows the same toolbar and tabs with native traffic
  lights inside a full-height sidebar.
- The repository sidebar has the repository name and a settings button, Changes (count) and All
  Commits entries, an icon row (branches, search, hosting service), a Filter field, and a tree of
  Starred, Branches, Remotes, Tags, Stashes, and Submodules. Branch names containing `/` appear as
  folders; the current branch has a check mark, bold text, and ahead/behind counts
  ([branch status image][branch-status-image], [sidebar filter image][sidebar-filter-image]).
- The commit table has no column headers: graph, reference labels and subject, avatar and author,
  short SHA, and date. The HEAD commit row is bold, and commits not reachable from the current branch
  are gray. Details below use Commit, Changes, and File Tree tabs with author/committer blocks, SHA,
  parent links, and the message.
- Graph drawing ([collapsible graph image][graph-image], [colored labels image][labels-image]):
  lanes are vertical lines that keep their column; a merge edge leaves the merge commit horizontally
  and turns down into the parent's lane with a rounded corner; a lane ending at its parent turns
  into that commit with a rounded corner; ordinary commits are small rings and merge commits are
  larger filled markers. Reference labels use a light tint of the commit's lane color with a border
  in that color, and a remote-tracked label adds a hosting-service icon segment.
- Menus ([bisect GIF][bisect-gif], [partial stash GIF][stash-gif], [drag-and-drop GIF][dnd-gif]):
  title-bar menus list shortcuts at the right and submenu arrows. The commit context menu starts with
  Create New Branch…, Create New Tag…, Interactive Rebase ▸, Reset '<branch>' to Here…, Checkout
  Commit…, Cherry-pick Commit…, Revert Commit…, Save as Patch…, and Copy Commit SHA (later entries are
  cropped). A right-clicked row is highlighted without replacing the selection. File and
  branch-drop menus are also renderer-styled popups.
- Some 2020 GIF frames also show lanes moving sideways with S-shaped transitions when space frees up.

Documented in release notes (**D**; version and date shown, Mac or Windows as listed): Mac 1.0.11
(2016-07-01) “Made the window title-less”; Windows 1.16 (2018-05-08) “Move application menu to
title”; Mac 1.0.18 (2016-08-22) unreachable revisions shown in gray; Mac 2.30 (2023-06-23)
“Emphasize active branch in commit list”; Windows 1.34 (2019-06-08) and Mac 2.53 (2025-05-21) branch
labels drawn with their graph colors; Windows 2.16 (2026-02-20) “Refreshed visual style - chevron
icons, updated graph lines, new toolbar icons” and a fix for “Vertical graph lines have subtle
horizontal offsets between rows”; Mac 2.65 (2026-03-20) and Windows 2.18 (2026-03-24) “Add 4 more
graph colors”; Mac 2.15 (2022-01-07) light/dark theme independent from the system; Windows 1.15/1.27
(2018/2019) closing tabs with middle click; Windows 1.30 (2019-03-22) “Close All” and “Close All But
This” in the tab context menu; Windows 2.21 (2026-07-16) Open in Terminal and Open in File Explorer
in the tab context menu; Mac 2.68 (2026-06-19) tab context menu Rename, select color, Open in
Terminal, Show in Finder; Mac 2.3 (2021-01-22) and Windows 1.58 (2021-01-15) copy to clipboard in
the branch context menu; Mac 1.0.35 (2017-01-13) “Open in Finder” in the repository manager context
menu; Mac 1.0.41 (2017-03-22) repository manager when all tabs are closed; Mac 2.66 (2026-04-10)
arrow-key sidebar navigation; Windows 2.20 (2026-06-05) Ctrl+Shift+T reopening and Tab/Shift-Tab
navigation between sidebar, commit list, and details. Sources: [Mac releases][mac], [Windows
releases][win].

This project’s implementation is an **I** choice built from those observations and documented
outcomes: Linux and Windows use a frameless Electron window with a renderer-drawn title bar, menu
bar, and window controls; macOS keeps native traffic lights and its native application menu. All
context menus and title-bar menus share one renderer menu component. Graph lanes keep their column,
elbows are quarter circles, and lines slightly overlap row boundaries so they stay continuous.
Unimplemented Git operations keep Fork’s menu and toolbar positions but are disabled with a tooltip
naming the planned phase. Colors, icons, and wording are independently authored; Fork assets are not
used.

Unresolved (**U**): the 2026 “updated graph lines” and toolbar icon refresh are not shown in the
public images examined; where vertical tabs are placed in Fork 2.70/2.22; Fork’s current dark palette;
the full current commit, branch, and tab context-menu contents; whether lanes still move sideways;
the rules behind “Compact branch labels” (Windows 1.55, Mac 2.19); and how tab badges for uncommitted
changes (Mac 2.45) render. Linux has no Fork release to compare with, so Linux chrome follows the
Windows layout.

## Feature coverage

Phase IDs refer to [the implementation plan](../implementation-plan.md).

| ID  | Public capability                                                                                           | Evidence                                                                                                                               | Planned phase |
| --- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| F01 | Initialize, clone, add existing repositories, recent repositories                                           | D: [product][home]                                                                                                                     | P02, P05      |
| F02 | Repository manager, folder hierarchy, source-directory scanning                                             | D: [Mac 1.0.79][manager], [Mac releases][mac], [Windows releases][win]                                                                 | P02, P12      |
| F03 | Multiple repository tabs and dirty indicators; vertical tabs and reopen-closed shortcuts                    | D: [manager][manager], [Mac releases][mac], [Windows releases][win]                                                                    | P02, P12      |
| F04 | Commit graph, reference labels, authors, hashes, dates, selection                                           | O: [history screenshot][history-image]; I: initial local history/graph/selection slice verified against disposable Git fixtures        | P03           |
| F05 | Collapse/expand merge branches in the graph                                                                 | D: [graph article][graph]; I: loaded-history projection, merge-tip controls, keyboard/context-menu flow (partial)                      | P03           |
| F06 | Branch/file filters, commit search, path/diff-content search                                                | D: [Windows 1.38][diff], [Mac releases][mac]                                                                                           | P03, P08      |
| F07 | Commit metadata, parents, changed files, tree at a revision                                                 | D/O: [product][home], [history screenshot][history-image]                                                                              | P03           |
| F08 | Staged/unstaged lists; tree/list mode; untracked/ignored visibility                                         | O/D: [changes screenshot][changes-image], [Windows 1.23][rebase]                                                                       | P04           |
| F09 | Unified/split diffs, inline changes/search, whitespace display                                              | D/O: [Windows 1.38][diff], [Mac 1.0.79][manager], [split screenshot][split-image]                                                      | P04           |
| F10 | File, hunk, and line staging/unstaging; hunk discard controls                                               | D/O: [product][home], [changes screenshot][changes-image]                                                                              | P04           |
| F11 | Commit, amend, recent messages, templates, hooks                                                            | D: [product][home], [Mac 1.0.73][merge], [Mac 1.0.79][manager]                                                                         | P04           |
| F12 | Branch/tag creation and deletion; checkout a branch or revision                                             | D: [product][home]                                                                                                                     | P05           |
| F13 | Remotes; fetch/pull/push; upstream indicators; multiple-branch push                                         | D: [product][home], [Windows 1.48][operations]                                                                                         | P05, P06      |
| F14 | Background fetch; cancellable network work; activity and command output                                     | D: [Mac 1.0.67][activity], [Windows 1.48][operations]                                                                                  | P01, P05      |
| F15 | Stashes in history, partial stashes, patch export                                                           | D: [product][home], [Windows 1.48][operations], [Windows releases][win]                                                                | P06, P08      |
| F16 | Merge/rebase; drag branches to initiate either operation                                                    | D: [product][home], [Windows 1.48][operations]                                                                                         | P06, P07      |
| F17 | Built-in conflict helper and editable merge result                                                          | D: [product][home], [Mac 1.0.73][merge]                                                                                                | P06           |
| F18 | Visual interactive rebase: ordering, pick/edit/reword/squash/fixup/drop                                     | D: [Windows 1.23][rebase]                                                                                                              | P07           |
| F19 | Cherry-pick and revert                                                                                      | D: [product][home]                                                                                                                     | P06           |
| F20 | Reflog/lost-commit recovery                                                                                 | D: [product][home]                                                                                                                     | P08           |
| F21 | File/directory history, blame; selected-code history                                                        | D: [product][home], [Windows releases][win]                                                                                            | P08           |
| F22 | Worktree creation/removal; remote-branch checkout into worktrees                                            | D: [Mac releases][mac], [Windows releases][win]                                                                                        | P09           |
| F23 | Submodules and informative submodule revision comparisons                                                   | D: [product][home], [Mac 1.0.73][merge]                                                                                                | P09           |
| F24 | Git LFS, image preview/download, server locks                                                               | D: [product][home], [Mac 1.0.79][manager], [Windows 1.48][operations]                                                                  | P10           |
| F25 | Git-flow workflows                                                                                          | D: [product][home]                                                                                                                     | P09           |
| F26 | Bisect with visible progress; good/bad/skip actions                                                         | D: [Windows 1.48][operations], [Windows releases][win]                                                                                 | P08           |
| F27 | Image comparison: side-by-side, swipe, onion skin; pixel differences                                        | D: [Windows 1.38][diff], [Mac releases][mac]                                                                                           | P10           |
| F28 | GPG support, including signed tags                                                                          | D: [product][home], [Mac releases][mac]                                                                                                | P10           |
| F29 | Hosted repository accounts; GitHub, GitLab, Bitbucket, Azure PR entry points; Gitea references              | D: [Windows 1.48][operations], [Windows releases][win]                                                                                 | P11           |
| F30 | GitHub notifications; pull-request/issue lists and filters                                                  | D: [product][home], [Windows releases][win]                                                                                            | P11           |
| F31 | Quick Launch: fuzzy command/branch/file lookup; user commands                                               | D: [Quick Launch][quick]                                                                                                               | P12           |
| F32 | Contextual custom commands; shared definitions and configurable input controls                              | D: [Mac 1.0.67][activity], [Windows releases][win]                                                                                     | P12           |
| F33 | External editors, diff/merge tools, terminal/file-manager actions, CLI repository opening                   | D: [Mac 1.0.67][activity], [Windows 1.23][rebase], [Windows releases][win]                                                             | P02, P12      |
| F34 | Theme/appearance, keyboard navigation, split panes, issue links, avatars; title-bar menus and context menus | D/O: [Windows 1.38][diff], [history screenshot][history-image], [Mac releases][mac], [Windows releases][win], [bisect GIF][bisect-gif] | P03–P04, P12  |
| F35 | Repository summaries/statistics and activity treemap                                                        | D: [product][home], [Windows releases][win]                                                                                            | P13           |
| F36 | Save/apply patches, including clipboard entry points                                                        | D: [Mac 1.0.67][activity], [Mac releases][mac]                                                                                         | P08           |
| F37 | External AI tools for commit messages and branch/range review                                               | D: [Mac releases][mac], [Windows releases][win]                                                                                        | P13           |

Recent release notes also describe conflict previews, rebase-dependent-reference updates, richer worktree
navigation, and tab ergonomics. These are refinements within F03/F16/F18/F22, not reasons to declare the
basic workflows complete early. Source: [Mac releases][mac].

## Layout observations

The [published history image][history-image] shows a custom title row with menus and window
controls, a top action toolbar and repository tabs, a narrow left navigation tree, a large commit
table with graph lanes, and lower commit/changes/tree details.
Repository navigation and selected-commit inspection remain visible together. This screenshot's contents
date from 2020; its exact spacing and horizontal-tab arrangement are not a current pixel specification.
The newer vertical-tab option is documented separately in release notes.

The [working-changes image][changes-image] retains repository navigation. Its center file column is split
into unstaged and staged sections, with a larger diff to the right and a commit composer beneath.
Hunk actions sit beside the relevant change. The [split-diff image][split-image] shows an enlarged,
two-column comparison and keyboard hints. These are observations of published images, not measured
interaction behavior.

Our mature layout (**I**, independently implemented, following the observations above):

```text
┌─────────────────────────────────────────────────────────────────────┐
│ File View Repository Window Help      Title            ─  □  ✕       │
├─────────────────────────────────────────────────────────────────────┤
│ Quick Launch Fetch Pull Push Stash▾ [≡ repo* / branch ↑↓] New Branch │
│                                                 Open in▾ Appearance▾ │
├─────────────────────────────────────────────────────────────────────┤
│ repository tab* │ repository tab │ Repository Manager │            + │
├───────────────┬─────────────────────────────────────────────────────┤
│ repo       ⚙  │ graph + labels + subject │ author │ SHA │ date       │
│ Local Changes │                                                     │
│ All Commits   ├─────────────────────────────────────────────────────┤
│ ⑂  🔍         │ Commit │ Changes │ File Tree                         │
│ Filter        │ author/committer, refs, SHA, parents, message       │
│ ▾ Branches    │                                                     │
│ ▾ Remotes     │ Local Changes swaps the right side for               │
│ ▸ Tags        │ staged + unstaged files | diff | commit composer    │
│   Stashes     │                                                     │
│   Submodules  │                                                     │
└───────────────┴─────────────────────────────────────────────────────┘
```

Vertical tabs move the tab strip to a column left of the sidebar. The window has no status bar; long
operations will use the activity surface planned for P01. Panes are resizable and remembered per
renderer profile. Graph color supplements labels, and added/removed styling supplements signs so color
is never the only cue. Typography, spacing, icons, and theme tokens are this project's own.

## Unresolved parity questions

- **U:** exact defaults and complete option sets for pull, push, reset, discard, stash, and conflict dialogs.
  Define safe project defaults and document differences until public evidence resolves them.
- **U:** full provider-by-provider parity, self-hosted authentication details, review versus browser handoff,
  and notification behavior. A documented PR entry point does not by itself establish an in-app review editor.
- **U:** all signing backends, sparse checkout, partial clone, reftable/SHA-256 behavior, and platform feature gaps.
  Treat underlying Git capabilities and advertised Fork support as separate questions.
- **U:** exact performance, graph lane algorithm, internal caching, watcher strategy, and private IPC or service design.
  Choose and measure our own implementation.
- **U:** exhaustive current menus, preferences, gestures, accessibility behavior, and shortcut conflicts.
  Older screenshots are useful for information architecture, not an exact current design inventory.
  The F34 refresh above lists the chrome and graph details that remain unresolved.
- **U:** proprietary algorithms and hidden state are outside this research scope. Equivalence will be assessed
  against documented user outcomes and Git repository state, not against private implementation behavior.

## Maintaining this record

Before each phase, refresh its sources and add dated evidence for new requirements. Keep three records
separate: what Fork publicly documents, what this project chooses to implement, and what tests verify.
Add a feature row if new public behavior has no coverage. Mark a row partial if any promised subworkflow
is missing. Do not silently remove difficult features from the target.

Public images used for the F34 refresh: [history image][history-image] and [manager image][manager-image]
(Windows, 2020 content); [Mac history image][mac-history-image] (2020 content); [collapsible graph
image][graph-image] 2020-08-03; [colored labels image][labels-image], [sidebar filter
image][sidebar-filter-image] 2019-08-27; [bisect GIF][bisect-gif], [partial stash GIF][stash-gif],
[drag-and-drop GIF][dnd-gif], [branch status image][branch-status-image] 2020-05-05. All accessed
2026-09-16.

Source dates for historical workflow evidence: [activity][activity] 2018-05-28;
[rebase][rebase] 2018-11-10; [merge][merge] 2019-02-06; [manager][manager] 2019-06-12;
[diff][diff] 2019-08-27; [Quick Launch][quick] 2019-10-23; [operations][operations] 2020-05-05;
[graph][graph] 2020-08-03. All accessed 2026-09-16; the graph article was revisited 2026-09-17 for F05.

[home]: https://fork.dev/
[mac]: https://fork.dev/releasenotes
[win]: https://fork.dev/releasenoteswin
[graph]: https://fork.dev/blog/posts/collapsible-graph/
[quick]: https://fork.dev/blog/posts/quick-launch/
[operations]: https://fork.dev/blog/posts/forkwin-1.48/
[rev-parse]: https://git-scm.com/docs/git-rev-parse
[git-log]: https://git-scm.com/docs/git-log
[for-each-ref]: https://git-scm.com/docs/git-for-each-ref
[init]: https://git-scm.com/docs/git-init
[diff]: https://fork.dev/blog/posts/forkwin-1.38/
[rebase]: https://fork.dev/blog/posts/forkwin-1.23/
[merge]: https://fork.dev/blog/posts/fork-1.0.73/
[manager]: https://fork.dev/blog/posts/fork-1.0.79/
[activity]: https://fork.dev/blog/posts/fork-1.0.67/
[history-image]: https://fork.dev/images/carousel/carousel_mainWin.jpg
[changes-image]: https://fork.dev/images/carousel/carousel_commitviewWin1.jpg
[split-image]: https://fork.dev/images/carousel/carousel_commitviewWin2.jpg
[manager-image]: https://fork.dev/images/carousel/carousel_repomanagerWin1.jpg
[mac-history-image]: https://fork.dev/images/carousel/carousel_mainMac.jpg
[graph-image]: https://fork.dev/blog/posts/collapsible-graph/swift-show-all.png
[labels-image]: https://fork.dev/blog/posts/forkwin-1.38/colored-branch-labels.jpg
[sidebar-filter-image]: https://fork.dev/blog/posts/forkwin-1.38/sidebar-filter.jpg
[branch-status-image]: https://fork.dev/blog/posts/forkwin-1.48/branch-status.jpg
[bisect-gif]: https://fork.dev/blog/posts/forkwin-1.48/bisect.gif
[stash-gif]: https://fork.dev/blog/posts/forkwin-1.48/partial-stash.gif
[dnd-gif]: https://fork.dev/blog/posts/forkwin-1.48/drag-and-drop-merge.gif
