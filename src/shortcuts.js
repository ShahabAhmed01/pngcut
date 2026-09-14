/** Keyboard shortcuts overlay and global hotkeys. */
export function createShortcutsHandler({ state, el, setTool, showToast }) {
  function toggleShortcuts(show = !el.shortcutsDialog.classList.contains("hidden")) {
    el.shortcutsDialog.classList.toggle("hidden", !show);
    if (show) el.shortcutsClose?.focus();
    else el.shortcutsBtn?.focus();
  }

  function bindShortcuts() {
    document.addEventListener("keydown", async (e) => {
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
      } else if (mod && e.key.toLowerCase() === "s") {
        // save/download
        e.preventDefault();
        if (!el.editor.classList.contains("hidden")) {
          const { doDownload } = await import("./export.js");
          await doDownload({ state, el, showToast });
        }
      } else if (!e.target.matches("input,textarea,select") && el.editor && !el.editor.classList.contains("hidden")) {
        if (e.key === "b") setTool("erase");
        else if (e.key === "r") setTool("restore");
        else if (e.key === "c") setTool("compare");
        else if (e.key === "g") setTool("bg");
        else if (e.key === "[") state.editor.adjustBrushSize(-5);
        else if (e.key === "]") state.editor.adjustBrushSize(5);
        else if (e.key === "0") state.editor.fit(); // Fit to screen
        else if (e.key === "t") toggleTransparent(); // Toggle transparent bg
        else if (e.key === "f") toggleFeather(); // Toggle feather
        else if (e.key === "d") downloadResult(); // Download
      }
    });

    el.shortcutsBtn?.addEventListener("click", () => toggleShortcuts());
    el.shortcutsClose?.addEventListener("click", () => toggleShortcuts(false));
    el.shortcutsDialog?.addEventListener("click", (e) => {
      if (e.target === el.shortcutsDialog) toggleShortcuts(false);
    });
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
      const { canvasToBlob } = await import("./utils.js");
      const { EXPORT_FORMATS } = await import("./config.js");
      const format = el.formatSelect.value;
      const quality = Number(el.qualityRange.value);
      const transparent = el.transparentToggle.checked && format !== "jpeg";
      const bgIsTransparent = state.editor.background.type === "transparent";
      const includeBg = !bgIsTransparent || !transparent;
      const result = state.editor.renderFull("#ffffff", includeBg);
      const fmt = EXPORT_FORMATS[format] || EXPORT_FORMATS.png;
      const mime = fmt.mime;
      let blob = await canvasToBlob(result, mime, format === "png" ? undefined : quality);
      const png = blob.type === "image/png" ? blob : await canvasToBlob(result, "image/png");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      showToast("Result copied to clipboard (PNG).");
    } catch (err) {
      console.warn("copy failed", err);
      showToast("Couldn't copy the result — try downloading instead.");
    }
  }

  function toggleTransparent() {
    if (el.formatSelect.value !== "jpeg") {
      el.transparentToggle.checked = !el.transparentToggle.checked;
      el.transparentToggle.dispatchEvent(new Event("change"));
    }
  }

  function toggleFeather() {
    const current = Number(el.feather.value);
    if (current > 0) {
      el.feather.value = 0;
    } else {
      el.feather.value = 2;
    }
    el.feather.dispatchEvent(new Event("input"));
  }

  async function downloadResult() {
    const { doDownload } = await import("./export.js");
    await doDownload({ state, el, showToast });
  }

  return { bindShortcuts, toggleShortcuts };
}