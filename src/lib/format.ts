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
}
