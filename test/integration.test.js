/** Integration tests for core flows. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock DOM APIs
const mockCanvas = {
  width: 100,
  height: 100,
  getContext: vi.fn(() => ({
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    globalCompositeOperation: "",
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    clearRect: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    setTransform: vi.fn(),
    filter: "",
    createLinearGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    createPattern: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(40000) })),
  })),
  toBlob: vi.fn((cb) => cb(new Blob(["test"], { type: "image/png" }))),
  toDataURL: vi.fn(() => "data:image/png;base64,test"),
};

// Mock HTMLCanvasElement
global.HTMLCanvasElement = vi.fn(() => mockCanvas);
global.OffscreenCanvas = vi.fn(() => mockCanvas);
global.Image = vi.fn(() => ({
  onload: null,
  onerror: null,
  src: "",
  width: 100,
  height: 100,
  naturalWidth: 100,
  naturalHeight: 100,
}));

// Mock URL.createObjectURL
global.URL = {
  createObjectURL: vi.fn(() => "blob:mock"),
  revokeObjectURL: vi.fn(),
};

// Mock requestAnimationFrame
global.requestAnimationFrame = vi.fn((cb) => cb());
global.cancelAnimationFrame = vi.fn();

// Mock fetch
global.fetch = vi.fn(() =>
  Promise.resolve({
    blob: () => Promise.resolve(new Blob(["test"], { type: "image/png" })),
    ok: true,
  })
);

// Mock navigator.clipboard
Object.defineProperty(global, "navigator", {
  value: {
    clipboard: {
      write: vi.fn(() => Promise.resolve()),
    },
    deviceMemory: 8,
    connection: { saveData: false },
    gpu: {
      requestAdapter: vi.fn(() => Promise.resolve({})),
    },
  },
  writable: true,
  configurable: true,
});

// Mock ClipboardItem
global.ClipboardItem = vi.fn();

// Mock document.createElement
global.document = {
  createElement: vi.fn((tag) => {
    if (tag === "canvas") {
      return mockCanvas;
    }
    return {};
  }),
};

// Mock self.caches
global.self = {
  caches: {
    open: vi.fn(() => Promise.resolve({
      add: vi.fn(),
      put: vi.fn(),
      match: vi.fn(),
      delete: vi.fn(),
      keys: vi.fn(() => Promise.resolve([])),
    })),
    delete: vi.fn(),
    keys: vi.fn(() => Promise.resolve([])),
  },
  skipWaiting: vi.fn(),
  clients: {
    claim: vi.fn(),
  },
};

// Mock DataView
global.DataView = vi.fn(() => ({
  setUint32: vi.fn(),
  setUint16: vi.fn(),
}));

// Mock Uint8Array
global.Uint8Array = vi.fn((size) => new Array(size).fill(0));

describe("Integration: Core flow - Image upload to export", () => {
  let Editor;
  let engine;
  let utils;
  let validate;
  let refine;
  let background;
  let config;

  beforeEach(async () => {
    vi.resetModules();
    Editor = (await import("../src/editor.js")).Editor;
    engine = await import("../src/engine.js");
    utils = await import("../src/utils.js");
    validate = await import("../src/validate.js");
    refine = await import("../src/refine.js");
    background = await import("../src/background.js");
    config = await import("../src/config.js");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should create editor instance", () => {
    const editor = new Editor();
    expect(editor).toBeDefined();
    expect(editor.width()).toBe(0);
    expect(editor.height()).toBe(0);
  });

  it("should set source canvas", () => {
    const editor = new Editor();
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    editor.setSource(canvas);
    expect(editor.width()).toBe(100);
    expect(editor.height()).toBe(100);
  });

  it("should validate image file", () => {
    const file = { name: "test.png", type: "image/png", size: 1024 };
    const result = validate.validateImageFile(file);
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("image");
  });

  it("should reject SVG file", () => {
    const file = { name: "test.svg", type: "image/svg+xml", size: 1024 };
    const result = validate.validateImageFile(file);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(validate.ERROR_CODES.SVG_NOT_SUPPORTED);
  });

  it("should reject empty file", () => {
    const file = { name: "test.png", type: "image/png", size: 0 };
    const result = validate.validateImageFile(file);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(validate.ERROR_CODES.EMPTY_FILE);
  });

  it("should reject oversized file", () => {
    const file = { name: "test.png", type: "image/png", size: 100 * 1024 * 1024 };
    const result = validate.validateImageFile(file);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(validate.ERROR_CODES.TOO_LARGE_BYTES);
  });

  it("should sanitize filename", () => {
    expect(validate.sanitizeFilename("test.jpg")).toBe("test");
    expect(validate.sanitizeFilename("../../evil.png")).toBe("evil");
    expect(validate.sanitizeFilename("CON.png")).toBe("image");
    expect(validate.sanitizeFilename("emoji-🧪.png")).toBe("emoji-🧪");
  });

  it("should refine mask with auto preset", () => {
    const alpha = new Uint8ClampedArray(100).fill(128);
    const refined = refine.refineAlpha(alpha, 10, 10, refine.REFINE_PRESETS.auto);
    expect(refined).toBeInstanceOf(Uint8ClampedArray);
    expect(refined.length).toBe(100);
  });

  it("should not mutate input during refine", () => {
    const alpha = new Uint8ClampedArray(100).fill(128);
    const copy = new Uint8ClampedArray(alpha);
    refine.refineAlpha(alpha, 10, 10, refine.REFINE_PRESETS.crisp);
    expect([...alpha]).toEqual([...copy]);
  });

  it("should create background render", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    const result = background.renderBackground(
      { type: "color", color: "#ff0000" },
      100,
      100,
      null
    );
    expect(result).toBeDefined();
    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
  });

  it("should create gradient background", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    const result = background.renderBackground(
      { type: "gradient", from: "#ff0000", to: "#0000ff", angle: 90 },
      100,
      100,
      null
    );
    expect(result).toBeDefined();
  });

  it("should create blur background", () => {
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 100;
    sourceCanvas.height = 100;
    const result = background.renderBackground(
      { type: "blur", amount: 10 },
      100,
      100,
      sourceCanvas
    );
    expect(result).toBeDefined();
  });

  it("should format bytes correctly", () => {
    expect(utils.formatBytes(0)).toBe("0 B");
    expect(utils.formatBytes(1024)).toBe("1.0 KB");
    expect(utils.formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(utils.formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("should clamp values", () => {
    expect(utils.clamp(5, 0, 10)).toBe(5);
    expect(utils.clamp(-5, 0, 10)).toBe(0);
    expect(utils.clamp(15, 0, 10)).toBe(10);
  });

  it("should have correct config constants", () => {
    expect(config.IMAGE_POLICY.maxDimension).toBe(4000);
    expect(config.IMAGE_POLICY.maxPixels).toBe(32_000_000);
    expect(config.IMAGE_POLICY.maxBytes).toBe(80 * 1024 * 1024);
    expect(config.VIDEO_POLICY.maxOutputDimension).toBe(1920);
    expect(config.BULK_POLICY.maxItems).toBe(300);
    expect(config.ZIP_POLICY.maxPayloadBytes).toBe(128 * 1024 * 1024);
  });

  it("should export PNG with transparency", () => {
    expect(config.EXPORT_FORMATS.png.transparent).toBe(true);
    expect(config.EXPORT_FORMATS.png.mime).toBe("image/png");
  });

  it("should export JPEG without transparency", () => {
    expect(config.EXPORT_FORMATS.jpeg.transparent).toBe(false);
    expect(config.EXPORT_FORMATS.jpeg.mime).toBe("image/jpeg");
  });

  it("should have model tiers defined", () => {
    expect(engine.MODEL_TIERS.large).toBeDefined();
    expect(engine.MODEL_TIERS.medium).toBeDefined();
    expect(engine.MODEL_TIERS.small).toBeDefined();
  });

  it("should validate video file", () => {
    const file = { name: "test.mp4", type: "video/mp4", size: 1024 * 1024 };
    const result = validate.validateVideoFile(file);
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("video");
  });

  it("should reject non-video file", () => {
    const file = { name: "test.txt", type: "text/plain", size: 1024 };
    const result = validate.validateVideoFile(file);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(validate.ERROR_CODES.UNSUPPORTED_TYPE);
  });

  it("should detect video by extension", () => {
    expect(validate.looksLikeVideo({ name: "test.mp4", type: "" })).toBe(true);
    expect(validate.looksLikeVideo({ name: "test.mkv", type: "" })).toBe(true);
    expect(validate.looksLikeVideo({ name: "test.mov", type: "" })).toBe(true);
    expect(validate.looksLikeVideo({ name: "test.png", type: "image/png" })).toBe(false);
  });
});