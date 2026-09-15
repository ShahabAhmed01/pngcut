/** Control binding — buttons, sliders, selects. */
import * as engine from "./engine.js";
import { ZOOM_DEFAULTS } from "./constants.js";

export function createControlsHandler({ state, el, showToast, setTool, savePrefs, requestRender }) {
  function bindControls() {
    el.newImage.addEventListener("click", () => {
      el.fileInput.value = "";
      el.fileInput.click();
    });

    el.undo.addEventListener("click", () => state.editor.undo());
    el.redo.addEventListener("click", () => state.editor.redo());

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

    el.qualityRange.addEventListener("input", () => {
      state.quality = Number(el.qualityRange.value);
      el.qualityVal.textContent = `${el.qualityRange.value}%`;
    });

    // Model quality tier (persisted; null = resolve on-device)
    if (el.modelSelect) {
      el.modelSelect.addEventListener("change", () => {
        const v = el.modelSelect.value;
        state.model = engine.isModelTier(v) ? v : null;
        savePrefs(state.model, state.refine);
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
        savePrefs(state.model, state.refine);
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
      const { w, h } = state.editor.viewportSize();
      const cx = w / 2;
      const cy = h / 2;
      state.editor.zoom(ZOOM_DEFAULTS.factor, cx, cy);
      requestRender();
    });
    el.zoomOut.addEventListener("click", () => {
      const { w, h } = state.editor.viewportSize();
      const cx = w / 2;
      const cy = h / 2;
      state.editor.zoom(1 / ZOOM_DEFAULTS.factor, cx, cy);
      requestRender();
    });
    el.zoomFit.addEventListener("click", () => {
      state.editor.fit();
      requestRender();
    });
  }

  return { bindControls };
}