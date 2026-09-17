# PNGCut — Free, Private Background Remover for Images & Videos

A free, private, **in-browser** background remover. Drop an image (or dozens, or
a whole folder, or a short video) and a neural network running locally in your
browser separates the subject from the background — no signup, no watermark, no
upload-based processing, no server-side processing of your files.

Live at **https://pngcut.vercel.app/**

[![Deployed on Vercel](https://img.shields.io/badge/deployed%20on-Vercel-000000?logo=vercel)](https://pngcut.vercel.app/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/source-GitHub-181717?logo=github)](https://github.com/ShahabAhmed01/pngcut)

## Privacy model

Your **selected media is processed locally in your browser** and is not uploaded
for background removal. The app itself is served by a hosting provider and
downloads its AI model/runtime assets once from a CDN; those requests do not
contain your image or video. See [`public/privacy.html`](public/privacy.html) for
the precise wording.

## Features

- Background removal for **PNG, JPEG, WebP, GIF, AVIF, BMP** images (depending
  on what your browser can decode)
- **Video background removal** — frame-by-frame, fully on-device, exported as
  WebM with a chosen background (white, custom color or blurred original); audio
  is preserved when the browser allows
- **Bulk removal** — pick many images or a whole folder (up to 300 per run),
  download each, all at once, or **as a single ZIP**; per-item retry and
  cancellation
- **Edge refinement** — a deterministic mask post-process (speckle removal,
  edge-aware smoothing, halo-crushing contrast, optional crisp threshold)
  cleans the raw model cutout before you edit: *Auto / Crisp / Soft / Off*
- **Device-adaptive AI model** — Best (full-precision ISNet), Balanced (FP16,
  default) or Fast (quantized), pre-picked by GPU/CPU capability and rememberable
- **Erase** and **Restore** brush for fine edge refinement (live preview while
  painting, even on multi-megapixel images)
- Undo / redo (memory-bounded)
- **Feather edges** for softer cutouts
- **Compare** slider (original vs. result)
- Zoom & pan, fit-to-screen (`0`), **paste an image straight from the clipboard**
- Background replacement: transparent, solid color, gradient, custom image, or
  blurred original
- Export as **PNG (transparent)**, **WebP (transparent)**, **AVIF (transparent,
  when your browser can encode it)** or **JPEG** — plus **copy the result to
  the clipboard** (`Ctrl+P`)
- **Installable PWA** — add to home screen; after the first visit the app and
  AI model are cached, so background removal keeps working **offline**
- **Settings reset** — one-click restore all toolbar settings to defaults
- **Persistent preferences** — model tier and refinement preset remembered across sessions
- **Keyboard shortcuts**: `?` lists them all — `B` erase, `R` restore, `C` compare,
  `G` background, `Ctrl+Z` undo, `Ctrl+Shift+Z`/`Ctrl+Y` redo, `Ctrl+P` copy,
  `Ctrl+S` download, `[`/`]` brush size, `0` fit to screen, `T` toggle transparent,
  `F` toggle feather, `Space` + drag to pan

## Known limitations

These are deliberate and disclosed — not hidden:

- **Image working size.** Very large images are processed at a bounded working
  size (up to 4000 px on the long side) so they can't exhaust browser memory.
- **Video output.** Video output is capped at 1920 px on the long side and saved
  as WebM.
- **Animated GIF.** GIF input is treated as a still image (the first frame).
- **SVG.** SVG input is *not* supported for background removal (privacy/safety).
- **Backend.** WebGPU is used when available; otherwise CPU (WASM). The active
  backend is shown in the header status chip. The model tier (full/FP16/quant)
  adapts to the device (see *Features*).
- **Local safety.** There is no account or usage quota, but practical processing
  is limited by your device and browser.
- **AVIF export** appears only when the browser can really encode it; whether
  the chosen model tier applies to video/bulk too: bulk uses the same on-device
  default, the video pipeline has its own quality ladder.

## AI Models

PNGCut runs the **ISNet** segmentation network directly in your browser via
[`@imgly/background-removal`](https://github.com/imgly/background-removal-js)
and **ONNX Runtime Web** (WebGPU when available, multi-threaded WASM otherwise).

Three weight tiers are selectable in the toolbar (Best / Balanced / Fast — these
are the same architecture at different precisions, so the quality difference is
subtle; the real trade-off is download size and speed).

For background on *which* model and *why*, and how ISNet compares with the
alternatives that are commonly recommended (U²-Net, BiRefNet, BEN2, RMBG-1.4,
RMBG-2.0, MODNet, Robust Video Matting, MediaPipe), see the
**[AI Models](https://pngcut.vercel.app/models)** page. In short:

> ISNet is Apache-2.0, so an MIT project can ship it. The most accurate public
> models (RMBG-1.4 / 2.0, RVM) are source-available for **non-commercial use
> only** or **GPL-3.0** — none can be redistributed inside a free MIT app. A
> tuned ISNet is a sensible baseline, not a compromise.

A full model catalogue with per-model architecture, reported size, license, and
in-PNGCut status is on the Models page and in
[`public/models.html`](public/models.html).

## How it works

**Images** (`src/main.js`, `src/editor.js`)

1. The image is decoded locally into a canvas.
2. [`@imgly/background-removal`](https://github.com/imgly/background-removal-js)
   downloads the ISNet segmentation model + ONNX Runtime WASM once and caches it,
   then runs inference on the device. The adapter (`src/engine.js`) wraps this
   with its own resilience layer:
   - **Retry with backoff** — up to 4 attempts per load (1.2 s base, ×2 backoff,
     jitter). Between attempts it purges the service-worker model cache
     (`pngcut-model-*`) and awaits the purge, so a stale or corrupt cache can't
     be re-served mid-retry.
   - **GPU → CPU fallback** — the WebGPU probe (`navigator.gpu.requestAdapter()`)
     can succeed while the actual GPU session creation fails (driver, shader, EP
     init). If all GPU attempts fail, `preload()` falls back to a full CPU load,
     and `segmentForeground()` runs inference on the backend that actually
     loaded. A GPU hiccup *during* inference also falls back to CPU once.
   - **Recoverable module load** — a failed dynamic import of the engine module
     no longer poisons the memoised promise; `resetModel()` (the retry chip)
     clears it along with the in-flight preload promise and the SW model cache.
3. The returned alpha mask is composited with the source image; brushes edit the
   alpha channel directly for lossless-quality edits.

**Videos** (`src/video.js`)

1. *Analyze pass* — the clip is seeked frame-by-frame at the chosen fps; each
   frame is segmented and stored as a compact 8-bit alpha mask.
2. *Render pass* — the video plays back in realtime (with audio when supported)
   while each frame is composited with its cached mask and the chosen background.
3. The canvas is captured with `MediaRecorder` and saved as a WebM download.
   Output is capped at 1920 px on the long side.

**Bulk** (`src/bulk.js`)

1. All picked files (multi-select or a whole folder) join a queue.
2. Items are processed sequentially at a bounded working resolution and exported
   as transparent PNGs — individually or all at once.

## Architecture

Vanilla JS + Canvas 2D, organized into small cohesive modules:

```text
src/
  config.js         policy constants + supported formats (single source of truth)
  validate.js       media validation + filename sanitization
  errors.js         structured error codes → actionable user messages
  engine.js         inference engine adapter (WebGPU/CPU probe + fallback, model tiers)
  editor.js         full-resolution source + mask + brush/zoom/compare (cached compositing)
  background.js     background rendering (color/gradient/image/blur)
  refine.js         mask post-processing (median/box-blur/contrast/threshold on alpha)
  zip.js            dependency-free STORE ZIP writer (CRC-32, zip-slip safe)
  utils.js          canvas/image/blob + memory helpers
  bulk.js           bulk queue + single-ZIP download
  video.js          video analyze + render
  main.js           app controller (thin, delegates to modules)
  upload.js         file upload handling (dropzone, paste, pickers)
  export.js         encode/download/copy result
  views.js          view switching (hero/editor/bulk/video)
  tools.js          tool selection (erase/restore/compare/bg)
  background-ui.js  background controls (color/gradient/image/blur)
  viewport.js       pointer interactions (pan/zoom/brush/compare)
  controls.js       control binding (buttons, sliders, selects)
  shortcuts.js      keyboard shortcuts overlay & global hotkeys
  prefs.js          preferences persistence (model tier, refinement)
  constants.js      shared constants (no magic numbers)
  init.js           app initialization (analytics, SW, model preload)
```

Build-time tooling lives in `scripts/`:

```text
scripts/
  apply-patches.mjs               postinstall/prebuild dependency patch (see below)
  patches/                        the eval-free inference bundle implementation
  gen-icons.py                    regenerates the PWA icons
```

## Stack

- [Vite](https://vitejs.dev/) — build tool
- [@imgly/background-removal](https://www.npmjs.com/package/@imgly/background-removal) — in-browser background removal (AGPL-3.0)
- [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) — ONNX inference runtime (MIT)
- Vanilla JS + Canvas 2D — no UI framework, minimal runtime, fast load

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for full license details.

## Dependency patches (keeping the strict CSP)

`@imgly/background-removal` bundles the [`ndarray`](https://www.npmjs.com/package/ndarray)
package, whose `compileConstructor()` JIT-generates its array-view classes with
`new Function(...)` string evaluation. PNGCut ships a CSP **without**
`'unsafe-eval'`, so the first `ndarray(...)` call after inference threw:

```text
EvalError: Evaluating a string as JavaScript violates the following Content
Security Policy directive because 'unsafe-eval' is not an allowed source of script.
```

That failure was easy to misread: `compileConstructor` is lazy and compiles the
`-1` dimension first, so it blew up on the line *after* a successful inference —
the status chip said "Model ready · GPU" while every upload failed.

Instead of weakening the policy, `scripts/apply-patches.mjs` replaces just that
one function in the installed bundle with an eval-free, behaviourally identical
implementation (`scripts/patches/imgly-ndarray-eval-free.js`). The script:

- runs automatically on **`postinstall`** and again on **`prebuild`**, so local
  dev, CI and the Vercel build all run against the patched bundle;
- is **dependency-free, offline, deterministic and idempotent** (a re-run is a
  no-op), and never needs network access to patch;
- **fails the build loudly** if the eval sites ever return (for example after an
  upstream refactor) instead of shipping a bundle that breaks under the CSP;
- can be verified without modifying anything: `npm run check:patches`.

`test/patches.test.js` guards the invariant (zero `new Function` calls in the
installed bundle and in every shipped `dist/assets/*.js`) and checks the patched
implementation against upstream semantics — constructor, `shape`/`stride`/`size`/
`order`, `get`/`set`/`index`, `hi`/`lo`/`step`/`transpose`/`pick`, the `generic`
dtype and the degenerate `-1`/`0` dimensions.

## Getting started

Requirements: Node.js 20.19+ (Vite 7 requires it).

```bash
git clone https://github.com/ShahabAhmed01/pngcut.git pngcut
cd pngcut
npm install
npm run dev       # start dev server at http://localhost:5173
npm run build     # production build -> dist/
npm run preview   # preview production build
npm test          # run unit tests
npm run lint      # run ESLint
npm run check:patches   # verify the inference bundle is eval-free
```

`npm install` applies the dependency patch described above automatically via
`postinstall`, and `npm run build` re-checks it via `prebuild`.

## Deploying to Vercel

This repo is already connected to Vercel — the project **`pngcut`** deploys
automatically to **https://pngcut.vercel.app/** on every push to `main`.

To deploy your own copy:

1. Fork/push this repo to GitHub.
2. In [Vercel](https://vercel.com), **Add New → Project**, import the repo
   (or run `vercel link` + `vercel --prod` from the CLI).
3. Vercel auto-detects Vite (build command `npm run build`, output `dist`).
4. Deploy.

### Security & cross-origin isolation headers

`vercel.json` sets cross-origin isolation, a strict Content-Security-Policy,
HSTS, and other headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
Content-Security-Policy: ... (see vercel.json)
Strict-Transport-Security: max-age=63072000
```

Cross-origin isolation unlocks multi-threaded WASM (`SharedArrayBuffer`), making
ONNX Runtime Web significantly faster. The app still works (single-threaded WASM)
if those headers are absent. The same COOP/COEP headers are set for local dev in
`vite.config.js`.

**CSP `blob:` sources are load-bearing.** `@imgly/background-removal` downloads
the ONNX Runtime glue (`.mjs`) and binary (`.wasm`) from its CDN and hands them
to onnxruntime-web as `blob:` object URLs. The runtime then loads the glue with a
dynamic `import("blob:…")` (governed by `script-src`) and fetches the binary via
`fetch("blob:…")` (governed by `connect-src`). If you tighten the CSP and remove
`blob:` from either directive, model loading will fail on every attempt —
including retries — even though the site looks fine in `npm run dev` (Vite dev
and preview servers send no CSP, which hides the breakage). This exact issue
caused "Model load failed" for all production users at one point; keep `blob:`
in `script-src` and `connect-src`.

**`'unsafe-eval'` is intentionally absent.** The policy allows `'wasm-unsafe-eval'`
(WebAssembly compilation) but *not* JavaScript string evaluation. `ndarray`,
bundled inside `@imgly/background-removal`, historically JIT-built its view
classes with `new Function(...)`, which threw an `EvalError` on the first call
after inference. That dependency is patched to an eval-free implementation at
install/build time instead of relaxing the CSP — see
[Dependency patches](#dependency-patches-keeping-the-strict-csp). If you fork
PNGCut and skip that step (or bump the dependency without re-checking), the
`prebuild`/`check:patches` guard will fail before anything ships.

### Model hosting (optional self-hosting)

By default the model + WASM files are fetched from IMG.LY's CDN. To self-host:

1. Download `https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/`
   (all files, retaining structure) into `public/models/`.
2. In `src/engine.js`, pass `publicPath: "/models/"` in the config.
3. Update the CSP `connect-src` in `vercel.json` if the CDN is no longer needed.

Only redistribute these assets if IMG.LY's license permits (see
`THIRD_PARTY_NOTICES.md`).

### Service Worker & offline support

The app includes a production-grade Service Worker (`public/sw.js`) that provides:
- **Offline support** — after first visit, the app and AI model work without network
- **Stale-while-revalidate** for model assets — instant cached loads, background updates
- **Network-first for navigations** — deploys go live immediately
- **Cache-first for hashed assets** — immutable content-addressed files
- **Auto-versioning** — SW version injected at build time from `package.json`

See `vite.config.js` for the version injection plugin.

## Troubleshooting

**"Model load failed — click to retry" chip appears**

- The chip is a real retry: clicking it resets the engine (in-flight preload +
  memoised module import) and purges the service-worker model cache before
  loading again.
- First check the browser console. Common causes, in order of likelihood:
  1. **CSP violation mentioning `blob:`** — you removed or tightened `blob:` in
     `script-src`/`connect-src` (see the headers section above). Note the failure
     only reproduces on the deployed site; dev/preview send no CSP.
  2. **Network failure to `staticimgly.com`** (ad-blocker, offline, corporate
     proxy). The model + runtime (~40 MB) are fetched from there once.
  3. **WebGPU session failure** — the app already falls back to CPU
     automatically; if it still fails, force CPU by picking a smaller model tier
     or test in another browser.
- After a deploy, do one hard reload: an old service worker can briefly serve a
  stale shell; the SW is network-first for navigations and auto-skips-waiting,
  so a single reload is enough.
- If everything loaded but processing fails for one file, that's usually an
  oversized/corrupt input (limits are in "Known limitations"), not a model
  problem.

**Chip says "Model ready" but every upload fails ("Something went wrong")**

This pattern — model fine, every file failing — is the signature of a crash
*after* inference, in the mask post-processing, and the console tells you which:

1. **`EvalError: … 'unsafe-eval' is not an allowed source of script`** — the
   inference bundle is running unpatched (see
   [Dependency patches](#dependency-patches-keeping-the-strict-csp)). Run
   `npm run check:patches`; if it fails, run `node scripts/apply-patches.mjs`
   and rebuild. A fresh `npm ci` fixes it automatically via `postinstall`.
   Error classification maps this to a model-init message, so a report showing
   generic "Something went wrong" for this case means the classifier pattern
   needs extending.
2. **`No available adapters` (warning, not an error)** — your browser exposes no
   WebGPU device; PNGCut already runs on CPU. Harmless on its own.
3. **`Out of memory` / very large images** — lower the working size or the model
   tier (see "Known limitations").

## Licensing note

This repository is MIT licensed. It depends on
[`@imgly/background-removal`](https://github.com/imgly/background-removal-js),
which is licensed under **AGPL-3.0**. Review that license to understand your
obligations when redistributing or modifying the combined work; for other terms,
IMG.LY offers commercial licensing.

## Contributing

Bug reports and pull requests are welcome. The project is deliberately
dependency-light; please keep new features client-side and free. See
[`SECURITY.md`](SECURITY.md) for the security reporting process.