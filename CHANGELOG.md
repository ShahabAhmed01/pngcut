# Changelog

All notable changes to PNGCut are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- GitHub issue templates (bug report, feature request)
- Pull request template
- Contributing guide and Code of Conduct
- Dependabot configuration for npm and GitHub Actions
- CI concurrency controls and least-privilege permissions

### Changed
- CI dependency audit now fails on critical-severity production vulnerabilities only; known high-severity transitive issue is tracked in SECURITY.md

### Fixed
- (none yet)

## [1.2.0] - 2026-09-17

### Added
- Editorial landing polish: frosted-glass hero/upload card, ambient gradient backdrop, trust strip, glass how-cards, styled FAQ
- Background model warm-up on page load with live per-asset progress and click-to-retry
- Save-Data mode skips warm-up; uploads still trigger the shared download
- Sessions expose per-model backend (GPU/CPU) for accurate ready state

### Changed
- Pinned cache-first model serving (no re-fetch when warm)
- Per-model sessions, on-demand downloads, Auto per tab
- Reprocess on model change; removed sample image section
- Persistent dark-default theme switch

### Fixed
- Kept the ONNX stack eval-free under the strict CSP (replaced ndarray's `new Function` code generator)

## [1.1.1] - 2026-09-15

### Fixed
- Replaced `ndarray`'s `compileConstructor()` JIT generator with an eval-free implementation so `@imgly/background-removal` runs under PNGCut's CSP without `unsafe-eval`
- Unblocked ONNX Runtime `blob:` loading and hardened model load recovery
- Classified EvalError/CSP-eval failures as `MODEL_INIT_FAILED`

### Added
- Documented the eval-free dependency patch and CSP troubleshooting
- `test/patches.test.js` guarding the eval-free invariant

## [1.1.0] - 2026-09-15

### Added
- AI Models comparison page and documentation

### Fixed
- Documented CSP `blob:` requirement, engine resilience, troubleshooting

## [1.0.0] - 2026-09-11

### Added
- Initial release: free, private, in-browser background removal for images and video
- ISNet segmentation via `@imgly/background-removal` and ONNX Runtime Web
- Bulk and folder processing with single-ZIP download
- Video background removal (frame-by-frame, WebM export)
- Erase/restore brush, edge refinement, compare slider, zoom/pan
- PNG, WebP, AVIF, JPEG export; clipboard copy
- Installable PWA with offline support and service worker
