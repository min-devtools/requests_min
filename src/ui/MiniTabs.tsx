import { useId } from "react";
import { motion } from "motion/react";
import type { IconName } from "./Icon";
import { Icon } from "./Icon";

export interface MiniTab {
  id: string;
  label: string;
  icon?: IconName;
  title?: string;
}

export function MiniTabs({
  tabs,
  active,
  onChange,
  label = "View mode",
}: {
  tabs: MiniTab[];
  active: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  // layoutId is app-global — namespace it so two mounted MiniTabs never fight
  const ns = useId();
  return (
    <div className="mini-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, index) => (
        <motion.button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          // roving tabindex — the strip is one Tab stop, arrows move within it
          tabIndex={t.id === active ? 0 : -1}
          whileTap={{ scale: 0.96 }}
          className={t.id === active ? "active" : ""}
          title={t.title ?? t.label}
          aria-label={t.label}
          onClick={() => onChange(t.id)}
          onKeyDown={(event) => {
            const direction =
              event.key === "ArrowRight" || event.key === "ArrowDown"
                ? 1
                : event.key === "ArrowLeft" || event.key === "ArrowUp"
                  ? -1
                  : 0;
            if (!direction) return;
            event.preventDefault();
            const next = (index + direction + tabs.length) % tabs.length;
            onChange(tabs[next].id);
            const strip = event.currentTarget.parentElement;
            requestAnimationFrame(() => {
              strip?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            });
          }}
        >
          {t.id === active && (
            // the active surface glides between tabs (FLIP, transform-only)
            <motion.span
              className="mini-tab-pill"
              layoutId={`mini-tab-pill-${ns}`}
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
          )}
          {t.icon && <Icon name={t.icon} size={13} />}
          <span className="mini-tab-label">{t.label}</span>
        </motion.button>
      ))}
    </div>
  );
}
