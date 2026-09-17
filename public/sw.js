/**
 * PNGCut service worker — real offline support + one-time model caching.
 *
 * Strategies:
 *  - Navigations (HTML pages): network-first with cache fallback, so deploys
 *    go live immediately while an offline copy always remains available.
 *  - Hashed build assets (/assets/…): cache-first — the filenames are
 *    content-hashed, so a cache hit is always correct.
 *  - Model/runtime assets (staticimgly.com): stale-while-revalidate — the
 *    ~40 MB model is served instantly from cache after first download and
 *    refreshed in the background when the CDN copy changes.
 *  - Analytics: untouched (always network, never cached).
 */

const VERSION = "v1.2.0";
const SHELL_CACHE = `pngcut-shell-${VERSION}`;
const ASSET_CACHE = `pngcut-assets-${VERSION}`;
const MODEL_CACHE = `pngcut-model-${VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/privacy.html",
  "/models.html",
  "/404.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Precache best-effort: a single failure must not break the install.
      await Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: "reload" })))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, ASSET_CACHE, MODEL_CACHE]);
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/** Cache-first, updating the cache in the background (stale-while-revalidate). */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // 1) App navigations — network-first, fall back to cache, then to index.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(request, response.clone());
          return response;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match(request)) ||
            (await cache.match("/index.html")) ||
            (await cache.match("/")) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  // 2) Hashed build assets — immutable, cache-first.
  if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((c) => c.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  // 3) Model/runtime assets — the big one-time downloads. SWR keeps later
  //    runs instant (even offline) and self-updating.
  if (url.hostname === "staticimgly.com") {
    event.respondWith(staleWhileRevalidate(request, MODEL_CACHE));
    return;
  }

  // 4) Everything else (including analytics) — plain network passthrough.
});