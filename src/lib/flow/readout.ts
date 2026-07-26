import { formatDuration } from "../format.ts";
import type { StepResult } from "./types";

// Reason phrases for the codes an API client actually meets; anything else shows as the bare number.
const HTTP_REASON: Record<number, string> = {
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
  301: "Moved Permanently", 302: "Found", 304: "Not Modified",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
  405: "Method Not Allowed", 408: "Request Timeout", 409: "Conflict", 410: "Gone",
  415: "Unsupported Media Type", 422: "Unprocessable Entity", 429: "Too Many Requests",
  500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway",
  503: "Service Unavailable", 504: "Gateway Timeout",
};

/**
 * One-line result readout for a block face — "200 OK · 145 ms", "NOT_FOUND · 18 ms",
 * "done · 3 ms" (transform). Null when there is nothing informative to show (no result yet,
 * still running, or a failure without a response) — callers fall back to the status word.
 */
export function stepReadout(result: StepResult | undefined): string | null {
  if (!result || (result.status !== "success" && result.status !== "failed")) return null;
  const response = result.response;
  let label = "";
  if (response && "status" in response && typeof response.status === "number") {
    const reason = HTTP_REASON[response.status];
    label = reason ? `${response.status} ${reason}` : String(response.status);
  } else if (response && "statusCode" in response && typeof response.statusCode === "string") {
    label = response.statusCode;
  } else if (result.status === "success" && result.timeMs != null) {
    label = "done";
  }
  if (!label) return null;
  const time = formatDuration(result.timeMs, true, "");
  return time ? `${label} · ${time}` : label;
}
