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

// Progress steps
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

// Debounce delays
export const DEBOUNCE_DELAYS = {
  render: 0, // rAF handled
  resize: 0,
  toast: 2600,
};

// File size limits
export const FILE_LIMITS = {
  maxImageBytes: 80 * 1024 * 1024,
  maxVideoBytesWarn: 250 * 1024 * 1024,
  maxMaskBytes: 500 * 1024 * 1024,
  maxOutputDimension: 1920,
  maxWorkingDimension: 4000,
  maxPixels: 32_000_000,
  maxZipPayloadBytes: 128 * 1024 * 1024,
  maxBulkItems: 300,
};

// Undo budget
export const UNDO_BUDGET_BYTES = 64 * 1024 * 1024;

// Preview dimension
export const PREVIEW_DIMENSION = 1280;

// Video defaults
export const VIDEO_DEFAULTS = {
  fps: 24,
  quality: 576,
};

// Model tier defaults
export const MODEL_DEFAULTS = {
  cpuLowMem: "small",
  cpu: "medium",
  gpu: "medium",
};

// Retry policy
export const RETRY_POLICY = {
  maxAttempts: 4,
  baseDelayMs: 1200,
  backoff: 2,
  jitter: 0.25,
};

// Default background color
export const DEFAULT_BG_COLOR = "#1b9aaa";

// Gradient presets
export const GRADIENT_PRESETS = [
  ["#7c3aed", "#06b6d4"],
  ["#f43f5e", "#fb923c"],
  ["#0ea5e9", "#22c55e"],
  ["#8b5cf6", "#ec4899"],
  ["#111827", "#6b7280"],
  ["#f59e0b", "#ef4444"],
];