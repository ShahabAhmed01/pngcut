/**
 * Guards the CSP safety of the shipped inference bundle.
 *
 * PNGCut's Content-Security-Policy omits 'unsafe-eval'. `@imgly/background-removal`
 * bundles ndarray, whose `compileConstructor()` JIT-generated view classes with
 * `new Function(...)` — an EvalError under that policy, thrown right after a
 * successful inference. `scripts/apply-patches.mjs` splices in an eval-free
 * equivalent; these tests fail if that safety net is ever lost.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyPatch,
  countEvalSites,
  findBlockEnd,
  IMGLY_DIST,
  MARKER,
  SIGNATURE,
} from "../scripts/apply-patches.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD_SRC = fs.readFileSync(
  path.join(ROOT, "scripts/patches/imgly-ndarray-eval-free.js"),
  "utf8"
);
const BUNDLE_PATH = path.join(ROOT, IMGLY_DIST);
const bundleInstalled = fs.existsSync(BUNDLE_PATH);
const bundleSrc = bundleInstalled ? fs.readFileSync(BUNDLE_PATH, "utf8") : "";

/** ndarray's dispatch table + `order` helper, mirroring the bundled module. */
const HARNESS = `
// Shadowing the global Function constructor inside this module means any
// dynamic string evaluation throws exactly like a CSP without 'unsafe-eval'.
// Every semantic assertion below therefore also proves the patched code path
// is eval-free.
function Function() {
  var err = new Error("EvalError: evaluating a string is blocked (CSP)");
  err.name = "EvalError";
  throw err;
}
function compare1st(a, b) {
  return a[0] - b[0];
}
function order() {
  var stride = this.stride;
  var terms = new Array(stride.length);
  for (var i = 0; i < terms.length; ++i) terms[i] = [Math.abs(stride[i]), i];
  terms.sort(compare1st);
  var result = new Array(terms.length);
  for (var j = 0; j < result.length; ++j) result[j] = terms[j][1];
  return result;
}
var CACHED_CONSTRUCTORS = { float32: [], generic: [] };
function ctorFor(dtype, dimension) {
  var list = CACHED_CONSTRUCTORS[dtype];
  while (list.length <= dimension + 1) list.push(compileConstructor(dtype, list.length - 1));
  return list[dimension + 1];
}
function defaultStride(shape) {
  var stride = new Array(shape.length);
  var acc = 1;
  for (var i = shape.length - 1; i >= 0; --i) {
    stride[i] = acc;
    acc *= shape[i];
  }
  return stride;
}
function ndarray(data, shape, stride, offset) {
  return ctorFor("float32", shape.length)(data, shape, stride || defaultStride(shape), offset || 0);
}
export { ndarray, ctorFor, defaultStride };
`;

/**
 * Load the payload source exactly as it is spliced into the bundle — via a
 * data: URL module, so this repository contains no dynamic string evaluation.
 */
async function loadCompileConstructor() {
  const moduleSource = `${PAYLOAD_SRC}\n${HARNESS}`;
  const url = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  return import(/* @vite-ignore */ url);
}

describe("patch script — bundle safety", () => {
  it("ships an eval-free payload that targets the ndarray generator", () => {
    expect(countEvalSites(PAYLOAD_SRC)).toBe(0);
    expect(PAYLOAD_SRC).toContain(MARKER);
    expect(PAYLOAD_SRC).toContain(SIGNATURE);
  });

  it.runIf(bundleInstalled)("the installed inference bundle contains no eval sites", () => {
    expect(countEvalSites(bundleSrc)).toBe(0);
  });

  it.runIf(bundleInstalled)("reports the installed bundle as already patched", () => {
    const result = applyPatch(bundleSrc);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("already-patched");
  });

  it.runIf(bundleInstalled)("the bundle's ndarray code generator is the eval-free one", () => {
    const start = bundleSrc.indexOf(SIGNATURE);
    expect(start).toBeGreaterThan(-1);
    const end = findBlockEnd(bundleSrc, bundleSrc.indexOf("{", start));
    const generator = bundleSrc.slice(start, end + 1);
    expect(countEvalSites(generator)).toBe(0);
    expect(generator).toContain(MARKER);
  });

  it.runIf(fs.existsSync(path.join(ROOT, "dist/assets")))(
    "no shipped build asset uses new Function()",
    () => {
      const assets = fs.readdirSync(path.join(ROOT, "dist/assets")).filter((f) => f.endsWith(".js"));
      expect(assets.length).toBeGreaterThan(0);
      for (const file of assets) {
        const code = fs.readFileSync(path.join(ROOT, "dist/assets", file), "utf8");
        expect(countEvalSites(code), `${file} must stay CSP-safe`).toBe(0);
      }
    }
  );
});

