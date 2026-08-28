import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runStagingR2Preflight } from "../scripts/preflight-staging-r2.mjs";

type NamedCommand = { constructor: { name: string } };

const env = {
  NODE_ENV: "test",
  RACUN_DEPLOY_ENV: "staging",
  STORAGE_MODE: "r2",
  R2_REGION: "auto",
  R2_ENDPOINT: "https://fixture.invalid",
  R2_BUCKET: "fixture-bucket",
  R2_ACCESS_KEY_ID: "fixture-access",
  R2_SECRET_ACCESS_KEY: "fixture-secret",
} satisfies NodeJS.ProcessEnv;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

test("production or unknown bucket context fails before any R2 request", async () => {
  const calls: string[] = [];
  const result = await runStagingR2Preflight({
    env,
    send: async (command: NamedCommand) => calls.push(command.constructor.name),
  });
  assert.equal(result.staging_context_verified, false);
  assert.deepEqual(calls, []);
});

test("hash failure still deletes and confirms absence from finally without exposing identifiers", async () => {
  const stagingEnv = {
    ...env,
    R2_ENDPOINT: process.env.TEST_STAGING_R2_ENDPOINT ?? "https://fixture.invalid",
    R2_BUCKET: process.env.TEST_STAGING_R2_BUCKET ?? "fixture-bucket",
  };
  const calls: string[] = [];
  const send = async (command: NamedCommand) => {
    calls.push(command.constructor.name);
    if (command.constructor.name === "GetObjectCommand") {
      return { Body: { transformToByteArray: async () => new Uint8Array([9, 9, 9]) } };
    }
    if (command.constructor.name === "HeadObjectCommand") {
      throw Object.assign(new Error("missing"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    }
    return {};
  };
  const result = await runStagingR2Preflight({
    env: stagingEnv,
    send,
    makeBytes: () => Buffer.from([1, 2, 3]),
    makeUuid: () => "00000000-0000-4000-8000-000000000000",
    expectedBucketSha256: digest(stagingEnv.R2_BUCKET),
    expectedEndpointSha256: digest(new URL(stagingEnv.R2_ENDPOINT).origin),
  });
  assert.equal(result.staging_context_verified, true);
  assert.equal(result.get_hash_verified, false);
  assert.equal(result.cleanup_delete_verified, true);
  assert.equal(result.cleanup_absent_verified, true);
  assert.deepEqual(calls, ["PutObjectCommand", "GetObjectCommand", "DeleteObjectCommand", "HeadObjectCommand"]);
  const serialized = JSON.stringify(result);
  for (const slot of ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const) {
    assert.equal(serialized.includes(stagingEnv[slot]), false);
  }
  assert.ok(Object.values(result).every((value) => typeof value === "boolean"));
});

test("successful round trip verifies readback, deletion, absence, and final cleanup", async () => {
  const calls: string[] = [];
  const payload = Buffer.from([4, 5, 6]);
  const send = async (command: NamedCommand) => {
    calls.push(command.constructor.name);
    if (command.constructor.name === "GetObjectCommand") {
      return { Body: { transformToByteArray: async () => payload } };
    }
    if (command.constructor.name === "HeadObjectCommand") {
      throw Object.assign(new Error("missing"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    }
    return {};
  };
  const result = await runStagingR2Preflight({
    env,
    send,
    makeBytes: () => payload,
    makeUuid: () => "00000000-0000-4000-8000-000000000000",
    expectedBucketSha256: digest(env.R2_BUCKET),
    expectedEndpointSha256: digest(new URL(env.R2_ENDPOINT).origin),
  });
  assert.deepEqual(result, {
    staging_context_verified: true,
    put_verified: true,
    get_hash_verified: true,
    delete_verified: true,
    absent_verified: true,
    cleanup_delete_verified: true,
    cleanup_absent_verified: true,
    secret_values_exposed: false,
    identifier_values_exposed: false,
    production_access_attempted: false,
  });
  assert.deepEqual(calls, [
    "PutObjectCommand",
    "GetObjectCommand",
    "DeleteObjectCommand",
    "HeadObjectCommand",
    "DeleteObjectCommand",
    "HeadObjectCommand",
  ]);
});
