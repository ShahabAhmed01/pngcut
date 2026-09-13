import { defineConfig } from "vite";

// Cross-origin isolation unlocks multi-threaded WASM (SharedArrayBuffer),
// which dramatically speeds up onnxruntime-web inference.
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

/**
 * Clean URLs in dev/preview: Vercel's `cleanUrls` serves /about → about.html in
 * production; these middlewares give local dev + preview the same behavior so
 * clean-URL links never 404 outside production.
 */
const STATIC_PAGES = new Set([
  "about",
  "api",
  "contact",
  "privacy",
  "support",
  "terms",
]);

function cleanUrlMiddleware(server) {
  server.middlewares.use((req, res, next) => {
    const path = (req.url || "").split("?")[0].split("#")[0];
    const name = path.replace(/^\/+|\/+$/g, "");
    if (name && STATIC_PAGES.has(name) && !name.includes(".")) {
      req.url = `/${name}.html`;
    }
    next();
  });
}

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
  plugins: [
    {
      name: "pngcut-clean-urls",
      configureServer: cleanUrlMiddleware,
      configurePreviewServer: cleanUrlMiddleware,
    },
  ],
});