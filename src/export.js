/** Export handling — encode, download, copy to clipboard. */
import { canvasToBlob, downloadBlob, formatBytes } from "./utils.js";
import { sanitizeFilename } from "./validate.js";
import { EXPORT_FORMATS } from "./config.js";

export function createExportHandler({ state, el, showToast }) {
  /** Shared encoder for Download + Copy. Returns { blob, format, mime }. */
  async function encodeResult() {
    const format = el.formatSelect.value;
    const quality = Number(el.qualityRange.value);
    const transparent = el.transparentToggle.checked && format !== "jpeg";

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
    const includeBg = state.editor.background.type !== "transparent";
    const result = state.editor.renderFull("#ffffff", includeBg);
    return canvasToBlob(result, "image/png");
  }

  function bindExport() {
    el.download.addEventListener("click", doDownload);

    if (el.copy) {
      const supported =
        typeof navigator !== "undefined" && navigator.clipboard && typeof window.ClipboardItem === "function";
      el.copy.classList.toggle("hidden", !supported);
      el.copy.addEventListener("click", doCopy);
    }

    el.formatSelect.addEventListener("change", () => {
      // JPEG cannot preserve transparency — disable the toggle and explain.
      const opaque = el.formatSelect.value === "jpeg";
      el.transparentToggle.disabled = opaque;
      el.transparentToggle.checked = !opaque;
      el.transparentToggle.closest(".toggle-row").classList.toggle("is-disabled", opaque);
      if (el.exportSize) el.exportSize.textContent = "";
    });
  }

  return { doDownload, doCopy, bindExport };
}