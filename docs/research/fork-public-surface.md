# Fork: public feature and layout baseline

Research date: **2026-09-16**. Scope: independently implementing publicly described workflows, with Linux
as the primary target. This document is a requirements inventory, not a claim of verified equivalence.

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
All F-items below remain **planned**; the foundation shell does not implement Git workflows.

## Feature coverage

Phase IDs refer to [the implementation plan](../implementation-plan.md).

| ID  | Public capability                                                                              | Evidence                                                                            | Planned phase |
| --- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------- |
| F01 | Initialize, clone, add existing repositories, recent repositories                              | D: [product][home]                                                                  | P02, P05      |
| F02 | Repository manager, folder hierarchy, source-directory scanning                                | D: [Mac 1.0.79][manager]                                                            | P02, P12      |
| F03 | Multiple repository tabs and dirty indicators; vertical tabs and reopen-closed shortcuts       | D: [manager][manager], [Mac releases][mac], [Windows releases][win]                 | P02, P12      |
| F04 | Commit graph, reference labels, authors, hashes, dates, selection                              | O: [history screenshot][history-image]                                              | P03           |
| F05 | Collapse/expand merge branches in the graph                                                    | D: [graph article][graph]                                                           | P03           |
| F06 | Branch/file filters, commit search, path/diff-content search                                   | D: [Windows 1.38][diff], [Mac releases][mac]                                        | P03, P08      |
| F07 | Commit metadata, parents, changed files, tree at a revision                                    | D/O: [product][home], [history screenshot][history-image]                           | P03           |
| F08 | Staged/unstaged lists; tree/list mode; untracked/ignored visibility                            | O/D: [changes screenshot][changes-image], [Windows 1.23][rebase]                    | P04           |
| F09 | Unified/split diffs, inline changes/search, whitespace display                                 | D/O: [Windows 1.38][diff], [Mac 1.0.79][manager], [split screenshot][split-image]   | P04           |
| F10 | File, hunk, and line staging/unstaging; hunk discard controls                                  | D/O: [product][home], [changes screenshot][changes-image]                           | P04           |
| F11 | Commit, amend, recent messages, templates, hooks                                               | D: [product][home], [Mac 1.0.73][merge], [Mac 1.0.79][manager]                      | P04           |
| F12 | Branch/tag creation and deletion; checkout a branch or revision                                | D: [product][home]                                                                  | P05           |
| F13 | Remotes; fetch/pull/push; upstream indicators; multiple-branch push                            | D: [product][home], [Windows 1.48][operations]                                      | P05, P06      |
| F14 | Background fetch; cancellable network work; activity and command output                        | D: [Mac 1.0.67][activity], [Windows 1.48][operations]                               | P01, P05      |
| F15 | Stashes in history, partial stashes, patch export                                              | D: [product][home], [Windows 1.48][operations], [Windows releases][win]             | P06, P08      |
| F16 | Merge/rebase; drag branches to initiate either operation                                       | D: [product][home], [Windows 1.48][operations]                                      | P06, P07      |
| F17 | Built-in conflict helper and editable merge result                                             | D: [product][home], [Mac 1.0.73][merge]                                             | P06           |
| F18 | Visual interactive rebase: ordering, pick/edit/reword/squash/fixup/drop                        | D: [Windows 1.23][rebase]                                                           | P07           |
| F19 | Cherry-pick and revert                                                                         | D: [product][home]                                                                  | P06           |
| F20 | Reflog/lost-commit recovery                                                                    | D: [product][home]                                                                  | P08           |
| F21 | File/directory history, blame; selected-code history                                           | D: [product][home], [Windows releases][win]                                         | P08           |
| F22 | Worktree creation/removal; remote-branch checkout into worktrees                               | D: [Mac releases][mac], [Windows releases][win]                                     | P09           |
| F23 | Submodules and informative submodule revision comparisons                                      | D: [product][home], [Mac 1.0.73][merge]                                             | P09           |
| F24 | Git LFS, image preview/download, server locks                                                  | D: [product][home], [Mac 1.0.79][manager], [Windows 1.48][operations]               | P10           |
| F25 | Git-flow workflows                                                                             | D: [product][home]                                                                  | P09           |
| F26 | Bisect with visible progress; good/bad/skip actions                                            | D: [Windows 1.48][operations], [Windows releases][win]                              | P08           |
| F27 | Image comparison: side-by-side, swipe, onion skin; pixel differences                           | D: [Windows 1.38][diff], [Mac releases][mac]                                        | P10           |
| F28 | GPG support, including signed tags                                                             | D: [product][home], [Mac releases][mac]                                             | P10           |
| F29 | Hosted repository accounts; GitHub, GitLab, Bitbucket, Azure PR entry points; Gitea references | D: [Windows 1.48][operations], [Windows releases][win]                              | P11           |
| F30 | GitHub notifications; pull-request/issue lists and filters                                     | D: [product][home], [Windows releases][win]                                         | P11           |
| F31 | Quick Launch: fuzzy command/branch/file lookup; user commands                                  | D: [Quick Launch][quick]                                                            | P12           |
| F32 | Contextual custom commands; shared definitions and configurable input controls                 | D: [Mac 1.0.67][activity], [Windows releases][win]                                  | P12           |
| F33 | External editors, diff/merge tools, terminal/file-manager actions, CLI repository opening      | D: [Mac 1.0.67][activity], [Windows 1.23][rebase], [Windows releases][win]          | P02, P12      |
| F34 | Theme/appearance, keyboard navigation, split panes, issue links, avatars                       | D/O: [Windows 1.38][diff], [history screenshot][history-image], [Mac releases][mac] | P03–P04, P12  |
| F35 | Repository summaries/statistics and activity treemap                                           | D: [product][home], [Windows releases][win]                                         | P13           |
| F36 | Save/apply patches, including clipboard entry points                                           | D: [Mac 1.0.67][activity], [Mac releases][mac]                                      | P08           |
| F37 | External AI tools for commit messages and branch/range review                                  | D: [Mac releases][mac], [Windows releases][win]                                     | P13           |

