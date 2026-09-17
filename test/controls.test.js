import { afterEach, expect, it, vi } from "vitest";
import { createControlsHandler } from "../src/controls.js";

afterEach(() => vi.unstubAllGlobals());

it("reprocesses the retained original with the selected model and preserves the existing result", async () => {
  const listeners = {};
  const modelSelect = {
    value: "small",
    addEventListener: (event, handler) => { listeners[event] = handler; },
  };
  const el = new Proxy({ modelSelect }, {
    get: (target, key) => target[key] || { addEventListener: vi.fn() },
  });
  const state = {
    model: "medium",
    device: "cpu",
    refine: "auto",
    processing: false,
    originalBlob: new Blob(["original image"], { type: "image/jpeg" }),
    originalName: "portrait.jpg",
    editor: {
      isPainting: vi.fn(() => false),
      canUndo: vi.fn(() => false),
      canRedo: vi.fn(() => false),
    },
  };
  vi.stubGlobal("window", { addEventListener: vi.fn(), confirm: vi.fn() });
  const processImage = vi.fn(async () => {
    expect(state.model).toBe("small");
    return true;
  });
  const savePrefs = vi.fn();
  createControlsHandler({
    state, el, processImage, savePrefs,
    showToast: vi.fn(), setTool: vi.fn(), requestRender: vi.fn(),
  }).bindControls();

  await listeners.change();

  expect(processImage).toHaveBeenCalledExactlyOnceWith(
    state.originalBlob, "portrait.jpg", { preserveResult: true }
  );
  expect(savePrefs).toHaveBeenCalledExactlyOnceWith("small", "auto");
  expect(window.confirm).not.toHaveBeenCalled();
});
