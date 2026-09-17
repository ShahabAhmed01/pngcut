/** Tab-local session registry. The adapter owns model-specific initialization. */
export function createSessionRegistry(adapter, notify = () => {}) {
  const entries = new Map();
  const attempts = new Map();
  function keyFor(model, device, output) {
    return JSON.stringify([model, device, output.format, output.quality]);
  }
  function ensure(model, device, output) {
    const key = keyFor(model, device, output);
    if (entries.has(key)) return entries.get(key);
    const attempt = attempts.get(key) || 0;
    const entry = { model, device, status: "loading", listeners: new Set(), fallback: null };
    entry.config = {
      model, device, output,
      // IMG.LY memoizes even rejected promises. A new config key permits a
      // real retry without evicting successful models or clearing disk caches.
      fetchArgs: { credentials: "omit", headers: { "Accept": `*/*;pngcut-attempt=${attempt}` } },
      progress: (...args) => entry.listeners.forEach((listener) => listener(...args)),
    };
    entries.set(key, entry);
    entry.promise = Promise.resolve().then(async () => {
      notify("loading", entry);
      try {
        await adapter.preload(entry.config);
      } catch (error) {
        if (device !== "gpu") throw error;
        const cpu = ensure(model, "cpu", output);
        const forward = (...args) => entry.listeners.forEach((listener) => listener(...args));
        cpu.listeners.add(forward);
        try {
          await cpu.promise;
        } finally {
          cpu.listeners.delete(forward);
        }
        entry.fallback = cpu;
      }
      entry.status = "ready";
      notify("ready", entry.fallback || entry);
      return true;
    }).catch((error) => {
      entry.status = "error";
      entries.delete(key);
      attempts.set(key, attempt + 1);
      notify("error", entry);
      throw error;
    });
    return entry;
  }
  async function segment(blob, model, device, output, onProgress) {
    const requested = ensure(model, device, output);
    const listener = (...args) => onProgress?.(...args);
    requested.listeners.add(listener);
    let actual = requested;
    try {
      await requested.promise;
      actual = requested.fallback || requested;
      actual.listeners.add(listener);
      notify("ready", actual);
      try {
        return await adapter.segmentForeground(blob, actual.config);
      } catch (error) {
        if (actual.device !== "gpu") throw error;
        const cpu = ensure(model, "cpu", output);
        cpu.listeners.add(listener);
        try {
          await cpu.promise;
          const result = await adapter.segmentForeground(blob, cpu.config);
          requested.fallback = cpu;
          notify("ready", cpu);
          return result;
        } finally {
          cpu.listeners.delete(listener);
        }
      }
    } finally {
      requested.listeners.delete(listener);
      actual.listeners.delete(listener);
    }
  }
  return {
    preload: (model, device, output) => ensure(model, device, output).promise,
    segment,
    status: (model, device, output) => entries.get(keyFor(model, device, output))?.status || "idle",
  };
}
