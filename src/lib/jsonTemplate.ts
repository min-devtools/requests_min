export interface TemplateToken {
  id: string;
  original: string;
  isUnquotedValue: boolean;
}

export function prepareJsonWithTemplates(text: string) {
  let result = "";
  const tokens: TemplateToken[] = [];
  let inString = false;
  let escaped = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inString) {
      if (escaped) {
        result += char;
        escaped = false;
        i++;
        continue;
      }
      if (char === "\\") {
        result += char;
        escaped = true;
        i++;
        continue;
      }
      if (char === '"') {
        inString = false;
        result += char;
        i++;
        continue;
      }
      if (char === "{" && nextChar === "{") {
        const endIdx = text.indexOf("}}", i + 2);
        if (endIdx !== -1) {
          const original = text.slice(i, endIdx + 2);
          const id = `__REQMIN_STR_TOK_${tokens.length}__`;
          tokens.push({ id, original, isUnquotedValue: false });
          result += id;
          i = endIdx + 2;
          continue;
        }
      }
      result += char;
      i++;
    } else {
      if (char === '"') {
        inString = true;
        result += char;
        i++;
        continue;
      }
      if (char === "{" && nextChar === "{") {
        const endIdx = text.indexOf("}}", i + 2);
        if (endIdx !== -1) {
          const original = text.slice(i, endIdx + 2);
          const id = `__REQMIN_RAW_TOK_${tokens.length}__`;
          tokens.push({ id, original, isUnquotedValue: true });
          result += `"${id}"`;
          i = endIdx + 2;
          continue;
        }
      }
      result += char;
      i++;
    }
  }

  return {
    sanitizedText: result,
    restore(jsonOutput: string): string {
      let restored = jsonOutput;
      for (const token of tokens) {
        if (token.isUnquotedValue) {
          restored = restored.split(`"${token.id}"`).join(token.original);
        } else {
          restored = restored.split(token.id).join(token.original);
        }
      }
      return restored;
    },
  };
}

export function formatJsonWithTemplates(text: string, indent: number = 2): string {
  const prepared = prepareJsonWithTemplates(text);
  const parsed = JSON.parse(prepared.sanitizedText);
  const stringified = JSON.stringify(parsed, null, indent);
  return prepared.restore(stringified);
}

export function minifyJsonWithTemplates(text: string): string {
  const prepared = prepareJsonWithTemplates(text);
  const parsed = JSON.parse(prepared.sanitizedText);
  const stringified = JSON.stringify(parsed);
  return prepared.restore(stringified);
}

