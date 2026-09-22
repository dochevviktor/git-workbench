# Branch and stash refresh fixes — 2026-09-22

Follow-up to the three baseline Electron failures recorded during F36. Runtime diagnostics reproduced
the disabled PR menu, missing rebase action and empty Stashes section. Git mutations had completed;
the failures were in renderer refresh/interaction timing and the tests' readiness assumptions.

`useReferences` previously cleared context and reset busy state on every refresh. Context menus capture
their entries when opened, so a menu opened during that gap could retain disabled commands or omit
Merge/Rebase even after the read finished. Same-repository refresh now retains the last complete
snapshot; repository switches still clear it. Operation completion uses a separate repository generation
so refreshing reads neither releases busy state early nor prevents completion from clearing it.
Backend snapshot checks and mutation serialization remain authoritative.

An empty sidebar section was not expandable, so clicking Stashes before the saved stash arrived did
nothing. Empty section selection now records expansion intent. Explicit expansion state is idempotent
relative to each section's default; when references arrive, the requested expansion is honored.
This is an independent usability correction, not an additional claim about captured Fork behavior.
There are no layout, asset, Git-command or IPC changes.

The review scenarios now check that the PR command is enabled, wait for the refreshed current branch
and matching Rebase action after an external checkout, and explicitly test clicking empty Stashes
before saving a file. Existing Git assertions remain: the unselected file stays changed, the stash
contains the selected change, rebase yields the expected history, and browser handoff uses the selected
upstream. No sleep or timeout increase was introduced.

All five focused review workflows pass, including the 16-second checkout-hook/repository-switch test.
`npm run check` passes 438 tests with one existing skip, along with typechecking, lint and formatting.
`npm run test:e2e` passes the production build and all 29 enabled Electron scenarios; the existing
large-repository opt-in scenario is skipped. The three initial F36 baseline failures are closed.
