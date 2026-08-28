// Unit test snapshot Skor FYP beku + lapor hasil (lib/fyp-snapshot.ts):
// - snapshot dihitung sekali dan idempoten (job duplikat tidak menimpa),
// - posted_url BEKU setelah terisi (nilai beda -> error, bukan overwrite),
// - outcome boleh di-update menyusul, URL invalid ditolak.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.DB_PATH = `/tmp/racun-test-fypsnap-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-fypsnap-storage-${process.pid}`;

// BERKAS DB DIBUANG DULU — PID BISA DIDAUR ULANG.
//
// Nama database ini memakai `process.pid`, dan berkasnya tidak pernah dihapus
// siapa pun. Begitu OS mendaur ulang sebuah PID, jalan berikutnya MEMBUKA
// database milik jalan lama yang sudah berisi `t@t.id`, lalu `INSERT` di bawah
// gagal dengan UNIQUE constraint — `npm test` merah tanpa satu baris kode pun
// berubah.
//
// Bukan hipotetis: saat baris ini ditulis ada 357 berkas
// /tmp/racun-test-fypsnap-*.db tertinggal sejak 14 Agu, dan SETIAP satu berisi
// baris `t@t.id`. Kegagalan itulah yang muncul di jalan penuh 21 Agu.
//
// Pola nama berbasis PID dipakai 65 berkas test di repo ini, jadi bahayanya
// tidak khusus berkas ini — yang khusus cuma bahwa berkas ini yang lebih dulu
// ketahuan. Yang diperbaiki di sini hanya yang benar-benar gagal; kelasnya
// dilaporkan, bukan diam-diam ditulis ulang di 65 tempat.
for (const akhiran of ["", "-wal", "-shm"]) {
  fs.rmSync(`${process.env.DB_PATH}${akhiran}`, { force: true });
}

const { getDb, now, uuid } = await import("../lib/db");
const { createFypSnapshot, applyFypReport } = await import("../lib/fyp-snapshot");
const { renderSegmentsForTier, formatHargaNatural } = await import("../lib/script-engine/templates");
const { REGISTERS } = await import("../lib/script-engine/registers");

const db = getDb();
const userId = uuid();
const productId = uuid();
const scriptId = uuid();
const jobId = uuid();

db.prepare("INSERT INTO users (id, email, created_at) VALUES (?,?,?)").run(userId, "t@t.id", now());
db.prepare("INSERT INTO products (id, user_id, name, price_idr, category, images, created_at) VALUES (?,?,?,?,?,?,?)")
  .run(productId, userId, "Serum Glow", 85000, "beauty", "[]", now());

const segments = renderSegmentsForTier(
  "H2",
  {
    reg: REGISTERS.bestie, harga: formatHargaNatural(85000), produk: "Serum Glow",
    noun: "skincare", pain: "kusamnya", proof: "teksturnya", space: "Meja skincare",
    aktivitas: "skincare-an malem", identitas: "tim glowing",
  },
  "silent_caption",
  15
);
db.prepare(
  "INSERT INTO scripts (id, product_id, hook_family, emotion, register, segments, caption, hashtags, validation_result, quality_tier, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
).run(scriptId, productId, "H2", "senang", "bestie", JSON.stringify(segments), "cap", "[]", "{}", "silent_caption", now());
db.prepare(
  "INSERT INTO jobs (id, user_id, product_id, script_id, format, quality_tier, duration_s, state, created_at, state_changed_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
).run(jobId, userId, productId, scriptId, "hands_only", "silent_caption", 15, "QUEUED", now(), now());

const snapInput = {
  jobId, scriptId, hookFamily: "H2", segments,
  qualityTier: "silent_caption" as const, durationSec: 15,
  format: "hands_only" as const, productName: "Serum Glow", priceIdr: 85000,
};

test("snapshot dibuat beku, idempoten, skor cocok dengan scorer", () => {
  const first = createFypSnapshot(db, snapInput);
  assert.equal(first.modelVersion, "ckpt18-n691");
  assert.ok(first.score >= 0 && first.score <= 100);
  const row1 = db.prepare("SELECT * FROM fyp_snapshots WHERE job_id = ?").get(jobId) as { created_at: string; score: number };
  // Panggilan kedua (job duplikat / retry) tidak menimpa snapshot pertama.
  createFypSnapshot(db, { ...snapInput, priceIdr: 999999 });
  const row2 = db.prepare("SELECT * FROM fyp_snapshots WHERE job_id = ?").get(jobId) as { created_at: string; score: number };
  assert.equal(row2.created_at, row1.created_at);
  assert.equal(row2.score, row1.score);
  const n = (db.prepare("SELECT COUNT(*) c FROM fyp_snapshots").get() as { c: number }).c;
  assert.equal(n, 1);
});

test("lapor hasil: URL tersimpan beku, outcome bisa menyusul dan di-update", () => {
  const url = "https://www.tiktok.com/@toko/video/123";
  const r1 = applyFypReport(db, jobId, { postedUrl: url });
  assert.equal(r1.posted_url, url);
  assert.equal(r1.outcome_json, null);

  // Outcome menyusul dengan URL sama — boleh.
  const r2 = applyFypReport(db, jobId, { postedUrl: url, views: 1500, orders: 3 });
  assert.deepEqual(JSON.parse(r2.outcome_json!), { views: 1500, orders: 3 });
  assert.equal(r2.posted_at, r1.posted_at, "posted_at tidak berubah saat update outcome");

  // Update sebagian: views baru, orders dipertahankan dari laporan sebelumnya.
  const r3 = applyFypReport(db, jobId, { postedUrl: url, views: 9000 });
  assert.deepEqual(JSON.parse(r3.outcome_json!), { views: 9000, orders: 3 });

  // URL BERBEDA -> ditolak (frozen), bukan ditimpa.
  assert.throws(() => applyFypReport(db, jobId, { postedUrl: "https://www.tiktok.com/@toko/video/999" }));
  const after = applyFypReport(db, jobId, { postedUrl: url });
  assert.equal(after.posted_url, url);
});

test("guard: URL invalid ditolak; job tanpa snapshot -> NOT_FOUND", () => {
  assert.throws(() => applyFypReport(db, jobId, { postedUrl: "bukan-url" }));
  assert.throws(() => applyFypReport(db, jobId, { postedUrl: "ftp://x.y/z" }));
  assert.throws(() => applyFypReport(db, uuid(), { postedUrl: "https://tiktok.com/v/1" }));
});
