import { useEffect } from "react";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function restoreLayoutSizes() {
  const left = Number(localStorage.getItem("requestsmin:left-w"));
  const right = Number(localStorage.getItem("requestsmin:right-w"));
  const requestTop = Number(localStorage.getItem("requestsmin:request-top"));
  const requestLeft = Number(localStorage.getItem("requestsmin:request-left"));
  if (left) document.body.style.setProperty("--left-w", `${left}px`);
  if (right) document.body.style.setProperty("--right-w", `${right}px`);
  if (requestTop) document.body.style.setProperty("--request-top", `${requestTop}px`);
  if (requestLeft) document.body.style.setProperty("--request-left", `${requestLeft}px`);
}

export function startResize(event: React.PointerEvent, axis: "left" | "right" | "request" | "request-x") {
  event.preventDefault();
  const requestAxis = axis === "request" || axis === "request-x";
  const container = document.querySelector(requestAxis ? ".request-screen.active" : ".main");
  document.body.classList.add(axis === "request-x" ? "resizing-x" : requestAxis ? "resizing-y" : "resizing");
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  // delta-based resize: anchor to the editor pane's actual size + pointer movement,
  // so a click without drag doesn't snap to (clientY - grid top), which includes
  // the ~90px name+head rows above the editor and causes a jump
  const startY = event.clientY;
  const startX = event.clientX;
  const editorPane = container?.querySelector(".editor-pane") as HTMLElement | null;
  const startTop = editorPane ? editorPane.getBoundingClientRect().height : 0;
  const startLeft = editorPane ? editorPane.getBoundingClientRect().width : 0;
  const move = (e: PointerEvent) => {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (axis === "request-x") {
      const next = clamp(startLeft + (e.clientX - startX), 240, Math.max(240, rect.width - 247));
      document.body.style.setProperty("--request-left", `${Math.round(next)}px`);
      localStorage.setItem("requestsmin:request-left", String(Math.round(next)));
    } else if (axis === "request") {
      const next = clamp(startTop + (e.clientY - startY), 39, Math.max(39, rect.height - 86));
      container.classList.remove("editor-maxed");
      document.body.style.setProperty("--request-top", `${Math.round(next)}px`);
      localStorage.setItem("requestsmin:request-top", String(Math.round(next)));
      localStorage.setItem("requestsmin:request-maxed", "0");
    } else if (axis === "left") {
      const max = Math.min(430, rect.width - 760);
      const next = clamp(e.clientX - rect.left, 190, max);
      document.body.style.setProperty("--left-w", `${Math.round(next)}px`);
      localStorage.setItem("requestsmin:left-w", String(Math.round(next)));
    } else {
      const max = Math.min(560, rect.width - 760);
      const next = clamp(rect.right - e.clientX, 260, max);
      document.body.style.setProperty("--right-w", `${Math.round(next)}px`);
      localStorage.setItem("requestsmin:right-w", String(Math.round(next)));
    }
  };
  const stop = () => {
    document.body.classList.remove("resizing", "resizing-y", "resizing-x");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
  window.addEventListener("pointercancel", stop, { once: true });
}

// Double-click a tab to toggle the bottom dock (response). Two states, decided by the
// measured editor height — the editor row CAN reach its 39px min, so the reading is
// reliable (unlike the max, which the grid caps):
//   body already at min (dock maxed)  -> open dock to 50%
//   otherwise                         -> shrink body flush to the tabs, dock takes the rest
const MIN_TOP = 39;
export function toggleRequestEditorSize(event: React.MouseEvent, horizontal: boolean) {
  if (horizontal) return;
  const screen = (event.currentTarget as HTMLElement).closest(".request-screen.active") as HTMLElement | null;
  const editorPane = screen?.querySelector(".editor-pane") as HTMLElement | null;
  if (!screen || !editorPane) return;

  screen.classList.remove("editor-maxed"); // legacy editor-max state; dock is driven via --request-top
  const screenH = screen.getBoundingClientRect().height;
  const cur = editorPane.getBoundingClientRect().height;
  const next = cur <= MIN_TOP + 8 ? Math.round(screenH / 2) : MIN_TOP;
  document.body.style.setProperty("--request-top", `${next}px`);
  localStorage.setItem("requestsmin:request-top", String(next));
}

export function PanelResizeHandles() {
  useEffect(() => { restoreLayoutSizes(); }, []);
  return (
    <>
      <div className="resize-handle vertical left" title="Resize sidebar" aria-label="Resize sidebar" onPointerDown={(e) => startResize(e, "left")} />
      <div className="resize-handle vertical right" title="Resize inspector" aria-label="Resize inspector" onPointerDown={(e) => startResize(e, "right")} />
    </>
  );
}
