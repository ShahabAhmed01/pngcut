/** Mask/foreground compositing. */
import { loadImage } from "./utils.js";

/**
 * Build a foreground canvas: original RGB colors with the alpha
 * channel replaced by the segmentation mask.
 * @param {HTMLCanvasElement|HTMLImageElement} source
 * @param {HTMLCanvasElement|HTMLImageElement} mask
 * @returns {HTMLCanvasElement}
 */
export function compositeForeground(source, mask) {
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, w, h);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mask, 0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}

/**
 * Load the alpha mask blob (white=keep) returned by segmentForeground into a
 * canvas sized to the source dimensions, so it can be used with
 * compositeForeground or edited with a brush.
 */
export async function maskToCanvas(maskBlob, source) {
  const img = await loadImage(maskBlob);
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}