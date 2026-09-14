/** App initialization — analytics, service worker, model preload. */
import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";
import * as engine from "./engine.js";

export async function initApp({ state, el, buildGradientSwatches, bindUpload, bindControls, bindViewport, bindShortcuts, applyPrefs, addAvifOption, registerServiceWorker, showStatus }) {
  inject();
  injectSpeedInsights();

  buildGradientSwatches();
  bindUpload();
  bindControls();
  bindViewport();
  bindShortcuts();
  applyPrefs(state, el);
  await addAvifOption();
  registerServiceWorker();

  state.editor.attachViewport(el.viewport);
  state.editor.layout();
  el.brushSizeVal.textContent = `${el.brushSize.value}px`;
  el.featherVal.textContent = `${el.feather.value}px`;
  el.qualityVal.textContent = `${el.qualityRange.value}%`;

  // warm model pick: probe WebGPU properly, fall back to CPU otherwise
  engine.probeDevice().then((device) => {
    state.device = device;
  });

  showStatus("Drop an image to remove its background — everything runs in your browser.");

  // Model status chip
  let lastModelStatus = "idle";
  engine.onModelStatus((status) => {
    if (!el.modelStatus) return;
    lastModelStatus = status;
    if (status === "ready") {
      const backend = engine.getActiveBackend();
      el.modelStatus.textContent = backend === "gpu" ? "Model ready · GPU" : "Model ready · CPU";
      el.modelStatus.classList.add("ready");
      el.modelStatus.classList.remove("error");
      el.modelStatus.hidden = false;
    } else if (status === "loading") {
      el.modelStatus.textContent = "Preparing model…";
      el.modelStatus.classList.remove("ready", "error");
      el.modelStatus.hidden = false;
    } else if (status === "error") {
      el.modelStatus.textContent = "Model load failed — click to retry";
      el.modelStatus.classList.remove("ready");
      el.modelStatus.classList.add("error");
      el.modelStatus.hidden = false;
    } else {
      el.modelStatus.hidden = true;
    }
  });

  // Clicking the chip after a failed load forces a clean retry
  el.modelStatus?.addEventListener("click", () => {
    if (lastModelStatus !== "error") return;
    engine.resetModel();
    showToast("Retrying model load…");
    engine.preload({ model: state.model || engine.defaultModel(state.device), device: state.device }).catch(() => {
      /* the status chip already reflects the failure */
    });
  });

  // Prefetch the model only in the background
  const mayPrefetch = () => {
    const saveData = navigator.connection && navigator.connection.saveData;
    const mem = navigator.deviceMemory || 8;
    return !saveData && mem >= 4;
  };
  if (mayPrefetch()) {
    const warmUp = () => engine.preload({ model: state.model || engine.defaultModel(state.device), device: state.device });
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(warmUp, { timeout: 4000 });
    } else {
      setTimeout(warmUp, 800);
    }
  }
}

function showToast(msg) {
  // This will be replaced by the actual showToast from main
  console.log("Toast:", msg);
}