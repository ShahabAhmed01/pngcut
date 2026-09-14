/**
 * Application controller — wires upload, inference, editor and DOM together.
 */

import "./style.css";
import { Editor } from "./editor.js";
import * as engine from "./engine.js";
import { initBulk } from "./bulk.js";
import { initVideo } from "./video.js";
import { loadImage, downloadBlob, clamp, formatBytes, toCanvasMax, canvasToBlob, supportsAvifExport } from "./utils.js";
import { validateImageFile, isSvgFile, sanitizeFilename, looksLikeVideo } from "./validate.js";
import { classifyError, describeError } from "./errors.js";
import { IMAGE_POLICY, EXPORT_FORMATS } from "./config.js";
import { REFINE_PRESETS } from "./refine.js";
import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";

const state = {
  editor: new Editor(),
  model: null, // "large" | "medium" | "small" — null resolves on-device
  device: engine.defaultDevice(),
  refine: "auto", // edge-refinement preset (see src/refine.js)
  format: "png",
  quality: 0.92,
  transparent: true,
  originalName: "image",
  processing: false,
  jobId: 0, // incremented per operation; guards against stale async results
};

/** Resolve the model tier actually used for processing. */
function resolveModel() {
  return state.model || engine.defaultModel(state.device);
}

// --- persisted preferences (toolbar model/refine choices) ------------------
const PREFS_KEY = "pngcut.prefs.v1";
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ model: state.model, refine: state.refine }));
  } catch {
    /* storage unavailable — preferences are best-effort */
  }
}

const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));

const el = {
  dropzone: qs("#dropzone"),
  fileInput: qs("#file-input"),
  hero: qs("#hero"),
  editor: qs("#editor"),
  viewport: qs("#viewport"),
  progress: qs("#progress"),
  progressBar: qs("#progress-bar"),
  progressText: qs("#progress-text"),
  toast: qs("#toast"),
  // buttons
  newImage: qs("#btn-new"),
  undo: qs("#btn-undo"),
  redo: qs("#btn-redo"),
  download: qs("#btn-download"),
  // tool rail
  toolErase: qs("#tool-erase"),
  toolRestore: qs("#tool-restore"),
  toolCompare: qs("#tool-compare"),
  toolBg: qs("#tool-bg"),
  // sliders
  brushSize: qs("#brush-size"),
  brushHardness: qs("#brush-hardness"),
  feather: qs("#feather"),
  brushSizeVal: qs("#brush-size-val"),
  featherVal: qs("#feather-val"),
  // background
  bgSection: qs("#bg-section"),
  bgTransparent: qs("#bg-transparent"),
  bgColor: qs("#bg-color"),
  bgGradient: qs("#bg-gradient"),
  bgImage: qs("#bg-image"),
  bgBlur: qs("#bg-blur"),
  colorPicker: qs("#bg-color-input"),
  gradientSwatches: qs("#gradient-swatches"),
  bgImageInput: qs("#bg-image-input"),
  blurAmount: qs("#blur-amount"),
  blurAmountVal: qs("#blur-amount-val"),
  // export
  formatSelect: qs("#format-select"),
  qualityRange: qs("#quality-range"),
  qualityVal: qs("#quality-val"),
  transparentToggle: qs("#transparent-toggle"),
  exportSize: qs("#export-size"),
  copy: qs("#btn-copy"),
  // toolbar selects
  modelSelect: qs("#model-select"),
  refineSelect: qs("#refine-select"),
  // shortcuts overlay
  shortcutsBtn: qs("#btn-shortcuts"),
  shortcutsDialog: qs("#shortcuts-dialog"),
  shortcutsClose: qs("#btn-shortcuts-close"),
  // info
  fileInfo: qs("#file-info"),
  // footer/status
  statusHint: qs("#status-hint"),
  sampleButtons: qsa("[data-sample]"),
  zoomIn: qs("#btn-zoom-in"),
  zoomOut: qs("#btn-zoom-out"),
  zoomFit: qs("#btn-fit"),
  brushHardnessVal: qs("#brush-hardness-val"),
  // new views + inputs
  bulkView: qs("#bulk-view"),
  videoView: qs("#video-view"),
  bulkInput: qs("#bulk-input"),
  folderInput: qs("#folder-input"),
  videoInput: qs("#video-input"),
  editorHome: qs("#btn-editor-home"),
  modelStatus: qs("#model-status"),
};

