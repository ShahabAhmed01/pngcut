/** Background UI — color, gradient, image, blur controls. */
import { GRADIENTS } from "./config.js";
import { loadImage, toCanvasMax } from "./utils.js";
import { validateImageFile } from "./validate.js";
import { IMAGE_POLICY } from "./config.js";

export function createBackgroundUIHandler({ state, el, showToast, setStatus }) {
  function applyColor(c) {
    state.editor.setBackground({ type: "color", color: c });
    const chip = qs("#bg-color-chip");
    if (chip) chip.style.background = c;
  }

  function buildGradientSwatches() {
    el.gradientSwatches.innerHTML = "";
    GRADIENTS.forEach(([from, to]) => {
      const b = document.createElement("button");
      b.className = "swatch";
      b.style.background = `linear-gradient(135deg, ${from}, ${to})`;
      b.title = `${from} → ${to}`;
      b.addEventListener("click", () => {
        qsa("#gradient-swatches .swatch").forEach((s) => s.classList.remove("selected"));
        b.classList.add("selected");
        state.editor.setBackground({ type: "gradient", from, to, angle: 135 });
      });
      el.gradientSwatches.appendChild(b);
    });
  }

  function selectBgButton(btn) {
    qsa("#bg-section .bg-option").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-pressed", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");
  }

  function bindBackgroundUI() {
    el.bgTransparent.addEventListener("click", () => {
      state.editor.setBackground({ type: "transparent" });
      selectBgButton(el.bgTransparent);
    });
    el.bgColor.addEventListener("click", () => {
      selectBgButton(el.bgColor);
      el.colorPicker.click();
    });
    el.bgGradient.addEventListener("click", () => {
      selectBgButton(el.bgGradient);
      const first = el.gradientSwatches.querySelector(".swatch");
      if (first && !el.gradientSwatches.querySelector(".selected")) {
        first.click();
      }
    });
    el.bgImage.addEventListener("click", () => {
      selectBgButton(el.bgImage);
      el.bgImageInput.click();
    });
    el.bgBlur.addEventListener("click", () => {
      selectBgButton(el.bgBlur);
      state.editor.setBackground({ type: "blur", amount: Number(el.blurAmount.value) });
    });

    el.colorPicker.addEventListener("input", () => applyColor(el.colorPicker.value));

    el.bgImageInput.addEventListener("change", async () => {
      const f = el.bgImageInput.files[0];
      el.bgImageInput.value = "";
      if (!f) return;
      const check = validateImageFile(f);
      if (!check.ok) {
        showToast(check.userMessage);
        return;
      }
      try {
        const img = await loadImage(f);
        const c = toCanvasMax(img, IMAGE_POLICY.maxDimension);
        state.editor.setBackground({ type: "image", imageCanvas: c });
        setStatus("Custom background image set.");
      } catch {
        showToast("PNGCut couldn't decode that background image.");
      }
    });

    el.blurAmount.addEventListener("input", () => {
      el.blurAmountVal.textContent = `${el.blurAmount.value}px`;
      if (state.editor.background.type === "blur") {
        state.editor.setBackground({ type: "blur", amount: Number(el.blurAmount.value) });
      }
    });
  }

  return { buildGradientSwatches, bindBackgroundUI };
}

const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));