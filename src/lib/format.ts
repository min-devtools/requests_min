export function escapeHtml(text: string): string {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlightJson(json: string): string {
  return escapeHtml(json).replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|[{}\[\],]/gi,
    (match, quoted, colon, bool) => {
      if (quoted && colon) return `<span class="syntax-key">${quoted}</span><span class="syntax-colon">${colon}</span>`;
      if (quoted) return `<span class="syntax-string">${quoted}</span>`;
      if (bool) return `<span class="syntax-bool">${match}</span>`;
      if (match === "null") return `<span class="syntax-null">${match}</span>`;
      if (/^-?\d/.test(match)) return `<span class="syntax-number">${match}</span>`;
      return `<span class="syntax-punc">${match}</span>`;
    },
  );
}export function formatNumber(val: number | string | null | undefined, fallback = "—"): string {
  if (val == null || val === "") return fallback;
  const num = typeof val === "number" ? val : Number(val);
  return isNaN(num) ? String(val) : num.toLocaleString("en-US");
}

export function formatDuration(ms: number | null | undefined, space = false, fallback = "—"): string {
  if (ms == null || !Number.isFinite(ms)) return fallback;
  return `${formatNumber(ms)}${space ? " ms" : "ms"}`;
}

export function formatBytes(bytes: number | null | undefined, fallback = "0 B"): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return fallback;
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