Recent release notes also describe conflict previews, rebase-dependent-reference updates, richer worktree
navigation, and tab ergonomics. These are refinements within F03/F16/F18/F22, not reasons to declare the
basic workflows complete early. Source: [Mac releases][mac].

## Layout observations

The [published history image][history-image] shows a top action toolbar and repository tabs, a narrow
left navigation tree, a large commit table with graph lanes, and lower commit/changes/tree details.
Repository navigation and selected-commit inspection remain visible together. This screenshot's contents
date from 2020; its exact spacing and horizontal-tab arrangement are not a current pixel specification.
The newer vertical-tab option is documented separately in release notes.

The [working-changes image][changes-image] retains repository navigation. Its center file column is split
into unstaged and staged sections, with a larger diff to the right and a commit composer beneath.
Hunk actions sit beside the relevant change. The [split-diff image][split-image] shows an enlarged,
two-column comparison and keyboard hints. These are observations of published images, not measured
interaction behavior.

Our proposed mature layout (**I**, independently designed):

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Repository tabs / workspace selector    Commands and Git operations │
├───────────────┬─────────────────────────────────────────────────────┤
│ Changes       │ History: graph + subject / author / hash / date     │
│ History       │                                                     │
│ Search        ├─────────────────────────────────────────────────────┤
│ Worktrees     │ Selected commit / changed files / revision tree     │
│ Branches      │                                                     │
│ Remotes       │ Changes view swaps this area for:                    │
│ Tags          │ staged + unstaged files | diff | commit composer     │
│ Stashes       │                                                     │
├───────────────┴─────────────────────────────────────────────────────┤
│ Repository status / operation progress / cancel / activity drawer  │
└─────────────────────────────────────────────────────────────────────┘
```

Use compact, resizable panes; virtualize long lists; preserve selection and scroll per repository.
Keep command names visible or discoverable with keyboard access. Graph color supplements labels,
and added/removed styling supplements signs so color is never the only cue. Choose native Linux
window controls and our own typography, spacing, icons, and theme tokens. These are project design
decisions. The current empty shell establishes regions only; pane resizing and Git views are later work.

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
- **U:** proprietary algorithms and hidden state are outside this research scope. Equivalence will be assessed
  against documented user outcomes and Git repository state, not against private implementation behavior.

## Maintaining this record

Before each phase, refresh its sources and add dated evidence for new requirements. Keep three records
separate: what Fork publicly documents, what this project chooses to implement, and what tests verify.
Add a feature row if new public behavior has no coverage. Mark a row partial if any promised subworkflow
is missing. Do not silently remove difficult features from the target.

Source dates for historical workflow evidence: [activity][activity] 2018-05-28;
[rebase][rebase] 2018-11-10; [merge][merge] 2019-02-06; [manager][manager] 2019-06-12;
[diff][diff] 2019-08-27; [Quick Launch][quick] 2019-10-23; [operations][operations] 2020-05-05;
[graph][graph] 2020-08-03. All accessed 2026-09-16.

[home]: https://fork.dev/
[mac]: https://fork.dev/releasenotes
[win]: https://fork.dev/releasenoteswin
[graph]: https://fork.dev/blog/posts/collapsible-graph/
[quick]: https://fork.dev/blog/posts/quick-launch/
[operations]: https://fork.dev/blog/posts/forkwin-1.48/
[diff]: https://fork.dev/blog/posts/forkwin-1.38/
[rebase]: https://fork.dev/blog/posts/forkwin-1.23/
[merge]: https://fork.dev/blog/posts/fork-1.0.73/
[manager]: https://fork.dev/blog/posts/fork-1.0.79/
[activity]: https://fork.dev/blog/posts/fork-1.0.67/
[history-image]: https://fork.dev/images/carousel/carousel_mainWin.jpg
[changes-image]: https://fork.dev/images/carousel/carousel_commitviewWin1.jpg
[split-image]: https://fork.dev/images/carousel/carousel_commitviewWin2.jpg