const bulkFlow = initBulk({ showToast, goHome: () => showView("hero") });
const videoFlow = initVideo({ showToast, goHome: () => showView("hero") });

const GRADIENTS = [
  ["#7c3aed", "#06b6d4"],
  ["#f43f5e", "#fb923c"],
  ["#0ea5e9", "#22c55e"],
  ["#8b5cf6", "#ec4899"],
  ["#111827", "#6b7280"],
  ["#f59e0b", "#ef4444"],
];

// ---------------------------------------------------------------------------
// Rendering loop
// ---------------------------------------------------------------------------
function requestRender() {
  requestAnimationFrame(() => state.editor.render());
}

state.editor.onChange(() => {
  requestRender();
  updateButtonState();
});

function updateButtonState() {
  el.undo.disabled = !state.editor.canUndo();
  el.redo.disabled = !state.editor.canRedo();
}

// ---------------------------------------------------------------------------
// Tool selection
// ---------------------------------------------------------------------------
let activeTool = "erase";

function setTool(tool) {
  activeTool = tool;
  const tools = { erase: el.toolErase, restore: el.toolRestore, compare: el.toolCompare, bg: el.toolBg };
  Object.entries(tools).forEach(([k, btn]) => {
    btn.classList.toggle("active", k === tool);
    btn.setAttribute("aria-pressed", k === tool ? "true" : "false");
  });
  qs("#brush-section").classList.toggle("hidden", !(tool === "erase" || tool === "restore"));
  qs("#bg-section").classList.toggle("hidden", tool !== "bg");
  // The custom color picker row is part of the bg panel — visible only there.
  qs("#color-row").classList.toggle("hidden", tool !== "bg");
  qs("#feather-row").classList.toggle("hidden", tool === "bg" || tool === "compare");
  if (tool === "compare") {
    state.editor.setCompare(true, 0.5);
    setStatus("Drag the divider to compare original vs. result.");
  } else {
    state.editor.setCompare(false);
    if (tool === "erase") setStatus("Paint over areas you want to remove (become background).");
    else if (tool === "restore") setStatus("Paint over areas you want to restore (become subject).");
    else if (tool === "bg") setStatus("Choose a background for the result.");
  }
}

function setStatus(msg) {
  el.statusHint.textContent = msg;
}

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------
function showView(name) {
  el.hero.classList.toggle("hidden", name !== "hero");
  el.editor.classList.toggle("hidden", name !== "editor");
  el.bulkView.classList.toggle("hidden", name !== "bulk");
  el.videoView.classList.toggle("hidden", name !== "video");
  el.dropzone.classList.toggle("dropzone--compact", name === "editor");
}

// ---------------------------------------------------------------------------
// Upload & processing
// ---------------------------------------------------------------------------
function showEditor() {
  showView("editor");
  requestAnimationFrame(() => {
    state.editor.layout();
    requestRender();
  });
}

function showProgress(show) {
  el.progress.classList.toggle("hidden", !show);
}

function updateProgress(pct, text) {
  el.progressBar.style.width = `${Math.round(pct)}%`;
  el.progressText.textContent = text;
}

