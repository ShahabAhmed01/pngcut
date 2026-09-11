import { defineConfig } from "vite";
import { resolve } from "node:path";

// Cross-origin isolation unlocks multi-threaded WASM (SharedArrayBuffer),
// which dramatically speeds up onnxruntime-web inference.
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

export default defineConfig({
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  server: {
    headers: isolationHeaders,
  },
  preview: {
    headers: isolationHeaders,
  },
});