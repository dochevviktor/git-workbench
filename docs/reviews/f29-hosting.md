# F29 — GitHub accounts and hosted repository selection

Date: 2026-09-22. Status: verified GitHub.com PAT slice; F29 and P11 remain partial.

## Delivered workflow

File → Accounts works with no local repository open. Add GitHub account selects a token file through
a native main-process dialog, validates identity using GitHub, and exposes only account metadata.
Session-only is the default; Remember requires a secure OS keyring and stores encrypted credentials
in a separate versioned, private, atomically replaced file. Replace token checks the same immutable
GitHub account ID. Sign out removes the app's credential and aborts pending reads. Original token files
and GitHub-side tokens are not deleted or revoked.

Repositories lists one page of up to 100 accessible repositories, with Previous/Next, Refresh,
current-page filtering, private/archive labels and explicit errors. HTTPS/SSH selection prepares the
existing Clone destination dialog. Git transport remains with native Git helpers/agents, as the UI
explains; API accounts do not silently inject credentials into Git. Website, Pull requests and Issues
open derived GitHub URLs in the system browser. Existing branch PR creation handoffs are preserved.

Main fixes the API origin, denies redirects, ignores pagination URLs, bounds response sizes/time,
validates response shape, and suppresses provider bodies and exception details. Backend-owned page IDs
gate clone/browser selection per window. Sign-out and replacement invalidate cached metadata; stale
responses cannot restore removed accounts. IPC rejects paths, tokens and arbitrary URLs, preserves
sender/frame checks, and denies hosting access to inspectors. No background hosting polling exists.

## Reference comparison

- Read the catalogue entry point, P1-012 dossier, original local-clone case and linked Git manifest.
  `P1-012-local-clone-subcase:F1–F3`, screen-0295, establishes the URL/Parent Folder/Name/Test Connection
  form and successful local clone. Authenticated hosting remains unobserved in this catalogue.
- Refreshed the public screenshot index (226 present, no downloads needed). Compared the existing
  `win-2026-07-31-trackerwin2826-1-preferences-dark.png` from
  [TrackerWin #2826](https://github.com/fork-dev/TrackerWin/issues/2826) against the independently authored
  account sidebar and Account/Repositories controls. Windows version unstated; medium confidence.
- Examined generated `f29-account.png`, `f29-account-dark.png`, `f29-repositories.png`, and `f29-clone.png` under the hosting
  scenario's git-ignored `test-results/` directory. The clone form preserves the reference field order
  with an added browse entry. Account storage/token-file controls and explicit Git-helper wording are
  independent adaptations. The public screenshot supplies no repository-list layout or authenticated
  success evidence. No reference asset is copied into the application.
- Provider-specific sources, dates, confidence and platform differences are recorded in
  [public research](../research/fork-public-surface.md#f29-github-account-and-repository-browser--2026-09-22)
  and the [alignment record](../research/fork-catalogue-alignment.md#f29-alignment-checkpoint--2026-09-22).

## Verification

- `npm run check`: 367 passing tests, one existing skip; type checking, lint and formatting pass.
- `npm run test:e2e -- tests/e2e/hosting.test.ts tests/e2e/desktop.test.ts`: production build and both
  headless Electron scenarios pass with sandboxing enabled. Existing startup/isolation/local Git/clone
  smoke behavior remains covered. No real display or service changes were required.
- `tests/unit/hosting.test.ts`: synthetic account identity and repository pages, fixed origins/redirect
  policy, hostile pagination URLs, expiration/revocation/permission/rate-limit/offline/server failures,
  malformed/oversized bodies, no response-body leakage, encrypted restart persistence, mode 0600,
  unavailable/locked keyring, removal without decrypting, replacement failure/identity mismatch,
  session-only no-write behavior, chooser cancellation, owner cancellation, sign-out race, corrupt-store
  preservation, token-file bounds/symlink refusal, window-owned selection and request validation.
- Preload and IPC tests cover strict hosting results/inputs, unauthorized frames, inspector denial and
  window cleanup. The Electron hosting scenario uses synthetic tokens and mocked HTTP in main, with
  the real preload and UI. It verifies paging/filtering, browser handoff, SSH clone prefill, expired-token
  presentation, sign-out, Escape and absence of any session credential file.

The explicitly authorized live check ran after implementation and the Electron checks:

```sh
npx esbuild scripts/verify-github.ts --bundle --platform=node --format=esm --outfile=out/verify-github.mjs
node out/verify-github.mjs --live
```

Result: authenticated identity passed; repository enumeration passed; pagination not needed;
credentials saved: false. The source token remained at `.idea/.githubtoken` and was read only into
process memory. No token, account identity, repository names, raw response or encrypted credential copy
was written to a report, profile, screenshot or log. The live check performed only GitHub GET requests;
it did not clone or mutate any remote resource. Mock tests, rather than the live account, exercise
second-page behavior, rate limits and token failures.

## Remaining acceptance limits

GitLab/Bitbucket/Azure/Gitea accounts, self-hosted URL policy, OAuth/device login, automatic refresh and
remote token revocation remain unimplemented. Current PAT expiry recovery is explicit replacement.
Full in-app PR/issue lists, filters and notifications are F30 and are not provided by browser links.
No new account-token-based Git transport is implemented or live-tested; private clone still requires
the user's Git credential helper or SSH agent. Native protected keyring save/unlock and the Linux,
Windows and macOS platform matrix remain unverified; routine tests use injected encryption and prove
that Electron's Linux basic-text backend cannot persist credentials. No offline repository cache is
persisted. The public repository enumeration scope does not guarantee access to every organization
repository for every token or SSO configuration.

Closing/cancelling stops pending network/chooser results; a credential write already committing is not
rolled back. Reopening Accounts queries authoritative state. Native file-dialog/keyring prompts have
their own platform behavior; a chooser result arriving after the five-minute connect deadline is ignored.
