/** @module engine — thin wrapper around @imgly/background-removal. */

let modulePromise = null;
let preloadPromise = null;
let modelStatus = "idle"; // "idle" | "loading" | "ready" | "error"
let activeBackend = "unknown"; // "gpu" | "cpu" | "unknown"
let deviceProbe = null; // memoized WebGPU probe result
const statusListeners = new Set();

// Every call shares this canonical output shape so all code paths (image
// editor, video frames, bulk jobs) produce the same memoisation key.
const CANONICAL_OUTPUT = { format: "image/png", quality: 1.0 };

/**
 * Model tiers exposed by @imgly (ISNet variants):
 *   large  → "isnet"          full-precision FP32
 *   medium → "isnet_fp16"     half precision (default)
 *   small  → "isnet_quint8"   8-bit quantized
 */
export const MODEL_TIERS = {
  large: { label: "Best", hint: "Full-precision ISNet — finest edges, largest download" },
  medium: { label: "Balanced", hint: "FP16 ISNet — recommended for most devices" },
  small: { label: "Fast", hint: "Quantized ISNet — quickest, smallest download" },
};

export function isModelTier(value) {
  return typeof value === "string" && value in MODEL_TIERS;
}

/** Synchronous hint: used only as an initial guess before `probeDevice`. */
export function defaultDevice() {
  return typeof navigator !== "undefined" && "gpu" in navigator ? "gpu" : "cpu";
}

/**
 * Device-aware default tier. WebGPU devices comfortably run the balanced FP16
 * model; CPU-only, low-memory devices default to the quantized model so the
 * first run stays responsive. The user can always override in the toolbar.
 */
export function defaultModel(device = defaultDevice()) {
  if (device === "cpu") {
    const mem = typeof navigator !== "undefined" ? navigator.deviceMemory || 8 : 8;
    if (mem > 0 && mem < 4) return "small";
    return "medium";
  }
  return "medium";
}

/**
 * A real WebGPU capability probe, not just `"gpu" in navigator`. Tries to
 * obtain an adapter; only returns "gpu" if that actually succeeds in a secure
 * context. Memoized per tab — one adapter request, ever.
 */
export async function probeDevice() {
  if (deviceProbe) return deviceProbe;
  deviceProbe = (async () => {
    try {
      if (typeof navigator === "undefined" || !("gpu" in navigator)) return "cpu";
      if (typeof window === "undefined" || !window.isSecureContext) return "cpu";
      const adapter = await navigator.gpu.requestAdapter();
      return adapter ? "gpu" : "cpu";
    } catch {
      return "cpu";
    }
  })();
  deviceProbe.catch(() => {
    deviceProbe = null; // allow a retry if the probe itself blew up
  });
  return deviceProbe;
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

export function getModelStatus() {
  return modelStatus;
}

export function getActiveBackend() {
  return activeBackend;
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
    model: isModelTier(model) ? model : "medium",
    device: device === "gpu" ? "gpu" : "cpu",
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
  const model = isModelTier(options.model) ? options.model : defaultModel(options.device);
  const device = options.device || defaultDevice();
  setModelStatus("loading");
  preloadPromise = (async () => {
    const engine = await loadEngine();
    await engine.preload(makeConfig(model, device));
    activeBackend = device;
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
  const resolvedDevice = await probeDevice();
  const engine = await loadEngine();
  const model = isModelTier(options.model) ? options.model : defaultModel(resolvedDevice);
  const device = options.device === "gpu" || options.device === "cpu" ? options.device : resolvedDevice;
  const config = makeConfig(model, device, options.output, options.onProgress);

  activeBackend = device;

  // Warm the canonical session (if a cold start) so this very call and every
  // later one reuse the exact same loaded model — no re-downloads, no re-init.
  if (!preloadPromise && modelStatus !== "ready") {
    preload({ model, device });
  }
  try {
    return await engine.segmentForeground(blob, config);
  } catch (err) {
    // WebGPU can fail mid-inference even after a successful probe; retry on CPU
    // once before giving up, so a GPU hiccup doesn't strand the user.
    if (device === "gpu") {
      console.warn("GPU inference failed; retrying on CPU.", err);
      activeBackend = "cpu";
      return engine.segmentForeground(blob, makeConfig(model, "cpu", options.output, options.onProgress));
    }
    throw err;
  }
}