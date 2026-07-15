import type { Request } from "./api";

export function requestVariableNames(request: Request): string[] {
  const names = new Set<string>();
  for (const match of JSON.stringify(request).matchAll(/\{\{([^{}]+)\}\}/g)) names.add(match[1].trim());
  return [...names].filter(Boolean);
}

export function resolveRequestTarget(request: Request, vars: Record<string, string>, secrets: Record<string, string>, revealSecrets: boolean): string {
  const raw = request.http?.url ?? request.grpc?.endpoint ?? request.ws?.url ?? "";
  return raw.replace(/\{\{([^{}]+)\}\}/g, (token, key: string) => {
    const name = key.trim();
    if (name in secrets) return revealSecrets ? secrets[name] : "••••••••";
    return name in vars ? vars[name] : token;
  });
}
