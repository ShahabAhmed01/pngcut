# Third-Party Notices

PNGCut itself is licensed under the MIT License (see `LICENSE`). It depends on
third-party packages and downloads assets that carry their own licenses. This
file lists them for compliance.

## Runtime dependencies

| Package | Version | License | Source |
|---|---|---|---|
| `@imgly/background-removal` | 1.7.0 | AGPL-3.0 | https://github.com/imgly/background-removal-js |
| `onnxruntime-web` | 1.21.0 | MIT | https://github.com/microsoft/onnxruntime |

`@vercel/analytics` and `@vercel/speed-insights` are MIT and loaded from
Vercel's same-origin bundle. The ZIP writer (`src/zip.js`), mask-refinement
pipeline (`src/refine.js`), service worker and PWA assets shipped with PNGCut
are original code under this repository's MIT license.

### `@imgly/background-removal` (AGPL-3.0)

This package implements the in-browser background-removal engine (model loading,
pre/post-processing and inference orchestration). It is licensed under the
GNU Affero General Public License v3.0. See the package's `LICENSE.md` for the
full text: https://github.com/imgly/background-removal-js

Because this dependency is AGPL-licensed, distributing or modifying the combined
work may carry additional obligations that the project's MIT license does not
describe. Review the AGPL license to understand these. IMG.LY offers commercial
licensing (see the upstream repository for contact details).

### `onnxruntime-web` (MIT)

ONNX Runtime Web provides the WASM/WebGPU execution of the segmentation model.
Licensed under the MIT License.

## Downloaded model assets

At runtime, PNGCut downloads the background-removal model and WASM runtime from
IMG.LY's static CDN:

- Origin: `https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/`

These assets are part of the `@imgly/background-removal` project (AGPL-3.0).
The requests do not contain any user-selected media. For self-hosting and proper
redistribution, review the IMG.LY license and distribution terms before copying
these assets into the repository.

## License summary

This listing is provided for convenience and is not legal advice. Confirm the
current licenses and terms directly with each project before redistribution.