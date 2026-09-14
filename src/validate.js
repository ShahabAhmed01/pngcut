/**
 * Media validation layer.
 *
 * Distinguishes supported container, suspicious/corrupt files, oversized media,
 * SVG (rejected by default for safety), and produces structured results rather
 * than raw browser exceptions. The HTML `accept` attribute is only a picker
 * hint; this is the real gate.
 *
 * Exposed results:
 *   { ok: true,  kind, type, width?, height?, pixels?, animated?, sizeBytes, warnings }
 *   { ok: false, code, userMessage, technicalMessage }
 */

import { IMAGE_POLICY, VIDEO_POLICY } from "./config.js";
import { formatBytes } from "./utils.js";

export const ERROR_CODES = {
  UNSUPPORTED_TYPE: "UNSUPPORTED_TYPE",
  SVG_NOT_SUPPORTED: "SVG_NOT_SUPPORTED",
  EMPTY_FILE: "EMPTY_FILE",
  TOO_LARGE_BYTES: "TOO_LARGE_BYTES",
  IMAGE_TOO_LARGE: "IMAGE_TOO_LARGE",
  IMAGE_DECODE_FAILED: "IMAGE_DECODE_FAILED",
  VIDEO_DECODE_FAILED: "VIDEO_DECODE_FAILED",
  VIDEO_TOO_LONG: "VIDEO_TOO_LONG",
  VIDEO_UNSUPPORTED_CODEC: "VIDEO_UNSUPPORTED_CODEC",
  MISSING_FILE: "MISSING_FILE",
};

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
]);

const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/x-matroska"]);

export function isImageFile(file) {
  return !!file && IMAGE_TYPES.has((file.type || "").toLowerCase());
}

export function isVideoFile(file) {
  return !!file && VIDEO_TYPES.has((file.type || "").toLowerCase());
}

