/** @module engine — thin wrapper around @imgly/background-removal. */

let modulePromise = null;
let preloadPromise = null;
let modelStatus = "idle"; // "idle" | "loading" | "ready" | "error"
const statusListeners = new Set();

// Every call shares this canonical output shape so all code paths (image
// editor, video frames, bulk jobs) produce the same memoisation key.
const CANONICAL_OUTPUT = { format: "image/png", quality: 1.0 };

export function defaultModel() {
  return "medium";
}

/** WebGPU when the browser supports it, plain WASM otherwise. */
export function defaultDevice() {
  return typeof navigator !== "undefined" && "gpu" in navigator ? "gpu" : "cpu";
}

export function loadEngine() {
  if (!modulePromise) {
    modulePromise = import("@imgly/background-removal");
  }
  return modulePromise;
}

/** Subscribe to model lifecycle changes: idle → loading → ready (or error). */
export function onModelStatus(cb) {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

function setModelStatus(status) {
  modelStatus = status;
  statusListeners.forEach((cb) => cb(status));
}

/**
 * Build a config that always has the exact same property shape (including JSON
 * key order). @imgly's `init` is memoised with `JSON.stringify(config)` as the
 * cache key and keeps its sessions alive for the whole tab lifetime — so
 * identical configs reuse the same ONNX session and the model is downloaded and
 * initialized exactly once per tab. (Function values are dropped by
 * JSON.stringify, so `progress` / `onProgress` never affect the cache key.)
 */
function makeConfig(model, device, output, onProgress) {
  return {
    model,
    device,
    output: output || CANONICAL_OUTPUT,
    progress: typeof onProgress === "function" ? onProgress : undefined,
  };
}

/**
 * Load the model + create the inference session now, in the background.
 * Single-flight: calling it again while loading returns the same promise, and
 * once ready the session stays resident in memory for the whole tab.
 */
export function preload(options = {}) {
  if (preloadPromise) return preloadPromise;
  const model = options.model || defaultModel();
  const device = options.device || defaultDevice();
  setModelStatus("loading");
  preloadPromise = (async () => {
    const engine = await loadEngine();
    await engine.preload(makeConfig(model, device));
    setModelStatus("ready");
    return true;
  })().catch((err) => {
    console.warn("Model preload failed; it will retry automatically on first use.", err);
    preloadPromise = null;
    setModelStatus("error");
    throw err;
  });
  return preloadPromise;
}

/**
 * Produce an alpha mask for `blob` (white = keep foreground).
 * @param {Blob} blob
 * @param {{model?:string, device?:string, output?:object, onProgress?:function}} options
 */
export async function segmentForeground(blob, options = {}) {
  const engine = await loadEngine();
  const model = options.model || defaultModel();
  const device = options.device || defaultDevice();
  const config = makeConfig(model, device, options.output, options.onProgress);
  // Warm the canonical session (if a cold start) so this very call and every
  // later one reuse the exact same loaded model — no re-downloads, no re-init.
  if (!preloadPromise && modelStatus !== "ready") {
    preload({ model, device });
  }
  return engine.segmentForeground(blob, config);
}