async function processImage(blob, name) {
  if (state.processing) return;
  state.processing = true;
  state.originalName = name;
  const jobId = ++state.jobId;

  try {
    const img = await loadImage(blob);
    if (jobId !== state.jobId) return;
    const { width, height } = img;
    state.editor.setSource(toCanvasMax(img, IMAGE_POLICY.maxDimension));
    showEditor();
    requestAnimationFrame(() => state.editor.fit());

    el.fileInfo.textContent = `${width} × ${height}px`;

    showProgress(true);
    updateProgress(2, `Preparing… (${formatBytes(blob.size)})`);

    let modelTotal = 0;

    const maskBlob = await engine.segmentForeground(blob, {
      model: resolveModel(),
      device: state.device,
      onProgress: (key, current, total) => {
        if (jobId !== state.jobId) return;
        if (key.startsWith("fetch:")) {
          modelTotal = Math.max(modelTotal, total);
          const pct = modelTotal ? Math.min(100, (current / modelTotal) * 100) : 0;
          updateProgress(pct, `Downloading model… ${Math.round(pct)}%`);
        } else if (key.startsWith("compute:")) {
          const step = Number(key.split(":")[2] || 0);
          updateProgress(Math.min(99, 70 + (step / 4) * 28), "Analyzing image…");
        }
      },
    });

    if (jobId !== state.jobId) return;

    updateProgress(99, "Applying mask…");
    state.editor.setRefine(state.refine); // sync preset, then apply at ingestion
    await state.editor.setMaskFromBlob(maskBlob);
    if (jobId !== state.jobId) return;
    updateProgress(100, "Done");
    setStatus("Ready. Use the tools on the left to refine, then download.");
    await new Promise((r) => setTimeout(r, 250));
    setTool(activeTool || "erase");
  } catch (err) {
    if (jobId !== state.jobId) return;
    console.error(err);
    const code = classifyError(err);
    const info = describeError(code);
    showToast(`${info.title} — ${info.body}`);
    setStatus("Choose another image or try again.");
  } finally {
    if (jobId === state.jobId) {
      showProgress(false);
      state.processing = false;
    }
  }
}

function acceptFile(file) {
  if (!file) return;
  if (isSvgFile(file)) {
    showToast("SVG files aren't supported for background removal. Use PNG, JPEG, WebP, AVIF or BMP.");
    return;
  }
  if (looksLikeVideo(file)) {
    if (videoFlow.setFile(file)) showView("video");
    return;
  }
  const result = validateImageFile(file);
  if (!result.ok) {
    showToast(result.userMessage);
    return;
  }
  processImage(file, file.name || "image");
}

/** Route a set of files to the right mode: single image → editor, many → bulk, video → video. */
function acceptFiles(files) {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return;
  const videos = list.filter(looksLikeVideo);
  const images = list.filter(
    (f) => /^image\//.test(f.type || "") && !/^image\/svg/.test(f.type) && !/\.svg$/i.test(f.name || "")
  );
  const svgs = list.filter(isSvgFile);

  if (svgs.length) {
    showToast("SVG files were skipped — background removal works on raster images (PNG, JPEG, WebP, AVIF, BMP).");
  }

  if (images.length > 1 || (images.length && videos.length)) {
    if (images.length && videos.length) {
      showToast("Videos are processed one at a time — dropping the images for bulk removal.");
    }
    bulkFlow.addFiles(images);
    showView("bulk");
    return;
  }
  if (images.length === 1) {
    acceptFile(images[0]);
    return;
  }
  if (videos.length) {
    acceptFile(videos[0]);
  }
}

// ---------------------------------------------------------------------------
// Background builder
// ---------------------------------------------------------------------------
function applyColor(c) {
  state.editor.setBackground({ type: "color", color: c });
  // Keep the Color option chip in sync with the picked color.
  const chip = qs("#bg-color-chip");
  if (chip) chip.style.background = c;
}

