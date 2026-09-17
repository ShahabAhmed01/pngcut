import { afterEach, expect, it, vi } from "vitest";
import { applyPrefs, savePrefs } from "../src/prefs.js";
import { defaultModel } from "../src/engine.js";

afterEach(() => vi.unstubAllGlobals());

it("starts in Auto despite a legacy saved model and resolves the device tier", () => {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => JSON.stringify({ model: "large", refine: "auto" })),
  });
  vi.stubGlobal("navigator", { deviceMemory: 2 });
  const state = { model: "large", refine: "auto", editor: { setRefine: vi.fn() } };
  const el = { modelSelect: { value: "large" }, refineSelect: { value: "auto" } };
  applyPrefs(state, el);
  expect(state.model).toBeNull();
  expect(el.modelSelect.value).toBe("");
  expect(state.model || defaultModel("cpu")).toBe("small");
});

it("persists refinement without persisting the tab model choice", () => {
  const setItem = vi.fn();
  vi.stubGlobal("localStorage", { setItem });
  savePrefs("large", "auto");
  expect(setItem).toHaveBeenCalledWith("pngcut.prefs.v1", JSON.stringify({ refine: "auto" }));
});
