/**
 * Editor — holds the full-resolution source + mask, applies brush edits,
 * backgrounds and renders a zoomable/panning preview.
 *
 * Mask model: a solid-white RGBA canvas whose *alpha* channel is the cutout
 * mask (255 = keep, 0 = remove). The foreground is produced by taking the
 * source RGB and applying the mask alpha via `destination-in`.
 *
 * Brushes only mutate the alpha channel:
 *   - "erase" lowers alpha (destination-out, soft round stamp)
 *   - "restore" raises alpha back to opaque (source-over, soft white stamp)
 */

import { renderBackground } from "./background.js";
import { checkerboardPattern, loadImage } from "./utils.js";

export class Editor {
  constructor() {
    this.sourceCanvas = null; // original, full resolution
    this.maskCanvas = null; // editable alpha mask

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
    this._undoBudget = 64 * 1024 * 1024; // 64 MB of alpha bytes across history


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
    this._undo = [];
    this._redo = [];
    this._featheredMask = null;
    this._featherCacheKey = "";
    this._dirty = true;
  }

  _maxUndoSteps() {
    const px = this.width() * this.height();
    if (!px) return 20;
    return Math.max(1, Math.floor(this._undoBudget / px));
  }

  /** Replace the alpha mask from a segmentation result (white=keep). */
  async setMaskFromBlob(blob) {
    const img = await loadImage(blob);
    const w = this.width();
    const h = this.height();
    const mask = document.createElement("canvas");
    mask.width = w;
    mask.height = h;
    const ctx = mask.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(img, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    this.maskCanvas = mask;
    this._undo = [];
    this._redo = [];
    this._invalidateFeather();
    this._emit();
  }

  _invalidateFeather() {
    this._featheredMask = null;
    this._featherCacheKey = "";
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
    this.brush.size = Math.max(2, size);
  }
  setBrushHardness(h) {
    this.brush.hardness = Math.max(0, Math.min(1, h));
  }

  setFeather(px) {
    this.feather = Math.max(0, px);
    this._invalidateFeather();
    this._emit();
  }

  undo() {
    if (!this._undo.length || !this.maskCanvas) return;
    const current = this._alphaBuffer();
    this._redo.push(current);
    const prev = this._undo.pop();
    this._applyAlphaBuffer(prev);
    this._invalidateFeather();
    this._emit();
  }

  redo() {
    if (!this._redo.length || !this.maskCanvas) return;
    const current = this._alphaBuffer();
    this._undo.push(current);
    const next = this._redo.pop();
    this._applyAlphaBuffer(next);
    this._invalidateFeather();
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
  }

  // ---- Background --------------------------------------------------------

  setBackground(bg) {
    this.background = { ...this.background, ...bg };
    this._emit();
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
        const bg = renderBackground(this.background, w, h, this.sourceCanvas);
        ctx.drawImage(bg, 0, 0);
      }
    }

    const mask = this._currentMask();
    if (mask && this.sourceCanvas) {
      const fg = document.createElement("canvas");
      fg.width = w;
      fg.height = h;
      const fctx = fg.getContext("2d");
      fctx.drawImage(this.sourceCanvas, 0, 0, w, h);
      fctx.globalCompositeOperation = "destination-in";
      fctx.drawImage(mask, 0, 0, w, h);
      ctx.drawImage(fg, 0, 0);
    }
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

    const bg = renderBackground(this.background, this.width(), this.height(), this.sourceCanvas);
    ctx.drawImage(bg, 0, 0, this.width(), this.height());

    if (this.background.type === "transparent") {
      ctx.fillStyle = this._checkerPattern();
      ctx.fillRect(0, 0, this.width(), this.height());
    }

    // foreground
    const mask = this._currentMask();
    if (mask && this.sourceCanvas) {
      const fg = document.createElement("canvas");
      fg.width = this.width();
      fg.height = this.height();
      const fctx = fg.getContext("2d");
      fctx.drawImage(this.sourceCanvas, 0, 0, this.width(), this.height());
      fctx.globalCompositeOperation = "destination-in";
      fctx.drawImage(mask, 0, 0, this.width(), this.height());
      ctx.drawImage(fg, 0, 0, this.width(), this.height());
    }

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