# GitHub accounts and Preferences correction — 2026-09-23

Scope: the four reported account location, login, private Git authentication and visual discrepancies.
F29/F34 and P05/P11/P12 remain partial beyond this bounded correction.

## Behavior

File → Preferences → Accounts embeds the account list, login, account/repository tabs and notifications.
The standalone File → Accounts entry and Integration handoff are removed. Clone's hosting shortcut opens
the Accounts preference page; selecting a hosted repository returns to Clone. Preferences preserves
identity Save/Cancel and focus restoration, and blocks page handoffs while identity edits are pending.

Login uses a copied PAT through **Log in with Access Token**. Main reads the clipboard only on that
explicit request; the UI never receives the token or asks for a file. Create token opens GitHub's fixed
token-settings page. Update checks the existing immutable account ID; errors preserve the old token.
Session storage and opt-in secure-keyring encryption retain their existing behavior. Clipboard content
is not cleared and GitHub tokens are not remotely revoked. Existing saved accounts need no re-login.

The same account now authenticates HTTPS clone, Test Connection, fetch, pull and push. This includes
silent automatic fetch. The first account is the default; Use as default for Git persists account order
in the existing version-1 store. Hosted HTTPS clone URLs carry the chosen public username, which pins
future operations to that account. No password/token is embedded in a URL. SSH remains with SSH keys.

Git receives a temporary github.com-specific credential helper and useHttpPath override, never a token
in argv/environment/configuration. The TypeScript helper is bundled separately and run through Electron's
Node mode. Its per-operation private socket/pipe requires a random capability and validates protocol,
exact host, repository path and username. It never stores/erases credentials through installed helpers.
The broker is closed and its temporary directory removed on completion/failure/cancellation. Known raw
tokens and Basic-auth values are redacted across progress chunks and in results/errors. No global helper
is installed. Other hosts retain their configured helpers. GitHub redirects are refused while the account
helper is active; moved repositories need their current URL.

Sign-out affects future credential requests. A Git transfer already authenticated can still finish.
Failed credentials are not retried through another account. Fine-grained tokens need the repository
grant and Contents read permission for clone/fetch, or write permission for push; organization policy
and SSO can still deny access. Keyring unlock errors and authentication failures remain visible.

## Reference and layout

Read `P0-013-general-git-subcase:F1–F4`, original JSON, General/Git screenshots and linked Git invariance
evidence. Windows 2.22.0.0/captured 2026-09-19; high confidence for tab/field organization and variable
height only. Refreshed the public cache (226 existing images, no downloads) and inspected the dark
Accounts screenshot from [TrackerWin #2826](https://github.com/fork-dev/TrackerWin/issues/2826),
2026-07-31/Windows/version unstated; medium confidence for visible account sidebar/header/tabs.

Compact preference tabs and sections, aligned account fields and underlined subpages follow those
references. Detailed global Git origins are expandable. Generated login/account light/dark, narrow,
General dark and Git light screenshots are under ignored `test-results/` and were compared with the
originals. Accounts-in-Preferences and clipboard login are user-directed/independent adaptations, not
observed Fork behavior. Initial avatars are independently drawn text. No reference images are copied
into the application, and no inaccurate Online badge or unsupported OAuth option is displayed.

## Verification

- Unit/integration: an isolated TLS Git HTTP server and loopback-only CONNECT proxy exercise the real
  Git executable with a connected HostingService account: ls-remote/Test Connection, clone, fetch,
  fast-forward pull and push, using both the default account and a public username in the URL;
  rejection and sign-out; unchanged global config and no token/helper in repository config. No GitHub
  connection or private remote mutation occurs. OpenSSL generates only a disposable test certificate.
- Broker tests cover direct credential fill, Git's repeated capability fields, exact-origin refusal,
  split-token progress redaction, Basic-auth redaction and socket cleanup. Account tests cover default
  selection/restart, explicit username selection, invalid-token login and legacy encrypted storage.
- Typed IPC/preload rejects credential payloads and validates metadata results; inspector and foreign
  frame denial cover the new default-account/token-settings routes. Existing cancellation, replacement,
  token/keyring failures and subscription tests remain in the suite.
- Headless Electron covers the bundled helper under Electron's Node mode, Preferences login/update
  failure, activity, clone selection, sign-out, late login cancellation, light/dark/narrow layout and
  the existing settings and desktop isolation regressions.

Validation results:

- `npm run check`: passed type checking, lint and formatting; 491 tests passed, one existing skip.
- `npm run test:e2e -- tests/e2e/hosting.test.ts tests/e2e/settings.test.ts tests/e2e/desktop.test.ts`:
  production build and all three headless Electron scenarios passed with sandboxing enabled.
- Final targeted replay, `npm run test:e2e -- tests/e2e/hosting.test.ts tests/e2e/settings.test.ts`:
  production build and both scenarios passed after the credential/default-username and cleanup review.
- `git diff --check`: passed. No real display, bridge/IDE service changes or live GitHub account used.

Remaining verification: no live GitHub clone/fetch/push was performed; API sources and the local
authenticated Git fixture establish the implementation separately. Real OS-keyring unlock/save,
Windows/macOS helpers/packaging and native Wayland window frame behavior remain unverified. Window
chrome was not changed. OAuth requires a Git Workbench OAuth registration/client ID and remains out
of this PAT implementation. Other providers, enterprise hosts and the full preference inventory remain
separate work. Broader feature families/phases are not marked complete.
