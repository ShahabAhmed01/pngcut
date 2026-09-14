/** Tool selection — erase, restore, compare, background. */
export function createToolHandler({ state, el, setStatus }) {
  let activeTool = "erase";

  function setTool(tool) {
    activeTool = tool;
    const tools = { erase: el.toolErase, restore: el.toolRestore, compare: el.toolCompare, bg: el.toolBg };
    Object.entries(tools).forEach(([k, btn]) => {
      btn.classList.toggle("active", k === tool);
      btn.setAttribute("aria-pressed", k === tool ? "true" : "false");
    });
    qs("#brush-section").classList.toggle("hidden", !(tool === "erase" || tool === "restore"));
    qs("#bg-section").classList.toggle("hidden", tool !== "bg");
    qs("#color-row").classList.toggle("hidden", tool !== "bg");
    qs("#feather-row").classList.toggle("hidden", tool === "bg" || tool === "compare");
    if (tool === "compare") {
      state.editor.setCompare(true, 0.5);
      setStatus("Drag the divider to compare original vs. result.");
    } else {
      state.editor.setCompare(false);
      if (tool === "erase") setStatus("Paint over areas you want to remove (become background).");
      else if (tool === "restore") setStatus("Paint over areas you want to restore (become subject).");
      else if (tool === "bg") setStatus("Choose a background for the result.");
    }
  }

  function getActiveTool() {
    return activeTool;
  }

  return { setTool, getActiveTool };
}

const qs = (sel) => document.querySelector(sel);