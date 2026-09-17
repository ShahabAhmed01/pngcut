/** Preferences persistence for toolbar choices. */
import { REFINE_PRESETS } from "./refine.js";

const PREFS_KEY = "pngcut.prefs.v1";

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

export function savePrefs(_model, refine) {
  try {
    // Model choice remains in application state for this tab only.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ refine }));
  } catch {
    /* storage unavailable — preferences are best-effort */
  }
}

export function applyPrefs(state, el) {
  const prefs = loadPrefs();
  // Ignore legacy persisted model choices: each page session starts in Auto.
  state.model = null;
  if (el.modelSelect) el.modelSelect.value = "";
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