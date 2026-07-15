import type { ReactNode } from "react";

export function Kv({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`kv ${className}`}>
      <span>{label}</span>
      <code>{children}</code>
    </div>
  );
}
