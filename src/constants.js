/** Shared constants to avoid magic numbers across modules. */

// Brush defaults
export const BRUSH_DEFAULTS = {
  size: 40,
  hardness: 0.8,
  minSize: 2,
  maxSize: 400,
  hardnessMin: 0,
  hardnessMax: 1,
};

// Feather defaults
export const FEATHER_DEFAULTS = {
  value: 0,
  min: 0,
  max: 12,
  step: 0.5,
};

// Quality defaults
export const QUALITY_DEFAULTS = {
  value: 92,
  min: 10,
  max: 100,
};

// Zoom defaults
export const ZOOM_DEFAULTS = {
  factor: 1.25,
  min: 0.05,
  max: 32,
};

// Blur defaults
export const BLUR_DEFAULTS = {
  amount: 24,
  min: 4,
  max: 80,
};

// Progress steps (used by main.js to map fetch progress into a band so the bar never jumps backwards)
export const PROGRESS_STEPS = {
  preparing: 2,
  modelDownloadStart: 0,
  modelDownloadEnd: 70,
  computingStart: 70,
  computingEnd: 98,
  applyingMask: 99,
  done: 100,
};

// Toast duration
export const TOAST_DURATION_MS = 2600;