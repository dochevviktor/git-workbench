# Fork: public feature and layout baseline

Research date: **2026-09-16**; F05/F08 source refresh, design reference refresh, and F09–F11 source
refresh: **2026-09-17**; F12 and F13 source refresh and workflow audit: **2026-09-19**.
Scope: independently implementing publicly described workflows, with Linux as the primary target. This
document is a requirements inventory, not a claim of verified equivalence.

Only the public website, official release notes, official blog posts, and published screenshots
(including public issue attachments and independently published hands-on articles) were consulted.
No Fork installation, application execution, binary download, decompilation, or proprietary
source inspection was used. Screenshots were viewed as references and are linked below; they are not
application assets and are not committed to this repository. Code, branding, icons, wording, and styling
for this project must be independently authored.

Since 2026-09-17, public screenshots used for design comparison are listed with their source, date,
platform, stated version, and theme in [`fork-references.json`](fork-references.json).
`npm run research:references` downloads them into the git-ignored `docs/research/fork-references/`
folder and writes an `INDEX.md` there, grouped by topic and source. The local copies exist only for
comparison: they are never committed, bundled, or used as application assets.

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
F01, the first F02 slice, the initial F03 slice, the initial F04 slice, the initial F05 slice, the
initial F07 slice, the F08–F11 local-change slices, the initial F12 branch/tag slice, the initial F13
remote/network slice, the F14 background-fetch/activity slice, and the initial F34 workspace chrome slice are **partial** in this project.
The stabilization also starts the F15/F16 recovery subset and the F29 PR browser handoff; their full
feature families and all other F-items remain incomplete or planned.

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

### F06 source refresh

Accessed **2026-09-17**. The official [Fork for Windows 1.38 article][diff] explicitly documents a
sidebar filter for searching branches by name and a filter for file lists. This is high-confidence
**D** evidence for the Windows workflow, published **2019-08-27**; it does not establish the current
search panel layout or exact matching rules. The official [Mac release notes][mac] document a new
commit search, file-path search, and file matches for diff/path searches in Fork 1.0.98 (**2020-09-04**),
and recent search queries in Fork 2.9 (**2021-06-25**). These are high-confidence **D** outcomes for
Mac release history, but the notes do not specify the complete query language, scope, or current UI.
Neither source establishes Linux support or parity between the two platforms.

This project’s first F06 slice is an **I** choice: a reference context-menu action scopes the history
query to the selected reference’s validated commit target, while the commit search field performs a
bounded, case-insensitive, fixed-string search over commit messages. Since the 2026-09-17 design refresh
below, that field and its results live in a sidebar Search Commits panel instead of filtering the list.
Both filters use the existing generation guard and paged history request, and search text remains a
single backend argument. The slice is verified against disposable Git fixtures and an Electron flow.
File-list filtering, path history, diff-content search, author/hash search, recent-query persistence, and
large-history search performance remain unverified and are deferred to the changed-file/diff and P08
investigation slices.

### F07 source refresh

Accessed **2026-09-17**. The official [Fork product page][home] advertises a Commit List and says that
history can find commits where a file or directory changed. It also explicitly advertises browsing the
repository file tree at any commit. The page lists Mac and Windows downloads only, so this is high-confidence
**D** evidence for the advertised outcomes on those platforms, not Linux support or a complete interaction
specification. The published [history screenshot][history-image] is **O** evidence for the lower Commit,
Changes, and File Tree detail views, including author/committer blocks, SHA, parent links, and message;
it does not establish current spacing, changed-file merge rules, or blob-preview behavior.

The official [git-diff-tree documentation][git-diff-tree] defines comparing a commit with its parents and
machine-readable raw path metadata; [git-ls-tree][git-ls-tree] defines listing entries in a committed tree;
and [git-cat-file][git-cat-file] defines reading an object's type, size, and contents. These are **D** Git
semantics used to keep the backend independent of Fork and are not observations of Fork.

This project’s first F07 slice is an **I** choice: committed changes use `diff-tree -m` so merge revisions
show the union of paths changed against their parents, retain rename/copy similarity, modes, object IDs,
and unusual path bytes, and deduplicate identical path pairs. Revision trees are requested one directory
at a time through validated repository IDs and relative paths. Blob previews are bounded at 1 MiB and
return explicit binary/too-large states; repository text remains inert text. Disposable Git tests compare
paths and tree entries with independent CLI reads, and the Electron flow verifies changed-file, tree, and
text-preview selection. Merge presentation, tree caching/virtualization, path persistence, detached and
multiple-root integration, and large-tree performance remain unverified. Fork’s exact current behavior,
platform differences, and Linux support remain **U**.

### F08 source refresh

Accessed **2026-09-17** using the existing linked [working-changes image][changes-image] and [Windows
1.23 article][rebase]. The screenshot is **O** evidence of separate staged and unstaged file areas in
Fork’s working-changes workspace; the Windows article is **D** evidence for the documented staging and
discard workflow around the same surface. These sources are historical Windows-oriented material and do
not establish Fork’s current layout, exact status classification, ignored-file defaults, tree/list state,
Linux support, or Mac/Windows parity. Those details remain **U**.

This project’s initial F08 slice is an **I** choice: a backend-owned `status --porcelain=v2 -z` read
returns bounded staged, unstaged, untracked, and ignored DTOs; a partially staged path appears in both
relevant sections; rename/copy similarity, conflict status, and mode metadata remain visible; and the
renderer offers per-repository tree/list presentation with persisted visibility toggles. Git status
semantics are verified independently on Fedora Linux with disposable repositories; Fork equivalence,
platform differences, actual merge-conflict presentation, and later conflict/commit behavior remain **U**;
F10 records the independent staging implementation below.

### F09 source refresh

Accessed **2026-09-17** using the official [Windows 1.38 article][diff], the official [Mac 1.0.79
article][manager], and the published [side-by-side screenshot][split-image]. The Windows article is
high-confidence **D** evidence, dated **2019-08-27**, for inline diff search and side-by-side viewing;
the Mac article is **D/O** evidence, dated **2019-06-12**, for diff-mode controls and hidden-character
display; and the product screenshot is **O** evidence of a two-pane line-numbered comparison. These
historical Mac/Windows sources do not establish current defaults, complete whitespace semantics, merge
diff presentation, Linux support, or behavior for binary and very large files.

