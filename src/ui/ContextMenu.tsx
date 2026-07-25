import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Icon, type IconName } from "./Icon";

export interface ContextMenuItem {
  icon: IconName;
  label: string;
  strong?: boolean;
  danger?: boolean;
  /** shortcut hint rendered right-aligned (e.g. "⌘D") */
  kbd?: string;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
  }, [onClose]);

  // clamp to viewport
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 12}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${window.innerHeight - rect.height - 12}px`;
  }, [x, y]);

  return (
    <motion.div
      ref={ref}
      className="index-context-menu"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
      initial={{ opacity: 0, scale: 0.93, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.93 }}
      transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`context-item ${item.danger ? "danger" : ""}`}
          onClick={() => { onClose(); item.onClick(); }}
        >
          <Icon name={item.icon} size={15} />
          {item.strong ? <strong>{item.label}</strong> : <span>{item.label}</span>}
          {item.kbd ? <span className="kbd">{item.kbd}</span> : <span />}
        </button>
      ))}
    </motion.div>
  );
}