describe("patch script — splicing", () => {
  it("replaces the eval-based generator and preserves the rest of the file", () => {
    const synthetic = [
      '"use strict";',
      SIGNATURE,
      '  var code = "function X(a){this.data=a;}";',
      '  return new Function("CTOR_LIST", code)([], null);',
      "}",
      "var after = 42;",
    ].join("\n");

    const result = applyPatch(synthetic);
    expect(result.reason).toBe("patched");
    expect(result.changed).toBe(true);
    expect(countEvalSites(result.code)).toBe(0);
    expect(result.code).toContain(MARKER);
    expect(result.code).toContain("var after = 42;");
    expect(result.code).not.toContain("this.data=a;"); // old body fully removed
  });

  it("is idempotent", () => {
    const once = applyPatch(`${SIGNATURE}\n  return new Function("x")();\n}`).code;
    const twice = applyPatch(once);
    expect(twice.changed).toBe(false);
    expect(twice.reason).toBe("already-patched");
    expect(twice.code).toBe(once);
  });

  it("leaves sources alone when there is nothing to patch", () => {
    expect(applyPatch("var x = 1;").reason).toBe("signature-not-found");
    expect(applyPatch(`${SIGNATURE}\n  /* eval-free already */\n}`).reason).toBe("no-eval-found");
  });

  it("findBlockEnd ignores braces inside strings and comments", () => {
    const src = 'function f() { var s = "a{b}c"; /* } */ return s; } tail';
    expect(src[findBlockEnd(src, src.indexOf("{"))]).toBe("}");
    expect(findBlockEnd("function f() {", 13)).toBe(-1);
  });
});

describe("patched ndarray semantics", () => {
  const data = () => new Float32Array([1, 2, 3, 4, 5, 6]);

  it("builds 2-D views with identical shape, stride, size and order", async () => {
    const { ndarray } = await loadCompileConstructor();
    const v = ndarray(data(), [2, 3]);
    expect(v.shape).toEqual([2, 3]);
    expect(v.stride).toEqual([3, 1]);
    expect(v.dimension).toBe(2);
    expect(v.size).toBe(6);
    expect(v.order).toEqual([1, 0]);
    expect(v.get(1, 2)).toBe(6);
    expect(v.index(1, 1)).toBe(4);
    expect(v.set(0, 1, 9)).toBe(9);
    expect(v.get(0, 1)).toBe(9);
  });

  it("copies shape/stride instead of aliasing the caller's arrays", async () => {
    const { ndarray } = await loadCompileConstructor();
    const shape = [2, 3];
    const stride = [3, 1];
    const v = ndarray(data(), shape, stride);
    shape[0] = 99;
    stride[0] = 99;
    expect(v.shape).toEqual([2, 3]);
    expect(v.stride).toEqual([3, 1]);
  });

  it("supports hi/lo/step/transpose/pick with the original formulas", async () => {
    const { ndarray } = await loadCompileConstructor();
    const v = ndarray(data(), [2, 3]);
    expect(v.hi(1, 2).shape).toEqual([1, 2]);
    // hi() clips the shape but keeps the offset (matching upstream ndarray).
    expect(v.hi(1, 2).get(0, 1)).toBe(2);
    expect(v.hi(1, 2).offset).toBe(0);
    expect(v.hi().shape).toEqual([2, 3]);
    expect(v.lo(1, 1).shape).toEqual([1, 2]);
    expect(v.lo(1, 1).get(0, 0)).toBe(5);
    expect(v.lo(1, 1).offset).toBe(4);
    const stepped = v.step(1, 2);
    expect(stepped.shape).toEqual([2, 2]);
    expect(stepped.stride).toEqual([3, 2]);
    expect(stepped.get(1, 1)).toBe(6);
    const t = v.transpose(1, 0);
    expect(t.shape).toEqual([3, 2]);
    expect(t.stride).toEqual([1, 3]);
    expect(t.get(2, 1)).toBe(6);
    const picked = v.pick(1);
    expect(picked.dimension).toBe(1);
    expect(picked.shape).toEqual([3]);
    expect(picked.order).toEqual([0]);
    expect(picked.get(2)).toBe(6);
  });

  it("computes 3-D order like the original", async () => {
    const { ndarray } = await loadCompileConstructor();
    const v = ndarray(new Float32Array(24), [2, 3, 4]);
    expect(v.order).toEqual([2, 1, 0]);
    expect(v.size).toBe(24);
  });

  it("handles the degenerate -1 and 0 dimensions", async () => {
    const { ctorFor } = await loadCompileConstructor();
    const nil = ctorFor("float32", -1)(data());
    expect(nil.dimension).toBe(-1);
    expect(nil.size).toBe(0);
    expect(nil.index()).toBe(-1);
    expect(nil.pick()).toBeNull();
    expect(nil.get(0)).toBeUndefined();
    expect(nil.lo().data).toBe(nil.data);

    const zero = ctorFor("float32", 0)(data(), [], [], 2);
    expect(zero.dimension).toBe(0);
    expect(zero.size).toBe(1);
    expect(zero.get()).toBe(3);
    expect(zero.set(7)).toBe(7);
    expect(zero.get()).toBe(7);
    expect(zero.pick().dimension).toBe(-1);
  });

  it("uses getters/setters for the generic dtype", async () => {
    const { ctorFor } = await loadCompileConstructor();
    const backing = { value: 5 };
    const boxed = {
      get: () => backing.value,
      set: (_, v) => {
        backing.value = v;
        return v;
      },
    };
    const v = ctorFor("generic", 0)(boxed, [], [], 0);
    expect(v.get()).toBe(5);
    v.set(11);
    expect(backing.value).toBe(11);
  });
});
