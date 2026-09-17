/* Runs before rendering on every page; keep this file independent of the app bundle. */
(() => {
  const key = "pngcut-theme";
  const root = document.documentElement;
  let button;

  function apply(theme) {
    const selected = theme === "light" ? "light" : "dark";
    root.dataset.theme = selected;
    const color = document.querySelector('meta[name="theme-color"]');
    const scheme = document.querySelector('meta[name="color-scheme"]');
    if (color) color.content = selected === "light" ? "#f7f5ef" : "#0b0d12";
    if (scheme) scheme.content = selected;
    if (button) {
      button.textContent = selected === "dark" ? "Light mode" : "Dark mode";
      button.setAttribute("aria-label", `Switch to ${selected === "dark" ? "light" : "dark"} mode`);
    }
  }

  let saved;
  try { saved = localStorage.getItem(key); } catch { /* Storage may be blocked. */ }
  apply(saved);

  document.addEventListener("DOMContentLoaded", () => {
    const header = document.querySelector(".topbar-actions") || document.querySelector(".topbar");
    if (!header) return;
    button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    button.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      apply(next);
      try { localStorage.setItem(key, next); } catch { /* Switching still works in memory. */ }
    });
    header.append(button);
    apply(root.dataset.theme);
  }, { once: true });

  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) {
      apply(event.newValue);
    }
  });
})();
