/**
 * Bulk background removal — a queue of images processed sequentially on-device.
 * Each result keeps full source resolution with a transparent (PNG) background.
 */

import * as engine from "./engine.js";
import { loadImage, toCanvasMax, canvasToBlob, downloadBlob, formatBytes } from "./utils.js";

const MAX_ITEMS = 300;

export function initBulk({ showToast, goHome }) {
  const qs = (s) => document.querySelector(s);
  const el = {
    grid: qs("#bulk-grid"),
    count: qs("#bulk-count"),
    summary: qs("#bulk-summary"),
    add: qs("#btn-bulk-add"),
    download: qs("#btn-bulk-download"),
    cancel: qs("#btn-bulk-cancel"),
    clear: qs("#btn-bulk-clear"),
    home: qs("#btn-bulk-home"),
  };

  let items = [];
  let seq = 0;
  let running = false;
  let cancelFlag = false;

  function isImage(file) {
    return /^image\//.test(file.type || "") && !/^image\/svg/.test(file.type);
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter(isImage);
    if (!files.length) {
      showToast("No images found — pick PNG, JPEG, WebP, GIF, AVIF or BMP files.");
      return;
    }
    const room = MAX_ITEMS - items.length;
    if (room <= 0) {
      showToast(`Bulk mode is limited to ${MAX_ITEMS} images per run.`);
      return;
    }
    const take = files.slice(0, room);
    if (files.length > take.length) {
      showToast(`Added the first ${take.length} images (limit ${MAX_ITEMS}).`);
    }
    for (const file of take) {
      items.push({
        id: ++seq,
        file,
        name: file.name || `image-${seq}.png`,
        status: "queued",
        thumbURL: URL.createObjectURL(file),
        resultURL: null,
        resultBlob: null,
      });
    }
    renderGrid();
    updateBar();
    if (!running) run();
  }

  function statusPill(status) {
    return { queued: "Queued", processing: "Processing…", done: "Done", failed: "Failed" }[status] || status;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function cardHTML(item) {
    const done = item.status === "done";
    return `
      <div class="bulk-thumb${done ? " done" : ""}">
        <img src="${done ? item.resultURL : item.thumbURL}" alt="" loading="lazy" />
        <span class="bulk-status s-${item.status}">${statusPill(item.status)}</span>
      </div>
      <p class="bulk-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</p>
      <div class="bulk-actions">
        ${
          done
            ? `<button type="button" class="pick-btn bulk-dl" data-dl="${item.id}">Download</button>`
            : `<span class="bulk-size">${formatBytes(item.file.size)}</span>`
        }
      </div>`;
  }

  function renderGrid() {
    el.grid.innerHTML = items
      .map((item) => `<div class="bulk-card ${item.status}" data-id="${item.id}">${cardHTML(item)}</div>`)
      .join("");
  }

  function refreshCard(item) {
    const card = el.grid.querySelector(`.bulk-card[data-id="${item.id}"]`);
    if (card) card.innerHTML = cardHTML(item);
    updateBar();
  }

  function updateBar() {
    const done = items.filter((i) => i.status === "done").length;
    const failed = items.filter((i) => i.status === "failed").length;
    el.count.textContent = `${items.length} image${items.length === 1 ? "" : "s"}`;
    el.summary.textContent = done ? `${done} done${failed ? ` · ${failed} failed` : ""}` : "";
    el.download.disabled = done === 0 || running;
    el.add.disabled = items.length >= MAX_ITEMS;
  }

  async function run() {
    running = true;
    cancelFlag = false;
    el.cancel.classList.remove("hidden");
    for (const item of items) {
      if (cancelFlag) break;
      if (item.status !== "queued") continue;
      item.status = "processing";
      refreshCard(item);
      try {
        const img = await loadImage(item.file);
        const source = toCanvasMax(img, 4000);
        const maskBlob = await engine.segmentForeground(item.file, { model: "medium", device: "gpu" });
        const maskImg = await loadImage(maskBlob);
        const fg = document.createElement("canvas");
        fg.width = source.width;
        fg.height = source.height;
        const fctx = fg.getContext("2d");
        fctx.drawImage(source, 0, 0);
        fctx.globalCompositeOperation = "destination-in";
        fctx.drawImage(maskImg, 0, 0, source.width, source.height);
        const blob = await canvasToBlob(fg, "image/png");
        item.resultBlob = blob;
        item.resultURL = URL.createObjectURL(blob);
        item.status = "done";
      } catch (err) {
        console.error("bulk item failed:", item.name, err);
        item.status = "failed";
      }
      refreshCard(item);
      await new Promise((r) => setTimeout(r, 0));
    }
    running = false;
    el.cancel.classList.add("hidden");
    updateBar();
    if (cancelFlag) showToast("Bulk processing canceled.");
  }

  function download(item) {
    if (!item.resultBlob) return;
    const base = item.name.replace(/\.[^.]+$/, "");
    downloadBlob(item.resultBlob, `${base}-nobg.png`);
  }

  async function downloadAll() {
    const done = items.filter((i) => i.resultBlob);
    if (!done.length) return;
    showToast(`Downloading ${done.length} PNG file${done.length === 1 ? "" : "s"}…`);
    for (const item of done) {
      download(item);
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  function clearAll() {
    if (running) cancelFlag = true;
    for (const item of items) {
      URL.revokeObjectURL(item.thumbURL);
      if (item.resultURL) URL.revokeObjectURL(item.resultURL);
    }
    items = [];
    renderGrid();
    updateBar();
  }

  el.grid.addEventListener("click", (e) => {
    const dl = e.target.closest("[data-dl]");
    if (dl) {
      const item = items.find((i) => i.id === Number(dl.dataset.dl));
      if (item) download(item);
    }
  });

  el.add.addEventListener("click", () => document.querySelector("#bulk-input").click());
  el.download.addEventListener("click", downloadAll);
  el.clear.addEventListener("click", clearAll);
  el.cancel.addEventListener("click", () => {
    cancelFlag = true;
  });
  if (el.home && goHome) el.home.addEventListener("click", goHome);

  return { addFiles };
}
