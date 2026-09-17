import { beforeEach, expect, it, vi } from "vitest";

const library = vi.hoisted(() => ({ preload: vi.fn(), segmentForeground: vi.fn() }));
vi.mock("@imgly/background-removal", () => library);
let engine;
beforeEach(async () => {
  vi.resetModules();
  library.preload.mockReset().mockResolvedValue(undefined);
  library.segmentForeground.mockReset().mockResolvedValue(new Blob(["mask"]));
  engine = await import("../src/engine.js");
});

it("public API reuses A after A → B → A and subsequent images", async () => {
  const blob = new Blob(["image"]);
  for (const model of ["small", "medium", "small", "small"]) {
    await engine.segmentForeground(blob, { model, device: "cpu" });
  }
  expect(library.preload).toHaveBeenCalledTimes(2);
  expect(library.segmentForeground).toHaveBeenCalledTimes(4);
});

it("public API remembers GPU inference fallback for subsequent images", async () => {
  library.segmentForeground.mockImplementation(async (_blob, config) => {
    if (config.device === "gpu") throw new Error("GPU unavailable");
    return new Blob(["mask"]);
  });
  const blob = new Blob(["image"]);
  await engine.segmentForeground(blob, { model: "small", device: "gpu" });
  await engine.segmentForeground(blob, { model: "small", device: "gpu" });
  expect(library.segmentForeground.mock.calls.map((call) => call[1].device))
    .toEqual(["gpu", "cpu", "cpu"]);
  expect(library.preload).toHaveBeenCalledTimes(2);
});
