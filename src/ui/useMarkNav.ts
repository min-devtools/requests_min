import { useLayoutEffect, useState, type RefObject } from "react";

export interface MarkNav {
  /** 0-based position of the active hit */
  index: number;
  count: number;
  /** ready-to-render `n/total`, `0/0` on a miss, `""` when not searching */
  label: string;
  /** move by `delta`, wrapping at both ends */
  step: (delta: number) => void;
}

/**
 * Find-bar navigation over the `<mark>`s a view has already rendered.
 *
 * The rendered marks *are* the match list, so this can't drift from what the user
 * sees — no second pass over the data, no separate matcher to keep in sync. Only
 * works when the whole result is in the DOM; a virtualised view has to navigate by
 * row index instead (see `JsonView` in preview_min).
 *
 * `deps` must keep a constant length across renders, like any hook dep array.
 */
export function useMarkNav(
  scopeRef: RefObject<HTMLElement | null>,
  active: boolean,
  deps: unknown[],
): MarkNav {
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);

  const marks = () => Array.from(scopeRef.current?.querySelectorAll<HTMLElement>("mark") ?? []);

  // recount after every render that can change the marks, clamping the cursor
  useLayoutEffect(() => {
    const next = active ? marks().length : 0;
    setCount(next);
    setIndex((current) => (next ? Math.min(current, next - 1) : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps]);

  // Paint + reveal the active hit. The class is applied imperatively, so this has to
  // re-run on anything that re-renders the marks — a new query with the same hit count
  // would otherwise leave the highlight on a stale node.
  useLayoutEffect(() => {
    const found = marks();
    found.forEach((m) => m.classList.remove("match-current"));
    const hit = found[index];
    if (!hit) return;
    hit.classList.add("match-current");
    hit.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count, active, ...deps]);

  return {
    index,
    count,
    label: active ? `${count ? index + 1 : 0}/${count}` : "",
    step: (delta) => {
      if (!count) return;
      setIndex((current) => (current + delta + count) % count);
    },
  };
}
