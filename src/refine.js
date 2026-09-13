/**
 * Mask refinement — deterministic post-processing of the raw ISNet alpha mask
 * to visibly improve cutout quality *before* manual editing.
 *
 * Why: the model's raw probabilities are excellent but carry typical
 * segmentation artifacts — semi-transparent "halo" bands around the subject,
 * speckle noise, and jagged binary steps at hard edges. A small, fast, purely
 * local post-process fixes all three:
 *
 *   1. median3   — 3×3 median filter: kills isolated misclassified speckles
 *   2. box blur  — separable, O(n): smooths jagged steps into clean curves
 *   3. contrast  — sigmoid curve: pushes ambiguous mid-alphas toward 0/255
 *                  (removes halos) while keeping legit soft edges (hair)
 *   4. smoothstep— optional crisp threshold with a soft transition band
 *
 * All functions are PURE and operate on a single-channel alpha buffer
 * (255 = keep foreground), so they run without a DOM and are unit tested.
 * Canvas glue lives in `refineMaskCanvas` (browser-only).
 */

/** Presets exposed in the UI ("Edge refinement" control). */
export const REFINE_PRESETS = {
  off: null, // raw model mask, untouched
  auto: { denoise: false, smooth: 1, steepness: 7 },
  crisp: { denoise: true, smooth: 1, steepness: 14, threshold: 0.5, band: 0.14 },
  soft: { denoise: false, smooth: 2, steepness: 3 },
};

export const REFINE_ORDER = ["auto", "crisp", "soft", "off"];

/**
 * 3×3 median filter over the alpha channel. Removes salt-and-pepper speckles
 * without softening real edges (a median preserves step transitions).
 * @param {Uint8ClampedArray} alpha
 * @param {number} width
 * @param {number} height
 * @returns {Uint8ClampedArray} new buffer
 */
export function median3(alpha, width, height) {
  const out = new Uint8ClampedArray(alpha.length);
  const win = new Uint8Array(9);
  for (let y = 0; y < height; y++) {
    const y0 = y > 0 ? y - 1 : 0;
    const y2 = y < height - 1 ? y + 1 : height - 1;
    for (let x = 0; x < width; x++) {
      const x0 = x > 0 ? x - 1 : 0;
      const x2 = x < width - 1 ? x + 1 : width - 1;
      let k = 0;
      for (let yy = y0; yy <= y2; yy++) {
        const row = yy * width;
        win[k++] = alpha[row + x0];
        win[k++] = alpha[row + x];
        win[k++] = alpha[row + x2];
      }
      out[y * width + x] = median9(win);
    }
  }
  return out;
}

/**
 * Median of 9 bytes via adaptive insertion sort, then take the middle.
 * Provably correct for every input (unlike ad-hoc sorting networks) and comparably
 * fast for image windows: ~18 comparisons on random data, fewer on nearly-sorted
 * windows, which are the common case in real masks.
 */
export function median9(w) {
  for (let i = 1; i < 9; i++) {
    const v = w[i];
    let j = i - 1;
    while (j >= 0 && w[j] > v) {
      w[j + 1] = w[j];
      j--;
    }
    w[j + 1] = v;
  }
  return w[4];
}

/**
 * Separable box blur over alpha (radius in px, ≥1). Two passes with a running
 * sum so cost is O(n) regardless of radius. Edge pixels use clamped indexing
 * (repeat-edge), which avoids transparent fringes at the image border.
 * @returns {Uint8ClampedArray} new buffer
 */
export function boxBlurAlpha(alpha, width, height, radius) {
  const r = Math.max(1, Math.floor(radius));
  const tmp = new Uint8ClampedArray(alpha.length);
  const out = new Uint8ClampedArray(alpha.length);
  const span = 2 * r + 1;

  // horizontal
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += alpha[row + Math.min(width - 1, Math.max(0, i))];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = Math.round(sum / span);
      const add = alpha[row + Math.min(width - 1, x + r + 1)];
      const rem = alpha[row + Math.max(0, x - r)];
      sum += add - rem;
    }
  }
  // vertical
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += tmp[Math.min(height - 1, Math.max(0, i)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = Math.round(sum / span);
      const add = tmp[Math.min(height - 1, y + r + 1) * width + x];
      const rem = tmp[Math.max(0, y - r) * width + x];
      sum += add - rem;
    }
  }
  return out;
}

