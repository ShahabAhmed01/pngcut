/** @module engine — thin wrapper around @imgly/background-removal. */

import { createSessionRegistry } from "./model-sessions.js";

let modulePromise = null;
const sessions = createSessionRegistry({
  preload: async (config) => (await loadEngine()).preload(config),
  segmentForeground: async (blob, config) => (await loadEngine()).segmentForeground(blob, config),
}, (status, entry) => {
  activeBackend = entry.device;
  setModelStatus(status);
});
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
  return typeof value === "string" && Object.hasOwn(MODEL_TIERS, value);
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
    modulePromise = import("@imgly/background-removal").catch((err) => {
      // A failed dynamic import caches its rejection forever; drop the
      // memoised promise so the next call (e.g. the retry chip) can retry it.
      modulePromise = null;
      throw err;
    });
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

/** Each model/backend pair retains its own loading promise and session. */
export function preload(options = {}) {
  const device = options.device || defaultDevice();
  const model = isModelTier(options.model) ? options.model : defaultModel(device);
  return sessions.preload(model, device, { ...CANONICAL_OUTPUT, ...options.output });
}

/** Failed entries are removed automatically; never purge healthy models. */
export function resetModel() {
  setModelStatus("idle");
}

export function getModelLoadStatus(model, device = defaultDevice()) {
  return sessions.status(model, device, CANONICAL_OUTPUT);
}

export async function segmentForeground(blob, options = {}) {
  const device = options.device || await probeDevice();
  const model = isModelTier(options.model) ? options.model : defaultModel(device);
  return sessions.segment(blob, model, device,
    { ...CANONICAL_OUTPUT, ...options.output }, options.onProgress);
}