function buildGradientSwatches() {
  el.gradientSwatches.innerHTML = "";
  GRADIENTS.forEach(([from, to]) => {
    const b = document.createElement("button");
    b.className = "swatch";
    b.style.background = `linear-gradient(135deg, ${from}, ${to})`;
    b.title = `${from} → ${to}`;
    b.addEventListener("click", () => {
      qsa("#gradient-swatches .swatch").forEach((s) => s.classList.remove("selected"));
      b.classList.add("selected");
      state.editor.setBackground({ type: "gradient", from, to, angle: 135 });
    });
    el.gradientSwatches.appendChild(b);
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
/** Shared encoder for Download + Copy. Returns { blob, format, mime }. */
async function encodeResult() {
  const format = el.formatSelect.value;
  const quality = Number(el.qualityRange.value);
  const transparent = el.transparentToggle.checked && format !== "jpeg";

  // Bake in the chosen background (color/gradient/image/blur) whenever one is
  // active. Only when the editor background is "transparent" does the toggle
  // decide: unchecked (or JPEG) flattens to `onTransparent` (white); checked
  // keeps real alpha for formats that support it.
  const bgIsTransparent = state.editor.background.type === "transparent";
  const includeBg = !bgIsTransparent || !transparent;
  const result = state.editor.renderFull("#ffffff", includeBg);

  const fmt = EXPORT_FORMATS[format] || EXPORT_FORMATS.png;
  const mime = fmt.mime;
  let blob = await canvasToBlob(result, mime, format === "png" ? undefined : quality);

  // Silent PNG fallback guard: browsers fall back to PNG bytes for unsupported
  // encodes (old WebP/Safari, optional AVIF) — catch the mismatch, re-encode
  // honestly as PNG, and tell the user what actually happened.
  if (!blob || (blob.type && blob.type !== mime)) {
    if (format === "png") return { blob, format: "png", mime: "image/png" };
    blob = await canvasToBlob(result, "image/png");
    showToast(`Your browser can't encode ${fmt.label} — saved as PNG instead.`);
    return { blob, format: "png", mime: "image/png", fallback: true };
  }
  return { blob, format, mime };
}

async function doDownload() {
  const { blob, format } = await encodeResult();
  const base = sanitizeFilename(state.originalName, "image");
  const ext = format === "jpeg" ? "jpg" : format;
  downloadBlob(blob, `${base}-no-bg.${ext}`);
  if (el.exportSize) el.exportSize.textContent = formatBytes(blob.size);
  showToast(`Downloaded ${format.toUpperCase()} (${formatBytes(blob.size)})`);
}

async function doCopy() {
  try {
    if (!state.editor.maskCanvas) {
      showToast("Remove a background first, then copy the result.");
      return;
    }
    if (!navigator.clipboard || typeof window.ClipboardItem !== "function") {
      showToast("Clipboard images aren't supported in this browser.");
      return;
    }
    const { blob } = await encodeResult();
    // Clipboard only accepts PNG reliably.
    const png = blob.type === "image/png" ? blob : await encodeAsPng();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    showToast("Result copied to clipboard (PNG).");
  } catch (err) {
    console.warn("copy failed", err);
    showToast("Couldn't copy the result — try downloading instead.");
  }
}

async function encodeAsPng() {
  const result = state.editor.renderFull(undefined, false);
  return canvasToBlob(result, "image/png");
}

// ---------------------------------------------------------------------------
// Viewport pointer interactions
// ---------------------------------------------------------------------------
let panning = false;
let compareDragging = false;
let spaceHeld = false;
let lastPan = { x: 0, y: 0 };

function bindViewport() {
  const vp = el.viewport;

  vp.addEventListener("pointerdown", (e) => {
    vp.setPointerCapture(e.pointerId);
    const rect = vp.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (activeTool === "compare") {
      compareDragging = true;
      const img = state.editor.screenToImage(sx, sy);
      state.editor.setCompare(true, clamp(img.x / state.editor.width(), 0, 1));
      return;
    }

    if (activeTool === "erase" || activeTool === "restore") {
      // Only the primary button (or pen contact) paints — middle pans, right
      // click opens the context menu.
      if (e.button !== 0) return;
      state.editor.setBrushTool(activeTool);
      const img = state.editor.screenToImage(sx, sy);
      state.editor.beginStroke(img.x, img.y);
      return;
    }

    // pan mode (spacebar or middle button)
    if (e.button === 1 || spaceHeld) {
      panning = true;
      lastPan = { x: sx, y: sy };
      vp.style.cursor = "grabbing";
    }
  });

  vp.addEventListener("pointermove", (e) => {
    const rect = vp.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (compareDragging) {
      const img = state.editor.screenToImage(sx, sy);
      state.editor.setCompare(true, clamp(img.x / state.editor.width(), 0, 1));
      return;
    }
    if (activeTool === "erase" || activeTool === "restore") {
      if (state.editor.isPainting()) {
        const img = state.editor.screenToImage(sx, sy);
        state.editor.moveStroke(img.x, img.y);
      }
      return;
    }
    if (panning) {
      state.editor.pan(sx - lastPan.x, sy - lastPan.y);
      lastPan = { x: sx, y: sy };
      requestRender();
    }
  });

  const end = () => {
    if (state.editor.isPainting()) state.editor.endStroke();
    panning = false;
    compareDragging = false;
    vp.style.cursor = "";
  };
  vp.addEventListener("pointerup", end);
  vp.addEventListener("pointercancel", end);

  vp.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = vp.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    state.editor.zoom(factor, sx, sy);
    requestRender();
  }, { passive: false });

  // keyboard pan (hold space)
  window.addEventListener("keydown", (e) => {
    if (e.key === " " && !e.target.matches("input,textarea,select") && !el.editor.classList.contains("hidden")) {
      spaceHeld = true;
      vp.style.cursor = "grab";
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === " ") {
      spaceHeld = false;
      if (!panning) vp.style.cursor = "";
    }
  });
}

// ---------------------------------------------------------------------------
// Dropzone + paste + samples
// ---------------------------------------------------------------------------
function bindUpload() {
  el.fileInput.addEventListener("change", () => {
    acceptFiles(el.fileInput.files);
    el.fileInput.value = ""; // allow re-selecting the same file
  });

  el.dropzone.addEventListener("click", (e) => {
    if (e.target === el.fileInput) return;
    if (e.target.closest(".pick-btn, .primary-upload, a")) return;
    el.fileInput.click();
  });

  ["dragover", "dragenter"].forEach((ev) =>
    el.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      el.dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    el.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      el.dropzone.classList.remove("dragover");
    })
  );
  el.dropzone.addEventListener("drop", (e) => {
    acceptFiles(e.dataTransfer && e.dataTransfer.files);
  });

  // picker buttons in the dropzone
  document.querySelector("#btn-upload").addEventListener("click", () => el.fileInput.click());
  document.querySelector("#btn-pick-video").addEventListener("click", () => el.videoInput.click());
  document.querySelector("#btn-pick-folder").addEventListener("click", () => el.folderInput.click());
  document.querySelector("#btn-pick-bulk").addEventListener("click", () => el.bulkInput.click());

  el.bulkInput.addEventListener("change", () => {
    acceptFiles(el.bulkInput.files);
    el.bulkInput.value = "";
  });

  el.folderInput.addEventListener("change", () => {
    const files = Array.from(el.folderInput.files || []).filter(
      (f) => !(f.webkitRelativePath || "").split("/").pop().startsWith(".")
    );
    if (!files.length) {
      showToast("No images found in that folder.");
    }
    acceptFiles(files);
    el.folderInput.value = "";
  });

  el.videoInput.addEventListener("change", () => {
    acceptFile(el.videoInput.files[0]);
    el.videoInput.value = ""; // allow re-selecting the same file
  });

  // home buttons
  el.editorHome.addEventListener("click", () => showView("hero"));

  document.addEventListener("paste", (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith("image/")) {
        acceptFile(item.getAsFile());
        e.preventDefault();
        break;
      }
    }
  });

  el.sampleButtons.forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const res = await fetch(btn.dataset.sample);
        const blob = await res.blob();
        processImage(blob, btn.dataset.sample.split("/").pop());
      } catch {
        showToast("Couldn't load sample image.");
      }
    })
  );
}

