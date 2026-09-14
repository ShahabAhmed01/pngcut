/** Viewport pointer interactions — pan, zoom, brush strokes, compare. */
import { clamp } from "./utils.js";

export function createViewportHandler({ state, el, getActiveTool, requestRender }) {
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

      if (getActiveTool() === "compare") {
        compareDragging = true;
        const img = state.editor.screenToImage(sx, sy);
        state.editor.setCompare(true, clamp(img.x / state.editor.width(), 0, 1));
        return;
      }

      if (getActiveTool() === "erase" || getActiveTool() === "restore") {
        if (e.button !== 0) return;
        state.editor.setBrushTool(getActiveTool());
        const img = state.editor.screenToImage(sx, sy);
        state.editor.beginStroke(img.x, img.y);
        return;
      }

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
      if (getActiveTool() === "erase" || getActiveTool() === "restore") {
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

  return { bindViewport };
}