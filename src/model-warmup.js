import * as engine from "./engine.js";

// One startup task per app state, even if initialization is called twice.
const warmups = new WeakMap();

/** Non-blocking warm-up. Progress describes the current asset, not a fake total. */
export function startModelWarmup({ state, chip, showToast = () => {} }) {
  if (warmups.has(state)) return warmups.get(state);
  const model = state.model || engine.defaultModel(state.device);
  const device = state.device;
  const label = engine.MODEL_TIERS[model].label;
  let status = "idle";
  let task;
  const render = (next, text) => {
    status = next;
    if (!chip) return;
    chip.hidden = false;
    chip.textContent = text;
    chip.classList.remove("loading", "ready", "error");
    if (next !== "idle") chip.classList.add(next);
    chip.setAttribute("aria-disabled", String(next !== "error"));
    chip.title = `${label} · retained in this tab; other models load when needed`;
  };
  const run = () => {
    if (status === "loading") return task;
    render("loading", `Preparing AI model · ${label}…`);
    task = engine.preload({
      model, device,
      onProgress: (key, current, total) => {
        if (status !== "loading" || !String(key).startsWith("fetch:")) return;
        if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return;
        const percent = Math.round(Math.min(1, Math.max(0, current / total)) * 100);
        render("loading", `Preparing AI model · ${label} · current asset ${percent}%`);
      },
    }).then(() => {
      const backend = engine.getModelBackend(model, device).toUpperCase();
      render("ready", `AI model ready · ${label} · ${backend}`);
    }).catch(() => {
      render("error", `${label} model load failed — click to retry`);
    });
    return task;
  };
  chip?.addEventListener("click", () => {
    if (status !== "error") return;
    showToast("Retrying model load…");
    void run();
  });
  // Respect an explicit bandwidth-saving preference; uploads still work normally.
  if (typeof navigator !== "undefined" && navigator.connection?.saveData) {
    render("idle", "Data saver on · AI downloads when needed");
    task = Promise.resolve();
  } else {
    task = run();
  }
  warmups.set(state, task);
  return task;
}