function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.toast.classList.remove("show"), 2600);
}

// ---------------------------------------------------------------------------
// Wire controls
// ---------------------------------------------------------------------------
function bindControls() {
  el.newImage.addEventListener("click", () => {
    el.fileInput.value = "";
    el.fileInput.click();
  });

  el.undo.addEventListener("click", () => state.editor.undo());
  el.redo.addEventListener("click", () => state.editor.redo());
  el.download.addEventListener("click", doDownload);

  el.toolErase.addEventListener("click", () => setTool("erase"));
  el.toolRestore.addEventListener("click", () => setTool("restore"));
  el.toolCompare.addEventListener("click", () => setTool("compare"));
  el.toolBg.addEventListener("click", () => setTool("bg"));

  el.brushSize.addEventListener("input", () => {
    state.editor.setBrushSize(Number(el.brushSize.value));
    el.brushSizeVal.textContent = `${el.brushSize.value}px`;
  });
  el.brushHardness.addEventListener("input", () => {
    state.editor.setBrushHardness(Number(el.brushHardness.value) / 100);
    el.brushHardnessVal.textContent = `${el.brushHardness.value}%`;
  });
  el.feather.addEventListener("input", () => {
    state.editor.setFeather(Number(el.feather.value));
    el.featherVal.textContent = `${el.feather.value}px`;
  });

  // background
  el.bgTransparent.addEventListener("click", () => {
    state.editor.setBackground({ type: "transparent" });
    selectBgButton(el.bgTransparent);
  });
  el.bgColor.addEventListener("click", () => {
    selectBgButton(el.bgColor);
    el.colorPicker.click();
  });
  el.bgGradient.addEventListener("click", () => {
    selectBgButton(el.bgGradient);
    const first = el.gradientSwatches.querySelector(".swatch");
    if (first && !el.gradientSwatches.querySelector(".selected")) {
      first.click();
    }
  });
  el.bgImage.addEventListener("click", () => {
    selectBgButton(el.bgImage);
    el.bgImageInput.click();
  });
  el.bgBlur.addEventListener("click", () => {
    selectBgButton(el.bgBlur);
    state.editor.setBackground({ type: "blur", amount: Number(el.blurAmount.value) });
  });

  el.colorPicker.addEventListener("input", () => applyColor(el.colorPicker.value));

  el.bgImageInput.addEventListener("change", async () => {
    const f = el.bgImageInput.files[0];
    el.bgImageInput.value = "";
    if (!f) return;
    // Background images go through the same validation + bounded working size
    // as foreground images — an 8000 px custom bg would blow tab memory.
    const check = validateImageFile(f);
    if (!check.ok) {
      showToast(check.userMessage);
      return;
    }
    try {
      const img = await loadImage(f);
      const c = toCanvasMax(img, IMAGE_POLICY.maxDimension);
      state.editor.setBackground({ type: "image", imageCanvas: c });
      setStatus("Custom background image set.");
    } catch {
      showToast("PNGCut couldn't decode that background image.");
    }
  });

  el.blurAmount.addEventListener("input", () => {
    el.blurAmountVal.textContent = `${el.blurAmount.value}px`;
    if (state.editor.background.type === "blur") {
      state.editor.setBackground({ type: "blur", amount: Number(el.blurAmount.value) });
    }
  });

  el.qualityRange.addEventListener("input", () => {
    state.quality = Number(el.qualityRange.value);
    el.qualityVal.textContent = `${el.qualityRange.value}%`;
  });

  el.formatSelect.addEventListener("change", () => {
    // JPEG cannot preserve transparency — disable the toggle and explain.
    const opaque = el.formatSelect.value === "jpeg";
    el.transparentToggle.disabled = opaque;
    el.transparentToggle.checked = !opaque;
    el.transparentToggle.closest(".toggle-row").classList.toggle("is-disabled", opaque);
    if (el.exportSize) el.exportSize.textContent = "";
  });

  // Copy the current result to the clipboard (hidden when unsupported).
  if (el.copy) {
    const supported =
      typeof navigator !== "undefined" && navigator.clipboard && typeof window.ClipboardItem === "function";
    el.copy.classList.toggle("hidden", !supported);
    el.copy.addEventListener("click", doCopy);
  }

  // Model quality tier (persisted; null = resolve on-device)
  if (el.modelSelect) {
    el.modelSelect.addEventListener("change", () => {
      const v = el.modelSelect.value;
      state.model = engine.isModelTier(v) ? v : null;
      savePrefs();
      const tier = state.model || engine.defaultModel(state.device);
      const meta = engine.MODEL_TIERS[tier];
      showToast(
        state.model
          ? `Model: ${meta.label} — ${meta.hint}`
          : `Model: Auto (${meta.label}) — ${meta.hint}`
      );
    });
  }

  // Edge refinement preset (persisted; re-derives the mask from raw output)
  if (el.refineSelect) {
    el.refineSelect.addEventListener("change", () => {
      const preset = el.refineSelect.value;
      state.refine = preset;
      savePrefs();
      state.editor.setRefine(preset);
      showToast(
        preset === "off"
          ? "Raw model mask — no edge refinement."
          : `Edge refinement: ${preset}. Brush history was reset.`
      );
    });
  }

  window.addEventListener("resize", () => {
    state.editor.layout();
    requestRender();
  });

  el.zoomIn.addEventListener("click", () => {
    const cx = state.editor._viewportW / 2;
    const cy = state.editor._viewportH / 2;
    state.editor.zoom(1.25, cx, cy);
    requestRender();
  });
  el.zoomOut.addEventListener("click", () => {
    const cx = state.editor._viewportW / 2;
    const cy = state.editor._viewportH / 2;
    state.editor.zoom(1 / 1.25, cx, cy);
    requestRender();
  });
  el.zoomFit.addEventListener("click", () => {
    state.editor.fit();
    requestRender();
  });
}