export function validateJsonWithTemplates(text: string): { valid: boolean; error?: string } {
  try {
    const prepared = prepareJsonWithTemplates(text);
    JSON.parse(prepared.sanitizedText);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}

export interface JsonDiagnostic {
  message: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

// Template-aware JSON syntax checker. Monaco's JSON worker can't be used here: an unquoted
// {{var}} reads as nested "{" opens, collapsing the parse tree and cascading false errors
// onto lines far away from the token. This parser instead treats {{...}} as an atomic value
// (and as an object key, mirroring prepareJsonWithTemplates) and reports the FIRST genuine
// syntax error with a precise range. Comments (// and block) are tolerated, matching the
// editor's allowComments config; empty input is fine (no body).
export function diagnoseJsonWithTemplates(text: string): JsonDiagnostic[] {
  const n = text.length;
  let i = 0;
  interface ParseFailure { message: string; start: number; end: number }
  const PARSE_FAILED = Symbol("parse-failed");

  const fail = (message: string, start: number, end: number = start + 1): never => {
    // Guarantee a visible, in-bounds range (EOF offsets collapse onto the last char).
    let s = start;
    let e = end;
    if (s >= n) { s = Math.max(0, n - 1); e = n; }
    e = Math.max(s + 1, Math.min(e, n));
    throw { tag: PARSE_FAILED, message, start: s, end: e };
  };

  const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

  const skipTrivia = () => {
    for (;;) {
      while (i < n && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++;
      if (text[i] === "/" && text[i + 1] === "/") {
        while (i < n && text[i] !== "\n") i++;
        continue;
      }
      if (text[i] === "/" && text[i + 1] === "*") {
        const close = text.indexOf("*/", i + 2);
        if (close === -1) fail("Unterminated block comment", i, Math.min(i + 2, n));
        i = close + 2;
        continue;
      }
      return;
    }
  };

  // Consumes a {{...}} variable if one starts here; only when a closing }} exists, so a
  // stray "{{" still falls through to object parsing and errors naturally.
  const tryTemplate = (): boolean => {
    if (text[i] === "{" && text[i + 1] === "{") {
      const close = text.indexOf("}}", i + 2);
      if (close !== -1) {
        i = close + 2;
        return true;
      }
    }
    return false;
  };
  const parseString = () => {
    const start = i;
    i++; // opening quote
    while (i < n) {
      const c = text[i];
      if (c === "\\") {
        const esc = text[i + 1];
        if (esc === undefined || !"\"\\/bfnrtu".includes(esc)) fail(`Invalid escape sequence "\\${esc ?? ""}" in string`, i, Math.min(i + 2, n));
        if (esc === "u" && !/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail("Invalid \\u escape in string", i, Math.min(i + 6, n));
        i += esc === "u" ? 6 : 2;
        continue;
      }
      if (c === '"') { i++; return; }
      if (c < " ") fail("Unterminated string", start, i);
      i++;
    }
    fail("Unterminated string", start, n);
  };

  const parseNumber = () => {
    const start = i;
    if (text[i] === "-") i++;
    if (text[i] === "0") i++;
    else if (isDigit(text[i])) { while (isDigit(text[i])) i++; }
    else fail("Invalid number", start, i + 1);
    if (text[i] === ".") {
      i++;
      if (!isDigit(text[i])) fail("Invalid number", start, i + 1);
      while (isDigit(text[i])) i++;
    }
    if (text[i] === "e" || text[i] === "E") {
      i++;
      if (text[i] === "+" || text[i] === "-") i++;
      if (!isDigit(text[i])) fail("Invalid number", start, i + 1);
      while (isDigit(text[i])) i++;
    }
  };

  const parseObject = () => {
    i++; // {
    skipTrivia();
    if (text[i] === "}") { i++; return; }
    for (;;) {
      skipTrivia();
      if (i >= n) fail("Unterminated object: expected a property or '}'", n);
      if (text[i] === '"') parseString();
      else if (!tryTemplate()) {
        if (text[i] === "}") fail("Trailing comma is not allowed in JSON", i);
        fail("Property name must be a string in double quotes", i);
      }
      skipTrivia();
      if (text[i] !== ":") fail("Expected ':' after property name", i);
      i++;
      parseValue();
      skipTrivia();
      if (text[i] === ",") { i++; continue; }
      if (text[i] === "}") { i++; return; }
      if (i >= n) fail("Unterminated object: expected '}'", n);
      fail("Expected ',' or '}' between properties", i);
    }
  };
  const parseArray = () => {
    i++; // [
    skipTrivia();
    if (text[i] === "]") { i++; return; }
    for (;;) {
      parseValue();
      skipTrivia();
      if (text[i] === ",") {
        i++;
        skipTrivia();
        if (text[i] === "]") fail("Trailing comma is not allowed in JSON", i);
        continue;
      }
      if (text[i] === "]") { i++; return; }
      if (i >= n) fail("Unterminated array: expected ']'", n);
      fail("Expected ',' or ']' between items", i);
    }
  };

  function parseValue(): void {
    skipTrivia();
    if (i >= n) fail("Expected a value", n);
    const c = text[i];
    if (c === '"') { parseString(); return; }
    if (c === "{") {
      if (tryTemplate()) return;
      parseObject();
      return;
    }
    if (c === "[") { parseArray(); return; }
    if (c === "-" || isDigit(c)) { parseNumber(); return; }
    if (text.startsWith("true", i)) { i += 4; return; }
    if (text.startsWith("false", i)) { i += 5; return; }
    if (text.startsWith("null", i)) { i += 4; return; }
    const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i, i + 64));
    if (word) fail(`Unexpected token "${word[0]}" (valid values: strings, numbers, true, false, null, arrays, objects, {{variables}})`, i, i + word[0].length);
    fail(`Unexpected token "${c}"`, i);
  }

  let found: ParseFailure | null = null;
  try {
    skipTrivia();
    if (i >= n) return []; // empty body is fine
    parseValue();
    skipTrivia();
    if (i < n) fail("Unexpected content after the JSON value", i);
  } catch (error) {
    if (typeof error !== "object" || error === null || (error as { tag?: unknown }).tag !== PARSE_FAILED) throw error;
    found = error as ParseFailure;
  }

  if (!found) return [];
  const toPos = (offset: number) => {
    let line = 1;
    let lineStart = 0;
    for (let k = 0; k < offset; k++) {
      if (text.charCodeAt(k) === 10) { line++; lineStart = k + 1; }
    }
    return { line, column: offset - lineStart + 1 };
  };
  const start = toPos(found.start);
  const end = toPos(found.end);
  return [{
    message: found.message,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  }];
}
