# F27 — Binary metadata and image comparison — 2026-09-22

Implemented the bounded static PNG/JPEG image workflow in Local Changes, staged/amend diffs,
committed Changes, and the shared popup/inspector diff component. Side-by-Side is the initial
mode. Swipe has a draggable vertical divider and keyboard/range controls. Onion Skin crossfades
the two images. Pixel highlights differences in decoded RGBA and reports a changed-pixel count.
Binary cards retain old/new names, extension and original byte sizes. Missing sides, unsupported
formats, corrupt data and oversized images have distinct fallback states.

## Evidence and comparison

- `P0-026:F1`, Windows 2.22.0.0, captured 2026-09-19: paired binary metadata cards,
  extension and byte sizes. Original case JSON and `screen-0156` inspected. The unchanged
  rename/text-deletion behavior remains with the existing diff service.
- `P2-003:F1`, same baseline/date: Side-by-Side default, old/new labels, dimensions/bytes,
  draggable Swipe and Onion Skin. Original case JSON, `screen-0455`–`screen-0458`, and
  `continuous04/media-before`/`media-viewed` Git manifests inspected; all 13 recorded command
  hashes match. High confidence for those sampled states, not all formats or dimensions.
- [Windows 1.38 announcement](https://fork.dev/blog/posts/forkwin-1.38/), 2019-08-27,
  checked 2026-09-22, corroborates the three modes. High confidence in their availability.
- [Mac release notes](https://git-fork.com/releasenotes), 2.42 (2024-04-19), document pixel
  highlighting; 2.68 (2026-06-19) mentions 16-bit RGBA. High confidence for Mac availability,
  not the Windows 2.22 pixel UI or its algorithm. Our decoded 8-bit comparison is independent.

`npm run research:references` restored the public index (226 cached references); image/diff topics
were consulted. No new public screenshot was needed. Private evidence is unchanged and is not an
application asset. The test PNG generator independently creates the fixture pixels.

Linux screenshots from `tests/e2e/image-diff.test.ts` are written into its ignored `test-results`
directory: `f27-side-by-side-light.png`, `f27-swipe-light.png`, `f27-onion-light.png`,
`f27-pixel-dark.png`, `f27-binary-dark.png`, and `f27-dimensions-small-window.png`.
Before/after comparison retained top-centered previews, equal old/new columns, muted metadata,
thin framing and bottom mode controls. The comparison prompted a metadata contrast adjustment.
Keyboard sliders, checkerboard alpha, explicit errors, Pixel and responsive sizing are deliberate
Linux/product adaptations. Exact typography, palette, zoom and persistence are not claimed as parity.

## Boundary and resource policy

`repository:get-diff` gains `options.includeImages` and optional, runtime-validated `images` sides;
the existing explicit API, preload invocation, handler authorization and cancellation route remain
in use. Ordinary mutation-time diff reads do not request image bytes. No renderer-selected URL,
generic file read, asset server or navigation capability is added; CSP and sandbox settings are unchanged.

The backend reads full blob IDs from a single Git patch; it never treats the worktree as the staged
or committed version. Multi-patch/merge ambiguity yields unavailable previews and unknown metadata
rather than choosing an arbitrary pair. Working files require a regular-file descriptor, bounded
reads, identity/stat checks and repository containment; Linux verifies the opened descriptor via
`/proc/self/fd` to close the parent-symlink race. Git blob reads preserve bytes through a backend-only
base64 stdout encoding, with raw-byte process limits and cancellation. Lazy fetch is disabled for
image diff/blob reads. Blob previews do not invoke filters, and diff reads disable external diff/textconv
programs. No LFS payload download is added; Git's existing worktree clean-filter policy is unchanged.

Each side is limited to 4 MiB encoded source, 4,194,304 pixels and 8192 pixels per edge. The combined
canvas is also limited to 4,194,304 pixels. These are independent project limits, not measured Fork
thresholds. PNG/JPEG signatures and frame/chunk structure are checked before decoding. PNG animation
is rejected; ancillary metadata is removed except palette transparency. Baseline/progressive 8-bit
JPEG is accepted, with EXIF/ICC/comment metadata removed and duplicate frames/dimension redefinition
rejected. The sandboxed renderer decodes raster Blobs with `createImageBitmap`, verifies dimensions,
draws canvases and closes bitmaps on replacement/unmount, including late decode results. Corrupt
raster data that passes header inspection still produces an explicit decode failure.

SVG remains inert text or an unsupported binary card; it is never inserted into the DOM or decoded.
GIF/WebP/TIFF/TGA, animation, SVG rasterization, image Save As, zoom/pan and automatic local-LFS image
resolution are not implemented. LFS pointers retain the existing F24 path. Color profiles and EXIF
orientation are intentionally not applied. Pixel compares the browser's decoded 8-bit RGBA, not
original 16-bit channels or hidden RGB in fully transparent source pixels. Different sizes align at
the top-left without stretching; absent coordinates count as changes. Onion Skin uses a premultiplied
crossfade, including alpha. The comparison policy and magenta overlay are independently specified.

## Verification

Temporary-repository tests cover exact staged/unstaged/committed versions, root additions, amendments,
deletions, changed renames, ignored/untracked files, unusual paths, binary byte counts, symlink escapes,
byte/pixel limits, corrupt/animated/unsupported input, JPEG framing, cancellation, and no Git writes.
Pure pixel tests cover alpha and dimensions; preload tests reject malformed image DTOs and URL inputs.
The Electron scenario checks actual canvas pixels at slider endpoints and midpoint, pointer dragging,
keyboard control, PNG/JPEG decode, corrupt/large fallbacks, target switching, popup mode isolation,
small-window layout and unchanged status/index/refs/reflog. Production startup remains sandboxed.

Verification on Linux (2026-09-22): `npm run check` passed type checks, lint, formatting and
402 tests (one existing optional test skipped). `npm run build` passed. The five headless Electron
scenarios in `image-diff`, `changes-catalogue`, `desktop`, `file-history` and `window-lifecycle`
passed, including the production preload/startup smoke test. Build output retains the existing
Zod annotation and bundle-size warnings. No user's working repository was mutated by a Git test.

The handoff is limited to these formats and states. P10 remains partial for authenticated LFS,
transfers/locks and the signing platform matrix. Native Wayland window-frame behavior was unchanged
and was not reverified in the headless image tests; Windows/macOS rendering, fractional scaling,
screen readers, and full codec fuzzing remain unverified.
