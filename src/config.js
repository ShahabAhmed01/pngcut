/**
 * Central policy + capability constants.
 *
 * This is the single source of truth for processing limits and the supported
 * format matrix. The UI, validation layer, README and static pages should all
 * derive their claims from here where practical so they never drift apart.
 */

export const APP = {
  name: "PNGCut",
  baseUrl: "https://pngcut.vercel.app/",
  sourceRepo: "https://github.com/ShahabAhmed01/pngcut",
};

/** Image policy — multiple safety dimensions, not a single byte threshold. */
export const IMAGE_POLICY = {
  /** Maximum decoded long side we will load into a working canvas. */
  maxDimension: 4000,
  /** Maximum decoded pixel count (area) we will attempt. */
  maxPixels: 32_000_000,
  /** Maximum compressed file size in bytes. */
  maxBytes: 80 * 1024 * 1024,
  /** Preview long-side used for interactive rendering (kept small for speed). */
  previewDimension: 1280,
  /** Undo history budget in bytes of alpha data. */
  undoBudgetBytes: 64 * 1024 * 1024,
};

/** Video policy. */
export const VIDEO_POLICY = {
  /** Maximum compressed file size in bytes (soft warning, not a hard block). */
  maxBytesWarn: 250 * 1024 * 1024,
  /** Hard cap on total alpha-mask storage during analysis. */
  maxMaskBytes: 500 * 1024 * 1024,
  /** Long side cap for rendered output. */
  maxOutputDimension: 1920,
  /** Default analysis/segment fps. */
  defaultFps: 24,
};

/** Bulk queue policy. */
export const BULK_POLICY = {
  maxItems: 300,
};

/**
 * Supported input image containers. This reflects what current browsers can
 * decode; actual decode success is still verified at runtime.
 */
export const IMAGE_INPUT_FORMATS = [
  { label: "PNG", mime: "image/png" },
  { label: "JPEG", mime: "image/jpeg" },
  { label: "WebP", mime: "image/webp" },
  { label: "GIF", mime: "image/gif" },
  { label: "AVIF", mime: "image/avif" },
  { label: "BMP", mime: "image/bmp" },
];

/** Video containers we let users pick; codec support is verified at runtime. */
export const VIDEO_INPUT_FORMATS = [
  { label: "MP4", mime: "video/mp4" },
  { label: "WebM", mime: "video/webm" },
];

/** Image export formats. */
export const EXPORT_FORMATS = {
  png: { label: "PNG", mime: "image/png", transparent: true, lossless: true },
  webp: { label: "WebP", mime: "image/webp", transparent: true, lossless: false },
  jpeg: { label: "JPEG", mime: "image/jpeg", transparent: false, lossless: false },
};

/**
 * The image/video MIME types we accept for processing. This is a *picker hint*,
 * not a security boundary — real validation happens in `src/validate.js`.
 */
export function pickerAccept(mimes) {
  return mimes.join(",");
}

export const IMAGE_ACCEPT = pickerAccept(IMAGE_INPUT_FORMATS.map((f) => f.mime));
export const VIDEO_ACCEPT = pickerAccept(VIDEO_INPUT_FORMATS.map((f) => f.mime));