This project’s initial F09 slice is an **I** choice: a named backend diff capability returns bounded raw
Git patches for a validated committed or working-tree target, with normal, `ignore-all-space`,
`ignore-space-change`, and `ignore-space-at-eol` comparison modes. The renderer owns presentation state and renders unified or split
rows, adjacent-line inline highlights, literal search navigation, and optional visible space/tab/CR
markers. Binary, oversized, and conflict targets return explicit non-text states. Disposable Git and
Electron tests verify the local workflow; F10 adds snapshot-validated hunk/line actions; syntax rendering,
image viewers, and exact current Fork parity remain **U**. Linux follows the independent implementation
because Fork publishes no Linux build.

### F10 source refresh

Accessed **2026-09-17** using the existing official [Fork product page][home] and published [working-changes
image][changes-image]. The product page is **D** evidence that file staging belongs to the Commit workflow;
the Windows-oriented screenshot is **O** evidence of pane-level Stage/Unstage controls and inline hunk
Stage/Discard controls. These sources do not document Fork’s exact line-selection patch model, stale-edit
handling, conflict policy, binary behavior, current defaults, or Linux support; those details remain **U**.

This project’s initial F10 slice is an **I** choice: whole-file stage/unstage, hunk and line stage/unstage,
and hunk/line discard use a named backend capability with a filesystem/index snapshot token. The backend
rebuilds selected patches from a fresh normal-whitespace diff, serializes repository mutations, and refuses
stale snapshots; the renderer exposes explicit added/removed-line selection. Disposable Git tests compare
the working tree and index after partial actions and cover CRLF, missing final newlines, rename/deletion,
symlink, binary, mode, and unborn-repository cases. The implementation is Linux-first and is not presented
as observed Fork behavior.

### F11 source refresh

Accessed **2026-09-17** from the official [Mac release notes][mac] and [Windows release notes][win], the
[Fork product page][home], and the published [working-changes image][changes-image], [Mac local-changes
image][mac-changes-image], and [commit message length image][length-image].

Documented (**D**; version, date, and platform as listed): Mac 1.0.9 (2016-06-10) "Show number of
changed files on the commit button"; Mac 1.0.12 (2016-07-08) "Added recent commit messages to the commit
view" and Windows 1.16 (2018-05-08) "Add recent messages list to commit message field"; Mac 1.0.20
(2016-09-02) "Show character counter for commit subject line in commit dialog" and Windows 1.18
(2018-06-28) "Add commit header length reminder"; Mac 1.0.89 (2020-01-24) "Ability to configure commit
subject limit"; Mac 1.0.22 (2016-09-16) and Windows 1.21 (2018-09-25) commit-message spell checking;
Mac 1.0.44 (2017-04-20) "Show changes from the latest commit in amend mode" and GitClient 1.0.1
(2017-04-17) "Implemented a possibility to amend the last commit"; Mac 1.0.64 (2018-02-22) "Support
commit templates" and Windows 1.26 (2019-01-15) "Take commit template into account"; Mac 1.0.69
(2018-08-01) "Show output of pre-commit hooks interactively" and "Automatically resize the commit message
area"; Mac 1.0.57 (2017-10-09) "Add 'Skip hook' option when pre-commit hook fails"; Windows 1.70
(2022-01-28) "Ability to create commit message draft using prepare-commit-msg hook"; Windows 1.54
(2020-09-18) fixed "Amend message disappears after switching between Changes/All Commits"; Mac 1.0.61
(2017-12-15) "--signoff" support; Mac 1.0.58 (2017-10-23) GPG signing; Mac 1.72 (2022-04-15)
"Co-authored" signature autocomplete; Windows 1.24 (2018-11-26) "Ability to commit and push" with
Mac 1.0.34 (2016-12-16) and Windows 1.43 (2020-01-13) options to push automatically after a commit.

Observed (**O**): the composer sits under the diff with a subject field, a description field, an Amend
check box, and a Commit button. The product image shows the button labelled "Commit 9 Files" and a
remaining-character count of 18 for a 32-character subject; the Windows 1.17 image shows "-38" in red for
an 88-character subject. Both are consistent with a 50-character guide counted down and shown negative
once exceeded. The newer Windows image (`win-2026-05-13-trackerwin2777-1`, stated 2.21-era) shows the
same composer with a split Commit button that carries a menu arrow, and a small icon at the right of the
subject field. The subject icon's exact menu is **U**; the recent-messages release notes are the only
public evidence of what such a list contains.

This project's initial F11 slice is an **I** choice: one bounded `repository:get-commit-context` read
returns the identity Git would use, the commit an amend would replace with its published state, a
`commit.template` with comment lines removed, pending merge/cherry-pick/revert/rebase state with Git's
own prepared message, recent messages from the loaded history, the executable commit hooks present, and a
compare-and-swap token over HEAD, the pending operation, and the staged entries. `repository:commit`
re-reads that context, refuses a stale token, and runs one `git commit --cleanup=whitespace --file=-`
with the message on standard input. Hooks run because committing is an explicit user action, their output
is returned as bounded inert text, and `--no-verify` is offered only as a separate, explicitly chosen
action after a hook failure. Expected refusals (empty message, nothing staged, unmerged files, missing
identity) are reported as structured results rather than exceptions. The renderer keeps subject and body
drafts per repository, counts down from 50 characters, labels the button "Commit N Files", and prefills
an amend from the previous message. Ticking Amend also shows what the amended commit would contain in the
Staged pane, by reading the index against HEAD's parent: the commit's own files are marked, files staged
since then appear beside them, and nothing is reset, so unticking restores the ordinary view. Fork's Mac
1.0.44 (2017-04-20) "Show changes from the latest commit in amend mode" documents the outcome; its exact
presentation, and whether Fork mutates anything, remain **U**. Signing, `--signoff`, co-author autocomplete, commit-and-push,
spell checking, a configurable subject limit, and Fork's exact recent-message definition are not
implemented; Fork equivalence remains **U**.

### F12 source refresh

Accessed **2026-09-19** from the official [Mac release notes][mac] and [Windows release notes][win], the
[Fork product page][home], and the local screenshot library described at the top of this document
(entries dated 2018-09-14 to 2026-03-24).

