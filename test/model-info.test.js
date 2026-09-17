import { afterEach, describe, expect, it, vi } from "vitest";
import { bindModelInfo } from "../src/model-info.js";

afterEach(() => vi.unstubAllGlobals());

describe("model selector info", () => {
  function makeSelect() {
    const options = [
      { value: "", textContent: "Auto (recommended)" },
      { value: "medium", textContent: "Balanced — FP16 ISNet" },
      { value: "small", textContent: "Fast — smallest" },
    ];
    return {
      value: "",
      options,
      setAttribute: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  }

  it("shows Auto resolution, the hint and per-model readiness", () => {
    vi.stubGlobal("navigator", { deviceMemory: 8 });
    const state = { model: null, device: "cpu" };
    const select = makeSelect();
    const description = { id: "model-description", textContent: "" };
    const unsubscribe = bindModelInfo({ state, select, description });
    expect(select.setAttribute).toHaveBeenCalledWith("aria-describedby", "model-description");
    expect(description.textContent).toContain("Auto → Balanced");
    expect(description.textContent).toContain("FP16 ISNet");
    expect(description.textContent).toContain("Not loaded in this tab");
    expect(select.options[1].textContent).toContain("Not loaded in this tab");
    unsubscribe();
  });

  it("refreshes the description when the selection changes", () => {
    const state = { model: null, device: "cpu" };
    const select = makeSelect();
    const description = { id: "model-description", textContent: "" };
    const unsubscribe = bindModelInfo({ state, select, description });
    const change = select.addEventListener.mock.calls.find(([event]) => event === "change")[1];
    state.model = "small";
    change();
    expect(description.textContent).toContain("Fast — Quantized ISNet");
    unsubscribe();
  });
});
