/**
 * Editor — holds the full-resolution source + mask, applies brush edits,
 * backgrounds and renders a zoomable/panning preview.
 *
 * Mask model: a solid-white RGBA canvas whose *alpha* channel is the cutout
 * mask (255 = keep, 0 = remove). The foreground is produced by taking the
 * source RGB and applying the mask alpha via `destination-in`.
 *
 * Refinement: the raw model mask (`rawMaskCanvas`) is post-processed by
 * src/refine.js according to `refinePreset` before editing; brushes then edit
 * the refined mask directly. Changing the preset re-derives the mask from the
 * raw output (brush history resets, like re-running the auto mask).
 *
 * Brushes only mutate the alpha channel:
 *   - "erase" lowers alpha (destination-out, soft round stamp)
 *   - "restore" raises alpha back to opaque (source-over, soft white stamp)
 *
 * Performance: the composited foreground is cached in `_fgCanvas` and updated
 * incrementally (dirty-rect only) while painting, so strokes stay smooth on
 * multi-megapixel images. The background layer is cached per bg version.
 */

import { renderBackground } from "./background.js";
import { checkerboardPattern, loadImage } from "./utils.js";
import { REFINE_PRESETS, refineMaskCanvas } from "./refine.js";
import { IMAGE_POLICY } from "./config.js";

export class Editor {
  constructor() {
    this.sourceCanvas = null; // original, full resolution
    this.rawMaskCanvas = null; // untouched model output
    this.maskCanvas = null; // refined + brush-editable alpha mask
    this.refinePreset = "auto";

    this.background = { type: "transparent" };

    this.feather = 0; // px of edge blur applied at composite time
    this._featheredMask = null;
    this._featherCacheKey = "";

    // view transform (screen-space)
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.fitScale = 1;

    this.brush = { tool: "erase", size: 40, hardness: 0.8 };

    // undo stack of mask alpha buffers
    this._undo = [];
    this._redo = [];
    this._undoBudget = IMAGE_POLICY.undoBudgetBytes;

    // cached foreground (source ⊗ mask) + background layer
    this._fgCanvas = null;
    this._fgValid = false;
    this._fgDirty = null; // pending rect while painting
    this._fgMaskKind = ""; // "raw" | "feathered" — which mask built the cache
    this._bgCanvas = null;
    this._bgKey = "";
    this._bgVersion = 0;
    this._renderPending = false;

    this.viewport = null;
    this._checker = null;
    this._pointer = null;
    this._onChange = null;
    this._painting = false;
    this._lastPoint = null;
    this._compare = 0; // 0..1 divider position (0 = hidden)
    this._compareMode = false;

    this._dirty = true;
  }

  width() {
    return this.sourceCanvas ? this.sourceCanvas.width : 0;
  }
  height() {
    return this.sourceCanvas ? this.sourceCanvas.height : 0;
  }

  setSource(canvas) {
    this.sourceCanvas = canvas;
    this._resetMaskState();
  }

  _resetMaskState() {
    this.maskCanvas = null;
    this.rawMaskCanvas = null;
    this._undo = [];
    this._redo = [];
    this._featheredMask = null;
    this._featherCacheKey = "";
    this._fgCanvas = null;
    this._fgValid = false;
    this._fgDirty = null;
    this._fgMaskKind = "";
    this._bgCanvas = null;
    this._bgKey = "";
    this._bgVersion = 0;
    this._dirty = true;
  }

  _maxUndoSteps() {
    const px = this.width() * this.height();
    if (!px) return 20;
    return Math.max(1, Math.floor(this._undoBudget / px));
  }