Documented (**D**; version and date as the release pages list them): Mac 1.0.10 (2016-06-18)
"Implemented possibility to add and remove tags" and "Added possibility to remove local and remote
branches"; Mac 1.0.11 (2016-07-01) "Implemented remote branch tracking"; Mac 1.0.38 (2017-02-13)
"Implemented ability to rename for local branches"; Mac 1.0.45 (2017-05-10) "Delete multiple branches or
tags support" with Windows 1.27 (2019-02-08) "Ability to delete multiple branches" and Windows 1.74
(2022-05-20) / Mac 2.18 (2022-05-12) "Remove multiple branches or tags at once"; Mac 1.0.55 (2017-09-05)
"Allow to checkout remote branches"; Mac 1.0.57 (2017-10-09) "Replace spaces with hypnens in new branch
dialog" [sic]; Mac 1.0.65 (2018-03-15) "Add ability to change tracking reference for local branch" with
Windows 1.21 (2018-09-25) "Add ability to change tracking reference for remote branches"; Windows 1.15
(2018-04-25) "Validate reference names in create branch/tag dialogs"; Windows 1.18 (2018-06-28) "Track
remote branch on double-click" and Mac 2.16 (2022-02-18) "Checkout branch on label double click in
graph"; Windows 1.20 (2018-08-13) "Add Create Branch toolbar button"; Windows 1.35 (2019-06-21) "Don't
propose to delete upstream if it doesn't exist"; Windows 1.43 (2020-01-13) "No context menu for active
branch" and "Show branches and tags in commit details"; Windows 1.44 (2020-01-31) "Show different branch
icons according to upstream status" with Mac 1.0.90 (2020-02-21) "Show branch upstream status on
sidebar"; Windows 1.47 (2020-03-27) "Add F2 keyboard shortcut to rename local branch"; Mac 2.10
(2021-07-23) "Autocomplete for branch folders in Create Branch dialog"; Windows 1.75 (2022-07-08) "Add
push option to create tag dialog"; Mac 2.29 (2023-05-12) "⌘B for quick checkout is back"; Mac 2.59
(2025-11-07) "Show worktree icon for branches checked out in other worktrees" with Windows 2.17
(2026-03-13) "Display worktree icon on branches checked out in other worktrees"; Mac 2.62 (2026-01-23)
and Windows 2.16 (2026-02-20) "Select Stale Local Branches" on the sidebar; Mac 2.63 (2026-02-13)
"Option to remove corresponding worktree when deleting a branch"; Mac 2.21/Windows 2.21 (2026-07-16)
"Checkout remote branch as worktree" and "Show warning icon for active branch with invalid upstream".

