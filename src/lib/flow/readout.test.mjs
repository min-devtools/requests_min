import assert from "node:assert/strict";
import test from "node:test";

import { stepReadout } from "./readout.ts";

const httpResponse = (status, timeMs) => ({ status, headers: [], body: "{}", timeMs, sizeBytes: 2 });
const grpcResponse = (statusCode, timeMs) => ({ statusCode, headers: [], trailers: [], bodyJson: "{}", timeMs });

test("stepReadout renders HTTP code + reason + latency like the run report", () => {
  assert.equal(stepReadout({ status: "success", timeMs: 145, response: httpResponse(200, 145) }), "200 OK · 145 ms");
  assert.equal(stepReadout({ status: "success", timeMs: 90, response: httpResponse(201, 90) }), "201 Created · 90 ms");
  assert.equal(stepReadout({ status: "failed", timeMs: 89, response: httpResponse(500, 89) }), "500 Internal Server Error · 89 ms");
  // unknown code still shows the number
  assert.equal(stepReadout({ status: "failed", timeMs: 10, response: httpResponse(599, 10) }), "599 · 10 ms");
});

test("stepReadout shows gRPC status codes verbatim", () => {
  assert.equal(stepReadout({ status: "success", timeMs: 210, response: grpcResponse("OK", 210) }), "OK · 210 ms");
  assert.equal(stepReadout({ status: "failed", timeMs: 18, response: grpcResponse("NOT_FOUND", 18) }), "NOT_FOUND · 18 ms");
});

test("stepReadout marks responseless successes as done and yields null otherwise", () => {
  // transform steps carry timing but no response
  assert.equal(stepReadout({ status: "success", timeMs: 3 }), "done · 3 ms");
  // network failure: no response to describe — callers fall back to the plain status word
  assert.equal(stepReadout({ status: "failed", error: "connection refused" }), null);
  assert.equal(stepReadout(undefined), null);
  assert.equal(stepReadout({ status: "running" }), null);
});
