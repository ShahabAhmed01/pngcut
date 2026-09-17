/** Targeted reproduction of the user-facing complaint: "once a model is
 *  downloaded it stays — no re-downloading for new images". The tab-session
 *  tests cover in-memory reuse; this file pins the service worker's disk-cache
 *  contract: a warm model asset is served with NO network request at all. */
import { beforeEach, expect, it, vi } from "vitest";

const listeners = new Map();
const cache = { match: vi.fn(), put: vi.fn() };
const fetchMock = vi.fn();

class FakeResponse {
  constructor(ok = true) {
    this.ok = ok;
    this.type = "basic";
  }
  clone() { return this; }
}

const MODEL_URL = "https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/models/isnet_fp16";

function dispatchFetch() {
  let captured;
  const event = {
    request: { method: "GET", mode: "cors", url: MODEL_URL },
    respondWith: (promise) => { captured = promise; },
  };
  listeners.get("fetch")(event);
  return captured;
}

beforeEach(async () => {
  vi.resetModules();
  listeners.clear();
  cache.match.mockReset().mockResolvedValue(undefined);
  cache.put.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockResolvedValue(new FakeResponse());
  vi.stubGlobal("self", {
    addEventListener: (name, handler) => listeners.set(name, handler),
    location: { origin: "https://pngcut.example" },
    skipWaiting: vi.fn(),
  });
  vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("Response", FakeResponse);
  await import("../public/sw.js");
});

it("serves a warm model asset with zero network requests", async () => {
  const cached = new FakeResponse();
  cache.match.mockResolvedValue(cached);

  const response = await dispatchFetch();

  expect(response).toBe(cached);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(cache.put).not.toHaveBeenCalled();
});

it("downloads and caches a model asset that is not cached yet", async () => {
  const response = await dispatchFetch();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(cache.put).toHaveBeenCalledTimes(1);
  expect(response.ok).toBe(true);

  // A second load of the same model must now be served from cache only.
  cache.match.mockResolvedValue(response);
  fetchMock.mockClear();
  cache.put.mockClear();
  await dispatchFetch();
  expect(fetchMock).not.toHaveBeenCalled();
});
