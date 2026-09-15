/** Keyboard shortcuts overlay and global hotkeys. */
export function createShortcutsHandler({ state, el, setTool, doDownload, doCopy }) {
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
        if (doCopy) doCopy();
      } else if (mod && e.key.toLowerCase() === "s") {
        // save/download
        e.preventDefault();
        if (!el.editor.classList.contains("hidden") && doDownload) {
          await doDownload();
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

  function downloadResult() {
    if (doDownload) doDownload();
  }

  return { bindShortcuts, toggleShortcuts };
}