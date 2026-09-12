import { describe, it, expect } from "vitest";
import { formatBytes, clamp } from "../src/utils.js";
import { IMAGE_POLICY, VIDEO_POLICY, BULK_POLICY, EXPORT_FORMATS } from "../src/config.js";
import { describeError, classifyError, ErrorCode } from "../src/errors.js";

describe("formatBytes", () => {
  it("handles small/zero values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512.0 B");
  });
  it("formats KB/MB", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("clamp", () => {
  it("clamps bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });
});

describe("error mapping", () => {
  it("maps unknown to a generic but actionable message", () => {
    const d = describeError(ErrorCode.UNKNOWN);
    expect(d.title).toBeTruthy();
    expect(d.body).toBeTruthy();
  });
  it("classifies memory errors", () => {
    expect(classifyError(new Error("Out of memory"))).toBe(ErrorCode.OUT_OF_MEMORY);
  });
  it("classifies GPU errors as webgpu-unavailable", () => {
    expect(classifyError(new Error("WebGPU adapter request failed"))).toBe(ErrorCode.WEBGPU_UNAVAILABLE);
  });
});

describe("policy config", () => {
  it("has sane limits", () => {
    expect(IMAGE_POLICY.maxDimension).toBeGreaterThan(0);
    expect(VIDEO_POLICY.maxOutputDimension).toBeGreaterThan(0);
    expect(BULK_POLICY.maxItems).toBeGreaterThan(0);
  });
  it("marks PNG/WebP transparent and JPEG not", () => {
    expect(EXPORT_FORMATS.png.transparent).toBe(true);
    expect(EXPORT_FORMATS.webp.transparent).toBe(true);
    expect(EXPORT_FORMATS.jpeg.transparent).toBe(false);
  });
});