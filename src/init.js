/** App initialization — analytics, service worker, model preload. */
import { inject } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";
import * as engine from "./engine.js";
import { bindModelInfo } from "./model-info.js";
import { startModelWarmup } from "./model-warmup.js";

export async function initApp({ state, el, buildGradientSwatches, bindUpload, bindControls, bindViewport, bindShortcuts, applyPrefs, addAvifOption, registerServiceWorker, showStatus, showToast }) {
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

  // warm model pick: probe WebGPU properly, fall back to CPU otherwise.
  // Await the probe so the warm-up below (and the retry chip) use the *real*
  // device instead of the synchronous "gpu in navigator" guess — a probe that
  // resolves later to "cpu" used to leave the prefetch loading on a GPU the
  // device may not be able to actually run inference on.
  const device = await engine.probeDevice();
  state.device = device;

  showStatus("Drop an image to remove its background — everything runs in your browser.");

  startModelWarmup({ state, chip: el.modelStatus, showToast });
  bindModelInfo({ state, select: el.modelSelect, description: el.modelDescription, reset: el.reset });
}