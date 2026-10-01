# F37 — Optional AI messages and diff review

Superseded within P13 by the [2026-10-01 completion handoff](p13-statistics-ai.md): named CLI/local
adapters, public saved choices, custom requests and amend generation are now implemented. The original
OpenAI-only checkpoint and test results below remain historical evidence, not the current provider scope.

Implementation date: 2026-09-22. A bounded OpenAI API workflow; full external-agent parity remains
partial. No live provider account or credentials were used during implementation or testing.

## Scope and use

File → AI Integration (also Preferences → Integration) works without an open repository. Enter an
OpenAI text model ID available to your API project, then select a regular text file containing its API
key. This enables AI for the current application session only. Setup does not make a network request;
invalid credentials, inaccessible models, quota and network failures are reported on explicit Send.
The key and model are forgotten on Disable or application exit. The original key file is not deleted
and disabling does not revoke the provider credential.

Local Changes → Generate Message previews staged changes for a new commit. Empty staging, conflicts
and Amend disable this entry. The backend also refuses empty/unmerged staged previews. Review the
instructions and exact diff, check the send consent, then choose Send to OpenAI. The generated message
is editable; Replace commit draft is a separate action. It preserves a newer draft or changed staged/HEAD
context by disabling replacement. Committing remains the existing explicit Git workflow.

Repository → AI Code Review accepts full commit IDs or full local/remote branch refs, with branch
suggestions. The initial tip is the current HEAD commit. The default compares the base/tip merge-base
with the tip; unchecking it compares endpoint trees directly. Main resolves refs to exact commits and
displays the actual endpoints. Neither form sends commit messages, author identities, repository paths,
untracked files, unstaged contents or additional source files. Review results are inert, unverified text
with no command, tool-call, browser-link or repository-write action.

All requests send only the displayed diff and instructions. Diff content includes paths and three
context lines. Binary payloads and submodule changes are omitted; rename detection is disabled, so
renames appear as delete/add. Diff reads are limited to 128 KiB and reject oversized output rather than
silently truncate it. Non-UTF-8 output and diffs containing the configured API key are refused. This is
not a general secret scanner: users must review all material before sending.

## Boundaries and lifetime

- Six named `ai:*` capabilities extend contracts, preload and main together. Runtime input/result
  validation, top-frame/document/owner checks, context isolation, CSP and sandboxing remain in place.
  All AI channels are denied to commit/file-history/Blame inspectors.
- Native file selection reads at most 4 KiB, rejects symlinks and non-regular files, and never returns
  the path/key to the renderer. Credentials never enter ordinary preferences, Git config, logs or DTOs.
  No environment credentials are imported automatically. No keyring or plaintext persistence is added.
- Main owns immutable, one-use preview tokens bound to window and repository. Previews expire after
  ten minutes (at most sixteen). Sending uses those exact bytes, even if branches or staging later
  change. This is analysis of a reviewed snapshot, not a mutation requiring a new Git snapshot guard.
- Repository reads disable external diff/textconv and lazy fetching; index optional locks are disabled.
  Only an explicit Preview collects content. Opening a repository/diff or reading settings sends nothing.
- The provider uses only `https://api.openai.com/v1/responses`, denies redirects, supplies no tools,
  conversation or background execution, sets `store: false`, caps output tokens at 4,096 and response
  bytes at 512 KiB. Only completed assistant text is accepted, bounded to 32,768 characters. Errors and
  transport exceptions are sanitized; the configured key is redacted from output. No automatic retries.
- At most four pending requests; local preview has a twelve-second deadline, generation two minutes,
  and native setup five minutes. Preload deadlines accommodate these. Cancel, tab/window close,
  renderer reload, Disable, replacement configuration and shutdown abort scoped work and release
  previews. Generation checks cancellation again before publishing a late result. Reload listeners are
  removed by exact identity. Cancelling cannot undo transmission or guarantee remote processing stops.
- Preview/review text is kept in memory; using a generated message opts into the existing ordinary
  persistent commit draft. Disabling response storage is not a zero-retention promise: OpenAI's abuse
  monitoring and account-specific data controls still apply.

## Evidence and deliberate adaptations

