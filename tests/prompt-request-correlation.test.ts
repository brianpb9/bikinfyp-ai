import test from "node:test";
import assert from "node:assert/strict";
import {
  freezeProviderRequestCorrelation,
  type CorrelationQueryable,
} from "../lib/postgres/prompt-request-correlation";

const spec = JSON.stringify({ shots: [{ idx: 0, prompt: "satu" }, { idx: 1, prompt: "dua" }] });

function database(options: { missingArchive?: boolean; incomplete?: boolean; updateError?: boolean } = {}) {
  const calls: string[] = [];
  const db: CorrelationQueryable = {
    async query<Row = Record<string, unknown>>(sql: string) {
      calls.push(sql);
      let result: { rows: unknown[]; rowCount: number };
      if (sql.startsWith("SELECT spec_json")) {
        result = options.missingArchive
          ? { rows: [], rowCount: 0 }
          : { rows: [{ spec_json: spec }], rowCount: 1 };
      } else if (sql.startsWith("SELECT job_id,shot_index")) {
        const rows = [0, 1].map((shot_index) => ({
          job_id: "job-1", shot_index, provider: "byteplus",
          task_id: `request-${shot_index}`, created_at: "2026-08-28T05:01:00.000Z",
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