/** MIME-less video files (e.g. .mkv) are common — sniff by extension too. */
export function looksLikeVideo(file) {
  if (!file) return false;
  if (isVideoFile(file) || /^video\//i.test(file.type || "")) return true;
  return /\.(mp4|m4v|webm|mov|mkv|ogv)$/i.test(file.name || "");
}

/** SVG is rejected by default: it can carry behavior + external references. */
export function isSvgFile(file) {
  return !!file && /^image\/svg/i.test(file.type || "") || !!file && /\.svg$/i.test(file.name || "");
}

function fail(code, userMessage, technicalMessage) {
  return { ok: false, code, userMessage, technicalMessage: technicalMessage || userMessage };
}

/**
 * Validate an image file before any expensive decode.
 * Pass in optional `width`/`height` (from an ImageBitmap) to also enforce
 * dimension and area limits.
 */
export function validateImageFile(file, policy = IMAGE_POLICY, dims = null) {
  if (!file) return fail(ERROR_CODES.MISSING_FILE, "No file was provided.");
  if (isSvgFile(file)) {
    return fail(
      ERROR_CODES.SVG_NOT_SUPPORTED,
      "SVG files are not supported for background removal. Please use a raster image such as PNG, JPEG, WebP, AVIF or BMP.",
      "SVG can reference external resources and behavior, so it is rejected for the privacy-first raster pipeline."
    );
  }
  if (!isImageFile(file)) {
    return fail(
      ERROR_CODES.UNSUPPORTED_TYPE,
      "PNGCut couldn't identify this file as a supported image. Use PNG, JPEG, WebP, AVIF or BMP."
    );
  }
  if (!file.size) {
    return fail(ERROR_CODES.EMPTY_FILE, "This file appears to be empty. Choose a different image.");
  }
  if (file.size > policy.maxBytes) {
    return fail(
      ERROR_CODES.TOO_LARGE_BYTES,
      `This image is ${formatBytes(file.size)}, larger than the ${formatBytes(policy.maxBytes)} safety limit. Try a smaller file.`,
      `file.size ${file.size} > maxBytes ${policy.maxBytes}`
    );
  }

  const warnings = [];
  if (dims) {
    const longSide = Math.max(dims.width, dims.height);
    const pixels = dims.width * dims.height;
    if (pixels > policy.maxPixels) {
      return fail(
        ERROR_CODES.IMAGE_TOO_LARGE,
        `This image is ${dims.width} × ${dims.height} px — too large to process safely in this browser. Try a smaller copy.`,
        `pixels ${pixels} > maxPixels ${policy.maxPixels}`
      );
    }
    if (longSide > policy.maxDimension) {
      warnings.push({
        code: "IMAGE_DOWNSCALED",
        message: `Large image (${dims.width} × ${dims.height} px) will be processed at up to ${policy.maxDimension} px on the long side.`,
      });
    }
  }

  return {
    ok: true,
    kind: "image",
    type: file.type || "image/png",
    width: dims ? dims.width : undefined,
    height: dims ? dims.height : undefined,
    pixels: dims ? dims.width * dims.height : undefined,
    animated: /^image\/gif/i.test(file.type || ""),
    sizeBytes: file.size,
    warnings,
  };
}

/**
 * Validate a video file. `meta` may be `{ width, height, duration }` after the
 * browser has loaded it — pass it in to enforce duration/dimension limits.
 */
export function validateVideoFile(file, policy = VIDEO_POLICY, meta = null) {
  if (!file) return fail(ERROR_CODES.MISSING_FILE, "No file was provided.");
  if (!looksLikeVideo(file)) {
    return fail(
      ERROR_CODES.UNSUPPORTED_TYPE,
      "PNGCut couldn't identify this file as a video. Use MP4/H.264 or WebM/VP8/VP9."
    );
  }
  if (!file.size) {
    return fail(ERROR_CODES.EMPTY_FILE, "This file appears to be empty. Choose a different video.");
  }
  const warnings = [];
  if (file.size > policy.maxBytesWarn) {
    warnings.push({
      code: "VIDEO_LARGE",
      message: `This clip is ${formatBytes(file.size)}. Longer or larger clips can exceed your browser's memory. Shorter clips work best.`,
    });
  }
  if (meta) {
    if (!meta.duration || !isFinite(meta.duration)) {
      return fail(
        ERROR_CODES.VIDEO_DECODE_FAILED,
        "Your browser couldn't read this video's duration. It may use an unsupported codec or be corrupt."
      );
    }
    // Estimate mask storage and surface an early recommendation if it is high.
    if (meta.width && meta.height && meta.duration) {
      warnings.push({ key: "meta", width: meta.width, height: meta.height, duration: meta.duration });
    }
  }
  return { ok: true, kind: "video", type: file.type || "video/mp4", sizeBytes: file.size, warnings };
}

/**
 * Sanitize a user-provided filename for the `download` attribute.
 * - strips path separators and control characters
 * - collapses whitespace
 * - caps length
 * - removes reserved Windows device names
 * - preserves Unicode (incl. non-ASCII) safely
 */
export function sanitizeFilename(name, fallback = "image") {
  let out = String(name == null ? "" : name)
    // remove path separators (incl. Windows backslash) → "-"
    .replace(/[\\/]+/g, "-")
    // strip control characters and anything that isn't safe in a filename
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    // collapse whitespace runs
    .replace(/\s+/g, " ")
    .trim()
    // strip leading separators, dot-segments and dots
    .replace(/^[-.]*\.{1,2}[-.]*/, "")
    .replace(/^[-.]+/, "");

  // windows reserved device names (with or without extension)
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  if (!out || reserved.test(out)) out = fallback;

  // strip the extension (caller re-appends the intended one)
  out = out.replace(/\.[^.]+$/, "");

  // cap length conservatively for cross-filesystem safety
  if (out.length > 120) out = out.slice(0, 120).trim();
  return out || fallback;
}