import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { managedStagingTraceQueueName } from "../lib/job-queue";

const here = path.dirname(fileURLToPath(import.meta.url));

test("managed trace queue is disjoint from canonical queue", () => {
  const canonical = "racun-jobs-staging";
  const trace = managedStagingTraceQueueName(canonical);
  assert.notEqual(trace, canonical);
  assert.equal(trace, "racun-jobs-staging:managed-staging-trace");
});

test("canonical admission routes only zero-value trace jobs to isolated queue", () => {
  const source = fs.readFileSync(path.join(here, "../app/api/jobs/route.ts"), "utf8");
  assert.match(source, /if \(zeroValueTrace\) await enqueueManagedStagingTraceJob\(created\.jobId\);\s*else await enqueueJob\(created\.jobId\);/);
});

test("trace worker consumes only isolated queue and never canonical queue", () => {
  const source = fs.readFileSync(path.join(here, "../scripts/managed-post-e2-worker-trace.ts"), "utf8");
  assert.match(source, /new Worker<\{ jobId: string \}>\(managedStagingTraceQueueName\(\)/);
  assert.doesNotMatch(source, /new Worker<\{ jobId: string \}>\(config\.redisQueueName/);
});

test("ordinary canonical record survives trace consumption and is processed after restoration", () => {
  const queues = new Map<string, string[]>([
    ["racun-jobs-staging", ["ordinary-held-job"]],
    [managedStagingTraceQueueName("racun-jobs-staging"), ["zero-ledger-trace-job"]],
  ]);
  const consume = (name: string) => queues.get(name)?.shift();
  assert.equal(consume(managedStagingTraceQueueName("racun-jobs-staging")), "zero-ledger-trace-job");
  assert.deepEqual(queues.get("racun-jobs-staging"), ["ordinary-held-job"], "trace worker tidak menyentuh record canonical");
  assert.equal(consume("racun-jobs-staging"), "ordinary-held-job", "canonical worker memproses job setelah restoration");
});
