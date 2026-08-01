// Unit test batas waktu per-state: QUEUED 30 mnt, state render allowance panjang.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-timeouts-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-timeouts-storage-${process.pid}`;
process.env.RACUN_WORKER_DISABLED = "1";

const { getDb, now, uuid } = await import("../lib/db");
const { findOrCreateUserByPhone } = await import("../lib/auth");
const { sweepStaleJobs, getJob } = await import("../lib/jobs");
const { config } = await import("../lib/config");

const db = getDb();
const user = findOrCreateUserByPhone("086666000111");

// FK aktif — butuh produk & skrip induk dummy
const productId = uuid();
const scriptId = uuid();
db.prepare(
  "INSERT INTO products (id, user_id, source_url, name, price_idr, category, images, raw_meta, created_at) VALUES (?,?,NULL,'P',1000,'default','[]',NULL,?)"
).run(productId, user.id, now());
db.prepare(
  `INSERT INTO scripts (id, job_id, product_id, hook_family, emotion, register, segments, caption, hashtags, validation_result, approved_by_user_at, edited_by_user, created_at)
   VALUES (?,NULL,?,'H1','senang','netral','[]','','[]','{}',?,0,?)`
).run(scriptId, productId, now(), now());

function insertJob(state: string, minutesAgo: number): string {
  const id = uuid();
  const ts = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  db.prepare(
    `INSERT INTO jobs (id, user_id, product_id, persona_id, script_id, format, duration_s, state, created_at, state_changed_at)
     VALUES (?,?,?,NULL,?,'hands_only',15,?,?,?)`
  ).run(id, user.id, productId, scriptId, state, ts, ts);
  return id;
}

test("konfigurasi batas per-state ada dan masuk akal", () => {
  assert.equal(config.stateTimeoutsMin.QUEUED, 30);
  assert.ok(config.stateTimeoutsMin.GENERATING_VISUAL >= 60, "render nyata butuh allowance panjang");
});

test("QUEUED 40 mnt -> FAILED+REFUNDED; GENERATING_VISUAL 40 mnt -> tetap jalan", () => {
  const queued = insertJob("QUEUED", 40);
  const rendering = insertJob("GENERATING_VISUAL", 40);
  const swept = sweepStaleJobs();
  assert.ok(swept >= 1);
  assert.equal(getJob(queued)!.state, "REFUNDED");
  assert.equal(getJob(rendering)!.state, "GENERATING_VISUAL");
});

test("GENERATING_VISUAL > batas (default 90 mnt) -> FAILED+REFUNDED", () => {
  const tooLong = insertJob("GENERATING_VISUAL", config.stateTimeoutsMin.GENERATING_VISUAL + 10);
  sweepStaleJobs();
  assert.equal(getJob(tooLong)!.state, "REFUNDED");
});

test("job READY/FAILED tidak disapu", () => {
  const ready = insertJob("READY", 5000);
  sweepStaleJobs();
  assert.equal(getJob(ready)!.state, "READY");
});
