# Contributing to PNGCut

Thanks for your interest in PNGCut — a free, private, in-browser background remover for images and video.

Bug reports, fixes, and feature ideas are welcome. The project is deliberately dependency-light and runs entirely client-side.

## Getting started

1. **Fork** the repository and clone your fork.
2. Install [Node.js 20.19+](https://nodejs.org/) (required by Vite 7).
3. Install dependencies:

   ```bash
   npm ci
   ```

   `postinstall` automatically applies the eval-free dependency patch (`scripts/apply-patches.mjs`) so the app runs under PNGCut's strict Content-Security-Policy.

4. Start the dev server:

   ```bash
   npm run dev    # http://localhost:5173
   ```

   Cross-origin isolation headers are served in dev, matching production, so multi-threaded WASM works locally.

## Available scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build |
| `npm test` | Run the Vitest suite |
| `npm run lint` | Run ESLint |
| `npm run check:patches` | Verify the inference bundle stays eval-free |
| `npm run icons` | Regenerate PWA icons (`python3 scripts/gen-icons.py`) |

## Making a change

1. Create a branch from `main`:

   ```bash
   git checkout -b my-change main
   ```

2. Make your change. Keep features client-side and free. Do not add server-side processing of user media.

3. Run the checks:

   ```bash
   npm test
   npm run lint
   npm run build
   npm run check:patches
   ```

4. Commit with a concise message in the project's conventional-commit style (e.g. `fix: ...`, `feat: ...`, `docs: ...`).

5. Push to your fork and open a draft pull request against `main`.

## Pull requests

- Link the issue this PR resolves, if there is one.
- Describe what changed and why.
- Mention how you tested it (dev server, specific file types, browsers).
- Keep PRs small and focused. One change per PR makes review faster.
- A maintainer will review and may ask for changes before merging.

## Reporting bugs

Please use the [bug report template](https://github.com/ShahabAhmed01/pngcut/issues/new?template=bug_report.yml). Include:
- Expected vs. actual behavior
- Steps to reproduce
- Browser and version
- File type/size involved (you do **not** need to share the actual media)

Do not paste private images, videos, or credentials into issues.

## Security

See [`SECURITY.md`](SECURITY.md) for the vulnerability reporting process. Do not disclose potential security issues in public issues.

## License

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE). Note that PNGCut depends on `@imgly/background-removal`, which is AGPL-3.0 — review [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) before redistributing the combined work.
