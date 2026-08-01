import assert from "node:assert/strict";
import test from "node:test";
import { redactWorkerError } from "../lib/worker-log";

test("worker failure log redacts datastore URLs and bearer tokens", () => {
  const output = redactWorkerError("postgresql://user:secret@db/app redis://:secret@kv:6379 Authorization: Bearer token-value");
  assert.ok(!output.includes("secret"));
  assert.ok(!output.includes("token-value"));
  assert.match(output, /postgresql:\/\/<redacted>/);
  assert.match(output, /redis:\/\/<redacted>/);
});
