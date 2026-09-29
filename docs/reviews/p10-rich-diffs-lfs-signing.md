# P10 — Rich diffs, LFS and signing

Implementation date: 2026-09-29. Linux baseline: Git 2.55.0, Git LFS 3.8.0, GnuPG 2.4.9,
Node 24.13.0 and the committed Electron/npm dependencies. This record supersedes the bounded
F24/F27/F28 handoffs within P10. Native platform and exact Fork parity limits remain below.

## Scope and evidence

| Requirement                                         | Implementation and independent checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Safe rich diffs and binary fallback                 | PNG/JPEG plus GIF first frame, static WebP, BMP, true-color/grayscale TGA including RLE/origins, and restricted SVG; four comparison modes, Fit/25–400% zoom, pointer panning/keyboard scrolling, committed File Tree previews and cached LFS image comparison. Header/byte/pixel bounds, corrupt input, alpha, missing sides, historical versions, inert SVG and unchanged Git state are tested.                                                                                                                                    |
| LFS capability, content, transfers, rules and locks | Repository → Git LFS retains Initialize and adds a compact management dialog. Historical Save As retrieves exactly one missing object, verifies size/SHA-256 and protects the checkout. Explicit download/refetch/upload, local/global/nested/info tracking inspection, root pattern editing, and server-verified lock/unlock use queryable cancellable operations. Real Git LFS and a disposable loopback TLS server verify authentication, missing/corrupt objects, upload bytes, ownership, stale configuration and cancellation. |
| Documented GPG configuration and verification       | Existing commit/amend/tag signing and exact-object verification gain atomic repository commit/tag defaults with explicit inheritance. Isolated protected keys exercise the real GPG agent with a controlled pinentry fixture, including acceptance, cancellation and interruption. Existing tests cover invalid signatures, missing keys, unsigned overrides, linked-worktree scope and signer-output suppression.                                                                                                                   |

Primary reference: Fork Windows **2.22.0.0**, captured **2026-09-19**, catalogue prepared
2026-09-20. Confidence is high for the sampled states only:

- `P0-026:F1`: original case and `screen-0156`, paired binary metadata cards.
- `P2-003:F1`: original case, `screen-0455`–`screen-0458`, top-aligned old/new images,
  dimensions/bytes, Swipe and Onion Skin, bottom mode controls. The linked before/after
  manifests preserve all 13 command hashes. Zoom, differing sizes and alpha remain capture unknowns.
- `P2-011-initialize-download-subcase:F1–F4`: original case and `screen-0518`–`screen-0525`,
  Initialize route, LFS badge/framed file card/size dropdown, retrieval progress and Save As.
  The linked Git manifests and saved/working-pointer hash evidence were inspected. The saved
  payload is 32,768 bytes while the checkout stays a 130-byte pointer.
- `P0-030:F1` and `P1-004-empty-message-tag-subcase:F1–F3`, previously inspected in the
  F28 handoff, anchor the retained composer/tag forms. They do not establish signing dialogs.

Public sources refreshed **2026-09-29**:

