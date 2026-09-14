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
- Sample images to try instantly
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

## How it works

**Images** (`src/main.js`, `src/editor.js`)

1. The image is decoded locally into a canvas.
2. [`@imgly/background-removal`](https://github.com/imgly/background-removal-js)
   downloads the ISNet segmentation model + ONNX Runtime WASM once and caches it,
   then runs inference on the device.
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
  upload.js         file upload handling (dropzone, paste, pickers, samples)
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

## Stack

- [Vite](https://vitejs.dev/) — build tool
- [@imgly/background-removal](https://www.npmjs.com/package/@imgly/background-removal) — in-browser background removal (AGPL-3.0)
- [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) — ONNX inference runtime (MIT)
- Vanilla JS + Canvas 2D — no UI framework, minimal runtime, fast load

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for full license details.

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
```

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