Observed (**O**) in the local reference library: the macOS local-branch menu
(`mac-2026-03-22-tracker2584-2`, stated 2.65.0) reads Checkout '<branch>' / Checkout '<branch>' as
Worktree… — Push… / Push and Create Pull Request… — Merge into '<current>'… / Rebase on '<branch>'… /
Interactively Rebase on '<branch>'… — New Branch… (⇧⌘B) / New Tag… (⇧⌘T) — Tracking ▸ / Rename
'<branch>'… / Delete '<branch>'… — Copy Branch Name. The same menu opened on a branch another worktree
has checked out (`mac-2026-03-22-tracker2584-1`) has no Checkout entry at all, and its Fast-Forward item
is disabled. The remote-branch menu (`mac-2025-08-14-tracker2421-2`) starts with Checkout
'<remote>/<branch>' and also offers New Branch…, New Tag…, and Delete '<remote>/<branch>'…. The commit
menu (`mac-2025-08-14-tracker2421-1`) offers New Branch… ⇧⌘B and New Tag… ⇧⌘T; the 2018 Mac blog image
(`blog-2018-09-14-fork-1.0.70-new-branch-menu`) shows the same menu with Create New Branch…, Create New
Tag…, and Checkout Commit…. The Windows toolbar Branch button
(`win-2025-07-22-trackerwin2545-1`) opens with New Branch… on Ctrl+Shift+B. The macOS Branches section
menu (`mac-2026-01-26-tracker2534-1`) lists New Branch…, Select Stale Local Branches, and Sort Branches.
The Create Tag dialog (`win-2026-03-24-trackerwin2745-1`, `mac-2026-02-19-tracker2556-1` stated 2.62.1,
`mac-2026-04-17-tracker2604-4` stated 2.66.6) has a large mark, the title "Create Tag" with the line
"Create annotated tag at the selected point", a "Create tag at:" row naming the short hash and subject, a
"Tag Name:" field, an optional "Message:" area, a Push check box, a bottom-left warning ("Tag 'v0.2.7-ios'
already exists") and Create and Push / Cancel buttons, ordered affirmative-first on Windows and
affirmative-last on macOS.

Unresolved (**U**): the Create Branch dialog itself is not in any public image examined, so its fields,
defaults, and checkout behavior are inference here. Fork's exact deletion warnings, its upstream picker,
its branch icons per upstream state, and the current wording of every menu entry were not verified.

This project's initial F12 slice is an **I** choice: one bounded `repository:get-reference-context` read
returns the local branches with their upstream, stale-upstream flag, linked-worktree checkout, and
merged state, the tags with their peeled target and whether they are annotated, the remote names and
remote-tracking branch names, the working-tree and pending-operation state, and a compare-and-swap token
over HEAD, the local branches, and the tags. `repository:apply-reference-action` takes one named action —
create/rename/delete a branch, set or unset an upstream, check out a branch, a remote branch, or a
commit, and create or delete a tag — re-reads that context inside the per-repository mutation queue,
refuses a stale token, and runs exactly one Git invocation with backend-built arguments. A start point is
either a commit this window already saw or a reference the same read reported, so revision syntax never
reaches Git. Names are bounded in the shared schema and then validated by Git's own `check-ref-format`.
Refusals Fork's UI implies — a name in use, an unmerged branch, a branch another worktree has checked
out, the current branch, local changes a checkout would overwrite, a running sequencer — come back as
structured results with the exact obstacle, and only an unmerged deletion offers an explicit force.
Fork's multiple-branch selection and deletion, branch folders and moving, pinning, sorting, hiding,
"Select Stale Local Branches", checkout as a worktree, remote-branch deletion, pushing a tag from the
create dialog, F2 and ⌘B shortcuts, branch-folder autocomplete, and the space-to-hyphen replacement are
not implemented. This project keeps Ctrl/⌘+Shift+T for reopening a closed tab, so New Tag has no
shortcut; New Branch uses Ctrl/⌘+Shift+B as both platforms document.

### F13 source refresh

Accessed **2026-09-19** from the official [Mac release notes][mac] and [Windows release notes][win], the
[Fork product page][home], the [Windows 1.48 operations post][operations], and the local screenshot
library (entries dated 2020-05-05 to 2026-08-04).

Documented (**D**; version and date as the release pages list them): Mac 1.0.12 (2016-07-08) "Added
remote repository management (add/edit/rename/delete)" and "Implemented clone"; Mac 1.0.11 (2016-07-01)
"Implemented remote branch tracking"; Mac 1.0.27 (2016-10-21) "Show progress and status for clone, fetch,
pull and push operations"; Mac 1.0.31 (2016-11-25) "Display how many commits behind or ahead are" with
Mac 1.0.90 (2020-02-21) "Show branch upstream status on sidebar" and Windows 1.44 (2020-01-31) "Show
different branch icons according to upstream status"; Mac 1.0.33 (2016-12-09) "Add possibility to prune
branches during fetch"; Mac 1.0.34 (2016-12-16) "Pull using rebase instead of merge"; Mac 1.0.62
(2018-01-15) "git fetch --all"; Mac 1.0.72 (2018-12-01) and Windows 1.22 (2018-10-26) "Ability to pull a
branch without checking out it (fast-forward pull)"; Windows 1.16 (2018-05-08) "Automatically fetch
remotes"; Windows 1.25 (2018-12-14) "Allow to push a branch to a remote branch with different name" and
"Ability to push a single tag"; Windows 1.41 (2019-10-25) "Ability to push multiple branches at once";
Windows 1.55 (2020-10-30) "Global option to always fetch tags"; Mac 2.1 (2020-12-04) "Ability to edit
remote branch name on push"; Mac 2.20 (2022-07-15) and Windows 1.74 (2022-05-20) "Allow to fast-forward
multiple branches". The [Windows 1.48 post][operations] documents Git output with progress and
cancellation for network work.

Observed (**O**) in the local reference library: the Fetch dialog
(`win-2026-08-04-trackerwin2827-2`, stated 2.21.0.0) has a large mark, the title "Fetch" with the line
"Fetch latest changes from remote repository", a "Remote:" drop-down, a "Fetch all remotes" check box,
and Fetch / Cancel. The remote context menu (`win-2025-09-26-trackerwin2615-1`) reads Fetch 'origin'…
(Ctrl+Shift+F) — Edit 'origin'… — Delete 'origin'… — a checked "Fetch 'origin' Automatically". The
activity window (`win-2025-11-26-trackerwin2659-1`) has All / User / Background tabs, a list whose rows
carry a title such as "Pull 'origin/Slot1181'", a status line ("Everything is up to date"), a time, and a
spinner with a cancel cross while one runs; the detail pane repeats the title, says "succeeded" with a
timestamp, and shows the command (`$ git pull --rebase=false origin --prune`) above its output. The
2020 push post (`blog-2020-05-05-forkwin-1.48-push-multiple-branches`) shows a sidebar selection of three
branches with "Push 3 branches to 'origin'…". A macOS sidebar (`mac-2026-04-23-tracker2610-1`, stated
2.66.6) shows a branch row with `7↓27↑` beside its name.

Correction from the workflow audit below: a complete Windows Pull dialog was already in the reference
library, and a complete historical Windows Push dialog has now been added. Their visible fields are
**O**, not unresolved. Current defaults, force-push confirmation semantics, credential prompts,
background-fetch scheduling, and activity tab definitions remain **U**.

This project's initial F13 slice is an **I** choice. Long-running Git work is owned by a main-process
operation registry: `repository:start-network-operation` validates one named request, accepts it, and
returns a running record immediately, so the preload deadline never decides the outcome of a fetch or a
push. Progress, output, and completion arrive on `repository:operation-changed`, addressed to the window
that started the work; `repository:list-operations` and `repository:cancel-operation` complete the
surface, and a record stays queryable after every listener has gone. One network operation runs per
repository at a time, which is also how duplicate work is refused. Cancellation aborts the process group,
so the transport helper and ssh stop with it, and the result says the outcome is unknown rather than
retrying a write. Fetch, fast-forward-only pull, push, and deleting a branch on a remote each become
exactly one Git invocation with backend-built arguments: a push refspec can only name a local branch, and
`--force-with-lease` is only ever added by an explicit confirmation. Failures are classified into
authentication, network, rejected, lease, no-upstream, not-fast-forward, local-changes, not-found,
cancelled, and timeout, each with one actionable sentence, and an ordinary push that is rejected never
falls back to a force. Git's carriage-return progress becomes percentage updates, and only completed
phases are kept in the log; every line is stripped of terminal escapes and of credentials embedded in a
URL. Remote management adds, renames, retargets, and removes remotes with Git's own `check-ref-format`
validation, and declines an `ext::` URL, which would make Git run a local command, because repository
trust is a later phase. Merge and rebase pulls, interactive credential and
passphrase prompts, platform secret storage, clone, pushing a single tag, pushing to a differently named
remote branch, and fast-forwarding several branches at once are not implemented.

### F14 source refresh

Accessed **2026-09-19** from the official [Fork 1.0.67 article][activity], the official [Fork for
Windows 1.48 article][operations], and the local activity screenshots listed in
fork-references.json. The Mac article is **D**, dated **2018-05-28**, and says that Fork automatically
fetches all remotes in open tabs every 20 minutes, with per-remote contextual-menu and global preference
controls. It also documents cancellation of fetch, pull, push, and clone, and an activity manager that
keeps past/current activities with their results. The Windows article is **D**, dated **2020-05-05**,
and documents cancellation plus Git command output in the activity manager. These sources establish
advertised Mac and Windows outcomes, not Linux support, credential-prompt behavior, current defaults, or
the internal scheduling policy.

The current local reference library provides **O** evidence for an activity surface with All, User, and
Background tabs, operation rows, cancellation affordances, command text, output, and terminal status.
The Windows screenshot shows a Pull and Fetch row; the newer macOS screenshot shows command output from
a commit. Neither screenshot proves the scheduler's timing or the meaning of every tab.

This project's F14 slice is an **I** choice: automatic fetching is enabled by default for configured
remotes in open tabs, uses a 20-minute main-process timer, allows a durable per-remote opt-out from the
remote context menu, rotates several remotes through one repository slot, and applies a repository-global
acceptance guard across windows. Operations carry a validated user/background source, remain queryable
after listener removal, stream bounded redacted progress/output, and can be cancelled through the same
process-group policy as explicit network work. Disposable Git tests cover opt-out/re-enable scheduling,
preference recovery and rename, duplicate prevention, and independent remote-ref assertions; the
Electron flow covers the activity scope controls. The global automatic-fetch preference documented by
the Mac article, credential/passphrase prompts, clone cancellation, and cross-platform runtime behavior
remain **U** or deferred to P05.

### F15 source refresh

Accessed **2026-09-19** from the official [Fork for Windows 1.48 article][operations], the official
[Windows release notes][win], the official [Mac release notes][mac], and the official [Fork 1.0.70
article][patches]. The Windows article is high-confidence **D**, dated **2020-05-05**, for a partial
stash command in the file context menu that saves individual changed files instead of the whole working
directory. This is Windows evidence; it does not establish the Mac UI, hunk-level selection, staged-state
rules, or Linux support. The Windows 1.49 notes document saving a stash as a patch, and the current
Windows 2.21 and Mac 2.69 notes document a Save as Patch command in the stash context menu. These are
**D** outcomes on the listed platforms, with no public evidence that the current defaults or dialog
wording are identical across Mac and Windows. The 2018 Mac article documents saving commits as patches;
the 2018 Fork 1.0.70 article documents saving selected working-directory files as a patch.

This project's verified F15 slice is an **I** implementation: reflog stashes are enumerated by stable
commit ID and included as independently labelled history entries; a named stash operation can save all
supported changes or selected whole-file paths, optionally including untracked files; inspect, apply,
pop, and delete re-read the current stash list, preserve staged state with `--index`, keep a failed pop
in Git, and protect Recovery copies from normal deletion. Commit, stash, and selected working-tree
patch export use a bounded main-process save dialog and backend-built Git arguments. Snapshot checks
prevent a stale selected-file stash or working patch from using changed data. Hunk/line-level stash
selection, patch import/apply, multi-commit patch bundles, and exact Fork dialog defaults remain outside
this slice and are deferred to the later P08 patch work. Linux follows the independently authored
Windows-oriented layout because Fork publishes no Linux build.

### F01–F13 workflow audit and reference correction

Accessed and visually inspected **2026-09-19**. The [audit report](../reviews/f01-f13-review.md)
records application defects, missing workflows, reproduction evidence, and proposed acceptance criteria.
The original review changed no implementation status. Its subsequently verified remediation is recorded
below; F01–F13 remain partial feature families.

- **O, high confidence for the captured Windows UI:** the existing
  `win-2025-11-25-trackerwin2658-1-dialogs-dark.png` from
  [TrackerWin issue 2658](https://github.com/fork-dev/TrackerWin/issues/2658), posted **2025-11-25**,
  shows the entire Pull dialog. It contains Remote and Branch selectors, a non-editable Into branch,
  rebase and stash/reapply checkboxes, and Pull/Cancel actions. The earlier claim that these fields
  could not be established was incorrect. The version is unstated; neither current defaults nor
  macOS behavior follow from this image.
- **O, high confidence for the visible controls; historical Windows evidence:** newly indexed
  `win-2023-04-29-qiita-checkout-dark.png` from
  [segur's public hands-on article](https://qiita.com/segur/items/8ce6914af5578c5f4ce2), published
  **2023-04-29**, updated **2023-05-14**, shows the target branch, three local-change radio choices
  (stash/reapply, preserve changes, discard), and Checkout/Cancel. It corroborates the user's
  2026-09-19 report. Windows is identified from the captured chrome; the Fork version and image
  capture date are unstated. The selected choice is an observed state, not proof of a default.
  The article's explanations are not used to define Git semantics or recovery guarantees.
- **O, historical Windows evidence:** `win-2023-04-29-qiita-push-dark.png`, from the same article,
  shows separate source-branch and destination selectors, with a remote/branch pair in the latter.
  It also shows tag and force options. It does not establish whether the force option uses a lease.
- **D, high-confidence historical Windows workflow:** the official
  [Windows 1.23 article](https://fork.dev/blog/posts/forkwin-1.23/), published **2018-11-10**, describes
  updating an inactive branch from its remote without checking it out. Its already indexed image
  `blog-2018-11-10-forkwin-1.23-fast-forward-pull.png` is a branch menu, previously categorized only
  as a dialog. It is now indexed under branch menus, fast-forward, and pull. This is a separate
  workflow from running `git pull --ff-only` on the current branch.
- **O, Windows:** the existing cropped menu
  `win-2026-03-24-trackerwin2746-4-menus-dark.png` from
  [TrackerWin issue 2746](https://github.com/fork-dev/TrackerWin/issues/2746), posted **2026-03-24**,
  stated **2.18.0.0**, shows upstream fast-forward, push, and pull-request creation entries above
  merge/rebase. Its crop does not establish the complete menu or checkout availability. The full
  current menu supplied by the user remains user-reported evidence, not an independently observed
  current Fork session.
- **D, historical Windows workflow:** the official
  [Windows 1.48 article](https://fork.dev/blog/posts/forkwin-1.48/), published **2020-05-05**, places
  pull-request creation in the branch context menu. The plan groups hosting integration in P11;
  the audit recommends separating an earlier browser handoff from later account/list/notification
  integration. That scope split is our **I** recommendation, not a claim about Fork's implementation.

Linux continues to follow the Windows visual target. These captures do not establish current macOS
equivalence, defaults, clean-versus-dirty checkout triggering, untracked-file discard scope, preservation
of staged state during stash/reapply, or conflict recovery. Those need explicit product rules and Git
fixture tests. Collecting an image is not acceptance of a workflow: each relevant control must be mapped
to a contract, implementation, failure/recovery path, and test before coverage is described as complete.

### Stabilization implementation verification

Verified **2026-09-19** on Fedora Linux with Git **2.55.0** and Node **24.13.0**. These are **I** product
decisions and independently tested Git behavior, not observations of Fork internals. The preceding
initial-slice limitations are historical where superseded by this record.

- F12 now includes checkout local-change radio choices and full-reference tracking/creation. Preserve
  uses Git's ordinary refusal/carry behavior. Stash/reapply restores index state; Discard previews tracked
  and untracked paths and keeps a recovery copy. Linux follows Windows affirmative-button order.
- F13 now has a Pull dialog with explicit source/destination, merge/rebase and stash/reapply options;
  separate inactive-branch fast-forward; and visible editable Push destinations derived from exact
  upstream configuration. Pull to an inactive branch states that it will check it out first. Fast-Forward
  leaves the active worktree alone. Other-worktree checkouts and stale snapshots are refused.
- The F15/F16 subset keeps saved changes in named stashes and pinned recovery refs, persists a per-worktree
  journal, and offers apply, resolution acknowledgement, and merge/rebase continue/abort after restart.
  This is not general stash management or the full three-way conflict editor.
- The F29 subset opens a validated GitHub.com, GitLab.com, Bitbucket.org, or Azure DevOps PR form in the
  system browser. Accounts, PR submission, listing, and notifications remain outside this slice.
- R1–R12 and late-result ownership risks are addressed. `npm run check` passes **239 tests** plus type,
  lint, and format checks. Production build and **three headless Electron scenarios** pass. The test
  browser handoff is intercepted; live hosting forms and authentication were not exercised.

UI captures were compared with the restored local checkout, Pull, Push, branch-menu, and activity
references. All 226 public images remain ignored and unbundled. Screenshot evidence establishes the
visible controls, not exact current palettes/defaults or cross-platform equivalence. The performance
improvements and remaining verification limits are detailed in the [remediation record](../reviews/f01-f13-review.md#remediation-verified--2026-09-19).

### F34 workspace chrome, graph drawing, and context-menu refresh

Accessed **2026-09-16**, prompted by a request to bring the layout, graph drawing, context menus, and
title bar closer to Fork. Only the public images and release-note pages linked below were used; images
were viewed in a temporary working directory (they are now part of the local reference library described
at the top of this document). Frames of the public blog GIFs were inspected individually.

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

Unresolved (**U**): the full current commit, branch, and tab context-menu contents; whether lanes
still move sideways; the rules behind “Compact branch labels” (Windows 1.55, Mac 2.19); and exact
current palettes and spacing. Linux has no Fork release to compare with, so Linux chrome follows the
Windows layout. The 2026-09-17 refresh below resolves the graph-marker refresh, tab indicators, and
Mac vertical-tab placement from newer public screenshots.

### Design reference refresh (2026-09-17)

Accessed **2026-09-17**, prompted by a request to realign the design after the F05–F08 slices. The
official images above date from 2018–2020, so current visuals come from user screenshots attached to
Fork’s public issue trackers ([Mac][tracker-mac], [Windows][tracker-win]) between 2025-03 and 2026-09,
plus the images already cited. File-name prefixes below identify images in the local reference library;
each entry in [`fork-references.json`](fork-references.json) links its issue. Reporter annotations and
redactions are not Fork UI, and a mockup attached to Mac issue 2707 was excluded. Versions are cited only
where the reporter stated them.

Observed (**O**):

- Windows chrome, 2025-08 to 2026-08 (`win-2025-08-01-trackerwin2560-2`,
  `win-2026-05-13-trackerwin2777-1`, and `win-2026-08-13-trackerwin2830-1`, which states 2.21): the title
  row has menus, a centered title, and feedback (and, in `win-2026-05-23-trackerwin2789-1`, notification)
  icons beside the window buttons. The compact toolbar reads Quick Launch, Fetch, Pull, Push, Stash ▾,
  the repository panel (name and branch, without `*`), Branch ▾, then Open in ▾, Console, Appearance ▾,
  and Work ▾. Equal-width tabs are low and mark uncommitted changes with a dot at their left edge
  (`win-2025-06-08-trackerwin2514-1`); Windows preferences name a “Tab indicator for uncommitted changes”
  (`win-2025-12-17-trackerwin2670-2`). Mac 2.x pill tabs show the dot at the right
  (`mac-2026-04-13-tracker2598-1`).
- Mac 2.70-era window (`mac-2026-09-10-tracker2707-1`, issue posted six days after the 2.70 release):
  a left column lists workspace repositories while the horizontal pill tabs remain; the detail views
  use a segmented Commit/Changes/File Tree control.
- Graph (Windows 2.17–2.22, Mac 2026: `win-2026-03-24-trackerwin2747-1`,
  `win-2026-09-10-trackerwin2847-1`, `mac-2026-09-10-tracker2707-1`): ordinary commits are small filled
  dots; merge commits are rings holding a chevron, pointing down while expanded and right while
  collapsed. This matches the Windows 2.16 (2026-02-20) release note “Refreshed visual style - chevron
  icons, updated graph lines, new toolbar icons” (**D**). Right-clicking the graph at a merge showed a
  menu with Collapse, Expand All, and Collapse All (`win-2025-07-23-trackerwin2548-1`).
- Labels (`win-2026-04-16-trackerwin2763-1`, `win-2025-11-03-trackerwin2642-1`): a branch label is a
  lane-tinted box; a hosting/remote icon sits in its own adjacent box; tags use one lavender box with an
  icon segment. Subjects with a message body end in a return-arrow indicator
  (`mac-2026-07-02-tracker2658-1`, `mac-2026-07-16-tracker2668-1`).
- Commit menu (`win-2025-10-12-trackerwin2628-3`, `mac-2025-08-14-tracker2421-1`): New Branch…,
  New Tag…, Interactive Rebase ▸, Reset '<branch>' to Here…; later entries are not shown.
- Search (`win-2026-04-16-trackerwin2763-1`): the sidebar magnifier replaces the reference tree with
  Search Commits, a query field, a “Commit Message ▾” scope, a result count, and result rows with avatar,
  subject, and date. A reference-filtered commit list shows “Filtered by: '…' Clear filter” above it.
- Commit details on Windows use underlined tabs (`win-2025-08-27-trackerwin2584-1`,
  `win-2025-08-01-trackerwin2560-2`). The Commit tab lists changed files under the message. The Changes
  tab starts with a one-line summary (avatar, author, short SHA, date, subject), then a file pane with a
  search strip and a folder tree or Name/Location list with colored status badges, beside the diff
  (`site-imagediffwin`, `win-2026-03-24-trackerwin2747-1`). The File Tree tab pairs a folder tree
  (folders first) with a line-numbered preview (`mac-2026-09-10-tracker2707-1`,
  `win-2025-10-07-trackerwin2626-1`).
- Local changes (`win-2026-05-13-trackerwin2777-1`, `win-2026-03-23-trackerwin2743-1`,
  `win-2025-10-30-trackerwin2641-1`, `mac-2025-09-23-tracker2464-1`, `site-commitviewwin1`): an Unstaged
  pane with Stage sits above a Staged pane with Unstage; untracked files appear in Unstaged with an added
  badge. A strip above them holds search, an eye toggle, and an options menu with View as Tree, View as
  List, View as Combined List, Hide Untracked Files, and Show Ignored Files
  (`mac-2026-04-25-tracker2616-1`). The diff fills the right side above a commit composer with subject,
  description, Amend, and Commit.

Implemented from these observations (**I**, independently drawn): commit dots and chevron merge rings;
separate remote-marker label boxes and fixed-color tag labels; the message-body indicator; a compact
toolbar with Branch ▾ and a Console button (both disabled with their phases); dot tab indicators; a
sidebar Search Commits panel whose results select commits in the unfiltered list, loading at most 40
further history pages to reveal one; a “Filtered by … Clear filter” strip; a graph menu on right-clicks
inside the graph column, with the same commands appended to the commit menu so they stay reachable from
the keyboard; the Commit tab file list; Changes and File Tree split panes with a lazily loaded folder
tree; and the Local Changes Unstaged/Staged layout with its options menu. Views that depend on later
phases keep Fork’s positions but explain themselves: the diff area shows the independently implemented
bounded local diff; Stage and Unstage plus hunk/line actions are enabled by F10, and F11 enables the
commit composer with its subject counter, recent messages, Amend, and "Commit N Files" button. The F11
slice also removed the F08 placeholder metadata list above the diff, which Fork does not show: the file
header now carries only the status badge, the path, and any rename or mode detail. The active detail tab
persists
while other commits are selected. View as Combined List, the eye toggle, and search scopes other than
commit messages are not implemented.

Unresolved (**U**): whether choosing a Fork search result filters or only scrolls the commit list; the
complete search scope list; the eye toggle’s meaning; whether colored tab dots are tab colors or change
indicators; current dark and light palettes; and all Linux behavior.

## Feature coverage

Phase IDs refer to [the implementation plan](../implementation-plan.md).
The [2026-09-19 remediation](../reviews/f01-f13-review.md#remediation-verified--2026-09-19) verifies F12
checkout local-change choices, F13 selected-source pull, inactive-branch fast-forward, visible push
destinations, and the early F29 PR browser handoff. The F15/F16 recovery subset supports these workflows;
the full feature families below remain partial. Reference evidence alone is not implementation evidence.

| ID  | Public capability                                                                                           | Evidence                                                                                                                                                                                                                                           | Planned phase |
| --- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| F01 | Initialize, clone, add existing repositories, recent repositories                                           | D: [product][home]                                                                                                                                                                                                                                 | P02, P05      |
| F02 | Repository manager, folder hierarchy, source-directory scanning                                             | D: [Mac 1.0.79][manager], [Mac releases][mac], [Windows releases][win]                                                                                                                                                                             | P02, P12      |
| F03 | Multiple repository tabs and dirty indicators; vertical tabs and reopen-closed shortcuts                    | D: [manager][manager], [Mac releases][mac], [Windows releases][win]                                                                                                                                                                                | P02, P12      |
| F04 | Commit graph, reference labels, authors, hashes, dates, selection                                           | O: [history screenshot][history-image]; I: initial local history/graph/selection slice verified against disposable Git fixtures                                                                                                                    | P03           |
| F05 | Collapse/expand merge branches in the graph                                                                 | D: [graph article][graph]; I: loaded-history projection, merge-tip controls, keyboard/context-menu flow (partial)                                                                                                                                  | P03           |
| F06 | Branch/file filters, commit search, path/diff-content search                                                | D: [Windows 1.38][diff], [Mac releases][mac]; O: [tracker][tracker-win]; I: reference filter, sidebar message search (partial)                                                                                                                     | P03, P08      |
| F07 | Commit metadata, parents, changed files, tree at a revision                                                 | D/O: [product][home], [history screenshot][history-image]; I: validated local revision inspection slice (partial)                                                                                                                                  | P03           |
| F08 | Staged/unstaged lists; tree/list mode; untracked/ignored visibility                                         | O/D: [changes screenshot][changes-image], [Windows 1.23][rebase]; I: bounded local status listing (partial)                                                                                                                                        | P04           |
| F09 | Unified/split diffs, inline changes/search, whitespace display                                              | D/O: [Windows 1.38][diff], [Mac 1.0.79][manager], [split screenshot][split-image]; I: bounded text-diff viewer (partial)                                                                                                                           | P04           |
| F10 | File, hunk, and line staging/unstaging; hunk discard controls                                               | D/O: [product][home], [changes screenshot][changes-image]; I: snapshot-validated local staging slice (partial)                                                                                                                                     | P04           |
| F11 | Commit, amend, recent messages, templates, hooks                                                            | D: [Mac releases][mac], [Windows releases][win]; O: [changes screenshot][changes-image], [length image][length-image]; I: snapshot-validated commit/amend slice (partial)                                                                          | P04           |
| F12 | Branch/tag creation and deletion; checkout a branch or revision                                             | D: [product][home], [Mac releases][mac], [Windows releases][win]; O: [branch menu][tracker-mac], [Create Tag dialog][tracker-win]; I: snapshot-validated branch/tag slice (partial)                                                                | P05           |
| F13 | Remotes; fetch/pull/push; upstream indicators; multiple-branch push                                         | D: [product][home], [Windows 1.48][operations], [Mac releases][mac], [Windows releases][win]; O: [Fetch dialog][tracker-win], [activity window][tracker-win]; I: operation registry with fetch/pull/push (partial)                                 | P05, P06      |
| F14 | Background fetch; cancellable network work; activity and command output                                     | D: [Mac 1.0.67][activity], [Windows 1.48][operations]; O: [activity window][tracker-win]; I: 20-minute scheduler, opt-out, deduplication, progress/cancellation, and All/User/Background views (partial)                                           | P01, P05      |
| F15 | Stashes in history, partial stashes, patch export                                                           | D: [product][home], [Windows 1.48][operations], [Windows releases][win], [Mac 2.69][mac], [patch export][patches]; I: stable stash history, selected-file stash, inspect/apply/pop/delete, and bounded commit/stash/working patch export (partial) | P06, P08      |
| F16 | Merge/rebase; drag branches to initiate either operation                                                    | D: [product][home], [Windows 1.48][operations]                                                                                                                                                                                                     | P06, P07      |
| F17 | Built-in conflict helper and editable merge result                                                          | D: [product][home], [Mac 1.0.73][merge]                                                                                                                                                                                                            | P06           |
| F18 | Visual interactive rebase: ordering, pick/edit/reword/squash/fixup/drop                                     | D: [Windows 1.23][rebase]                                                                                                                                                                                                                          | P07           |
| F19 | Cherry-pick and revert                                                                                      | D: [product][home]                                                                                                                                                                                                                                 | P06           |
| F20 | Reflog/lost-commit recovery                                                                                 | D: [product][home]                                                                                                                                                                                                                                 | P08           |
| F21 | File/directory history, blame; selected-code history                                                        | D: [product][home], [Windows releases][win]                                                                                                                                                                                                        | P08           |
| F22 | Worktree creation/removal; remote-branch checkout into worktrees                                            | D: [Mac releases][mac], [Windows releases][win]                                                                                                                                                                                                    | P09           |
| F23 | Submodules and informative submodule revision comparisons                                                   | D: [product][home], [Mac 1.0.73][merge]                                                                                                                                                                                                            | P09           |
| F24 | Git LFS, image preview/download, server locks                                                               | D: [product][home], [Mac 1.0.79][manager], [Windows 1.48][operations]                                                                                                                                                                              | P10           |
| F25 | Git-flow workflows                                                                                          | D: [product][home]                                                                                                                                                                                                                                 | P09           |
| F26 | Bisect with visible progress; good/bad/skip actions                                                         | D: [Windows 1.48][operations], [Windows releases][win]                                                                                                                                                                                             | P08           |
| F27 | Image comparison: side-by-side, swipe, onion skin; pixel differences                                        | D: [Windows 1.38][diff], [Mac releases][mac]                                                                                                                                                                                                       | P10           |
| F28 | GPG support, including signed tags                                                                          | D: [product][home], [Mac releases][mac]                                                                                                                                                                                                            | P10           |
| F29 | Hosted repository accounts; GitHub, GitLab, Bitbucket, Azure PR entry points; Gitea references              | D: [Windows 1.48][operations], [Windows releases][win]                                                                                                                                                                                             | P11           |
| F30 | GitHub notifications; pull-request/issue lists and filters                                                  | D: [product][home], [Windows releases][win]                                                                                                                                                                                                        | P11           |
| F31 | Quick Launch: fuzzy command/branch/file lookup; user commands                                               | D: [Quick Launch][quick]                                                                                                                                                                                                                           | P12           |
| F32 | Contextual custom commands; shared definitions and configurable input controls                              | D: [Mac 1.0.67][activity], [Windows releases][win]                                                                                                                                                                                                 | P12           |
| F33 | External editors, diff/merge tools, terminal/file-manager actions, CLI repository opening                   | D: [Mac 1.0.67][activity], [Windows 1.23][rebase], [Windows releases][win]                                                                                                                                                                         | P02, P12      |
| F34 | Theme/appearance, keyboard navigation, split panes, issue links, avatars; title-bar menus and context menus | D/O: [Windows 1.38][diff], [history screenshot][history-image], [Mac releases][mac], [Windows releases][win], [bisect GIF][bisect-gif]                                                                                                             | P03–P04, P12  |
| F35 | Repository summaries/statistics and activity treemap                                                        | D: [product][home], [Windows releases][win]                                                                                                                                                                                                        | P13           |
| F36 | Save/apply patches, including clipboard entry points                                                        | D: [Mac 1.0.67][activity], [Mac releases][mac]                                                                                                                                                                                                     | P08           |
| F37 | External AI tools for commit messages and branch/range review                                               | D: [Mac releases][mac], [Windows releases][win]                                                                                                                                                                                                    | P13           |

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
┌────────────────────────────────────────────────────────────────────────────┐
│ File View Repository Window Help            Title                ─  □  ✕   │
├────────────────────────────────────────────────────────────────────────────┤
│ Quick Launch Fetch Pull Push Stash▾ [≡ repo / branch ↑↓] Branch▾           │
│                                         Open in▾ Console Appearance▾       │
├────────────────────────────────────────────────────────────────────────────┤
│ ● repository tab │ repository tab │ Repository Manager │                 + │
├───────────────┬────────────────────────────────────────────────────────────┤
│ repo       ⚙  │ Filtered by: 'branch'  Clear filter   (only when filtered) │
│ Local Changes │ graph + labels + subject ↩ │ author │ SHA │ date           │
│ All Commits   ├────────────────────────────────────────────────────────────┤
│ ⑂  ⌕          │ Commit │ Changes │ File Tree                               │
│ Filter        │ Commit: people, refs, SHA, parents, message, files         │
│ ▾ Branches    │ Changes, File Tree: summary row, file list │ preview       │
│ ▾ Remotes     │                                                            │
│ ▸ Tags        │ Local Changes swaps the right side for                     │
│   Stashes     │ Unstaged/Stage, Staged/Unstage │ diff + commit composer    │
│   Submodules  │                                                            │
└───────────────┴────────────────────────────────────────────────────────────┘
```

The sidebar magnifier (⌕) swaps the filter and reference tree for the Search Commits panel.
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
[patches]: https://fork.dev/blog/posts/fork-1.0.70/
[rev-parse]: https://git-scm.com/docs/git-rev-parse
[git-log]: https://git-scm.com/docs/git-log
[for-each-ref]: https://git-scm.com/docs/git-for-each-ref
[git-diff-tree]: https://git-scm.com/docs/git-diff-tree
[git-ls-tree]: https://git-scm.com/docs/git-ls-tree
[git-cat-file]: https://git-scm.com/docs/git-cat-file
[init]: https://git-scm.com/docs/git-init
[diff]: https://fork.dev/blog/posts/forkwin-1.38/
[rebase]: https://fork.dev/blog/posts/forkwin-1.23/
[merge]: https://fork.dev/blog/posts/fork-1.0.73/
[manager]: https://fork.dev/blog/posts/fork-1.0.79/
[activity]: https://fork.dev/blog/posts/fork-1.0.67/
[history-image]: https://fork.dev/images/carousel/carousel_mainWin.jpg
[changes-image]: https://fork.dev/images/carousel/carousel_commitviewWin1.jpg
[split-image]: https://fork.dev/images/carousel/carousel_commitviewWin2.jpg
[mac-changes-image]: https://fork.dev/images/carousel/carousel_commitviewMac1.jpg
[length-image]: https://fork.dev/blog/posts/forkwin-1.17/commit-message-length.png
[manager-image]: https://fork.dev/images/carousel/carousel_repomanagerWin1.jpg
[mac-history-image]: https://fork.dev/images/carousel/carousel_mainMac.jpg
[graph-image]: https://fork.dev/blog/posts/collapsible-graph/swift-show-all.png
[labels-image]: https://fork.dev/blog/posts/forkwin-1.38/colored-branch-labels.jpg
[sidebar-filter-image]: https://fork.dev/blog/posts/forkwin-1.38/sidebar-filter.jpg
[branch-status-image]: https://fork.dev/blog/posts/forkwin-1.48/branch-status.jpg
[tracker-mac]: https://github.com/fork-dev/Tracker/issues
[tracker-win]: https://github.com/fork-dev/TrackerWin/issues
[bisect-gif]: https://fork.dev/blog/posts/forkwin-1.48/bisect.gif
[stash-gif]: https://fork.dev/blog/posts/forkwin-1.48/partial-stash.gif
[dnd-gif]: https://fork.dev/blog/posts/forkwin-1.48/drag-and-drop-merge.gif
