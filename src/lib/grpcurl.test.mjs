import assert from "node:assert/strict";
import test from "node:test";
import { parseGrpcurl, isGrpcurl } from "./grpcurl.ts";

test("plaintext reflection call → bare host endpoint + service/method", () => {
  const r = parseGrpcurl(`grpcurl -plaintext -d '{"id":1}' localhost:50051 pkg.v1.UserService/GetUser`);
  assert.equal(r.protocol, "grpc");
  assert.equal(r.grpc.endpoint, "localhost:50051");
  assert.equal(r.grpc.insecure, false);
  assert.equal(r.grpc.service, "pkg.v1.UserService");
  assert.equal(r.grpc.method, "GetUser");
  assert.equal(r.grpc.message, '{"id":1}');
  assert.equal(r.grpc.protoSource, "reflection");
  assert.equal(r.name, "UserService/GetUser");
});

test("TLS with -insecure → https endpoint + insecure flag, -H → metadata", () => {
  const r = parseGrpcurl(`grpcurl -insecure -H 'authorization: Bearer x' api.example.com:443 pkg.Svc/M`);
  assert.equal(r.grpc.endpoint, "https://api.example.com:443");
  assert.equal(r.grpc.insecure, true);
  assert.deepEqual(r.grpc.metadata, [{ key: "authorization", value: "Bearer x", enabled: true }]);
});

test("proto files switch source to files, line continuations tolerated", () => {
  const r = parseGrpcurl("grpcurl \\\n  -proto ./a.proto -proto ./b.proto \\\n  host:1 S/M");
  assert.deepEqual(r.grpc.protoFiles, ["./a.proto", "./b.proto"]);
  assert.equal(r.grpc.protoSource, "files");
});

test("-d=@file (stdin) is ignored, defaults message to {}", () => {
  const r = parseGrpcurl("grpcurl -plaintext -d @ host:1 S/M");
  assert.equal(r.grpc.message, "{}");
});

test("value-flags don't leak into positionals", () => {
  const r = parseGrpcurl("grpcurl -plaintext -authority foo.bar -max-time 5 host:1 pkg.S/M");
  assert.equal(r.grpc.endpoint, "host:1");
  assert.equal(r.grpc.service, "pkg.S");
});

test("non-grpcurl text rejected", () => {
  assert.equal(isGrpcurl("curl https://x"), false);
  assert.equal(parseGrpcurl("curl https://x"), null);
});
