/** Background rendering for the editor preview. */
import { checkerboardPattern } from "./utils.js";

export const BACKGROUND_TYPES = {
  transparent: { label: "Transparent", icon: "checker" },
  color: { label: "Solid color", icon: "square" },
  gradient: { label: "Gradient", icon: "gradient" },
  image: { label: "Image", icon: "photo" },
  blur: { label: "Blur original", icon: "blur" },
};

/**
 * Draw the current background into a canvas the same size as the image.
 * Returns an opaque (or transparent) canvas that the foreground is drawn over.
 */
export function renderBackground(bg, width, height, sourceCanvas) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  switch (bg.type) {
    case "transparent":
      break;
    case "color":
      ctx.fillStyle = bg.color || "#ffffff";
      ctx.fillRect(0, 0, width, height);
      break;
    case "gradient": {
      const from = bg.from || "#7c3aed";
      const to = bg.to || "#06b6d4";
      const angle = (bg.angle ?? 135) * (Math.PI / 180);
      const cx = width / 2;
      const cy = height / 2;
      const len = Math.sqrt(width * width + height * height) / 2;
      const g = ctx.createLinearGradient(
        cx - Math.cos(angle) * len,
        cy - Math.sin(angle) * len,
        cx + Math.cos(angle) * len,
        cy + Math.sin(angle) * len
      );
      g.addColorStop(0, from);
      g.addColorStop(1, to);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case "blur": {
      if (sourceCanvas) {
        const blurRadius = bg.amount ?? 24;
        ctx.filter = `blur(${blurRadius}px)`;
        // draw slightly scaled up so blurred edges don't leave transparent gaps
        const s = 1 + blurRadius / Math.min(width, height);
        ctx.drawImage(sourceCanvas, -width * (s - 1) / 2, -height * (s - 1) / 2, width * s, height * s);
        ctx.filter = "none";
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      }
      break;
    }
    case "image": {
      if (bg.imageCanvas) {
        ctx.fillStyle = checkerboardPattern(12);
        ctx.fillRect(0, 0, width, height);
        drawCover(ctx, bg.imageCanvas, 0, 0, width, height);
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      }
      break;
    }
    default:
      break;
  }
  return canvas;
}

/** Draw an image covering the target rect, preserving aspect ratio. */
export function drawCover(ctx, img, x, y, w, h) {
  const iw = img.width || img.naturalWidth;
  const ih = img.height || img.naturalHeight;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}