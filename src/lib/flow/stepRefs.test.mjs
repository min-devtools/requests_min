import assert from "node:assert/strict";
import test from "node:test";
import { buildStepCtx, resolvePath, substituteRefs, substituteRequest } from "./stepRefs.ts";

const ctx = {
  steps: {
    login: {
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { token: "abc", n: 7 },
        bodyText: "{}",
      },
    },
  },
  vars: { userId: "u1" },
};

const requestNode = (id, key, protocol = "http") => ({
  id,
  key,
  type: "request",
  position: { x: 0, y: 0 },
  config: { request: { name: key, protocol } },
});

test("resolvePath walks dot paths", () => {
  assert.equal(resolvePath(ctx, "steps.login.response.body.token"), "abc");
  assert.equal(resolvePath(ctx, "steps.login.response.headers.content-type"), "application/json");
  assert.equal(resolvePath(ctx, "steps.nope.x"), undefined);
});

test("substituteRefs replaces steps and vars, stringifies non-strings, and keeps env tokens", () => {
  assert.equal(substituteRefs("Bearer {{steps.login.response.body.token}}", ctx), "Bearer abc");
  assert.equal(substituteRefs("n={{ steps.login.response.body.n }}", ctx), "n=7");
  assert.equal(substituteRefs("{{vars.userId}}/{{baseUrl}}", ctx), "u1/{{baseUrl}}");
});

test("substituteRefs serializes supported JSON values and preserves empty strings", () => {
  const values = {
    steps: {},
    vars: {
      empty: "",
      nullValue: null,
      bool: false,
      object: { id: 7 },
      array: ["a", 2],
    },
  };

  assert.equal(substituteRefs("x{{vars.empty}}y", values), "xy");
  assert.equal(substituteRefs("{{vars.nullValue}}", values), "null");
  assert.equal(substituteRefs("{{vars.bool}}", values), "false");
  assert.equal(substituteRefs("{{vars.object}}", values), "{\"id\":7}");
  assert.equal(substituteRefs("{{vars.array}}", values), "[\"a\",2]");
});

test("substituteRefs rejects unsupported values with the exact reference", () => {
  const circular = {};
  circular.self = circular;
  const values = {
    big: 1n,
    callback: () => {},
    marker: Symbol("marker"),
    circular,
  };

  for (const ref of Object.keys(values)) {
    assert.throws(
      () => substituteRefs(`{{vars.${ref}}}`, { steps: {}, vars: values }),
      new RegExp(`Cannot serialize.*vars\\.${ref}`),
    );
  }
});

test("substituteRefs throws a clear error on unknown refs", () => {
  assert.throws(
    () => substituteRefs("{{steps.missing.response.status}}", ctx),
    /steps\.missing\.response\.status/,
  );
});

test("substituteRequest deep-substitutes every string field without mutating input", () => {
  const request = {
    name: "create",
    protocol: "http",
    http: {
      method: "POST",
      url: "{{baseUrl}}/users",
      params: [{ key: "owner", value: "{{vars.userId}}" }],
      insecure: false,
      headers: [{ key: "Authorization", value: "Bearer {{steps.login.response.body.token}}" }],
      auth: { type: "none" },
      body: { type: "json", content: "{\"id\":\"{{vars.userId}}\"}" },
    },
  };

  const out = substituteRequest(request, ctx);

  assert.equal(out.http.headers[0].value, "Bearer abc");
  assert.equal(out.http.params[0].value, "u1");
  assert.equal(out.http.body.content, "{\"id\":\"u1\"}");
  assert.equal(out.http.url, "{{baseUrl}}/users");
  assert.equal(request.http.headers[0].value, "Bearer {{steps.login.response.body.token}}");
  assert.equal(request.http.params[0].value, "{{vars.userId}}");
  assert.notEqual(out, request);
});

