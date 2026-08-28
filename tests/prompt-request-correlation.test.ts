import test from "node:test";
import assert from "node:assert/strict";
import {
  freezeProviderRequestCorrelation,
  type CorrelationQueryable,
} from "../lib/postgres/prompt-request-correlation";

const HASHES = ["a".repeat(64), "b".repeat(64)];
const spec = JSON.stringify({ shots: [
  { idx: 0, prompt: "satu", providerPayloadSha256: HASHES[0] },
  { idx: 1, prompt: "dua", providerPayloadSha256: HASHES[1] },
] });

function database(options: {
  missingArchive?: boolean;
  incomplete?: boolean;
  updateError?: boolean;
  archiveAfterRequest?: boolean;
  requestAfterCompletion?: boolean;
  providerMismatch?: boolean;
  mixedPayload?: boolean;
  archiveHashes?: string[];
  requestHashes?: string[];
} = {}) {
  const calls: string[] = [];
  const db: CorrelationQueryable = {
    async query<Row = Record<string, unknown>>(sql: string) {
      calls.push(sql);
      let result: { rows: unknown[]; rowCount: number };
      if (sql.startsWith("SELECT spec_json")) {
        result = options.missingArchive
          ? { rows: [], rowCount: 0 }
          : { rows: [{ spec_json: options.archiveHashes ? JSON.stringify({ shots: [
            { idx: 0, prompt: "satu", providerPayloadSha256: options.archiveHashes[0] },
            { idx: 1, prompt: "dua", providerPayloadSha256: options.archiveHashes[1] },
          ] }) : spec, created_at: options.archiveAfterRequest
            ? "2026-08-28T05:01:30.000Z" : "2026-08-28T05:00:00.000Z" }], rowCount: 1 };
      } else if (sql.startsWith("SELECT provider_video")) {
        result = { rows: [{ provider_video: "byteplus-ark-seedance", completed_at: "2026-08-28T05:02:00.000Z" }], rowCount: 1 };
      } else if (sql.startsWith("SELECT job_id,shot_index")) {
        const rows = [0, 1].map((shot_index) => ({
          job_id: "job-1", shot_index, provider: options.providerMismatch ? "provider-lain" : "byteplus",
          payload_sha256: options.requestHashes?.[shot_index]
            ?? (options.mixedPayload && shot_index === 1 ? "c".repeat(64) : HASHES[shot_index]),
          task_id: `request-${shot_index}`, created_at: options.requestAfterCompletion
            ? "2026-08-28T05:03:00.000Z" : "2026-08-28T05:01:00.000Z",
        }));
        if (options.incomplete) rows.pop();
        result = { rows, rowCount: rows.length };
      } else if (sql.includes("UPDATE job_prompts")) {
        if (options.updateError) throw new Error("INJECTED_ARCHIVE_WRITE_FAILURE");
        result = { rows: [{ job_id: "job-1" }], rowCount: 1 };
      } else {
        throw new Error(`unexpected query: ${sql}`);
      }
      return result as { rows: Row[]; rowCount: number };
    },
  };
  return { db, calls };
}

test("complete request coverage is frozen with a nonzero archive update", async () => {
  const { db, calls } = database();
  assert.equal(await freezeProviderRequestCorrelation(db, "job-1"), true);
  assert.equal(calls.some((sql) => sql.includes("RETURNING job_id")), true);
});

test("missing archive row returns false and never attempts destructive cleanup", async () => {
  const { db, calls } = database({ missingArchive: true });
  assert.equal(await freezeProviderRequestCorrelation(db, "job-1"), false);
  assert.equal(calls.some((sql) => sql.includes("UPDATE job_prompts")), false);
  assert.equal(calls.some((sql) => /DELETE/i.test(sql)), false);
});

test("incomplete request coverage returns false and preserves database evidence", async () => {
  const { db, calls } = database({ incomplete: true });
  assert.equal(await freezeProviderRequestCorrelation(db, "job-1"), false);
  assert.equal(calls.some((sql) => sql.includes("UPDATE job_prompts")), false);
  assert.equal(calls.some((sql) => /DELETE/i.test(sql)), false);
});

test("archive database error propagates so worker retains provider_tasks", async () => {
  const { db, calls } = database({ updateError: true });
  await assert.rejects(() => freezeProviderRequestCorrelation(db, "job-1"), /INJECTED_ARCHIVE_WRITE_FAILURE/);
  assert.equal(calls.some((sql) => /DELETE/i.test(sql)), false);
});

test("retry archive inserted after reused request cannot authorize cleanup", async () => {
  const { db, calls } = database({ archiveAfterRequest: true });
  assert.equal(await freezeProviderRequestCorrelation(db, "job-1"), false);
  assert.equal(calls.some((sql) => sql.includes("UPDATE job_prompts")), false);
  assert.equal(calls.some((sql) => /DELETE/i.test(sql)), false);
});

test("post-completion request and failover-provider mismatch cannot authorize cleanup", async () => {
  assert.equal(await freezeProviderRequestCorrelation(database({ requestAfterCompletion: true }).db, "job-1"), false);
  assert.equal(await freezeProviderRequestCorrelation(database({ providerMismatch: true }).db, "job-1"), false);
});

test("one retained request plus one regenerated request bound to another archive cannot authorize cleanup", async () => {
  const { db, calls } = database({ mixedPayload: true });
  assert.equal(await freezeProviderRequestCorrelation(db, "job-1"), false);
  assert.equal(calls.some((sql) => sql.includes("UPDATE job_prompts")), false);
  assert.equal(calls.some((sql) => /DELETE/i.test(sql)), false);
});

test("finalized generated-reference digest replaces pre-transform digest before a successful freeze", async () => {
  const preTransform = ["a".repeat(64), "b".repeat(64)];
  const providerBound = ["c".repeat(64), "d".repeat(64)];
  assert.equal(await freezeProviderRequestCorrelation(database({
    archiveHashes: preTransform, requestHashes: providerBound,
  }).db, "job-1"), false);
  assert.equal(await freezeProviderRequestCorrelation(database({
    archiveHashes: providerBound, requestHashes: providerBound,
  }).db, "job-1"), true);
});
