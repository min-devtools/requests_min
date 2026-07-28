import assert from "node:assert/strict";
import test from "node:test";

import { requestReadiness, requestTargetConfigured } from "./requestReadiness.ts";

const http = (url) => ({
  protocol: "http",
  http: { method: "GET", url, params: [], pathParams: [], headers: [], auth: {}, body: { type: "none", content: "" } },
});

const grpc = (endpoint, service, method) => ({
  protocol: "grpc",
  grpc: { endpoint, service, method },
});

test("request target validation rejects blank HTTP and incomplete gRPC targets", () => {
  assert.equal(requestTargetConfigured(http("   ")), false);
  assert.equal(requestTargetConfigured(http("https://api.example.com/users")), true);
  assert.equal(requestTargetConfigured(grpc("localhost:50051", "users.UserService", "")), false);
  assert.equal(requestTargetConfigured(grpc("localhost:50051", "users.UserService", "GetUser")), true);
});

test("request readiness prioritizes missing targets before unresolved variables", () => {
  assert.deepEqual(requestReadiness(http(""), 2), { ready: false, label: "Not configured", tone: "idle" });
  assert.deepEqual(requestReadiness(http("{{baseUrl}}/users"), 1), { ready: false, label: "1 unresolved", tone: "error" });
  assert.deepEqual(requestReadiness(http("https://api.example.com/users"), 0), { ready: true, label: "Ready", tone: "ready" });
});
