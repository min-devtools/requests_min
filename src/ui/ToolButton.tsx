import type { ButtonHTMLAttributes } from "react";
import { motion } from "motion/react";

// Motion's gesture props (onDrag, onAnimationStart, ...) collide with the DOM's same-named
// handlers — drop them so the spread stays type-safe. No caller here needs native drag.
type MotionConflicting = "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, MotionConflicting> {
  variant?: "default" | "primary" | "danger";
  iconOnly?: boolean;
}

export function ToolButton({ variant = "default", iconOnly = false, className = "", disabled, ...rest }: Props) {
  const cls = ["tool-btn", variant !== "default" ? variant : "", iconOnly ? "icon-only" : "", className]
    .filter(Boolean)
    .join(" ");
  return <motion.button type="button" className={cls} disabled={disabled} whileTap={disabled ? undefined : { scale: 0.96 }} {...rest} />;
}
