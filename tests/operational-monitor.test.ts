import assert from "node:assert/strict";
import test from "node:test";

process.env.RACUN_NO_DOTENV = "1";
process.env.TIMEOUT_QUEUED_MIN = "30";
process.env.OPERATIONAL_ERROR_MIN_JOBS = "3";
process.env.OPERATIONAL_ERROR_RATE_PERCENT = "20";
const { runOperationalMonitor } = await import("../lib/operational-monitor");

test("monitor mengirim satu alert stuck dan mencatat cooldown setelah pengiriman", async () => {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const db = { query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes("FROM jobs") && sql.includes("ANY")) return { rows: [{ id: "abcdefgh-1234", state: "QUEUED", state_changed_at: "2026-01-01T00:00:00.000Z" }] };
    if (sql.includes("GROUP BY state")) return { rows: [{ state: "READY", count: 1 }] };
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("SELECT id FROM audit_log")) return { rows: [] };
    return { rows: [] };
  }};
  const sent: string[] = [];
  const result = await runOperationalMonitor({ db, now: new Date("2026-01-01T00:30:00.000Z"), send: async (alert) => { sent.push(alert.fingerprint); } });
  assert.deepEqual(result, { checked: 1, sent: 1, suppressed: 0 });
  assert.deepEqual(sent, ["stuck-jobs"]);
  assert.ok(calls.some((call) => call.sql.startsWith("INSERT INTO audit_log")));
});

test("monitor tidak mengirim ulang alert yang masih dalam cooldown", async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes("FROM jobs") && sql.includes("ANY")) return { rows: [{ id: "abcdefgh-1234", state: "QUEUED", state_changed_at: "2026-01-01T00:00:00.000Z" }] };
    if (sql.includes("GROUP BY state")) return { rows: [] };
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("SELECT id FROM audit_log")) return { rows: [{ id: "already-sent" }] };
    return { rows: [] };
  }};
  const result = await runOperationalMonitor({ db, now: new Date("2026-01-01T00:30:00.000Z"), send: async () => assert.fail("email tidak boleh terkirim") });
  assert.deepEqual(result, { checked: 1, sent: 0, suppressed: 1 });
});

test("error rate menghitung REFUNDED sekali dan memenuhi ambang sampel", async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes("FROM jobs") && sql.includes("ANY")) return { rows: [] };
    if (sql.includes("GROUP BY state")) return { rows: [{ state: "READY", count: 3 }, { state: "REFUNDED", count: 2 }, { state: "FAILED", count: 9 }] };
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("SELECT id FROM audit_log")) return { rows: [] };
    return { rows: [] };
  }};
  const subjects: string[] = [];
  const result = await runOperationalMonitor({ db, now: new Date("2026-01-01T00:30:00.000Z"), send: async (alert) => { subjects.push(alert.subject); } });
  assert.deepEqual(result, { checked: 1, sent: 1, suppressed: 0 });
  assert.match(subjects[0], /40%/);
});