- [Fork Windows 1.38](https://fork.dev/blog/posts/forkwin-1.38/) (2019-08-27): three image modes.
- [Fork Windows 1.48](https://fork.dev/blog/posts/forkwin-1.48/) (2020-05-05): file-context LFS
  Lock/Unlock. Its existing public screenshot was inspected; ownership/refusal semantics are independently specified.
- [Fork Mac release notes](https://git-fork.com/releasenotes): 1.0.26 (2016-10-17) names common
  image formats, 2.45 (2024-08-16) WebP, 2.51 (2025-03-07) TGA/SVG, 2.52 (2025-04-18) LFS pixel
  comparison, and 2.68 (2026-06-19) 16-bit RGBA. These establish Mac feature availability,
  not Windows 2.22 codec algorithms or exact color parity. The earlier F28 signing sources remain applicable.
- Git LFS [fetch](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-fetch.adoc),
  [smudge](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-smudge.adoc),
  [push](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-push.adoc),
  [track](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-track.adoc) and
  [locks](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-locks.adoc) define Git/LFS behavior.
  Public upstream [inspection setup](https://github.com/git-lfs/git-lfs/blob/main/commands/commands.go),
  [lock command](https://github.com/git-lfs/git-lfs/blob/main/commands/command_locks.go) and
  [endpoint selection](https://github.com/git-lfs/git-lfs/blob/main/lfsapi/endpoint_finder.go) explain
  the independently reproduced format-version write, JSON error omission and destination rules.
- [SVG secure image modes](https://www.w3.org/TR/SVG2/conform.html),
  [WebP container](https://developers.google.com/speed/webp/docs/riff_container),
  [GIF specification](https://www.w3.org/Graphics/GIF/spec-gif89a.txt),
  [Git configuration](https://git-scm.com/docs/git-config),
  [commit verification](https://git-scm.com/docs/git-verify-commit),
  [tag verification](https://git-scm.com/docs/git-verify-tag) and
  [GPG agent](https://www.gnupg.org/documentation/manuals/gnupg/Invoking-GPG_002dAGENT.html)
  supply implementation semantics, not observations of Fork.

`npm run research:references` restored/checked all 226 cached public images. Image/diff/LFS topics
were consulted; no new screenshot was required and no private bundle file or artwork was copied.

## Boundaries and policies

Two named validated capabilities, `getLfsContext` and `startLfsOperation`, extend common schemas,
the explicit preload and owner/frame-checked main handlers together. Inspectors cannot configure LFS,
transfer whole revisions, edit tracking or manage locks. Their existing historical export capability
can retrieve a selected payload, and they can inspect/cancel only their own operation records.
No generic process/filesystem/network capability, credential DTO, CSP or sandbox change is introduced.

LFS jobs share the common-directory mutation queue and revalidate reviewed context. Context snapshots
include configuration, actual download endpoint and configured push URL, HEAD, attributes and index
configuration entries. Tool reads have a total ten-second deadline. Transfers use installed Git LFS,
native helpers/SSH agents or the existing origin-scoped account credential broker; no credentials are
put in arguments, environment or UI state. Diagnostics returned by the LFS service are fixed messages.
Transfer payload stdout is drained without retention; progress is read from a private bounded-tail file.
Transfers have a 30-minute bound, lock actions two minutes; cancellation terminates the process group.
Native caches can remain after interruption; a completed server upload or lock change is not rolled back.

Historical Save As sends one backend-read pointer to LFS smudge and drains stdout into the local cache.
It never smudges the working file. Temporary hooks isolate native smudge hook installation. The selected
payload is streamed through a private destination sibling with size/hash checks before atomic publication;
checkout/Git destinations, symlinks and hard-linked destinations are refused. Custom `lfs.storage` is
resolved as a storage root with its `objects` child. Selecting a row/preview never downloads missing content.

Git LFS tracking enumeration is run with private temporary Git metadata, the real working directory and
its effective global/info attributes. This prevents the native listing command's implicit local config
initialization. Root Track/Stop tracking use the installed tool and leave .gitattributes unstaged; nested,
global and info rules are displayed with their sources and edited at those sources. Lockable rules may
change file write permissions according to Git LFS. No migration of existing history is implied.

Lock queries are explicit, capped at 1,000 rows and 1 MiB. Git LFS 3.8's JSON query can hide a server
failure; the backend requires matching ordinary and structured ownership reads. A disagreement fails
closed. Unlock checks the exact path/ID and current owner again; there is no force-unlock action.
Local LFS-only cache writes and these separately tested public workflows do not become captured Fork
HTTP/lock/push observations.

Images keep the 4 MiB/source, 4,194,304-pixel/canvas and 8192-edge limits. TGA normalizes to bounded PNG;
other raster decoding occurs in the sandboxed renderer. GIF uses a static first frame. SVG is limited
to 1 MiB and 10,000 elements, parsed inertly and checked against a shape/attribute allowlist before
Chromium's image-only decoding; it never enters the application DOM. Scripts, foreign content, external
resources, filters, patterns, use/animation and stylesheet elements are rejected. A five-second SVG
deadline and bitmap cleanup bound decode lifetime. SVG source remains accessible in the text diff.
Pixel comparison remains decoded 8-bit RGBA with the established alpha and unequal-size policy.

Signing settings prepare a private configuration copy and publish key/commit/tag defaults together
under Git's config lock, preserving unrelated settings and detecting external changes. Linked worktrees
share that local scope. Explicit per-operation choices still override defaults. Passphrases stay with
the native GPG agent; the fixture pinentry is test-only. No key generation/import UI, SSH or X.509
verification is claimed. Signature presentation resets when its selected object changes.

## Design verification

The original images were inspected before changes and compared with independent Linux captures.
The comparison corrected a duplicate filename header and replaced the loose LFS icon with a framed
file/extension card, LFS/status caption and inline size dropdown. Image previews retain old/new labels,
top-centered framing and bottom mode controls. Additional zoom/source controls, explicit transfer
review, server ownership display and tracking pages are independent Linux/product choices.
Small-window dark-mode checks prompted more distinct disabled Unlock styling and scrollable dialogs.

`tests/e2e/p10-images.test.ts` and `p10-lfs.test.ts` generate ignored screenshots for SVG Pixel/zoom,
WebP dark, cached LFS Onion Skin, missing/saved payload cards, tracking rules, owned locks and
other-owned locks at 880×600. The legacy image/signing scenarios retain the baseline comparisons.
Native frame/window-manager behavior was not changed or reverified.

## Verification

- `npm run check`: **630 passed**, one existing opt-in skip; shared/main/renderer type checks,
  lint and formatting pass. The multi-operation TLS/lock lifecycle uses a 20-second test budget after
  its initial five-second default expired under the full concurrent unit suite; assertions are unchanged.
- `npm run build`: passes with the existing dependency-annotation and bundle-size warnings.
- Eight focused headless Electron scenarios pass: both P10 scenarios, legacy image/LFS/signing,
  Local Changes catalogue, settings and desktop isolation/startup smoke. Final captures are under
  `test-results/p10-final/`. Rename-only image blob resolution also passes a dedicated Git assertion.
- Full headless suite: **66 passed, 2 opt-in skips, 1 failed**, with no automatic retries. The P07
  compact-action scenario reached its combined-message editor with an empty description instead of
  `Add Gamma`. Untouched starting commit `7b2624a091844c9db66244a8fe1ef320c32ab7b9`, archived at
  `/tmp/git-workbench-p10-baseline-BWVonV`, passes two of three repeats and fails once with a different
  keyboard-action result (`Add Epsilon` retained instead of `Add Zeta`). Three subsequent baseline
  repeats pass. This establishes preexisting intermittency in that scenario, not an exact root cause
  or proof that the two assertions have the same cause. No P07 code/assertion was changed.
- One initial desktop smoke run missed a hunk Unstage transition; its unchanged focused replay and
  the full-suite/final targeted smoke pass. This observation is retained rather than claimed as a fix.
- `git diff --check`: passes. All P10 acceptance criteria are verified for the documented Linux
  policies; the broad suite is not claimed entirely green.

Tests use only temporary repositories, profiles, caches, generated GPG keys and loopback services.
Git LFS was absent on the host; the official 3.8.0 Linux executable was downloaded into a temporary
test-tools directory and matched GitHub's published SHA-256
`e455e00f15d9b95661b8d53498ffb0c3367962cf1ec73c31ab7369516cd6ab8d`.
It was prepended to PATH for verification, without installing it globally or modifying user Git config.
Git-LFS-dependent tests explicitly skip on hosts without the optional executable.

Remaining P14/public parity limits: real provider policies and SSH-specific LFS servers, graphical
pinentry/smartcard/keyring/platform matrices, codec fuzzing, full SVG/CSS/filter support, animated
WebP/APNG playback, exact 16-bit/color-profile comparison, native fractional scaling and screen readers.
GIF's first-frame policy and the SVG subset are deliberate limits, not claims of full Fork format parity.
