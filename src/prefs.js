/** Preferences persistence for toolbar choices. */
import { REFINE_PRESETS } from "./refine.js";
import * as engine from "./engine.js";

const PREFS_KEY = "pngcut.prefs.v1";

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

export function savePrefs(model, refine) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ model, refine }));
  } catch {
    /* storage unavailable — preferences are best-effort */
  }
}

export function applyPrefs(state, el) {
  const prefs = loadPrefs();
  if (engine.isModelTier(prefs.model)) {
    state.model = prefs.model;
    if (el.modelSelect) el.modelSelect.value = prefs.model;
  }
  if (prefs.refine && prefs.refine in REFINE_PRESETS) {
    state.refine = prefs.refine;
    if (el.refineSelect) el.refineSelect.value = prefs.refine;
  }
  state.editor.setRefine(state.refine);
}

export function resetPrefs() {
  try {
    localStorage.removeItem(PREFS_KEY);
  } catch {
    /* storage unavailable */
  }
}