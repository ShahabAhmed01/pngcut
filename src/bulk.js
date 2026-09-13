/**
 * Bulk background removal — a queue of images processed sequentially on-device.
 * Items are validated up front, one failure does not poison the queue, and
 * completed results keep transparent (PNG) output with the working resolution
 * (see IMAGE_POLICY.maxDimension — very large sources are processed at a
 * bounded working size).
 */

import * as engine from "./engine.js";
import { loadImage, toCanvasMax, canvasToBlob, downloadBlob, formatBytes } from "./utils.js";
import { validateImageFile, isSvgFile, sanitizeFilename } from "./validate.js";
import { BULK_POLICY, ZIP_POLICY } from "./config.js";
import { createZipBlob } from "./zip.js";

const MAX_ITEMS = BULK_POLICY.maxItems;

export function initBulk({ showToast, goHome }) {
  const qs = (s) => document.querySelector(s);
  const el = {
    grid: qs("#bulk-grid"),
    count: qs("#bulk-count"),
    summary: qs("#bulk-summary"),
    add: qs("#btn-bulk-add"),
    download: qs("#btn-bulk-download"),
    zip: qs("#btn-bulk-zip"),
    retry: qs("#btn-bulk-retry"),
    cancel: qs("#btn-bulk-cancel"),
    clear: qs("#btn-bulk-clear"),
    home: qs("#btn-bulk-home"),
  };

  let items = [];
  let seq = 0;
  let running = false;
  let cancelFlag = false;

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    const svg = files.filter(isSvgFile).length;
    const valid = files.filter((f) => {
      const v = validateImageFile(f);
      return v.ok;
    });
    if (svg) {
      showToast(`Skipped ${svg} SVG file${svg === 1 ? "" : "s"} — bulk works on raster images.`);
    }
    if (!valid.length) {
      showToast("No images found — pick PNG, JPEG, WebP, GIF, AVIF or BMP files.");
      return;
    }
    const room = MAX_ITEMS - items.length;
    if (room <= 0) {
      showToast(`Bulk mode is limited to ${MAX_ITEMS} images per run.`);
      return;
    }
    const take = valid.slice(0, room);
    if (valid.length > take.length) {
      showToast(`Added the first ${take.length} images (limit ${MAX_ITEMS}).`);
    }
    for (const file of take) {
      items.push({
        id: ++seq,
        file,
        name: file.name || `image-${seq}.png`,
        status: "queued",
        error: null,
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
    return { queued: "Queued", processing: "Processing…", done: "Done", failed: "Failed", canceled: "Canceled" }[status] || status;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function cardHTML(item) {
    const done = item.status === "done";
    const failed = item.status === "failed";
    let actions;
    if (done) {
      actions = `<button type="button" class="pick-btn bulk-dl" data-dl="${item.id}">Download</button>`;
    } else if (failed) {
      actions = `<button type="button" class="pick-btn bulk-retry" data-retry="${item.id}">Retry</button>`;
    } else {
      actions = `<span class="bulk-size">${formatBytes(item.file.size)}</span>`;
    }
    const failText = failed && item.error ? `<span class="bulk-fail" title="${escapeHtml(item.error)}">${escapeHtml(item.error)}</span>` : "";
    return `
      <div class="bulk-thumb${done ? " done" : ""}">
        <img src="${done ? item.resultURL : item.thumbURL}" alt="" loading="lazy" />
        <span class="bulk-status s-${item.status}">${statusPill(item.status)}</span>
      </div>
      <p class="bulk-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</p>
      <div class="bulk-actions">${actions}
        <button type="button" class="bulk-remove" data-remove="${item.id}" aria-label="Remove ${escapeHtml(item.name)}">×</button>
      </div>
      ${failText}`;
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
    if (el.zip) el.zip.disabled = done === 0 || running;
    el.add.disabled = items.length >= MAX_ITEMS;
    if (el.retry) el.retry.classList.toggle("hidden", failed === 0);
  }

  function releaseItem(item) {
    if (item.thumbURL) URL.revokeObjectURL(item.thumbURL);
    if (item.resultURL) URL.revokeObjectURL(item.resultURL);
    item.thumbURL = null;
    item.resultURL = null;
    item.resultBlob = null;
  }

  async function processItem(item) {
    item.status = "processing";
    item.error = null;
    refreshCard(item);
    try {
      const img = await loadImage(item.file);
      const source = toCanvasMax(img, 4000);
      // Model tier resolves on-device (engine.defaultModel) unless overridden.
      const maskBlob = await engine.segmentForeground(item.file, {});
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
      item.error = "Couldn't process this image";
    }
    refreshCard(item);
    await new Promise((r) => setTimeout(r, 0));
  }

  async function run() {
    running = true;
    cancelFlag = false;
    el.cancel.classList.remove("hidden");
    updateBar();
    for (const item of items) {
      if (cancelFlag) break;
      if (item.status !== "queued") continue;
      await processItem(item);
    }
    // mark any still-queued items as canceled once we stop
    items.forEach((i) => {
      if (i.status === "queued") i.status = "canceled";
    });
    running = false;
    el.cancel.classList.add("hidden");
    renderGrid();
    updateBar();
    if (cancelFlag) showToast("Bulk processing canceled.");
  }

  function download(item) {
    if (!item.resultBlob) return;
    const base = sanitizeFilename(item.name, "image");
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

  /**
   * Pack every finished result into a single ZIP download. Sequential click
   * chains ("Download all") are blocked by popup/download defenders for more
   * than a handful of files — a ZIP is the reliable way to get N results at
   * once. Payload is capped by ZIP_POLICY to keep tab memory safe.
   */
  async function downloadZip() {
    const done = items.filter((i) => i.resultBlob);
    if (!done.length || running) return;
    showToast(`Packing ${done.length} PNG file${done.length === 1 ? "" : "s"}…`);
    const files = [];
    const used = new Set();
    let payload = 0;
    let packed = 0;
    for (const item of done) {
      if (payload + item.resultBlob.size > ZIP_POLICY.maxPayloadBytes) {
        showToast(
          `ZIP capped at ${formatBytes(ZIP_POLICY.maxPayloadBytes)} — packed ${packed} of ${done.length}. Use per-card downloads for the rest.`
        );
        break;
      }
      const base = sanitizeFilename(item.name, "image");
      let name = `${base}-no-bg.png`;
      let k = 2;
      while (used.has(name)) name = `${base}-no-bg-${k++}.png`;
      used.add(name);
      const data = new Uint8Array(await item.resultBlob.arrayBuffer());
      payload += data.length;
      packed += 1;
      files.push({ name, data });
    }
    if (!files.length) return;
    const blob = createZipBlob(files);
    downloadBlob(blob, "pngcut-no-bg.zip");
    showToast(`ZIP saved (${formatBytes(blob.size)})`);
  }

  function clearAll() {
    if (running) cancelFlag = true;
    for (const item of items) releaseItem(item);
    items = [];
    renderGrid();
    updateBar();
  }

  function removeItem(id) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if (item.status === "done" || item.status === "processing") return; // keep in-flight safe
    releaseItem(item);
    items = items.filter((i) => i.id !== id);
    renderGrid();
    updateBar();
  }

  function retryItem(id) {
    const item = items.find((i) => i.id === id);
    if (!item || running) return;
    if (item.resultURL) URL.revokeObjectURL(item.resultURL);
    item.resultURL = null;
    item.resultBlob = null;
    item.status = "queued";
    item.error = null;
    refreshCard(item);
    run();
  }

  function retryAll() {
    if (running) return;
    const failed = items.filter((i) => i.status === "failed");
    if (!failed.length) return;
    failed.forEach((i) => {
      i.status = "queued";
      i.error = null;
    });
    renderGrid();
    updateBar();
    run();
  }

  el.grid.addEventListener("click", (e) => {
    const dl = e.target.closest("[data-dl]");
    if (dl) {
      const item = items.find((i) => i.id === Number(dl.dataset.dl));
      if (item) download(item);
      return;
    }
    const retry = e.target.closest("[data-retry]");
    if (retry) {
      retryItem(Number(retry.dataset.retry));
      return;
    }
    const remove = e.target.closest("[data-remove]");
    if (remove) {
      removeItem(Number(remove.dataset.remove));
    }
  });

  el.add.addEventListener("click", () => document.querySelector("#bulk-input").click());
  el.download.addEventListener("click", downloadAll);
  if (el.zip) el.zip.addEventListener("click", downloadZip);
  el.clear.addEventListener("click", clearAll);
  if (el.retry) {
    el.retry.addEventListener("click", retryAll);
  }
  el.cancel.addEventListener("click", () => {
    cancelFlag = true;
  });
  if (el.home && goHome) el.home.addEventListener("click", goHome);

  updateBar();

  return { addFiles, retryAll };
}