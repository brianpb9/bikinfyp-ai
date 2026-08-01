import test from "node:test";
import assert from "node:assert/strict";
import { QueueConfigurationError, assertQueueConfiguration } from "../lib/job-queue";

test("queue production fail-closed tanpa Redis dan inline worker", () => {
  assert.throws(() => assertQueueConfiguration({ NODE_ENV: "production", RACUN_QUEUE_MODE: "inline" }), QueueConfigurationError);
  assert.throws(() => assertQueueConfiguration({ NODE_ENV: "production", RACUN_QUEUE_MODE: "redis" }), QueueConfigurationError);
  assert.doesNotThrow(() => assertQueueConfiguration({ NODE_ENV: "production", RACUN_QUEUE_MODE: "redis", REDIS_URL: "redis://redis.internal:6379" }));
});