  /**
   * Replace the raw mask from a segmentation result (white=keep), then apply
   * the active refinement preset to produce the editable mask.
   */
  async setMaskFromBlob(blob, preset = this.refinePreset) {
    const img = await loadImage(blob);
    const w = this.width();
    const h = this.height();
    const raw = document.createElement("canvas");
    raw.width = w;
    raw.height = h;
    const ctx = raw.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(img, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    // Decode and refine before committing; failures must preserve edits/history.
    const refinePreset = preset in REFINE_PRESETS ? preset : "auto";
    const mask = refineMaskCanvas(raw, refinePreset);
    this.rawMaskCanvas = raw;
    this.maskCanvas = mask;
    this.refinePreset = refinePreset;
    this._undo = [];
    this._redo = [];
    this._invalidateFeather();
    this._invalidateFg();
    this._emit();
  }

  /** Re-derive the editable mask from the raw model output (resets history). */
  setRefine(preset) {
    this.refinePreset = preset in REFINE_PRESETS ? preset : "auto";
    this._applyRefine();
    return this.refinePreset;
  }

  _applyRefine() {
    if (!this.rawMaskCanvas) return;
    this.maskCanvas = refineMaskCanvas(this.rawMaskCanvas, this.refinePreset);
    this._undo = [];
    this._redo = [];
    this._invalidateFeather();
    this._invalidateFg();
    this._emit();
  }

  _invalidateFeather() {
    this._featheredMask = null;
    this._featherCacheKey = "";
    this._dirty = true;
  }

  /** Full foreground-cache invalidation (mask or feather changed globally). */
  _invalidateFg() {
    this._fgValid = false;
    this._fgDirty = null;
    this._fgMaskKind = "";
    this._dirty = true;
  }

  onChange(cb) {
    this._onChange = cb;
  }
  _emit() {
    if (this._onChange) this._onChange();
  }

  // ---- Brushes -----------------------------------------------------------

  setBrushTool(tool) {
    this.brush.tool = tool === "restore" ? "restore" : "erase";
  }
  setBrushSize(size) {
    this.brush.size = Math.max(2, Math.min(400, Number(size) || this.brush.size));
  }
  /** Public helper for keyboard `[` / `]` adjustments. */
  adjustBrushSize(delta) {
    this.setBrushSize(this.brush.size + delta);
  }
  setBrushHardness(h) {
    this.brush.hardness = Math.max(0, Math.min(1, h));
  }

  // Public introspection (main.js must not reach into privates)
  canUndo() {
    return this._undo.length > 0;
  }
  canRedo() {
    return this._redo.length > 0;
  }
  isPainting() {
    return this._painting;
  }

  /** Public accessor for viewport dimensions (replaces private field access). */
  viewportSize() {
    return { w: this._viewportW, h: this._viewportH };
  }

  setFeather(px) {
    this.feather = Math.max(0, px);
    this._invalidateFeather();
    this._invalidateFg();
    this._emit();
  }

  undo() {
    if (!this._undo.length || !this.maskCanvas) return;
    const current = this._alphaBuffer();
    this._redo.push(current);
    const prev = this._undo.pop();
    this._applyAlphaBuffer(prev);
    this._invalidateFeather();
    this._invalidateFg();
    this._emit();
  }

  redo() {
    if (!this._redo.length || !this.maskCanvas) return;
    const current = this._alphaBuffer();
    this._undo.push(current);
    const next = this._redo.pop();
    this._applyAlphaBuffer(next);
    this._invalidateFeather();
    this._invalidateFg();
    this._emit();
  }

  _alphaBuffer() {
    const ctx = this.maskCanvas.getContext("2d");
    const data = ctx.getImageData(0, 0, this.width(), this.height()).data;
    const alpha = new Uint8ClampedArray(this.width() * this.height());
    for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = data[j];
    return alpha;
  }

  _applyAlphaBuffer(alpha) {
    const ctx = this.maskCanvas.getContext("2d");
    const img = ctx.getImageData(0, 0, this.width(), this.height());
    for (let i = 0, j = 3; i < alpha.length; i++, j += 4) img.data[j] = alpha[i];
    ctx.putImageData(img, 0, 0);
  }

  beginStroke(x, y) {
    // x,y in image-space coordinates
    if (!this.maskCanvas) return;
    this._undo.push(this._alphaBuffer());
    while (this._undo.length > this._maxUndoSteps()) this._undo.shift();
    this._redo = [];
    this._painting = true;
    this._fgDirty = null;
    this._lastPoint = { x, y };
    this._stamp(x, y);
  }

  moveStroke(x, y) {
    if (!this._painting || !this.maskCanvas) return;
    const last = this._lastPoint;
    const dist = Math.hypot(x - last.x, y - last.y);
    const step = Math.max(1, this.brush.size / 4);
    const n = Math.ceil(dist / step);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      this._stamp(last.x + (x - last.x) * t, last.y + (y - last.y) * t);
    }
    this._lastPoint = { x, y };
  }

  endStroke() {
    if (!this._painting) return;
    this._painting = false;
    this._lastPoint = null;
    this._invalidateFeather();
    if (this.feather > 0) {
      // The feathered composite can't be updated incrementally — rebuild fully.
      this._invalidateFg();
    }
    // With feather 0 the dirty-rect updates were pixel-exact, so the cached
    // foreground stays valid and blending continues instantly.
    this._emit();
  }

