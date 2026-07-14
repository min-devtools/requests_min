import { useMemo } from "react";
import { highlightJson } from "../lib/format";

export function JsonView({ value, className = "json-tree" }: { value: unknown; className?: string }) {
  const html = useMemo(() => highlightJson(typeof value === "string" ? value : JSON.stringify(value, null, 2)), [value]);
  return <pre className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
