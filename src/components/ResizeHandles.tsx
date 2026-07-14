import { useEffect } from "react";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function restoreLayoutSizes() {
  const left = Number(localStorage.getItem("requestsmin:left-w"));
  const right = Number(localStorage.getItem("requestsmin:right-w"));
  const requestTop = Number(localStorage.getItem("requestsmin:request-top"));
  if (left) document.body.style.setProperty("--left-w", `${left}px`);
  if (right) document.body.style.setProperty("--right-w", `${right}px`);
  if (requestTop) document.body.style.setProperty("--request-top", `${requestTop}px`);
}

export function startResize(event: React.PointerEvent, axis: "left" | "right" | "request") {
  event.preventDefault();
  const container = document.querySelector(axis === "request" ? ".request-screen.active" : ".main");
  document.body.classList.add(axis === "request" ? "resizing-y" : "resizing");
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  const move = (e: PointerEvent) => {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (axis === "request") {
      const next = clamp(e.clientY - rect.top, 220, Math.max(220, rect.height - 267));
      document.body.style.setProperty("--request-top", `${Math.round(next)}px`);
      localStorage.setItem("requestsmin:request-top", String(Math.round(next)));
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
    document.body.classList.remove("resizing", "resizing-y");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
  window.addEventListener("pointercancel", stop, { once: true });
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
