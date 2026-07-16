import type { Request, GrpcPart, KV } from "./api";

export const isGrpcurl = (text: string) => /^\s*grpcurl\b/i.test(text);

// flags that consume the following token as their value (everything else is
// treated as a boolean switch — good enough for the common grpcurl surface)
const VALUE_FLAGS = new Set([
  "-d", "-H", "-rpc-header", "-reflect-header", "-proto", "-import-path",
  "-protoset", "-authority", "-servername", "-cacert", "-cert", "-key",
  "-max-msg-sz", "-max-time", "-connect-timeout", "-keepalive-time",
  "-format", "-unix-socket",
]);

/** shell-ish tokenizer: honours '…' / "…" quoting and \-line-continuations */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false; // saw an (even empty) quoted token
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < input.length) cur += input[++i];
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (ch === "\\") {
      const nxt = input[i + 1];
      if (nxt === "\n") { i++; continue; }
      if (nxt !== undefined) { cur += nxt; i++; has = true; }
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur || has) { tokens.push(cur); cur = ""; has = false; }
      continue;
    }
    cur += ch;
    has = true;
  }
  if (cur || has) tokens.push(cur);
  return tokens;
}

const kv = (raw: string): KV => {
  const i = raw.indexOf(":");
  return i === -1
    ? { key: raw.trim(), value: "", enabled: true }
    : { key: raw.slice(0, i).trim(), value: raw.slice(i + 1).trim(), enabled: true };
};

/** Parse a `grpcurl …` command into a gRPC Request, or null if it isn't one. */
export function parseGrpcurl(text: string): Request | null {
  if (!isGrpcurl(text)) return null;
  const tokens = tokenize(text);
  if (tokens[0]?.toLowerCase() === "grpcurl") tokens.shift();

  let plaintext = false, insecure = false, message = "";
  const protoFiles: string[] = [];
  const metadata: KV[] = [];
  const positionals: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("-")) {
      const eq = t.indexOf("=");
      const flag = eq === -1 ? t : t.slice(0, eq);
      let val = eq === -1 ? undefined : t.slice(eq + 1);
      if (val === undefined && VALUE_FLAGS.has(flag)) val = tokens[++i];
      if (flag === "-plaintext") plaintext = true;
      else if (flag === "-insecure") insecure = true;
      else if (flag === "-d") { if (val && !val.startsWith("@")) message = val; }
      else if (flag === "-H" || flag === "-rpc-header" || flag === "-reflect-header") { if (val) metadata.push(kv(val)); }
      else if (flag === "-proto") { if (val) protoFiles.push(val); }
      // other value-flags already consumed their arg above; booleans are ignored
    } else {
      positionals.push(t);
    }
  }

  // address then symbol; if only one, disambiguate by the "/" in a symbol
  let address = "", symbol = "";
  if (positionals.length >= 2) { address = positionals[0]; symbol = positionals[1]; }
  else if (positionals.length === 1) {
    if (positionals[0].includes("/")) symbol = positionals[0];
    else address = positionals[0];
  }

  let service = "", method = "";
  if (symbol) {
    const slash = symbol.lastIndexOf("/");
    if (slash !== -1) { service = symbol.slice(0, slash); method = symbol.slice(slash + 1); }
    else { const dot = symbol.lastIndexOf("."); service = dot === -1 ? symbol : symbol.slice(0, dot); method = dot === -1 ? "" : symbol.slice(dot + 1); }
  }

  const grpc: GrpcPart = {
    // plaintext → bare host (buildGrpcurl re-adds -plaintext); TLS → https:// scheme
    endpoint: address ? (plaintext ? address : `https://${address}`) : "",
    protoSource: protoFiles.length ? "files" : "reflection",
    protoFiles,
    service,
    method,
    message: message || "{}",
    metadata,
    insecure: insecure && !plaintext,
  };

  const name = method ? `${service.split(".").pop() || service}/${method}` : "gRPC request";
  return { name, protocol: "grpc", grpc };
}