Research refreshed 2026-09-22. F37 is public-only: there is no AI case in the private Windows 2.22.0.0
catalogue. The original P0-013-general-git-subcase:F1–F4 and P0-030:F1 records, screenshots and Git
verification establish surrounding settings/composer presentation and existing commit behavior only.
They do not prove AI prompts, provider defaults, authentication, retention or review semantics.

| Tool/surface               | Public evidence                                                                                                                                                                                               | Implemented scope / remaining difference                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenAI generation, Windows | [TrackerWin 2808](https://github.com/fork-dev/TrackerWin/issues/2808), 2026-06-22 screenshot, version unstated: Commit preferences and OpenAI token login. O, high confidence for visible controls only.      | Main-owned native key-file selection and session storage, explicit model, preview and Send. Direct Responses API and range review are independent choices, not observed Fork API behavior. |
| Claude, Windows            | [Windows releases](https://fork.dev/releasenoteswin): 2.14 (2025-11-21) messages/branch review; 2.15 (2025-12-12) revised branch review and installation location. D, high confidence for advertised support. | CLI invocation/authentication/settings discovery remains unimplemented.                                                                                                                    |
| Claude and ranges, macOS   | [Mac releases](https://fork.dev/releasenotes): 2.59/2.60 messages/branch review; 2.61 (2026-01-09) SHA-range review. D.                                                                                       | The range workflow here uses a reviewed Git diff and OpenAI, not the Claude CLI.                                                                                                           |
| Codex, macOS               | Mac 2.64 (2026-03-06) messages/review and editable default agent requests. D.                                                                                                                                 | Codex CLI and customizable prompt templates remain unimplemented; no matching Windows release claim found.                                                                                 |
| Cursor, macOS              | Mac 2.70 (2026-09-04) commit-message integration. D.                                                                                                                                                          | Cursor CLI remains unimplemented; review and Windows parity are not established by this entry.                                                                                             |

The [Responses reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
and [data controls](https://developers.openai.com/api/docs/guides/your-data), accessed 2026-09-22, inform
the independent request, response and retention policy. This implementation uses HTTP directly, not
the CLI represented by that reference page. No OpenAI SDK or other dependency was added.

Before/after comparison uses original private P0-013/P0-030 screenshots and the already-restored public
`win-2026-06-22-trackerwin2808-1-preferences-light.png`. The 574 px setup width, existing dialog text/theme,
and compact composer action follow the surrounding Windows surfaces. The 760 px diff preview and
consent/retention controls are deliberate Linux/product adaptations. Headless Linux light/dark/720 px
captures live under the F37 Playwright output directory; original reference images remain untouched.

## Verification and limits

Final `npm run check` passes: type checks, lint, formatting and 461 tests (one existing skip).
Independent disposable-repository tests cover staged/unstaged/untracked separation, unborn staging,
exact reviewed bytes after staging changes, branch and merge-base/endpoint resolution, unchanged Git
state, empty/oversized/encoding/credential rejection, owner/repository guards, cancelled late setup and
generation, key-file validation, inspector denial, malformed IPC and provider response/error bounds.
Mock HTTP tests cover request policy, authentication/permission/quota/model/server errors, incomplete
and malformed responses, transport exceptions and key redaction. The production build and desktop
isolation/preload/commit/hooks smoke pass. The F37 headless Electron workflow passes, including setup
with no repository, zero requests before consent, staged-only material, draft replacement and preservation
of a newer draft, range review, inert results, cancellation, sanitized authentication failure, Disable
and unchanged refs/index/worktree. Captures: `f37-settings-light.png`, `f37-preview-light.png`,
`f37-review-dark.png`, `f37-review-narrow.png` in the F37 test output directory. A first run's ambiguous
checkbox locator was corrected to target explicit send consent; the complete rerun passes.

Unverified/unimplemented: live account/model compatibility and generated-message quality, Claude/Codex/
Cursor adapters, local/offline inference, persistent AI configuration/keyring storage, amend generation,
selective path redaction, custom prompts, streaming, large-diff chunking, full native platform and
accessibility matrices. F37/P13 remain partial for those external-agent/platform variants. The API
feature does not require installed agent tools and does not claim to handle their missing-tool states.
