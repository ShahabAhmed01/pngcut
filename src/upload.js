/** File upload handling — dropzone, paste, file pickers, sample images. */
import { validateImageFile, isSvgFile, looksLikeVideo } from "./validate.js";

export function createUploadHandler({ el, showToast, showView, processImage, bulkFlow, videoFlow }) {
  const { fileInput, bulkInput, folderInput, videoInput, dropzone, sampleButtons } = el;

  function acceptFile(file) {
    if (!file) return;
    if (isSvgFile(file)) {
      showToast("SVG files aren't supported for background removal. Use PNG, JPEG, WebP, AVIF or BMP.");
      return;
    }
    if (looksLikeVideo(file)) {
      if (videoFlow.setFile(file)) showView("video");
      return;
    }
    const result = validateImageFile(file);
    if (!result.ok) {
      showToast(result.userMessage);
      return;
    }
    processImage(file, file.name || "image");
  }

  function acceptFiles(files) {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    const videos = list.filter(looksLikeVideo);
    const images = list.filter(
      (f) => /^image\//.test(f.type || "") && !/^image\/svg/.test(f.type) && !/\.svg$/i.test(f.name || "")
    );
    const svgs = list.filter(isSvgFile);

    if (svgs.length) {
      showToast("SVG files were skipped — background removal works on raster images (PNG, JPEG, WebP, AVIF, BMP).");
    }

    if (images.length > 1 || (images.length && videos.length)) {
      if (images.length && videos.length) {
        showToast("Videos are processed one at a time — dropping the images for bulk removal.");
      }
      bulkFlow.addFiles(images);
      showView("bulk");
      return;
    }
    if (images.length === 1) {
      acceptFile(images[0]);
      return;
    }
    if (videos.length) {
      acceptFile(videos[0]);
    }
  }

  function bindUpload() {
    fileInput.addEventListener("change", () => {
      acceptFiles(fileInput.files);
      fileInput.value = "";
    });

    dropzone.addEventListener("click", (e) => {
      if (e.target === fileInput) return;
      if (e.target.closest(".pick-btn, .primary-upload, a")) return;
      fileInput.click();
    });

    ["dragover", "dragenter"].forEach((ev) =>
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
      })
    );
    dropzone.addEventListener("drop", (e) => {
      acceptFiles(e.dataTransfer && e.dataTransfer.files);
    });

    document.querySelector("#btn-upload").addEventListener("click", () => fileInput.click());
    document.querySelector("#btn-pick-video").addEventListener("click", () => videoInput.click());
    document.querySelector("#btn-pick-folder").addEventListener("click", () => folderInput.click());
    document.querySelector("#btn-pick-bulk").addEventListener("click", () => bulkInput.click());

    bulkInput.addEventListener("change", () => {
      acceptFiles(bulkInput.files);
      bulkInput.value = "";
    });

    folderInput.addEventListener("change", () => {
      const files = Array.from(folderInput.files || []).filter(
        (f) => !(f.webkitRelativePath || "").split("/").pop().startsWith(".")
      );
      if (!files.length) {
        showToast("No images found in that folder.");
      }
      acceptFiles(files);
      folderInput.value = "";
    });

    videoInput.addEventListener("change", () => {
      acceptFile(videoInput.files[0]);
      videoInput.value = "";
    });

    document.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith("image/")) {
          acceptFile(item.getAsFile());
          e.preventDefault();
          break;
        }
      }
    });

    sampleButtons.forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          const res = await fetch(btn.dataset.sample);
          const blob = await res.blob();
          processImage(blob, btn.dataset.sample.split("/").pop());
        } catch {
          showToast("Couldn't load sample image.");
        }
      })
    );
  }

  return { acceptFile, acceptFiles, bindUpload };
}