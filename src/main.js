/**
 * Application controller — wires upload, inference, editor and DOM together.
 */

import "./style.css";
import { Editor } from "./editor.js";
import * as engine from "./engine.js";
import { initBulk } from "./bulk.js";
import { initVideo } from "./video.js";
import { loadImage, downloadBlob, clamp, formatBytes, toCanvasMax, canvasToBlob } from "./utils.js";

const state = {
  editor: new Editor(),
  model: "medium", // small | medium | large
  device: "gpu",
  format: "png",
  quality: 0.92,
  transparent: true,
  originalName: "image",
  processing: false,
};

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
  el.undo.disabled = state.editor._undo.length === 0;
  el.redo.disabled = state.editor._redo.length === 0;
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
  });
  qs("#brush-section").classList.toggle("hidden", !(tool === "erase" || tool === "restore"));
  qs("#bg-section").classList.toggle("hidden", tool !== "bg");
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

  try {
    const img = await loadImage(blob);
    const { width, height } = img;
    state.editor.setSource(toCanvasMax(img, 4000));
    showEditor();
    requestAnimationFrame(() => state.editor.fit());

    el.fileInfo.textContent = `${width} × ${height}px`;

    showProgress(true);
    updateProgress(2, `Preparing… (${formatBytes(blob.size)})`);

    let phase = "download";
    let modelTotal = 0;

    const maskBlob = await engine.segmentForeground(blob, {
      model: state.model,
      device: state.device,
      onProgress: (key, current, total) => {
        if (key.startsWith("fetch:")) {
          phase = "download";
          modelTotal = Math.max(modelTotal, total);
          const pct = modelTotal ? Math.min(100, (current / modelTotal) * 100) : 0;
          updateProgress(pct, `Downloading model… ${Math.round(pct)}%`);
        } else if (key.startsWith("compute:")) {
          const step = Number(key.split(":")[2] || 0);
          const pct = phase === "download" ? 70 : 70;
          updateProgress(Math.min(99, pct + (step / 4) * 28), "Analyzing image…");
        }
      },
    });

    updateProgress(99, "Applying mask…");
    await state.editor.setMaskFromBlob(maskBlob);
    updateProgress(100, "Done");
    setStatus("Ready. Use the tools on the left to refine, then download.");
    await new Promise((r) => setTimeout(r, 250));
    setTool(activeTool || "erase");
  } catch (err) {
    console.error(err);
    showToast("Something went wrong processing this image.");
    setStatus("Try another image.");
  } finally {
    showProgress(false);
    state.processing = false;
  }
}

function acceptFile(file) {
  if (!file) return;
  if (/^video\//.test(file.type || "")) {
    if (videoFlow.setFile(file)) showView("video");
    return;
  }
  const okTypes = /image\/(png|jpeg|webp|gif|avif|bmp|x-icon)/;
  if (!okTypes.test(file.type)) {
    showToast("Please choose a PNG, JPEG, WebP, GIF, AVIF or BMP image, or a video.");
    return;
  }
  processImage(file, file.name || "image");
}

/** Route a set of files to the right mode: single image → editor, many → bulk, video → video. */
function acceptFiles(files) {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return;
  const videos = list.filter((f) => /^video\//.test(f.type || ""));
  const images = list.filter((f) => /^image\//.test(f.type || "") && !/^image\/svg/.test(f.type));

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
async function doDownload() {
  const format = el.formatSelect.value;
  const quality = Number(el.qualityRange.value);
  const transparent = el.transparentToggle.checked && format !== "jpeg";

  // When transparent is requested and supported, export without any background.
  // Otherwise bake in the current background (or white when transparent+JPEG).
  const includeBg = !transparent;
  const result = state.editor.renderFull(
    state.editor.background.type === "transparent" ? "#ffffff" : undefined,
    includeBg
  );

  let mime = { png: "image/png", webp: "image/webp", jpeg: "image/jpeg" }[format];
  const blob = await canvasToBlob(result, mime, format === "png" ? undefined : quality);

  const base = (state.originalName || "image").replace(/\.[^.]+$/, "");
  const ext = format === "jpeg" ? "jpg" : format;
  downloadBlob(blob, `${base}-no-bg.${ext}`);
  showToast(`Downloaded ${format.toUpperCase()} (${formatBytes(blob.size)})`);
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
      if (state.editor._painting) {
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
    if (state.editor._painting) state.editor.endStroke();
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
  el.fileInput.addEventListener("change", () => acceptFiles(el.fileInput.files));

  el.dropzone.addEventListener("click", (e) => {
    if (e.target === el.fileInput) return;
    if (e.target.closest(".pick-btn")) return;
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
  document.querySelector("#btn-pick-images").addEventListener("click", () => el.fileInput.click());
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

  el.videoInput.addEventListener("change", () => acceptFile(el.videoInput.files[0]));

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
    if (!f) return;
    const img = await loadImage(f);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    state.editor.setBackground({ type: "image", imageCanvas: c });
  });

  el.blurAmount.addEventListener("input", () => {
    el.blurAmountVal.textContent = `${el.blurAmount.value}px`;
    if (state.editor.background.type === "blur") {
      state.editor.setBackground({ type: "blur", amount: Number(el.blurAmount.value) });
    }
  });

  el.qualityRange.addEventListener("input", () => {
    state.quality = Number(el.qualityRange.value);
    el.qualityVal.textContent = `${Math.round(el.qualityRange.value * 100)}%`;
  });

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
  qsa("#bg-section .bg-option").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
}

// keyboard shortcuts
function bindShortcuts() {
  window.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) state.editor.redo();
      else state.editor.undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      state.editor.redo();
    } else if (!e.target.matches("input,textarea,select") && el.editor && !el.editor.classList.contains("hidden")) {
      if (e.key === "b") setTool("erase");
      else if (e.key === "r") setTool("restore");
      else if (e.key === "c") setTool("compare");
      else if (e.key === "g") setTool("bg");
      else if (e.key === "[") state.editor.setBrushSize((state.editor.brush.size -= 5));
      else if (e.key === "]") state.editor.setBrushSize((state.editor.brush.size += 5));
    }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function init() {
  buildGradientSwatches();
  bindUpload();
  bindControls();
  bindViewport();
  bindShortcuts();

  state.editor.attachViewport(el.viewport);
  state.editor.layout();
  el.brushSizeVal.textContent = `${el.brushSize.value}px`;
  el.featherVal.textContent = `${el.feather.value}px`;
  el.qualityVal.textContent = `${Math.round(el.qualityRange.value * 100)}%`;

  // warm model pick: gpu when available
  if (!("gpu" in navigator)) state.device = "cpu";

  setStatus("Drop an image to remove its background — everything runs in your browser.");
}

init();