function selectBgButton(btn) {
  qsa("#bg-section .bg-option").forEach((b) => {
    b.classList.remove("active");
    b.setAttribute("aria-pressed", "false");
  });
  btn.classList.add("active");
  btn.setAttribute("aria-pressed", "true");
}

// keyboard shortcuts
function toggleShortcuts(show = !el.shortcutsDialog.classList.contains("hidden")) {
  el.shortcutsDialog.classList.toggle("hidden", !show);
  if (show) el.shortcutsClose?.focus();
  else el.shortcutsBtn?.focus();
}

function bindShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.shortcutsDialog.classList.contains("hidden")) {
      toggleShortcuts(false);
      return;
    }
    if (e.key === "?" && !e.target.matches("input,textarea,select")) {
      e.preventDefault();
      toggleShortcuts();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) state.editor.redo();
      else state.editor.undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      state.editor.redo();
    } else if (mod && e.key.toLowerCase() === "p") {
      // copy the current result without reaching for the button
      e.preventDefault();
      doCopy();
    } else if (!e.target.matches("input,textarea,select") && el.editor && !el.editor.classList.contains("hidden")) {
      if (e.key === "b") setTool("erase");
      else if (e.key === "r") setTool("restore");
      else if (e.key === "c") setTool("compare");
      else if (e.key === "g") setTool("bg");
      else if (e.key === "[") state.editor.adjustBrushSize(-5);
      else if (e.key === "]") state.editor.adjustBrushSize(5);
    }
  });

  el.shortcutsBtn?.addEventListener("click", () => toggleShortcuts());
  el.shortcutsClose?.addEventListener("click", () => toggleShortcuts(false));
  el.shortcutsDialog?.addEventListener("click", (e) => {
    // click on the dimmed backdrop closes
    if (e.target === el.shortcutsDialog) toggleShortcuts(false);
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
/** Apply persisted toolbar preferences (model tier + refinement preset). */
function applyPrefs() {
  const prefs = loadPrefs();
  if (engine.isModelTier(prefs.model)) {
    state.model = prefs.model;
    if (el.modelSelect) el.modelSelect.value = prefs.model;
  }
  if (prefs.refine && prefs.refine in REFINE_PRESETS) {
    state.refine = prefs.refine;
    if (el.refineSelect) el.refineSelect.value = prefs.refine;
  }
  state.editor.setRefine(state.refine);
}

/** Add the AVIF export option only when this browser can actually encode it. */
async function addAvifOption() {
  if (!(await supportsAvifExport())) return;
  if (el.formatSelect.querySelector('option[value="avif"]')) return;
  const opt = document.createElement("option");
  opt.value = "avif";
  opt.textContent = "AVIF (transparent, modern)";
  const webp = el.formatSelect.querySelector('option[value="webp"]');
  el.formatSelect.insertBefore(opt, webp ? webp.nextSibling : null);
}

/** PWA service worker — true offline support after first use (prod only). */
function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {
    /* SW is an enhancement; the app works fully without it */
  });
}

