import { describe, it, expect } from "vitest";
import { sanitizeFilename, validateImageFile, validateVideoFile, ERROR_CODES } from "../src/validate.js";

function file(name, type, size = 1024) {
  return { name, type, size };
}

describe("sanitizeFilename", () => {
  it("keeps a normal name and strips the extension", () => {
    expect(sanitizeFilename("photo.jpg")).toBe("photo");
  });
  it("strips path separators and traversal", () => {
    expect(sanitizeFilename("../../evil.png")).toBe("evil");
    expect(sanitizeFilename("a/b\\c.png")).toBe("a-b-c");
  });
  it("handles hostile HTML-like names", () => {
    expect(sanitizeFilename('<img src=x onerror=alert(1)>.png')).toBe('<img src=x onerror=alert(1)>');
  });
  it("handles Windows reserved device names", () => {
    expect(sanitizeFilename("CON.png")).toBe("image");
    expect(sanitizeFilename("NUL.txt")).toBe("image");
  });
  it("preserves unicode", () => {
    expect(sanitizeFilename("emoji-🧪.png")).toBe("emoji-🧪");
  });
  it("collapses whitespace", () => {
    expect(sanitizeFilename("my   photo (1).png")).toBe("my photo (1)");
  });
  it("caps very long names", () => {
    const long = "a".repeat(500);
    expect(sanitizeFilename(long + ".png").length).toBeLessThanOrEqual(120);
  });
  it("falls back when name is empty", () => {
    expect(sanitizeFilename("")).toBe("image");
    expect(sanitizeFilename(null)).toBe("image");
  });
});

describe("validateImageFile", () => {
  it("accepts a PNG", () => {
    const r = validateImageFile(file("a.png", "image/png"));
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("image");
  });
  it("rejects SVG", () => {
    const r = validateImageFile(file("a.svg", "image/svg+xml"));
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ERROR_CODES.SVG_NOT_SUPPORTED);
  });
  it("rejects unsupported types", () => {
    const r = validateImageFile(file("a.txt", "text/plain"));
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ERROR_CODES.UNSUPPORTED_TYPE);
  });
  it("rejects empty files", () => {
    const r = validateImageFile(file("a.png", "image/png", 0));
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ERROR_CODES.EMPTY_FILE);
  });
  it("rejects files over the byte budget", () => {
    const r = validateImageFile(file("a.png", "image/png", 90 * 1024 * 1024));
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ERROR_CODES.TOO_LARGE_BYTES);
  });
  it("flag oversize dimensions as a warning, not failure", () => {
    const r = validateImageFile(file("big.png", "image/png"), undefined, { width: 6000, height: 4000 });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.code === "IMAGE_DOWNSCALED")).toBe(true);
  });
  it("rejects images above the pixel budget", () => {
    const r = validateImageFile(file("huge.png", "image/png"), undefined, { width: 8000, height: 8000 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ERROR_CODES.IMAGE_TOO_LARGE);
  });
});

describe("validateVideoFile", () => {
  it("accepts an MP4 container", () => {
    const r = validateVideoFile(file("v.mp4", "video/mp4"));
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("video");
  });
  it("warns on large files", () => {
    const r = validateVideoFile(file("v.mp4", "video/mp4", 300 * 1024 * 1024));
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.code === "VIDEO_LARGE")).toBe(true);
  });
  it("rejects non-video files", () => {
    const r = validateVideoFile(file("v.txt", "text/plain"));
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ERROR_CODES.UNSUPPORTED_TYPE);
  });
});