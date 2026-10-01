# P13 statistics and optional AI — 2026-10-01

This record supersedes the earlier F35/F37 implementation limits within the independently specified
Linux phase, now complete for that specified scope. It separates implementation verification from live provider compatibility and exact Fork
parity. No live provider account, model request, or user repository was used for this work.

## Statistics and design

The existing cached, cancellable aggregation remains authoritative: HEAD-reachable commits, inclusive
UTC author dates, exact name/email identities without mailmap, first-parent merge diffs and delete/add
rename treatment. Independent fixture totals, UTC boundaries, aliases, empty commits, merges, shallow
history, cancellation and the 10,005-commit filtered-range regression pass. The original
[F35 metric and resource specification](f35-statistics.md) remains applicable.

Statistics now has compact date controls with Calculation options holding computation limits and the
metric policy. The orange chart and contributor table/donut retain the captured composition. Treemap
shows nested folder groups, independently drawn file icons, neutral tiles, a blue selected outline,
and a narrow Commits/Authors sidebar with contribution bars. Selecting a folder header drills down;
Up/root, filtering and a paged path list provide alternatives. File/author detail lists use 100-row
pages. The tile view displays at most 300 busiest matching paths and four directory levels at once;
it labels that limit, and filtering/drill-down/path paging can reach every returned path. This bounds
rendering separately from the backend range bounds; no aggregate totals are truncated.

Primary source: `P2-010:F1`, Windows 2.22.0.0, 2026-09-19, screens 0515–0517, original case and linked
manifests/graphs. Confidence is high for the sampled composition. Those Git records also span recovery,
so they do not establish read-only statistics semantics. Before/after comparisons use the original
screenshots and the Linux light/dark/narrow captures listed below. Date defaults, exact tile algorithm,
and multi-contributor chart behavior remain unknown in Fork. One modal with two views, explicit ISO
dates, total monthly series, exact Unicode paths, bounded tiles and keyboard folder buttons are
deliberate Linux adaptations. No reference asset was modified or copied into the application.

## AI workflow and retention

File → AI Integration and Preferences → Commit/Integration expose a compact provider page and Default
requests page. Choose OpenAI, Claude Code, Codex, Cursor, or Ollama and an explicit model name. Commit
and review instructions are editable, bounded plain text with Restore default requests. Remember saves
only provider/model/prompts and the selected executable in a version-1 atomic profile file. Invalid
saved data is retained as a `.corrupt-<id>` recovery file and defaults to disabled. Unchecking Remember
and saving removes stored choices. Every application restart requires explicit Enable, even with saved
choices. Disable aborts work and forgets app-owned keys while preserving remembered public choices.

OpenAI and Cursor keys come from a native regular-file chooser and remain in main-process memory.
They never enter public settings, preview/result DTOs, screenshots, ordinary preferences, Git config,
or diagnostic logs. Claude/Codex use their installed CLI's login; the app does not import those
credentials. Cursor uses a separate session API key so its CLI configuration can be isolated. Original
key files and the agent's own account remain the user's responsibility; Disable does not revoke them.

Generate Message supports staged changes and Amend. Amend compares the current index with HEAD's
first parent, or the empty tree for a root commit, and never restages or writes a tree. Unstaged and
untracked bytes remain excluded. Merge amendments retain first-parent comparison. Branch/commit-range
review keeps its explicit merge-base/endpoint choice. A local preview freezes exact instructions, diff,
provider and model in an owner/repository-bound one-use token. Send is separate; setup, opening a repo,
or viewing a diff makes no request. Results are plain inert text. A generated message can replace the
editable draft only while the draft, changes and amend mode still match; committing stays explicit.

Previews expire after ten minutes; at most sixteen previews and four pending operations are retained.
Diffs are bounded to 128 KiB, instructions to 3,000 editable characters plus fixed guidance, generation
to two minutes, provider output to 512 KiB and final text to 32,768 characters. No streaming, automatic
retries or chunked large-diff transmission is introduced. Closing/reloading a window, closing a tab,
Cancel, Disable or replacing configuration invalidates scoped work. Application shutdown drains AI
requests as well as Git operations, so agent process cleanup can complete. Cancellation cannot recall
already transmitted data or promise remote cancellation.

## Provider contracts and evidence

Public sources were accessed **2026-10-01**. Vendor documentation is high-confidence evidence for the
documented contract, not a live compatibility result or a claim about Fork's internal invocation.

