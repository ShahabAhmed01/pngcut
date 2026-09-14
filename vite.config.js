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
    writeBundle() {
      const pkgPath = path.resolve(__dirname, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const version = pkg.version;

      const swPath = path.resolve(__dirname, "public/sw.js");
      let swContent = fs.readFileSync(swPath, "utf-8");
      swContent = swContent.replace(/const VERSION = "v\d+";/, `const VERSION = "v${version}";`);
      fs.writeFileSync(swPath, swContent);
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