function init() {
  inject();
  injectSpeedInsights();

  buildGradientSwatches();
  bindUpload();
  bindControls();
  bindViewport();
  bindShortcuts();
  applyPrefs();
  addAvifOption();
  registerServiceWorker();

  state.editor.attachViewport(el.viewport);
  state.editor.layout();
  el.brushSizeVal.textContent = `${el.brushSize.value}px`;
  el.featherVal.textContent = `${el.feather.value}px`;
  el.qualityVal.textContent = `${el.qualityRange.value}%`;

  // warm model pick: probe WebGPU properly, fall back to CPU otherwise
  engine.probeDevice().then((device) => {
    state.device = device;
  });

  setStatus("Drop an image to remove its background — everything runs in your browser.");

  // The neural model loads on first use (not on idle page load) and stays
  // resident for the whole tab: the underlying engine memoises sessions and
  // every code path (image editor, video frames, bulk jobs) shares one canonical
  // config, so it is downloaded and initialized exactly once — never again.
  let lastModelStatus = "idle";
  engine.onModelStatus((status) => {
    if (!el.modelStatus) return;
    lastModelStatus = status;
    if (status === "ready") {
      const backend = engine.getActiveBackend();
      el.modelStatus.textContent = backend === "gpu" ? "Model ready · GPU" : "Model ready · CPU";
      el.modelStatus.classList.add("ready");
      el.modelStatus.classList.remove("error");
      el.modelStatus.hidden = false;
    } else if (status === "loading") {
      el.modelStatus.textContent = "Preparing model…";
      el.modelStatus.classList.remove("ready", "error");
      el.modelStatus.hidden = false;
    } else if (status === "error") {
      el.modelStatus.textContent = "Model load failed — click to retry";
      el.modelStatus.classList.remove("ready");
      el.modelStatus.classList.add("error");
      el.modelStatus.hidden = false;
    } else {
      el.modelStatus.hidden = true;
    }
  });

  // Clicking the chip after a failed load forces a clean retry: the in-flight
  // promise and any poisoned service-worker model cache are dropped first.
  el.modelStatus?.addEventListener("click", () => {
    if (lastModelStatus !== "error") return;
    engine.resetModel();
    showToast("Retrying model load…");
    engine.preload({ model: resolveModel(), device: state.device }).catch(() => {
      /* the status chip already reflects the failure */
    });
  });

  // Prefetch the model only in the background, and only when it is unlikely to
  // waste the user's data/battery: no explicit Save-Data, adequate device
  // memory, no file selected yet. First actual processing always triggers a
  // real load; this is best-effort and never blocks the UI.
  const mayPrefetch = () => {
    const saveData = navigator.connection && navigator.connection.saveData;
    const mem = navigator.deviceMemory || 8;
    return !saveData && mem >= 4;
  };
  if (mayPrefetch()) {
    const warmUp = () => engine.preload({ model: resolveModel(), device: state.device });
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(warmUp, { timeout: 4000 });
    } else {
      setTimeout(warmUp, 800);
    }
  }
}

init();