/**
 * Sigmoid contrast curve as a 256-entry LUT. `steepness` 0 → identity;
 * higher values push mid-alphas harder toward 0/255 (halo removal).
 * `center` is the decision point in 0..1. The LUT is normalized so 0 → 0 and
 * 255 → 255 exactly (transparent stays transparent, opaque stays opaque).
 * @returns {Uint8ClampedArray} new buffer
 */
export function contrastCurve(alpha, steepness, center = 0.5) {
  const k = Math.max(0, Number(steepness) || 0);
  const out = new Uint8ClampedArray(alpha.length);
  if (k === 0) {
    out.set(alpha); // identity: steepness 0 must not distort the mask
    return out;
  }
  const s = (t) => 1 / (1 + Math.exp(-k * (t - center)));
  // Range-normalize so 0 → 0 and 255 → 255 exactly: transparent stays
  // transparent, opaque stays opaque, regardless of steepness/center.
  const lo = s(0);
  const scale = 255 / (s(1) - lo);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v <= 255; v++) lut[v] = Math.round((s(v / 255) - lo) * scale);
  lut[0] = 0;
  lut[255] = 255;
  for (let i = 0; i < alpha.length; i++) out[i] = lut[alpha[i]];
  return out;
}

/**
 * Smoothstep threshold as LUT: decision at `center` (0..1) with a soft
 * transition band on each side. Crisper than contrast but never staircase-hard.
 * @returns {Uint8ClampedArray} new buffer
 */
export function smoothstepAlpha(alpha, center = 0.5, band = 0.14) {
  const b = Math.max(0.01, Math.min(0.5, band));
  const lo = Math.max(0, center - b);
  const hi = Math.min(1, center + b);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    if (t <= lo) lut[v] = 0;
    else if (t >= hi) lut[v] = 255;
    else {
      const x = (t - lo) / (hi - lo);
      lut[v] = Math.round(255 * x * x * (3 - 2 * x));
    }
  }
  const out = new Uint8ClampedArray(alpha.length);
  for (let i = 0; i < alpha.length; i++) out[i] = lut[alpha[i]];
  return out;
}

/**
 * Full refinement pipeline. Returns a NEW buffer; input is never mutated.
 * @param {Uint8ClampedArray} alpha
 * @param {number} width
 * @param {number} height
 * @param {{denoise?: boolean, smooth?: number, steepness?: number, center?: number, threshold?: number, band?: number}} options
 */
export function refineAlpha(alpha, width, height, options = {}) {
  let buf = new Uint8ClampedArray(alpha); // copy; input stays intact
  if (options.denoise) buf = median3(buf, width, height);
  if (options.smooth > 0) buf = boxBlurAlpha(buf, width, height, options.smooth);
  if (options.steepness > 0) buf = contrastCurve(buf, options.steepness, options.center ?? 0.5);
  if (options.threshold != null) buf = smoothstepAlpha(buf, options.threshold, options.band);
  return buf;
}

/**
 * Browser glue: apply a preset to an RGBA mask canvas whose *alpha* channel is
 * the cutout (RGB constant white). Returns a new canvas.
 * @param {HTMLCanvasElement} maskCanvas
 * @param {string} presetName
 * @returns {HTMLCanvasElement} refined mask (same dimensions)
 */
export function refineMaskCanvas(maskCanvas, presetName = "auto") {
  const preset = REFINE_PRESETS[presetName] || null;
  const w = maskCanvas.width;
  const h = maskCanvas.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;

  // Start from the raw mask, copied 1:1
  const ctx = out.getContext("2d");
  ctx.drawImage(maskCanvas, 0, 0, w, h);

  if (!preset) return out; // "off": untouched copy

  const img = ctx.getImageData(0, 0, w, h);
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = img.data[j];

  const refined = refineAlpha(alpha, w, h, preset);
  for (let i = 0, j = 3; i < refined.length; i++, j += 4) img.data[j] = refined[i];
  ctx.putImageData(img, 0, 0);
  return out;
}
