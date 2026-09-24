# Provider account authentication correction — 2026-09-24

Scope: the user's requested account sidebar, bottom +/− controls and provider-specific token/OAuth
forms. This supersedes the clipboard acquisition in [the previous account correction](github-accounts-correction.md).
P05's existing Linux network acceptance stays complete; F29/P11 remain partial for the limits below.

## Reference and presentation

- `P0-013-general-git-subcase:F1–F4`: read the original case, preferences dossier, original
  `evidence/20260919T133309_674804Z_batch02-preferences-general_cb8eb5/screen.png` and unchanged-Git
  verification. Windows 2.22.0.0, captured 2026-09-19; high confidence for the sampled composition,
  not account login fields. `P1-012-local-clone-subcase` documents local cloning and explicitly leaves
  provider authentication unobserved.
- Refreshed `npm run research:references` and inspected the Accounts image
  `win-2026-07-31-trackerwin2826-1-preferences-dark.png` from
  [TrackerWin #2826](https://github.com/fork-dev/TrackerWin/issues/2826). Windows, version unstated,
  dark, 2026-07-31; medium confidence for account sidebar, identity header, Account/Repositories tabs
  and aligned detail rows. Its Online badge is not treated as proof of valid authorization.
- The user supplied the five-provider field inventory and bottom +/− requirement on 2026-09-24.
  These are explicit requirements, not additional captured Fork observations. Accounts inside
  Preferences, removal confirmation, session/keyring choices and device OAuth are independent adaptations.

The independently rendered Linux light/dark and 780×600 screenshots under
`test-results/hosting-providers-provider-0af41-cancellation-in-Preferences/` were compared with those
originals after implementation: `gitea-form-light.png`, each provider's light/dark forms,
`github-oauth-form-light.png`, `accounts-all-providers-dark.png`, and `provider-form-narrow-dark.png`.
The existing hosting scenario also captures GitHub token entry and account/repository/activity states.
The private bundle is unchanged, no reference artwork enters the application, and no new public image
was downloaded or added to the screenshot manifest.

## Implemented behavior

| Provider          | Add-account inputs                                                   | API and Git behavior                                                                                     |
| ----------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Gitea             | Server URL, Access token                                             | Selected HTTPS installation, `/api/v1`, identity/repositories and scoped HTTPS Git                       |
| GitHub            | Authentication Type: OAuth → Username; Personal access token → token | Fixed GitHub.com/API origins; existing repository/activity features and HTTPS Git                        |
| GitHub Enterprise | Server URL, Personal access token                                    | HTTPS server root, `/api/v3`, identity/repositories and scoped HTTPS Git                                 |
| GitLab            | Personal access token                                                | GitLab.com `/api/v4`, identity/member projects, nested namespaces and HTTPS Git                          |
| GitLab Server     | Server URL, Token                                                    | Selected HTTPS installation, `/api/v4`, identity/member projects, nested namespaces and scoped HTTPS Git |

Adding an account verifies its identity before saving. Update preserves provider/server/user and keeps
the previous credential if verification fails. Removal confirms the selected account, removes the app's
credential and cancels its reads. Existing GitHub account IDs and encrypted version-1 files remain
readable. Session-only accounts create no credential file. Saved accounts retain the existing atomic,
mode-0600, OS-keyring-encrypted store; plaintext keyring fallback remains refused.

The user's direct-entry request creates a narrow exception to the historical no-renderer-credential
acquisition policy. An uncontrolled password input sends one bounded token through the stable
`hosting:connect-account` channel. It clears on submission and form dismissal/provider/method/server
changes. Tokens are not stored in React or presentation persistence and are never returned in account
results. This is transient renderer/IPC exposure, not a claim that JavaScript strings can be securely
erased. All provider requests, keyring access and Git credential delivery remain main-owned.
No automatic clipboard read, clipboard write or native token-file chooser is used by Accounts.

Self-hosting accepts explicitly selected HTTPS destinations, including installation paths for Gitea
and GitLab Server; Enterprise uses the server root. API paths are constructed locally, redirects are
rejected, bodies/time are bounded, and raw remote errors are not surfaced. Repository and browser/clone
selection stays bound to the window's most recent repository page. No generic network/execution API
was exposed; exact top-frame authorization, inspector denial, isolation, sandbox and CSP are unchanged.

The temporary Git helper now scopes configuration and credential requests to registered HTTPS origins
and installation paths, using the longest matching installation and a per-server default. Public
usernames pin explicit account selection; nested GitLab paths are supported. Passwords never enter
argv, environment, Git configuration or helper files. Output and progress retain credential redaction.
Unrelated hosts use their installed helpers and SSH uses native keys. SSH clone destinations currently
assume the conventional `git` user and port 22; custom SSH routing can be edited in Clone.

GitHub OAuth uses a registered **Git Workbench** public client ID supplied through
`GIT_WORKBENCH_GITHUB_CLIENT_ID` before launch, with device flow enabled in GitHub's OAuth App settings.
The fixed system-browser destination is `https://github.com/login/device`; the UI displays the user
code and optional username. Main retains device/access tokens, honors poll intervals and `slow_down`,
checks expiry and the returned identity, and prevents late results after cancellation/window disposal
from creating an account. Requested scopes are `repo read:user notifications`. No client secret is
embedded and no other application's OAuth registration is reused. Without a configured ID the method
selector explains setup and prevents starting an unavailable flow.

## Verification and remaining limits

Automated provider API fixtures cover all requested provider endpoints/headers, nested namespaces,
server isolation, wrong-account replacement, invalid server URLs and secret-free errors. Existing
encrypted-storage/restart, owner/frame/inspector, progress-redaction and Git tests are retained. OAuth
fixtures cover pending/slow-down, denied/expired authorization, wrong usernames, cancellation and a
late device-code response. Headless Electron exercises every provider form and account, direct token
entry without clipboard/file access, existing GitHub lists and clone selection, OAuth completion and
cancellation, confirmed removal, narrow layout and the production preload smoke test.

Verified on 2026-09-24:

- `npm run check`: 547 tests passed, one existing opt-in skip; type checks, lint and formatting passed.
- `npm run build`: passed (also run by the Electron command below).
- `npm run test:e2e -- tests/e2e/hosting.test.ts tests/e2e/hosting-providers.test.ts tests/e2e/desktop.test.ts`:
  all three headless scenarios passed, including the production preload smoke test. No desktop window
  or display/bridge changes were used.
- Real Git Test Connection/clone/fetch/pull/push, credential rejection, sign-out and unchanged credential
  configuration passed against authenticated loopback TLS fixtures for GitHub and a GitLab Server
  installation path. Provider HTTP and OAuth endpoints use synthetic responses; these are not live
  provider authorization results. Separate regressions verify that late OAuth completion cannot revive
  a cancelled login or overwrite a credential replaced in another window.
- `git diff --check`: passed. Reference bundle files and assets remain unchanged.

No real provider credentials were read and no live authorization or remote mutation was performed.
A registered OAuth client ID has not been supplied for this installation, so real OAuth login is not
enabled by this change alone. Automatic refresh-token renewal is not implemented; expired or revoked
OAuth tokens require sign-in again. Actual OS keyring unlock/save and native Windows/macOS behavior
remain unverified. Non-GitHub issues/PRs use website links; built-in activity/notifications stay GitHub-only.
These limits retain F29/P11's partial status and do not claim full Fork parity.
