# Free Background Remover

A free, private, **in-browser** background remover. Drop an image, and a neural
network running locally in your browser separates the subject from the
background — no signup, no uploads, no watermark, no server, no ads, no cost.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Why this is different

- **100% client-side.** The AI model runs via [ONNX Runtime Web](https://onnxruntime.ai/)
  inside the user's browser (WebGPU/WASM). Images are decoded and processed on
  the device and **never leave it**. Nothing is uploaded, so there is nothing to
  host, meter, or charge for — and nothing to leak.
- **Free forever.** No quotas, no API keys, no usage tiers.
- **No account.** No signup, no login, no email.
- **No tracking.** No analytics, no ads, no third-party scripts.

## Features

- Background removal for **PNG, JPEG, WebP, GIF, AVIF, BMP**
- High-resolution output (source resolution is preserved)
- **Erase** and **Restore** brush for fine edge refinement
- Undo / redo (20 steps)
- **Feather edges** for softer cutouts
- **Compare** slider (original vs. result)
- Zoom & pan, fit-to-screen
- Background replacement: transparent, solid color, gradient, custom image, or blurred original
- Export as **PNG (transparent)**, **WebP (transparent)** or **JPEG**
- Sample images to try instantly
- Keyboard shortcuts: `B` erase, `R` restore, `C` compare, `G` background, `Ctrl+Z` undo, `Ctrl+Shift+Z`/`Ctrl+Y` redo, `[`/`]` brush size, `Space` + drag to pan
- **SEO** out of the box: Open Graph, Twitter cards, JSON-LD (`WebApplication` + `FAQPage`), sitemap, robots.txt

## How it works

1. The image is decoded locally into a canvas.
2. [`@imgly/background-removal`](https://github.com/imgly/background-removal-js)
   downloads the ISNet segmentation model + ONNX Runtime WASM once and caches it,
   then runs inference on the device.
3. The returned alpha mask is composited with the source image; brushes edit the
   alpha channel directly for lossless-quality edits.
4. The final canvas is exported at full resolution in the requested format.

## Stack

- [Vite](https://vitejs.dev/) — build tool
- [@imgly/background-removal](https://www.npmjs.com/package/@imgly/background-removal) — in-browser background removal
- [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) — ONNX inference runtime
- Vanilla JS + Canvas 2D — no UI framework, minimal runtime, fast load

## Getting started

```bash
git clone <your-repo-url> bg-remover
cd bg-remover
npm install
npm run dev       # start dev server at http://localhost:5173
npm run build     # production build -> dist/
npm run preview   # preview production build
```

## Deploying to Vercel

The app is a static Vite site — deploy it with zero configuration:

1. Push this repo to GitHub.
2. In [Vercel](https://vercel.com), **Add New → Project**, import the repo.
3. Vercel auto-detects Vite (build command `npm run build`, output `dist`).
4. Deploy.

### Important: cross-origin isolation headers

The ONNX WASM runtime is significantly faster when
[cross-origin isolation](https://web.dev/articles/coop-coep) is enabled
(`SharedArrayBuffer` → multi-threaded WASM). `vercel.json` already sets:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

These are also set for local dev in `vite.config.js`. The app **still works** if
these headers are absent (it falls back to single-threaded WASM); it is just
slower on large images. If you self-host on another platform, add the same two
headers.

### Model hosting (optional self-hosting)

By default the model + WASM files are fetched from IMG.LY's CDN (free, CORS and
CORP enabled). To self-host them:

1. Download `https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/` (all files, retaining structure) into `public/models/`.
2. In `src/engine.js`, pass `publicPath: "/models/"` in the config.

This removes the external CDN dependency while keeping everything else identical.

## Licensing note

This repository is MIT licensed. It depends on
[`@imgly/background-removal`](https://github.com/imgly/background-removal-js),
which is licensed under **AGPL-3.0**. Review that license to understand your
obligations when redistributing or modifying the combined work; for other terms,
IMG.LY offers commercial licensing (support@img.ly).

## Roadmap ideas

- Batch processing (multiple images)
- Crop & resize tool
- Color/exposure adjustments
- Photo "matting" quality presets (small/medium/large model toggle)

## Contributing

Bug reports and pull requests are welcome. The project is deliberately
dependency-light; please keep new features client-side and free.