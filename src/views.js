/** View management — switching between hero, editor, bulk, video. */
export function createViewsHandler({ el, state, requestRender }) {
  function showView(name) {
    el.hero.classList.toggle("hidden", name !== "hero");
    el.editor.classList.toggle("hidden", name !== "editor");
    el.bulkView.classList.toggle("hidden", name !== "bulk");
    el.videoView.classList.toggle("hidden", name !== "video");
    el.dropzone.classList.toggle("dropzone--compact", name === "editor");
  }

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

  function setStatus(msg) {
    el.statusHint.textContent = msg;
  }

  return { showView, showEditor, showProgress, updateProgress, setStatus };
}