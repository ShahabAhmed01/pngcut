/**
 * Video background removal — 100% client-side.
 *
 * Pass 1 ("Analyze"): seek through the video frame-by-frame at the chosen fps,
 * run the segmentation model on each frame and store a compact 8-bit alpha
 * mask per frame (one byte per pixel at working resolution).
 *
 * Pass 2 ("Render"): play the video in realtime (with audio), composite
 * original frame + stored mask + chosen background into an output canvas and
 * capture it with MediaRecorder → WebM download.
 */

import * as engine from "./engine.js";
import { downloadBlob, formatBytes, clamp } from "./utils.js";
import { sanitizeFilename, validateVideoFile } from "./validate.js";
import { VIDEO_POLICY } from "./config.js";

export function initVideo({ showToast, goHome }) {
  const qs = (s) => document.querySelector(s);
  const el = {
    home: qs("#btn-video-home"),
    video: qs("#video-el"),
    info: qs("#video-file-info"),
    quality: qs("#video-quality"),
    fps: qs("#video-fps"),
    bg: qs("#video-bg"),
    bgColor: qs("#video-bg-color"),
    start: qs("#btn-video-start"),
    render: qs("#btn-video-render"),
    cancel: qs("#btn-video-cancel"),
    progress: qs("#video-progress"),
    bar: qs("#video-progress-bar"),
    text: qs("#video-progress-text"),
  };

  const v = {
    file: null,
    url: null,
    meta: null, // { width, height, duration }
    masks: null, // array of Uint8Array (alpha per frame)
    maskW: 0,
    maskH: 0,
    fps: 24,
    running: false,
    cancelFlag: false,
  };

  function pct(p) {
    el.bar.style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`;
  }
  function say(text) {
    el.text.textContent = text;
  }
  function showProgress(show) {
    el.progress.classList.toggle("hidden", !show);
  }

  function reset() {
    v.file = null;
    v.meta = null;
    v.masks = null;
    v.running = false;
    v.cancelFlag = false;
    el.info.textContent = "";
    el.render.classList.add("hidden");
    el.cancel.classList.add("hidden");
    el.start.classList.remove("hidden");
    showProgress(false);
    pct(0);
  }

  /** Point the player at a new video file. */
  function setFile(file) {
    if (v.running) {
      showToast("Please wait for the current job to finish.");
      return false;
    }
    const check = validateVideoFile(file);
    if (!check.ok) {
      showToast(check.userMessage);
      return false;
    }
    reset();
    v.file = file;
    if (v.url) URL.revokeObjectURL(v.url);
    v.url = URL.createObjectURL(file);
    el.video.src = v.url;
    el.video.muted = true;
    el.video.currentTime = 0;
    waitForMeta(el.video)
      .then((meta) => {
        v.meta = meta;
        const est = estimateWorkload(meta, Number(el.fps.value), Number(el.quality.value));
        el.info.textContent = `${meta.width} × ${meta.height} · ${meta.duration.toFixed(1)}s · ${formatBytes(file.size)}`;
        say(`${Math.round(est.frames)} frames to analyze · ~${formatBytes(est.maskBytes)} mask memory`);
      })
      .catch(() => {
        showToast("Could not load this video in your browser — the codec may be unsupported.");
      });
    return true;
  }

  function estimateWorkload(meta, fps, quality) {
    const scale = Math.min(1, quality / Math.max(meta.width, meta.height));
    const mw = Math.max(2, Math.round((meta.width * scale) / 2) * 2);
    const mh = Math.max(2, Math.round((meta.height * scale) / 2) * 2);
    const frames = Math.max(1, Math.round(meta.duration * fps));
    return { frames, maskBytes: frames * mw * mh };
  }

  function waitForMeta(video) {
    return new Promise((resolve, reject) => {
      if (video.readyState >= 1 && video.duration && isFinite(video.duration) && video.videoWidth) {
        resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
        return;
      }
      const onMeta = () => {
        cleanup();
        if (video.duration && isFinite(video.duration) && video.videoWidth) {
          resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
        } else reject(new Error("no metadata"));
      };
      const onErr = () => {
        cleanup();
        reject(new Error("video error"));
      };
      const to = setTimeout(() => {
        cleanup();
        reject(new Error("timeout"));
      }, 10000);
      function cleanup() {
        clearTimeout(to);
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("error", onErr);
      }
      video.addEventListener("loadedmetadata", onMeta, { once: true });
      video.addEventListener("error", onErr, { once: true });
    });
  }

  function seekTo(video, t) {
    return new Promise((resolve) => {
      const to = setTimeout(() => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      }, 5000);
      function onSeeked() {
        clearTimeout(to);
        video.removeEventListener("seeked", onSeeked);
        resolve();
      }
      video.addEventListener("seeked", onSeeked, { once: true });
      video.currentTime = Math.min(t, Math.max(0, video.duration - 0.001));
    });
  }

  function canvasToJpeg(canvas, quality = 0.92) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
  }

  /** Pass 1 — analyze every frame and cache alpha masks. */
  async function analyze() {
    if (!v.file) return;
    if (!v.meta) {
      showToast("Video still loading — try again in a moment.");
      return;
    }
    const fps = Number(el.fps.value);
    const quality = Number(el.quality.value);
    const model = quality <= 384 ? "small" : quality <= 576 ? "medium" : "large";
    const meta = v.meta;
    const scale = Math.min(1, quality / Math.max(meta.width, meta.height));
    const mw = Math.max(2, Math.round((meta.width * scale) / 2) * 2);
    const mh = Math.max(2, Math.round((meta.height * scale) / 2) * 2);

    const total = Math.max(1, Math.round(meta.duration * fps));
    const est = total * mw * mh; // bytes of alpha storage
    if (est > VIDEO_POLICY.maxMaskBytes) {
      showToast("This video is too long to process in-browser at this quality. Try fewer fps, lower quality, or a shorter clip.");
      return;
    }

    v.fps = fps;
    v.maskW = mw;
    v.maskH = mh;
    v.masks = [];

    const work = document.createElement("canvas");
    work.width = mw;
    work.height = mh;
    const wctx = work.getContext("2d", { willReadFrequently: true });

    const video = el.video;
    video.pause();
    v.running = true;
    v.cancelFlag = false;
    el.start.classList.add("hidden");
    el.cancel.classList.remove("hidden");
    showProgress(true);
    pct(0);

    try {
      await seekTo(video, 0);
      for (let i = 0; i < total; i++) {
        if (v.cancelFlag) {
          v.masks = null;
          showToast("Analysis canceled.");
          showProgress(false);
          el.start.classList.remove("hidden");
          return;
        }
        await seekTo(video, i / fps);
        wctx.drawImage(video, 0, 0, mw, mh);
        const blob = await canvasToJpeg(work, 0.92);
        const maskBlob = await engine.segmentForeground(blob, { model });
        const bmp = await createImageBitmap(maskBlob);
        const md = document.createElement("canvas");
        md.width = mw;
        md.height = mh;
        const mctx = md.getContext("2d", { willReadFrequently: true });
        mctx.drawImage(bmp, 0, 0, mw, mh);
        bmp.close();
        const data = mctx.getImageData(0, 0, mw, mh).data;
        const alpha = new Uint8Array(mw * mh);
        for (let p = 0, j = 3; p < alpha.length; p++, j += 4) alpha[p] = data[j];
        v.masks.push(alpha);
        pct(i / total);
        say(`Analyzing frame ${i + 1} of ${total}…`);
        await new Promise((r) => setTimeout(r, 0)); // keep UI responsive
      }
      pct(1);
      say(`Done — ${total} frames analyzed. Press “Render & download”.`);
      el.render.classList.remove("hidden");
    } catch (err) {
      console.error(err);
      showToast("Video analysis failed — try a lower quality setting or a different clip.");
      v.masks = null;
      showProgress(false);
      el.start.classList.remove("hidden");
    } finally {
      v.running = false;
      el.cancel.classList.add("hidden");
    }
  }

  function pickMime() {
    const options = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9",
      "video/webm",
    ];
    for (const m of options) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    }
    return "";
  }

  /** Pass 2 — realtime composite + capture → WebM download. */
  async function renderAndDownload() {
    if (!v.masks || !v.masks.length || v.running) return;
    const meta = v.meta;
    const fps = v.fps;
    const total = v.masks.length;

    const long = Math.min(Math.max(meta.width, meta.height), VIDEO_POLICY.maxOutputDimension);
    const aspect = meta.width / meta.height;
    const outW = (aspect >= 1 ? long : Math.round(long * aspect)) & ~1;
    const outH = (aspect >= 1 ? Math.round(long / aspect) : long) & ~1;

    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    const octx = out.getContext("2d");
    const fg = document.createElement("canvas");
    fg.width = outW;
    fg.height = outH;
    const fctx = fg.getContext("2d");
    const maskC = document.createElement("canvas");
    maskC.width = v.maskW;
    maskC.height = v.maskH;
    const mctx = maskC.getContext("2d", { willReadFrequently: true });
    const maskData = mctx.createImageData(v.maskW, v.maskH);
    for (let p = 0; p < maskData.data.length; p += 4) {
      maskData.data[p] = 255;
      maskData.data[p + 1] = 255;
      maskData.data[p + 2] = 255;
    }

    function drawComposite(frameIdx, sourceEl) {
      const alpha = v.masks[frameIdx];
      const d = maskData.data;
      for (let p = 0, j = 3; p < alpha.length; p++, j += 4) d[j] = alpha[p];
      mctx.putImageData(maskData, 0, 0);

      const mode = el.bg.value;
      if (mode === "blur") {
        octx.save();
        octx.filter = `blur(${Math.max(6, Math.round(outH / 25))}px)`;
        const s = 1.12;
        octx.drawImage(sourceEl, (-outW * (s - 1)) / 2, (-outH * (s - 1)) / 2, outW * s, outH * s);
        octx.restore();
      } else {
        octx.fillStyle = mode === "color" ? el.bgColor.value : "#ffffff";
        octx.fillRect(0, 0, outW, outH);
      }

      fctx.globalCompositeOperation = "source-over";
      fctx.clearRect(0, 0, outW, outH);
      fctx.drawImage(sourceEl, 0, 0, outW, outH);
      fctx.globalCompositeOperation = "destination-in";
      fctx.drawImage(maskC, 0, 0, outW, outH);
      octx.drawImage(fg, 0, 0);
    }

    const mime = pickMime();
    if (!mime) {
      showToast("Your browser does not support in-browser video recording (MediaRecorder).");
      return;
    }

    const stream = out.captureStream(fps);
    let audioCtx = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        audioCtx = new AC();
        const srcNode = audioCtx.createMediaElementSource(el.video);
        const dest = audioCtx.createMediaStreamDestination();
        srcNode.connect(dest);
        const track = dest.stream.getAudioTracks()[0];
        if (track) stream.addTrack(track);
      }
    } catch (e) {
      console.warn("Audio capture unavailable:", e);
    }

    const bits = clamp(Math.round(outW * outH * fps * 0.12), 2000000, 16000000);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bits });
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise((res) => {
      rec.onstop = res;
    });

    v.running = true;
    v.cancelFlag = false;
    el.render.classList.add("hidden");
    el.cancel.classList.remove("hidden");
    showProgress(true);
    pct(0);

    let finished = false;
    rec.start(400);

    function finish(save) {
      if (finished) return;
      finished = true;
      try {
        el.video.pause();
      } catch {
        /* video may already be dead — nothing to do */
      }
      try {
        rec.stop();
      } catch {
        /* recorder may have already stopped — nothing to do */
      }
      stopped.then(() => {
        try {
          if (audioCtx) audioCtx.close();
        } catch {
          /* audio context may already be closed */
        }
        if (save && chunks.length) {
          const blob = new Blob(chunks, { type: mime.split(";")[0] });
          const base = sanitizeFilename(v.file.name || "video", "video");
          downloadBlob(blob, `${base}-nobg.webm`);
          showToast(`Saved WebM (${formatBytes(blob.size)})`);
        } else if (!save) {
          showToast("Rendering canceled.");
        }
        v.running = false;
        showProgress(false);
        el.cancel.classList.add("hidden");
        el.render.classList.remove("hidden");
        pct(0);
        say("Ready.");
      });
    }

    const onEnded = () => finish(true);
    el.video.addEventListener("ended", onEnded, { once: true });

    const onFrame = () => {
      if (finished) return;
      if (v.cancelFlag) {
        finish(false);
        return;
      }
      const t = el.video.currentTime;
      const idx = clamp(Math.round(t * fps), 0, total - 1);
      drawComposite(idx, el.video);
      pct(t / meta.duration);
      say(`Rendering ${Math.min(total, idx + 1)} / ${total}…`);
    };

    if (el.video.requestVideoFrameCallback) {
      const vfcLoop = () => {
        onFrame();
        if (!finished) el.video.requestVideoFrameCallback(vfcLoop);
      };
      el.video.requestVideoFrameCallback(vfcLoop);
    } else {
      const loop = () => {
        onFrame();
        if (!finished) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    el.video.muted = false;
    el.video.currentTime = 0;
    try {
      await el.video.play();
    } catch {
      el.video.muted = true;
      try {
        await el.video.play();
      } catch {
        finish(false);
        showToast("Could not start playback for rendering.");
        return;
      }
    }
  }

  // ---- wiring --------------------------------------------------------------
  el.start.addEventListener("click", analyze);
  el.render.addEventListener("click", renderAndDownload);
  el.cancel.addEventListener("click", () => {
    v.cancelFlag = true;
    if (v._cancelFn) {
      v._cancelFn();
      v._cancelFn = null;
    }
  });
  el.bg.addEventListener("change", () => {
    el.bgColor.classList.toggle("hidden", el.bg.value !== "color");
  });
  if (el.home && goHome) el.home.addEventListener("click", goHome);

  return {
    setFile,
    isActive: () => v.running,
    cancel: () => {
      v.cancelFlag = true;
    },
  };
}
