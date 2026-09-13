/** @module engine — thin wrapper around @imgly/background-removal. */

let modulePromise = null;
let preloadPromise = null;
let modelStatus = "idle"; // "idle" | "loading" | "ready" | "error"
let activeBackend = "unknown"; // "gpu" | "cpu" | "unknown"
let deviceProbe = null; // memoized WebGPU probe result
const statusListeners = new Set();

/** Clear the service-worker–cached copies of the model/runtime assets so a
 *  stale or corrupt SW cache can't poison the next load. Best-effort / no-op
 *  when SW isn't controlling the page. */
function clearModelCache() {
  if (typeof self === "undefined" || !self.caches) return;
  const cacheNames = [
    `pngcut-model-v1`,
    `pngcut-model-v1-old`,
    `pngcut-model`,
    `imgly-model`,
    `imgly-resources`,
  ];
  cacheNames.forEach((name) => caches.delete(name));
  // Also nudge the SW to skipWaiting so a fresh install sees the new policy.
  if (typeof self !== "undefined" && typeof self.skipWaiting === "function") {
    self.skipWaiting().catch(() => {});
  }
}

/** Retry policy for model loads that fail (network hiccup, SW serving a corrupt
 *  cache, transient WebGPU init failure, …). Backing off here avoids hammering
 *  the CDN / the browser's own connection pool on repeated quick retries.
 */
const RETRY_POLICY = {
  maxAttempts: 4,
  baseDelayMs: 1200,
  backoff: 2,
  jitter: 0.25,
};

/** Bounded exponential backoff with small jitter so concurrent retries don't
 *  all land on the CDN at the exact same instant. */
function backoffDelay(attempt) {
  const factor = Math.pow(RETRY_POLICY.backoff, attempt);
  const base = RETRY_POLICY.baseDelayMs * factor;
  const jitter = base * RETRY_POLICY.jitter * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

/** Retry `fn` up to `RETRY_POLICY.maxAttempts` times with exponential backoff.
 *  On each failure we clear the SW model cache first so a stale/corrupt cache
 *  is not re-served on the next attempt. Returns the first successful result or
 *  throws the final error. */
async function withRetry(fn) {
  let lastErr = null;
  for (let attempt = 0; attempt < RETRY_POLICY.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(
        `Model load attempt ${attempt + 1}/${RETRY_POLICY.maxAttempts} failed.`,
        err
      );
      // Don't sleep after the last attempt — throw immediately.
      if (attempt + 1 >= RETRY_POLICY.maxAttempts) break;
      clearModelCache();
      await new Promise((r) => setTimeout(r, backoffDelay(attempt)));
    }
  }
  throw lastErr;
}

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
 *
 * Single-flight: calling it again while loading returns the same promise, and
 * once ready the session stays resident in memory for the whole tab.
 *
 * Retries: if the load fails (network hiccup, SW serving a stale/corrupt model
 * cache, transient WebGPU init failure, …) we retry up to
 * `RETRY_POLICY.maxAttempts` times with exponential backoff. Each retry clears
 * the service-worker model cache first so a stale cache isn't re-served.
 *
 * In-flight persistence: the (possibly retrying) promise is kept as
 * `preloadPromise` while it is still settling, so concurrent calls that arrive
 * during a retry see the same promise instead of starting a brand-new load.
 * Once the promise settles to an *error* we clear it so the next call starts
 * fresh.
 */
export function preload(options = {}) {
  const model = isModelTier(options.model) ? options.model : defaultModel(options.device);
  const device = options.device || defaultDevice();
  if (preloadPromise) return preloadPromise;

  setModelStatus("loading");
  preloadPromise = (async () => {
    const engine = await loadEngine();
    await withRetry(() => engine.preload(makeConfig(model, device)));
    activeBackend = device;
    setModelStatus("ready");
    return true;
  })().catch((err) => {
    preloadPromise = null;
    setModelStatus("error");
    throw err;
  });
  return preloadPromise;
}

/**
 * Force a fresh model load on next use. Clears any in-flight promise and the
 * service-worker–cached model assets so the next `preload`/`segmentForeground`
 * call starts from a clean state. Primarily intended as a user-facing "retry"
 * path after a persistent failure.
 */
export function resetModel() {
  preloadPromise = null;
  clearModelCache();
  setModelStatus("idle");
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

  // Ensure the canonical session is loaded before we try to run inference on
  // it. If a load is already in flight (preloadPromise) we join it; otherwise
  // we start one ourselves and *wait* for it before calling segmentForeground —
  // the old code called preload() and then immediately ran inference, which
  // races on a cold start and produces the "model failed to load" error that
  // also fails to recover on retry.
  if (modelStatus !== "ready") {
    await preload({ model, device });
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