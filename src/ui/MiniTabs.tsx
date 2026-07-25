import { motion } from "motion/react";

export interface MiniTab {
  id: string;
  label: string;
}

export function MiniTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: MiniTab[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mini-tabs" role="tablist">
      {tabs.map((t) => (
        <motion.button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          whileTap={{ scale: 0.96 }}
          className={t.id === active ? "active" : ""}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </motion.button>
      ))}
    </div>
  );
}
