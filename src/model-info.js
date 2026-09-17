import * as engine from "./engine.js";

const STATUS_LABELS = {
  idle: "Not loaded in this tab",
  loading: "Downloading / initializing…",
  ready: "Ready in this tab",
  error: "Load failed — select to retry",
};

/** Render descriptions and independent readiness labels without polling. */
export function bindModelInfo({ state, select, description, reset }) {
  if (!select || !description) return () => {};
  const labels = new Map(Array.from(select.options, (option) => [option.value, option.textContent]));
  const render = () => {
    const selected = state.model || engine.defaultModel(state.device);
    const meta = engine.MODEL_TIERS[selected];
    const status = engine.getModelLoadStatus(selected, state.device);
    description.textContent = `${state.model ? meta.label : `Auto → ${meta.label}`} — ${meta.hint}. ${STATUS_LABELS[status]}.`;
    for (const option of select.options) {
      const model = option.value || engine.defaultModel(state.device);
      const meta = engine.MODEL_TIERS[model];
      option.textContent = `${labels.get(option.value)} · ${STATUS_LABELS[engine.getModelLoadStatus(model, state.device)]}`;
      // Hover/focus description for every entry, not just the selected one.
      option.title = option.value
        ? `${meta.label} — ${meta.hint}`
        : "Automatically picks a model based on your device";
    }
  };
  select.setAttribute("aria-describedby", description.id);
  select.addEventListener("change", render);
  reset?.addEventListener("click", render);
  const unsubscribe = engine.onModelStatus(render);
  render();
  return () => {
    unsubscribe();
    select.removeEventListener("change", render);
    reset?.removeEventListener("click", render);
  };
}
