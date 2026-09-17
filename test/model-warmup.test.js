import { afterEach, beforeEach, expect, it, vi } from "vitest";

const library = vi.hoisted(() => ({ preload: vi.fn(), segmentForeground: vi.fn() }));
vi.mock("@imgly/background-removal", () => library);
let engine, startModelWarmup;
function makeChip() {
  const classes = new Set();
  return {
    hidden: true, textContent: "", attributes: {}, listeners: {},
    classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)) },
    setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener(k, cb) { this.listeners[k] = cb; },
  };
}
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("navigator", { connection: { saveData: false } });
  library.preload.mockReset().mockResolvedValue(undefined);
  library.segmentForeground.mockReset().mockResolvedValue(new Blob(["mask"]));
  engine = await import("../src/engine.js");
  ({ startModelWarmup } = await import("../src/model-warmup.js"));
});
afterEach(() => vi.unstubAllGlobals());

it("starts once, displays actual asset progress, and reports readiness", async () => {
  let finish;
  library.preload.mockImplementation(config => {
    config.progress("fetch:model", 42, 100);
    return new Promise(resolve => { finish = resolve; });
  });
  const state = { device: "cpu", model: null }, chip = makeChip();
  const task = startModelWarmup({ state, chip });
  expect(startModelWarmup({ state, chip })).toBe(task);
  await vi.waitFor(() => expect(chip.textContent).toContain("current asset 42%"));
  expect(chip.hidden).toBe(false);
  finish();
  await task;
  expect(chip.textContent).toBe("AI model ready · Balanced · CPU");
  expect(library.preload).toHaveBeenCalledTimes(1);
});

it("suppresses automatic downloads with Save-Data, without blocking uploads", async () => {
  navigator.connection.saveData = true;
  const chip = makeChip();
  await startModelWarmup({ state: { device: "cpu", model: null }, chip });
  expect(library.preload).not.toHaveBeenCalled();
  expect(chip.textContent).toContain("Data saver on");
  await engine.segmentForeground(new Blob(["image"]), { model: "medium", device: "cpu" });
  expect(library.preload).toHaveBeenCalledTimes(1);
});

it("an upload during warm-up and later images share the original download", async () => {
  let finish;
  library.preload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const warmup = startModelWarmup({ state: { device: "cpu", model: null }, chip: makeChip() });
  const options = { device: "cpu", model: "medium" };
  const image = new Blob(["image"]);
  const upload = engine.segmentForeground(image, options);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  finish();
  await Promise.all([warmup, upload]);
  await engine.segmentForeground(image, options);
  expect(library.preload).toHaveBeenCalledTimes(1);
  expect(library.segmentForeground).toHaveBeenCalledTimes(2);
});

it("handles failure and supports a single keyboard/click retry", async () => {
  library.preload.mockRejectedValueOnce(new Error("offline"));
  const chip = makeChip();
  await startModelWarmup({ state: { device: "cpu", model: "small" }, chip });
  expect(chip.attributes["aria-disabled"]).toBe("false");
  expect(chip.textContent).toContain("click to retry");
  chip.listeners.click();
  chip.listeners.click();
  await vi.waitFor(() => expect(chip.textContent).toBe("AI model ready · Fast · CPU"));
  expect(library.preload).toHaveBeenCalledTimes(2);
});

it("reports CPU when GPU initialization falls back", async () => {
  library.preload.mockImplementation(async config => {
    if (config.device === "gpu") throw new Error("no GPU");
    config.progress("fetch:model", 1, 2);
  });
  const chip = makeChip();
  await startModelWarmup({ state: { device: "gpu", model: "small" }, chip });
  expect(chip.textContent).toBe("AI model ready · Fast · CPU");
  expect(engine.getModelBackend("small", "gpu")).toBe("cpu");
});