  _stamp(x, y) {
    const ctx = this.maskCanvas.getContext("2d");
    const r = this.brush.size / 2;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const inner = this.brush.hardness;
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(inner, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save();
    ctx.globalCompositeOperation = this.brush.tool === "restore" ? "source-over" : "destination-out";
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this._markFgDirty(x - r, y - r, this.brush.size, this.brush.size);
    this._requestRender();
  }

  /**
   * While painting, record the stamp region so `render` can update the cached
   * foreground incrementally instead of recompositing the whole image.
   * Inflated by the feather radius + margin in case a feathered mask is in use.
   */
  _markFgDirty(x, y, w, h) {
    if (!this._fgValid) return; // full rebuild pending — rect tracking moot
    const m = Math.ceil(this.feather) + 2;
    const x0 = Math.max(0, Math.floor(x - m));
    const y0 = Math.max(0, Math.floor(y - m));
    const x1 = Math.min(this.width(), Math.ceil(x + w + m));
    const y1 = Math.min(this.height(), Math.ceil(y + h + m));
    if (x1 <= x0 || y1 <= y0) return;
    const d = this._fgDirty;
    this._fgDirty = d
      ? {
          x: Math.min(d.x, x0),
          y: Math.min(d.y, y0),
          w: Math.max(d.x + d.w, x1) - Math.min(d.x, x0),
          h: Math.max(d.y + d.h, y1) - Math.min(d.y, y0),
        }
      : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** rAF-throttled live preview during strokes (cheap thanks to dirty rects). */
  _requestRender() {
    if (this._renderPending) return;
    this._renderPending = true;
    requestAnimationFrame(() => {
      this._renderPending = false;
      this.render();
    });
  }

  // ---- Background --------------------------------------------------------

  setBackground(bg) {
    this.background = { ...this.background, ...bg };
    this._bgVersion++; // invalidates the cached background layer
    this._emit();
  }

  /**
   * Cached background layer: rendered only when the bg settings or size change
   * (key = dimensions + `_bgVersion`), instead of on every frame.
   */
  _getBackground() {
    const w = this.width();
    const h = this.height();
    if (!this._bgCanvas) {
      this._bgCanvas = document.createElement("canvas");
      this._bgCanvas.width = w;
      this._bgCanvas.height = h;
    }
    const key = `${w}x${h}:v${this._bgVersion}`;
    if (this._bgKey !== key) {
      renderBackground(this.background, w, h, this.sourceCanvas, this._bgCanvas);
      this._bgKey = key;
    }
    return this._bgCanvas;
  }

  /**
   * Cached foreground (source ⊗ mask).
   *
   * `kind` describes which mask variant built the cache: while painting we
   * composite from the crisp raw mask (fast dirty-rect updates; a live
   * feathered rebuild per move would be far too slow), otherwise from the
   * feathered mask. A kind switch triggers exactly one full rebuild.
   *
   * @param {HTMLCanvasElement} maskSource mask canvas to apply
   * @param {"raw"|"feathered"} kind which mask variant `maskSource` is
   * @returns {HTMLCanvasElement|null}
   */
  _getForeground(maskSource, kind = "feathered") {
    if (!this.sourceCanvas || !this.maskCanvas) return null;
    const w = this.width();
    const h = this.height();
    if (!this._fgCanvas) {
      this._fgCanvas = document.createElement("canvas");
      this._fgCanvas.width = w;
      this._fgCanvas.height = h;
    }
    const fg = this._fgCanvas;
    const ctx = fg.getContext("2d");

    if (this._fgValid && this._fgMaskKind !== kind) this._invalidateFg();

    if (!this._fgValid) {
      // full rebuild
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(this.sourceCanvas, 0, 0, w, h);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(maskSource, 0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      this._fgValid = true;
      this._fgMaskKind = kind;
      this._fgDirty = null;
    } else if (this._fgDirty) {
      // incremental dirty-rect update (painting path)
      const d = this._fgDirty;
      ctx.clearRect(d.x, d.y, d.w, d.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(d.x, d.y, d.w, d.h);
      ctx.clip();
      ctx.drawImage(this.sourceCanvas, d.x, d.y, d.w, d.h, d.x, d.y, d.w, d.h);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(maskSource, d.x, d.y, d.w, d.h, d.x, d.y, d.w, d.h);
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
      this._fgDirty = null;
    }
    return fg;
  }

  // ---- Compare -----------------------------------------------------------

  /** Set compare mode (original vs result split view). */
  setCompare(enabled, divider = 0.5) {
    this._compareMode = enabled;
    this._compare = Math.max(0, Math.min(1, divider));
    this._emit();
  }

  // ---- Viewport ----------------------------------------------------------

  attachViewport(canvas) {
    this.viewport = canvas;
    this._resize();
  }

  _resize() {
    if (!this.viewport) return;
    const rect = this.viewport.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.viewport.width = Math.max(1, Math.round(rect.width * dpr));
    this.viewport.height = Math.max(1, Math.round(rect.height * dpr));
    this._viewportDpr = dpr;
    this._viewportW = rect.width;
    this._viewportH = rect.height;
    this._dirty = true;
  }

  layout() {
    this._resize();
    this.fit();
  }

  fit() {
    if (!this.width() || !this._viewportW) return;
    const pad = 32;
    this.fitScale = Math.min(
      (this._viewportW - pad) / this.width(),
      (this._viewportH - pad) / this.height()
    );
    this.scale = this.fitScale;
    this.tx = (this._viewportW - this.width() * this.scale) / 2;
    this.ty = (this._viewportH - this.height() * this.scale) / 2;
    this._dirty = true;
  }

  /** Zoom about a screen point. */
  zoom(factor, sx, sy) {
    const oldScale = this.scale;
    this.scale = Math.max(0.05, Math.min(32, this.scale * factor));
    const k = this.scale / oldScale;
    this.tx = sx - (sx - this.tx) * k;
    this.ty = sy - (sy - this.ty) * k;
    this._dirty = true;
  }

  pan(dx, dy) {
    this.tx += dx;
    this.ty += dy;
    this._dirty = true;
  }

  screenToImage(sx, sy) {
    return {
      x: (sx - this.tx) / this.scale,
      y: (sy - this.ty) / this.scale,
    };
  }

  _checkerPattern() {
    return this._checker || (this._checker = checkerboardPattern(14));
  }

  /** Returns the (possibly feathered) mask canvas used for compositing. */
  _currentMask() {
    if (!this.maskCanvas) return null;
    if (this.feather <= 0) return this.maskCanvas;
    const key = `${this.width()}x${this.height()}:${this.feather}:${this._undo.length}`;
    if (this._featheredMask && this._featherCacheKey === key) return this._featheredMask;
    const c = document.createElement("canvas");
    c.width = this.width();
    c.height = this.height();
    const ctx = c.getContext("2d");
    ctx.filter = `blur(${this.feather}px)`;
    ctx.drawImage(this.maskCanvas, 0, 0);
    ctx.filter = "none";
    this._featheredMask = c;
    this._featherCacheKey = key;
    return c;
  }

  /**
   * Render the complete result (background + foreground) at full resolution.
   * If format requires an opaque background and bg is transparent, `onTransparent`
   * is used as the fill (default white).
   */
  renderFull(onTransparent = "#ffffff", includeBg = true) {
    const w = this.width();
    const h = this.height();
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");

    if (includeBg) {
      if (this.background.type === "transparent") {
        ctx.fillStyle = onTransparent;
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.drawImage(this._getBackground(), 0, 0);
      }
    }

    // Export always runs outside a stroke; use the feathered mask when active.
    const maskSource = this.feather > 0 ? this._currentMask() : this.maskCanvas;
    const fg = this._getForeground(maskSource, this.feather > 0 ? "feathered" : "raw");
    if (fg) ctx.drawImage(fg, 0, 0);
    return out;
  }

  /** Render the on-screen preview into the attached viewport. */
  render() {
    if (!this.viewport || !this.width()) return;
    const ctx = this.viewport.getContext("2d");
    const { _viewportW: w, _viewportH: h, _viewportDpr: dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // backdrop
    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.tx, this.ty);
    ctx.scale(this.scale, this.scale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(this._getBackground(), 0, 0);

    if (this.background.type === "transparent") {
      ctx.fillStyle = this._checkerPattern();
      ctx.fillRect(0, 0, this.width(), this.height());
    }

    // While painting: crisp raw-mask composite (incremental, no feather rebuild).
    // Otherwise: feathered mask when a feather is set.
    const painting = this._painting;
    const feathered = !painting && this.feather > 0;
    const maskSource = feathered ? this._currentMask() : this.maskCanvas;
    const fg = this._getForeground(maskSource, feathered ? "feathered" : "raw");
    if (fg) ctx.drawImage(fg, 0, 0);

    // compare divider overlay (original on left, result on right)
    if (this._compareMode && this.sourceCanvas) {
      const divX = this.width() * this._compare;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, divX, this.height());
      ctx.clip();
      ctx.drawImage(this.sourceCanvas, 0, 0, this.width(), this.height());
      ctx.restore();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 / this.scale;
      ctx.beginPath();
      ctx.moveTo(divX, 0);
      ctx.lineTo(divX, this.height());
      ctx.stroke();
    }

    ctx.restore();
    this._dirty = false;
  }
}