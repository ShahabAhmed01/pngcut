/** @module engine — thin wrapper around @imgly/background-removal */

let modulePromise = null;

export function loadEngine() {
  if (!modulePromise) {
    modulePromise = import("@imgly/background-removal");
  }
  return modulePromise;
}

/**
 * Produce an alpha mask for `blob` (white = keep foreground).
 * @param {Blob} blob
 * @param {{model?:string, device?:string, onProgress?:function}} options
 */
export async function segmentForeground(blob, options = {}) {
  const engine = await loadEngine();
  const config = {
    model: options.model || "medium",
    device: options.device || "gpu",
    output: { format: "image/png", quality: 1.0 },
    progress: (key, current, total) => {
      if (typeof options.onProgress === "function") {
        options.onProgress(key, current, total);
      }
    },
  };
  return engine.segmentForeground(blob, config);
}

export { loadEngine as preload };