/**
 * PNGCut dependency patches — applied on `postinstall` and again on `prebuild`,
 * so both local dev and the Vercel build always run against the patched bundle.
 *
 * Why this exists
 * ---------------
 * PNGCut ships a strict Content-Security-Policy that deliberately omits
 * 'unsafe-eval' (see `vercel.json`, `SECURITY.md`). `@imgly/background-removal`
 * bundles the `ndarray` package, whose `compileConstructor()` JIT-generates its
 * view classes with `new Function(...)` string evaluation. Under that policy the
 * first `ndarray(...)` call after inference throws:
 *
 *   EvalError: Evaluating a string as JavaScript violates the following
 *   Content Security Policy directive ... 'unsafe-eval' is not an allowed
 *   source of script.
 *
 * `compileConstructor` is lazy and compiles the `-1` dimension first, so the
 * crash happened on the very next line after a successful inference — the model
 * chip said "Model ready" while every upload failed with a generic error.
 *
 * This script splices in an eval-free, behaviourally identical replacement
 * (`scripts/patches/imgly-ndarray-eval-free.js`). It is dependency-free,
 * offline, deterministic and idempotent (a second run is a no-op).
 *
 * Usage:
 *   node scripts/apply-patches.mjs          # patch in place (install / build)
 *   node scripts/apply-patches.mjs --check  # verify only, exit 1 if unpatched
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** Human-readable target, for log lines only. */
export const IMGLY_PACKAGE = "@imgly/background-removal@1.7.0";
/** Bundle containing the eval-based code generator. */
export const IMGLY_DIST = "node_modules/@imgly/background-removal/dist/index.mjs";
/** Left inside the patched function so re-runs are cheap no-ops. */
export const MARKER = "PATCHED (PNGCut)";
/** The declaration we replace (whole function, located by signature). */
export const SIGNATURE = "function compileConstructor(dtype, dimension) {";

const PAYLOAD_PATH = path.join(__dirname, "patches", "imgly-ndarray-eval-free.js");

/**
 * The eval-free replacement, read verbatim from its own file so it stays as
 * reviewable (and diffable) as ordinary code.
 */
export const EVAL_FREE_COMPILE_CONSTRUCTOR = fs
  .readFileSync(PAYLOAD_PATH, "utf8")
  .replace(/\n+$/, "");

/** Count dynamic string-evaluation calls in a source string. */
export function countEvalSites(source) {
  return (source.match(/\bnew Function\s*\(/g) || []).length;
}

/**
 * Index of the `}` closing the block opened by the first `{` at/after `start`,
 * ignoring braces inside strings, template literals and comments. Required
 * because the original code generator is full of string literals containing
 * braces (a naive brace counter truncates it).
 */
export function findBlockEnd(source, start) {
  let depth = 0;
  let mode = "code";
  for (let j = start; j < source.length; j++) {
    const ch = source[j];
    if (mode === "line") {
      if (ch === "\n") mode = "code";
      continue;
    }
    if (mode === "block") {
      if (ch === "*" && source[j + 1] === "/") {
        mode = "code";
        j++;
      }
      continue;
    }
    if (mode === "sq" || mode === "dq" || mode === "tmpl") {
      const closer = mode === "sq" ? "'" : mode === "dq" ? '"' : "`";
      if (ch === "\\") {
        j++;
      } else if (ch === closer) {
        mode = "code";
      }
      continue;
    }
    if (ch === "/" && source[j + 1] === "/") {
      mode = "line";
      j++;
      continue;
    }
    if (ch === "/" && source[j + 1] === "*") {
      mode = "block";
      j++;
      continue;
    }
    if (ch === "'") {
      mode = "sq";
      continue;
    }
    if (ch === '"') {
      mode = "dq";
      continue;
    }
    if (ch === "`") {
      mode = "tmpl";
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/**
 * Replace the eval-based `compileConstructor` with the eval-free payload.
 *
 * @param {string} source Bundle source.
 * @returns {{ changed: boolean, code: string, reason: string }} `reason` is one
 *   of `patched`, `already-patched`, `no-eval-found`, `signature-not-found`,
 *   `unterminated-block`.
 */
export function applyPatch(source) {
  if (source.includes(MARKER)) return { changed: false, code: source, reason: "already-patched" };

  const start = source.indexOf(SIGNATURE);
  if (start === -1) return { changed: false, code: source, reason: "signature-not-found" };

  const end = findBlockEnd(source, source.indexOf("{", start));
  if (end === -1) return { changed: false, code: source, reason: "unterminated-block" };

  // Only splice when the target actually eval-generates; otherwise upstream got
  // rid of it and touching the file would be pointless churn.
  if (countEvalSites(source.slice(start, end + 1)) === 0) {
    return { changed: false, code: source, reason: "no-eval-found" };
  }

  const code = source.slice(0, start) + EVAL_FREE_COMPILE_CONSTRUCTOR + source.slice(end + 1);
  return { changed: true, code, reason: "patched" };
}

function main(argv) {
  const checkOnly = argv.includes("--check");
  const file = path.resolve(ROOT, IMGLY_DIST);

  if (!fs.existsSync(file)) {
    console.log(`[patches] ${IMGLY_DIST} is not installed yet — nothing to patch.`);
    return 0;
  }

  const before = fs.readFileSync(file, "utf8");
  const result = applyPatch(before);

  if (checkOnly) {
    if (result.changed) {
      console.error(
        `[patches] ${IMGLY_DIST} is NOT patched (would be "${result.reason}").\n` +
          `[patches] Fix: node scripts/apply-patches.mjs`
      );
      return 1;
    }
    if (countEvalSites(before) > 0) {
      console.error(
        `[patches] ${IMGLY_DIST} still calls new Function() and would throw EvalError under PNGCut's CSP.`
      );
      return 1;
    }
    console.log(`[patches] verified ${IMGLY_PACKAGE}: bundle is eval-free.`);
    return 0;
  }

  if (result.changed) fs.writeFileSync(file, result.code);

  const remaining = countEvalSites(result.changed ? result.code : before);
  if (remaining > 0) {
    console.error(
      `[patches] FAILED: ${IMGLY_DIST} still calls new Function() (${remaining}x, ${result.reason}).\n` +
        `[patches] The upstream code generator changed shape — update scripts/patches/imgly-ndarray-eval-free.js.`
    );
    return 1;
  }

  console.log(
    `[patches] ${IMGLY_PACKAGE}: ${result.changed ? "patched" : result.reason} — ` +
      `bundle is eval-free (0 new Function calls).`
  );
  return 0;
}

const invokedDirectly =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