| Adapter     | Contract and independently specified behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI      | The existing fixed-origin Responses adapter retains no tools, no redirect/retry, `store: false`, and explicit model selection. [Responses](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) and [data controls](https://developers.openai.com/api/docs/guides/your-data). Provider retention may still apply.                                                                                                                                                                                                                                                                                                        |
| Claude Code | Native selected executable, print/JSON, empty built-in tool set, MCP denied, safe/restricted mode, no permission prompts or session persistence. [CLI reference](https://code.claude.com/docs/en/cli-reference). Installed 2.1.278 help was checked without signing in or invoking a model.                                                                                                                                                                                                                                                                                                                                                             |
| Codex       | `exec` with stdin/JSON, ephemeral session, read-only sandbox, ignored user config/rules and disabled shell, image/browser/computer, apps/plugins, hooks, memory and agent collaboration. [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli), [configuration](https://learn.chatgpt.com/docs/config-file/config-reference). Installed 0.159.3 help/features were checked without invoking a model.                                                                                                                                                   |
| Cursor      | Print/JSON/Ask, sandbox enabled, a temporary workspace/config directory, and explicit deny rules for shell, reads, writes, web and MCP. The selected session API key is supplied only in the child environment. [Parameters](https://cursor.com/docs/cli/reference/parameters), [permissions](https://cursor.com/docs/cli/reference/permissions), [configuration](https://cursor.com/docs/cli/reference/configuration). No installed Cursor CLI was available; execution is tested with a contract stand-in.                                                                                                                                            |
| Ollama      | Fixed loopback server on port 11434. Read model metadata before transmitting the diff, reject cloud names/remote metadata, then request a bounded non-streaming chat without tools. No model download or server configuration. [Chat API](https://docs.ollama.com/api/chat), [model information](https://github.com/ollama/ollama/blob/main/docs/api.md#show-model-information), [remote metadata fields](https://github.com/ollama/ollama/blob/main/api/types.go), [local-only setup](https://docs.ollama.com/faq#how-do-i-disable-ollama-cloud-features). Users must start their own daemon with cloud features disabled; its logging policy applies. |

CLI processes receive only the displayed instructions/diff over stdin and run in a private temporary
directory outside the checkout. Only named adapter arguments exist; there is no shell interpolation
or arbitrary executable/argv request from the renderer. Native selection and executable validation
remain main-owned. Child environments exclude inherited provider keys, Git overrides and Node injection
variables. Process groups receive TERM/KILL on cancellation/timeout/output overflow; temporary request
directories are removed after termination. Raw stderr/errors never reach UI/logs, and app-owned keys
are redacted from returned text. Unsupported flags, missing executables, login/model failures and
malformed/incomplete results are explicit failures. Installed tools and managed policies remain an
external trust boundary; the app does not claim an OS sandbox for a malicious replacement executable.

Fork's AI family is public-only. [Windows notes](https://fork.dev/releasenoteswin) advertise Claude
messages/branch review in 2.14 (2025-11-21) and revised review in 2.15 (2025-12-12).
[Mac notes](https://fork.dev/releasenotes) advertise Codex and editable requests in 2.64 (2026-03-06),
and Cursor messages in 2.70 (2026-09-04). These are high-confidence documented capabilities; no matching
Windows Codex/Cursor claim or private AI case is inferred. Ollama and Cursor range review are independent
extensions. `P0-013-general-git-subcase:F1–F4` and `P0-030:F1` (2026-09-19, Windows 2.22.0.0) supply
surrounding preferences/composer presentation and Git evidence only. The restored
[TrackerWin 2808 screenshot](https://github.com/fork-dev/TrackerWin/issues/2808) (2026-06-22, Windows,
light, version unstated) supports the Commit preferences entry point. Native key files, explicit model
selection, preview/consent, session activation and the larger request dialog are independent choices.

## Verification and retained limits

`npm run check` passes type/lint/format and **693 tests**, with **6 existing skipped tests**. The production build and four focused
headless Electron scenarios pass: F35 Statistics, F37 API, P13 providers/persistence/amend, and the desktop
isolation/preload/commit/hooks smoke. The phase ledger records these final gates.

New unit tests cover saved-choice restart/opt-out/corruption, early cancellation and shutdown draining,
root/non-root amend bytes and unchanged index/refs, provider routing, prompt snapshots, strict input/result
schemas, missing/invalid executables, stdin/environment isolation, output/failure bounds, cancelled process
termination, temporary cleanup and local/cloud model separation. Electron checks exercise actual preload
and main handlers with local HTTP/process stand-ins, editable drafts, all three selected CLI adapters,
zero network requests before Send, disabled restart, remembered prompts, dark/narrow presentation and
unchanged Git state. These tests do not validate live model quality, accounts, billing or vendor executables.

Compared images (all git-ignored under `test-results/`):

- `statistics-F35-statistics--028b0--refresh-and-keyboard-close/f35-{statistics,contributors,treemap}-light.png`,
  `f35-treemap-dark.png`, and `f35-statistics-narrow-dark.png`.
- `ai-F37-opt-in-setup-exact--3c2de-ew-cancellation-and-disable/f37-{settings,preview}-light.png`,
  `f37-review-dark.png`, and `f37-review-narrow.png`.
- `p13-ai-P13-saved-prompts-l-d4477-stay-explicit-and-read-only/p13-ai-prompts-light.png` and
  `p13-ai-agent-narrow-dark.png`.

Remaining release validation: live provider/account/version matrix (especially Cursor), real local
model compatibility and quality, Windows/macOS execution, native Wayland frame/physical scaling,
screen-reader/keyboard-layout matrix and P14's 100k-history performance budgets. Exact undocumented
Fork prompts, aggregation algorithms and AI defaults remain unknown. Keyring persistence, selective
secret redaction, streaming, model installation and automatic Git mutation are not part of this phase.
