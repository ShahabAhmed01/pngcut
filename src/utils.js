/** Canvas + image helpers */

/** Load an HTMLImageElement from a File/Blob via object URL. */
export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      // Reject with a real Error (mapped by classifyError), never a bare Event.
      URL.revokeObjectURL(url);
      reject(new Error("Image decode failed — the file may be corrupt or in an unsupported format."));
    };
    img.src = url;
  });
}

/** Width/height of a decoded image. */
export function sizeOf(image) {
  if (image instanceof ImageBitmap) {
    return { width: image.width, height: image.height };
  }
  return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
}

/**
 * Draw an image to a canvas, downscaling so the largest side does not exceed
 * `maxDim` (keeps browser memory in check for huge photos).
 */
export function toCanvasMax(image, maxDim = 4000) {
  const { width, height } = sizeOf(image);
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, w, h);
  return canvas;
}

/** Convert a canvas to a blob with a fallback for older browsers. */
export function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve) => {
    if (canvas.toBlob) {
      canvas.toBlob(resolve, type, quality);
    } else {
      const dataURL = canvas.toDataURL(type, quality);
      const bin = atob(dataURL.split(",")[1]);
      const len = bin.length;
      const arr = new Uint8Array(len);
      for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
      resolve(new Blob([arr], { type }));
    }
  });
}

/** Format a byte count as human-readable. */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/** Clamp helper. */
export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/** Download a blob as a file. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Build a checkerboard pattern canvas for transparency preview. */
export function checkerboardPattern(size = 16, light = "#e8e8e8", dark = "#cacaca") {
  const canvas = document.createElement("canvas");
  canvas.width = size * 2;
  canvas.height = size * 2;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, size * 2, size * 2);
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, size, size);
  ctx.fillRect(size, size, size, size);
  return ctx.createPattern(canvas, "repeat");
}

/**
 * Probe whether `canvas.toBlob` really encodes a MIME type. Browsers *fall
 * back silently* to PNG for unsupported types, so the returned blob's type
 * must equal the request — that's the only reliable signal.
 * (Used for the optional AVIF export option.)
 * @returns {Promise<boolean>}
 */
export function canEncodeMime(mime) {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      if (typeof canvas.toBlob !== "function") {
        resolve(false);
        return;
      }
      canvas.toBlob((blob) => resolve(!!blob && blob.type === mime), mime, 0.8);
    } catch {
      resolve(false);
    }
  });
}

/** True if the browser can encode AVIF (probed once, memoized). */
let avifSupport = null;
export async function supportsAvifExport() {
  if (avifSupport == null) avifSupport = await canEncodeMime("image/avif");
  return avifSupport;
}