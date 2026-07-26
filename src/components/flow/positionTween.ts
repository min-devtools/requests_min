export interface TweenTarget {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export function lerpTargets(
  targets: readonly TweenTarget[],
  progress: number,
): Map<string, { x: number; y: number }> {
  const eased = easeOutCubic(Math.min(1, Math.max(0, progress)));
  return new Map(targets.map((target) => [target.id, {
    x: target.from.x + (target.to.x - target.from.x) * eased,
    y: target.from.y + (target.to.y - target.from.y) * eased,
  }]));
}

/**
 * rAF-driven tween: `apply` gets interpolated positions every frame, `done` fires exactly once
 * when the tween lands. The returned function cancels a tween still in flight (done is skipped).
 */
export function runPositionTween(
  targets: readonly TweenTarget[],
  durationMs: number,
  apply: (positions: Map<string, { x: number; y: number }>) => void,
  done: () => void,
): () => void {
  if (targets.length === 0) {
    done();
    return () => {};
  }
  const startedAt = performance.now();
  let frame = 0;
  let finished = false;
  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / durationMs);
    apply(lerpTargets(targets, progress));
    if (progress < 1) {
      frame = requestAnimationFrame(tick);
    } else {
      finished = true;
      done();
    }
  };
  frame = requestAnimationFrame(tick);
  return () => { if (!finished) cancelAnimationFrame(frame); };
}