test("buildStepCtx exposes successful HTTP request steps and excludes idle steps", () => {
  const resolvedRequest = {
    name: "login",
    protocol: "http",
    http: {
      method: "POST",
      url: "https://example.test/login",
      headers: [],
      params: [],
      auth: { type: "none" },
      body: { type: "none" },
      insecure: false,
    },
  };
  const flow = {
    version: 1,
    id: "f",
    name: "f",
    edges: [],
    nodes: [requestNode("n1", "login"), requestNode("n2", "later")],
  };
  const run = {
    startedAt: 0,
    status: "running",
    steps: {
      n1: {
        status: "success",
        resolvedRequest,
        response: {
          status: 201,
          headers: [
            { key: "X-Req-Id", value: "9" },
            { key: "Set-Cookie", value: "a=1" },
            { key: "set-cookie", value: "b=2" },
          ],
          body: "{\"ok\":true}",
          timeMs: 5,
          sizeBytes: 10,
        },
      },
      n2: { status: "idle" },
    },
  };

  const built = buildStepCtx(flow, run);

  assert.equal(resolvePath(built, "steps.login.response.status"), 201);
  assert.equal(resolvePath(built, "steps.login.response.headers.x-req-id"), "9");
  assert.deepEqual(resolvePath(built, "steps.login.response.headers.set-cookie"), ["a=1", "b=2"]);
  assert.deepEqual(resolvePath(built, "steps.login.response.body"), { ok: true });
  assert.equal(resolvePath(built, "steps.login.response.bodyText"), "{\"ok\":true}");
  assert.equal(resolvePath(built, "steps.login.response.timeMs"), 5);
  assert.equal(resolvePath(built, "steps.login.request"), resolvedRequest);
  assert.equal(resolvePath(built, "steps.later"), undefined);
  assert.deepEqual(built.vars, {});
});

test("buildStepCtx exposes a successful gRPC request step", () => {
  const flow = {
    version: 1,
    id: "f",
    name: "f",
    edges: [],
    nodes: [requestNode("n1", "lookup", "grpc")],
  };
  const run = {
    startedAt: 0,
    status: "success",
    steps: {
      n1: {
        status: "success",
        resolvedRequest: { name: "lookup", protocol: "grpc" },
        response: {
          statusCode: "OK",
          headers: [{ key: "Content-Type", value: "application/grpc" }],
          trailers: [
            { key: "Trace-ID", value: "trace-1" },
            { key: "trace-id", value: "trace-2" },
          ],
          bodyJson: "{\"user\":{\"id\":42}}",
          timeMs: 8,
        },
      },
    },
  };

  const built = buildStepCtx(flow, run);

  assert.equal(resolvePath(built, "steps.lookup.response.status"), "OK");
  assert.equal(resolvePath(built, "steps.lookup.response.headers.content-type"), "application/grpc");
  assert.deepEqual(resolvePath(built, "steps.lookup.response.trailers.trace-id"), ["trace-1", "trace-2"]);
  assert.deepEqual(resolvePath(built, "steps.lookup.response.body"), { user: { id: 42 } });
  assert.equal(resolvePath(built, "steps.lookup.response.bodyText"), "{\"user\":{\"id\":42}}");
  assert.equal(resolvePath(built, "steps.lookup.response.timeMs"), 8);
});

test("buildStepCtx tolerates a successful request step without a response", () => {
  const flow = {
    version: 1,
    id: "f",
    name: "f",
    edges: [],
    nodes: [requestNode("n1", "request-only")],
  };
  const run = {
    startedAt: 0,
    status: "success",
    steps: {
      n1: {
        status: "success",
        resolvedRequest: { name: "request-only", protocol: "http" },
      },
    },
  };

  const built = buildStepCtx(flow, run);

  assert.deepEqual(built.steps["request-only"], {
    request: { name: "request-only", protocol: "http" },
    response: undefined,
  });
});

test("buildStepCtx uses a null-prototype step registry", () => {
  const flow = {
    version: 1,
    id: "f",
    name: "f",
    edges: [],
    nodes: [requestNode("n1", "safe-key")],
  };
  const run = {
    startedAt: 0,
    status: "success",
    steps: { n1: { status: "success" } },
  };

  const built = buildStepCtx(flow, run);

  assert.equal(Object.getPrototypeOf(built.steps), null);
});

test("buildStepCtx clearly rejects unsafe step keys when validation is bypassed", () => {
  for (const key of ["__proto__", "login.v2"]) {
    const flow = {
      version: 1,
      id: "f",
      name: "f",
      edges: [],
      nodes: [requestNode("n1", key)],
    };
    const run = {
      startedAt: 0,
      status: "success",
      steps: { n1: { status: "success" } },
    };

    assert.throws(() => buildStepCtx(flow, run), new RegExp(`Invalid step key.*${key.replace(".", "\\.")}`));
  }
});

test("buildStepCtx reports malformed response shapes with the step key", () => {
  const flow = {
    version: 1,
    id: "f",
    name: "f",
    edges: [],
    nodes: [requestNode("n1", "login")],
  };
  const malformedResponses = [
    42,
    { status: 200, headers: "not-an-array", body: "{}", timeMs: 1 },
    { statusCode: "OK", headers: [], trailers: [], timeMs: 1 },
  ];

  for (const response of malformedResponses) {
    const run = {
      startedAt: 0,
      status: "success",
      steps: { n1: { status: "success", response } },
    };

    assert.throws(() => buildStepCtx(flow, run), /Step "login": Invalid response shape/);
  }
});
