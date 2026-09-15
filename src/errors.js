/**
 * Structured error model — actionable, user-facing recovery messages mapped to
 * stable error codes. Never show raw browser exception text to users.
 */

export const ErrorCode = {
  MODEL_DOWNLOAD_FAILED: "MODEL_DOWNLOAD_FAILED",
  MODEL_INIT_FAILED: "MODEL_INIT_FAILED",
  WEBGPU_UNAVAILABLE: "WEBGPU_UNAVAILABLE",
  INFERENCE_FAILED: "INFERENCE_FAILED",
  IMAGE_TOO_LARGE: "IMAGE_TOO_LARGE",
  IMAGE_DECODE_FAILED: "IMAGE_DECODE_FAILED",
  VIDEO_DECODE_FAILED: "VIDEO_DECODE_FAILED",
  VIDEO_UNSUPPORTED_CODEC: "VIDEO_UNSUPPORTED_CODEC",
  OUT_OF_MEMORY: "OUT_OF_MEMORY",
  EXPORT_FAILED: "EXPORT_FAILED",
  UNKNOWN: "UNKNOWN",
};

const MESSAGES = {
  [ErrorCode.MODEL_DOWNLOAD_FAILED]: {
    title: "The AI model could not be loaded",
    body: "Check your connection and try again. If you already used PNGCut once on this device, the model may still be cached and usable offline.",
  },
  [ErrorCode.MODEL_INIT_FAILED]: {
    title: "The AI model failed to start",
    body: "PNGCut couldn't initialize the background-removal model in this browser. Try reloading the page or a Chromium-based browser. Self-hosting? Check that your Content-Security-Policy allows WebAssembly and blob: scripts.",
  },
  [ErrorCode.WEBGPU_UNAVAILABLE]: {
    title: "GPU acceleration is unavailable",
    body: "PNGCut will fall back to CPU mode, which still works locally but may be slower.",
  },
  [ErrorCode.INFERENCE_FAILED]: {
    title: "Background removal failed for this file",
    body: "PNGCut couldn't process this image. Try a different image, or a smaller copy. Nothing was uploaded.",
  },
  [ErrorCode.IMAGE_TOO_LARGE]: {
    title: "Image too large for this device",
    body: "This image is larger than can be processed safely in your browser at once. Try a smaller copy.",
  },
  [ErrorCode.IMAGE_DECODE_FAILED]: {
    title: "PNGCut couldn't decode this image",
    body: "Try PNG, JPEG, WebP, AVIF or BMP — the file may be corrupt or in an unsupported format.",
  },
  [ErrorCode.VIDEO_DECODE_FAILED]: {
    title: "PNGCut couldn't decode this video",
    body: "Your browser may not support this codec. Try MP4/H.264 or WebM/VP8/VP9.",
  },
  [ErrorCode.VIDEO_UNSUPPORTED_CODEC]: {
    title: "Unsupported video codec",
    body: "Your browser can open this video only partially and cannot reliably render it for export. Try MP4/H.264 or WebM/VP8/VP9.",
  },
  [ErrorCode.OUT_OF_MEMORY]: {
    title: "Your browser ran out of memory",
    body: "PNGCut stopped safely and did not upload the file. Try a smaller image or lower video settings.",
  },
  [ErrorCode.EXPORT_FAILED]: {
    title: "Export failed",
    body: "PNGCut couldn't create the output file. Try a different format or a smaller image.",
  },
  [ErrorCode.UNKNOWN]: {
    title: "Something went wrong",
    body: "PNGCut hit an unexpected problem. Please try again, or report it via Support.",
  },
};

export function describeError(code, fallback = null) {
  const entry = MESSAGES[code] || MESSAGES[ErrorCode.UNKNOWN];
  return fallback ? { ...entry, body: fallback } : entry;
}

/**
 * Classify a thrown error/caught value into a stable ErrorCode without leaking
 * raw exception details. Detection is heuristic but conservative.
 */
export function classifyError(err) {
  const msg = String((err && err.message) || err || "").toLowerCase();
  if (/(out of memory|memory limit|rangeerror)/.test(msg)) return ErrorCode.OUT_OF_MEMORY;
  // Dynamic string evaluation blocked by CSP (any policy without
  // 'unsafe-eval'). Surfaced by JIT-style code generators in the inference
  // stack; PNGCut patches the one we ship, so this usually means a
  // self-hosted CSP regression rather than an end-user problem.
  if (/(evalerror|unsafe-eval|evaluating a string|content security policy|refused to (load|execute))/.test(msg)) {
    return ErrorCode.MODEL_INIT_FAILED;
  }
  if (/decod|could not (load|open|read)|invalid image|cannot render/.test(msg)) {
    return ErrorCode.IMAGE_DECODE_FAILED;
  }
  if (/webgpu|gpu|adapter|shader/.test(msg)) return ErrorCode.WEBGPU_UNAVAILABLE;
  if (/network|failed to fetch|fetch|download|404|timeout/.test(msg)) return ErrorCode.MODEL_DOWNLOAD_FAILED;
  return ErrorCode.UNKNOWN;
}