import type { Request } from "./api";

export const requestTargetConfigured = (request: Request): boolean => {
  if (request.protocol === "grpc") {
    return !!request.grpc
      && request.grpc.endpoint.trim().length > 0
      && request.grpc.service.trim().length > 0
      && request.grpc.method.trim().length > 0;
  }
  if (request.protocol === "ws") return !!request.ws?.url.trim();
  return !!request.http?.url.trim();
};

export const requestReadiness = (request: Request, unresolvedCount: number) => {
  if (!requestTargetConfigured(request)) {
    return { ready: false, label: "Not configured", tone: "idle" as const };
  }
  if (unresolvedCount > 0) {
    return {
      ready: false,
      label: `${unresolvedCount} unresolved`,
      tone: "error" as const,
    };
  }
  return { ready: true, label: "Ready", tone: "ready" as const };
};
