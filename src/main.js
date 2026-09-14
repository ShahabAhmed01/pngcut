/**
 * Application controller — wires upload, inference, editor and DOM together.
 * Refactored into small modules for maintainability.
 */

import "./style.css";
import { Editor } from "./editor.js";
import * as engine from "./engine.js";
import { initBulk } from "./bulk.js";
import { initVideo } from "./video.js";
import { loadImage, toCanvasMax, formatBytes } from "./utils.js";
import { IMAGE_POLICY } from "./config.js";
import { classifyError, describeError } from "./errors.js";
import {
  BRUSH_DEFAULTS,
  FEATHER_DEFAULTS,
  QUALITY_DEFAULTS,
  BLUR_DEFAULTS,
  TOAST_DURATION_MS,
} from "./constants.js";

// Module imports
import { createUploadHandler } from "./upload.js";
import { createExportHandler } from "./export.js";
import { createViewsHandler } from "./views.js";
import { createToolHandler } from "./tools.js";
import { createBackgroundUIHandler } from "./background-ui.js";
import { createViewportHandler } from "./viewport.js";
import { createControlsHandler } from "./controls.js";
import { createShortcutsHandler } from "./shortcuts.js";
import { savePrefs, applyPrefs, resetPrefs } from "./prefs.js";
import { initApp } from "./init.js";

const state = {
  editor: new Editor(),
  model: null, // "large" | "medium" | "small" — null resolves on-device
  device: engine.defaultDevice(),
  refine: "auto", // edge-refinement preset
  format: "png",
  quality: QUALITY_DEFAULTS.value / 100,
  transparent: true,
  originalName: "image",
  processing: false,
  jobId: 0, // incremented per operation; guards against stale async results
};

/** Resolve the model tier actually used for processing. */
function resolveModel() {
  return state.model || engine.defaultModel(state.device);
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
  reset: qs("#btn-reset"),
  // new views + inputs
  bulkView: qs("#bulk-view"),
  videoView: qs("#video-view"),
  bulkInput: qs("#bulk-input"),
  folderInput: qs("#folder-input"),
  videoInput: qs("#video-input"),
  editorHome: qs("#btn-editor-home"),
  modelStatus: qs("#model-status"),
};

const bulkFlow = initBulk({ showToast, goHome: () => views.showView("hero") });
const videoFlow = initVideo({ showToast, goHome: () => views.showView("hero") });

// --- Rendering loop ---
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

// --- Module initialization ---

// Views
const views = createViewsHandler({ el, state, requestRender });
const { showEditor, showProgress, updateProgress, setStatus } = views;

// Tools
const tools = createToolHandler({ state, el, setStatus, requestRender });
const { setTool, getActiveTool } = tools;

// Upload
const upload = createUploadHandler({
  state,
  el,
  showToast,
  showView: views.showView,
  processImage,
  bulkFlow,
  videoFlow,
});
const { bindUpload } = upload;

// Export
const exportHandler = createExportHandler({ state, el, showToast });
const { bindExport } = exportHandler;

// Background UI
const backgroundUI = createBackgroundUIHandler({ state, el, showToast, setStatus });
const { buildGradientSwatches, bindBackgroundUI } = backgroundUI;

// Viewport
const viewport = createViewportHandler({ state, el, getActiveTool, requestRender });
const { bindViewport } = viewport;

// Controls
const controls = createControlsHandler({
  state,
  el,
  showToast,
  setTool: tools.setTool,
  savePrefs: (model, refine) => savePrefs(model, refine),
  requestRender,
});
const { bindControls } = controls;

// Shortcuts
const shortcuts = createShortcutsHandler({ state, el, setTool: tools.setTool, showToast });
const { bindShortcuts } = shortcuts;

// --- Processing ---

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
    state.editor.setRefine(state.refine);
    await state.editor.setMaskFromBlob(maskBlob);
    if (jobId !== state.jobId) return;
    updateProgress(100, "Done");
    setStatus("Ready. Use the tools on the left to refine, then download.");
    await new Promise((r) => setTimeout(r, 250));
    setTool(getActiveTool() || "erase");
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

// --- Toast ---
function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.toast.classList.remove("show"), TOAST_DURATION_MS);
}

// --- Init ---
initApp({
  state,
  el,
  buildGradientSwatches,
  bindUpload,
  bindControls,
  bindViewport,
  bindShortcuts,
  applyPrefs: (s, e) => applyPrefs(s, e),
  addAvifOption: async () => {
    const { supportsAvifExport } = await import("./utils.js");
    if (!(await supportsAvifExport())) return;
    if (el.formatSelect.querySelector('option[value="avif"]')) return;
    const opt = document.createElement("option");
    opt.value = "avif";
    opt.textContent = "AVIF (transparent, modern)";
    const webp = el.formatSelect.querySelector('option[value="webp"]');
    el.formatSelect.insertBefore(opt, webp ? webp.nextSibling : null);
  },
  registerServiceWorker: () => {
    if (!import.meta.env.PROD) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW is an enhancement; the app works fully without it */
    });
  },
  showStatus: setStatus,
});

// Wire export controls after initApp (needs showToast)
bindExport();
bindBackgroundUI();

// Reset settings button
el.reset?.addEventListener("click", () => {
  resetPrefs();
  state.model = null;
  state.refine = "auto";
  state.format = "png";
  state.quality = QUALITY_DEFAULTS.value / 100;
  state.transparent = true;
  state.feather = FEATHER_DEFAULTS.value;
  state.editor.setFeather(FEATHER_DEFAULTS.value);
  state.editor.setRefine("auto");
  if (el.modelSelect) el.modelSelect.value = "";
  if (el.refineSelect) el.refineSelect.value = "auto";
  if (el.formatSelect) el.formatSelect.value = "png";
  if (el.qualityRange) el.qualityRange.value = QUALITY_DEFAULTS.value;
  if (el.qualityVal) el.qualityVal.textContent = `${QUALITY_DEFAULTS.value}%`;
  if (el.transparentToggle) el.transparentToggle.checked = true;
  if (el.feather) el.feather.value = FEATHER_DEFAULTS.value;
  if (el.featherVal) el.featherVal.textContent = `${FEATHER_DEFAULTS.value}px`;
  if (el.brushSize) el.brushSize.value = BRUSH_DEFAULTS.size;
  if (el.brushSizeVal) el.brushSizeVal.textContent = `${BRUSH_DEFAULTS.size}px`;
  if (el.brushHardness) el.brushHardness.value = BRUSH_DEFAULTS.hardness * 100;
  if (el.brushHardnessVal) el.brushHardnessVal.textContent = `${BRUSH_DEFAULTS.hardness * 100}%`;
  if (el.blurAmount) el.blurAmount.value = BLUR_DEFAULTS.amount;
  if (el.blurAmountVal) el.blurAmountVal.textContent = `${BLUR_DEFAULTS.amount}px`;
  // Reset background to transparent
  state.editor.setBackground({ type: "transparent" });
  // Reset tool to erase
  setTool("erase");
  showToast("Settings reset to defaults");
});