import { defineConfig } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  "models",
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

/** Vite plugin to inject version into service worker at build time. */
function swVersionPlugin() {
  return {
    name: "pngcut-sw-version",
    closeBundle() {
      const pkgPath = path.resolve(__dirname, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const version = pkg.version;

      // Target the BUILT file in dist/, NOT the source file in public/
      const swPath = path.resolve(__dirname, "dist/sw.js");
      if (!fs.existsSync(swPath)) return;
      const c = fs.readFileSync(swPath, "utf-8")
        .replace(/const VERSION = "[^"]+";/, `const VERSION = "v${version}";`);
      fs.writeFileSync(swPath, c);
    },
  };
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
    swVersionPlugin(),
  ],
});