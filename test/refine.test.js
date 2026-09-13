import { describe, it, expect } from "vitest";
import {
  REFINE_PRESETS,
  REFINE_ORDER,
  median3,
  median9,
  boxBlurAlpha,
  contrastCurve,
  smoothstepAlpha,
  refineAlpha,
} from "../src/refine.js";

describe("median9", () => {
  it("returns the middle of nine values", () => {
    expect(median9(new Uint8Array([9, 1, 8, 2, 7, 3, 6, 4, 5]))).toBe(5);
    expect(median9(new Uint8Array([0, 0, 0, 0, 42, 0, 0, 0, 0]))).toBe(0);
    expect(median9(new Uint8Array([255, 255, 255, 255, 10, 255, 255, 255, 255]))).toBe(255);
  });
});

describe("median3", () => {
  it("removes an isolated speckle", () => {
    const w = 3;
    const h = 3;
    const alpha = new Uint8ClampedArray(9); // all background
    alpha[4] = 255; // lone misclassified speckle in the center
    const out = median3(alpha, w, h);
    expect(out[4]).toBe(0); // speckle removed
    for (let i = 0; i < 9; i++) expect(out[i]).toBe(0);
  });

  it("keeps a solid region solid", () => {
    const alpha = new Uint8ClampedArray(25).fill(200);
    const out = median3(alpha, 5, 5);
    for (let i = 0; i < 25; i++) expect(out[i]).toBe(200);
  });

  it("does not mutate the input", () => {
    const alpha = new Uint8ClampedArray([255, 0, 255, 0, 255, 0, 255, 0, 255]);
    const copy = new Uint8ClampedArray(alpha);
    median3(alpha, 3, 3);
    expect([...alpha]).toEqual([...copy]);
  });
});

describe("boxBlurAlpha", () => {
  it("keeps a constant buffer constant", () => {
    const alpha = new Uint8ClampedArray(36).fill(128);
    const out = boxBlurAlpha(alpha, 6, 6, 1);
    for (let i = 0; i < 36; i++) expect(out[i]).toBe(128);
  });

  it("blurs a hard step into a gradient", () => {
    const w = 5;
    const h = 1;
    const alpha = new Uint8ClampedArray([0, 0, 0, 255, 255]);
    const out = boxBlurAlpha(alpha, w, h, 1);
    // repeat-edge clamping: border pixels only see in-bounds neighbours
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(85); // (0+0+255)/3
    expect(out[3]).toBe(170); // (0+255+255)/3
    expect(out[4]).toBe(255);
    expect(out[4]).toBeGreaterThan(out[2]);
  });

  it("does not mutate the input", () => {
    const alpha = new Uint8ClampedArray([0, 255, 0, 255, 0]);
    const copy = new Uint8ClampedArray(alpha);
    boxBlurAlpha(alpha, 5, 1, 1);
    expect([...alpha]).toEqual([...copy]);
  });
});

describe("contrastCurve", () => {
  it("keeps 0 transparent and 255 opaque", () => {
    const alpha = new Uint8ClampedArray([0, 255]);
    const out = contrastCurve(alpha, 10);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(255);
  });

  it("pushes mid-alphas apart with steepness", () => {
    const alpha = new Uint8ClampedArray([64, 192]);
    const gentle = contrastCurve(alpha, 2);
    const steep = contrastCurve(alpha, 14);
    expect(steep[0]).toBeLessThan(gentle[0]);
    expect(steep[1]).toBeGreaterThan(gentle[1]);
  });

  it("is monotonic", () => {
    const inBuf = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) inBuf[i] = i;
    const out = contrastCurve(inBuf, 9);
    for (let i = 1; i < 256; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
  });
});

describe("smoothstepAlpha", () => {
  it("hard-decides outside the band and blends inside it", () => {
    const alpha = new Uint8ClampedArray([10, 100, 155, 245]);
    const out = smoothstepAlpha(alpha, 0.5, 0.14);
    expect(out[0]).toBe(0); // far below center
    expect(out[3]).toBe(255); // far above center
    expect(out[1]).toBeLessThan(128); // just below center → low
    expect(out[2]).toBeGreaterThan(128); // just above center → high
  });
});

describe("refineAlpha pipeline", () => {
  it("input is never mutated", () => {
    const alpha = new Uint8ClampedArray(16).fill(120);
    const copy = new Uint8ClampedArray(alpha);
    refineAlpha(alpha, 4, 4, REFINE_PRESETS.crisp);
    expect([...alpha]).toEqual([...copy]);
  });

  it("empty options behave like a copy", () => {
    const alpha = new Uint8ClampedArray([0, 64, 128, 192, 255]);
    const out = refineAlpha(alpha, 5, 1, {});
    expect([...out]).toEqual([...alpha]);
  });

  it("steeper presets push the same ambiguous pixel further from the middle", () => {
    const alpha = new Uint8ClampedArray([120]);
    const soft = refineAlpha(alpha, 1, 1, REFINE_PRESETS.soft);
    const crisp = refineAlpha(alpha, 1, 1, REFINE_PRESETS.crisp);
    expect(crisp[0]).toBeLessThan(soft[0]);
  });
});

describe("presets", () => {
  it("covers every UI option and 'off' disables all stages", () => {
    expect(REFINE_ORDER).toEqual(["auto", "crisp", "soft", "off"]);
    expect(REFINE_PRESETS.off).toBeNull();
    for (const name of ["auto", "crisp", "soft"]) {
      expect(REFINE_PRESETS[name]).toEqual(expect.any(Object));
      expect(REFINE_PRESETS[name].smooth).toBeGreaterThanOrEqual(0);
    }
  });
});
