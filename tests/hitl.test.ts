// Unit test gerbang HITL (F-03 / SF-04): POST /api/jobs menolak 422 SCRIPT_NOT_APPROVED
// bila approved_by_user_at IS NULL — ditegakkan di API, bukan hanya UI.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.DB_PATH = `/tmp/racun-test-hitl-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-hitl-storage-${process.pid}`;
process.env.RACUN_WORKER_DISABLED = "1"; // unit test tidak menjalankan pipeline FFmpeg

const { getDb, now, uuid } = await import("../lib/db");
const { findOrCreateUserByPhone, issueToken } = await import("../lib/auth");
const { POST: createJob } = await import("../app/api/jobs/route");
const { POST: approveScript } = await import("../app/api/scripts/[id]/approve/route");

const db = getDb();
const user = findOrCreateUserByPhone("087777000111"); // bonus 1 kredit
const token = await issueToken(user.id, user.phone ?? "");

// Produk dengan 1 foto dummy (PNG 1x1 valid)
const productId = uuid();
const storageDir = process.env.STORAGE_DIR!;
fs.mkdirSync(path.join(storageDir, "uploads", productId), { recursive: true });
const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
fs.writeFileSync(path.join(storageDir, "uploads", productId, "0.png"), png1x1);
db.prepare(
  "INSERT INTO products (id, user_id, source_url, name, price_idr, category, images, raw_meta, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
).run(productId, user.id, null, "Serum Glow Bright", 85000, "beauty", JSON.stringify([`uploads/${productId}/0.png`]), null, now());

// Skrip belum di-approve
const scriptId = uuid();
// DIPENDEKKAN ke jendela baru (16-22 kata untuk 15 detik, batas Brian 1,5
// kata/detik). Versi lama 45 kata: dulu lolos karena L-05 cuma keras di mode
// strict, sementara approve dan submit render memakai "light" — persis lubang
// P0 yang ditutup 18 Agu. Sekarang aturan gerbang keras di kedua mode, jadi
// fixture-nya harus benar-benar sah, bukan cuma lolos di jalur yang longgar.
const segments = [
  { role: "hook", start: 0, end: 3, text: "Say, masa 85 ribu segini sih?", visual_direction: "x" },
  { role: "demo", start: 3, end: 10, text: "nah, teksturnya niat banget deh", visual_direction: "x" },
  { role: "cta", start: 10, end: 15, text: "linknya di keranjang kuning ya", visual_direction: "x" },
];
db.prepare(
  `INSERT INTO scripts (id, job_id, product_id, hook_family, emotion, register, segments, caption, hashtags, validation_result, quality_tier, approved_by_user_at, edited_by_user, created_at)
   VALUES (?, NULL, ?, 'H1', 'senang', 'bestie', ?, 'caption', '[]', '{}', 'high_quality', NULL, 0, ?)`
).run(scriptId, productId, JSON.stringify(segments), now());

function req(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `racun_token=${encodeURIComponent(token)}` },
    body: JSON.stringify(body),
  });
}
const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) });

test("approve NULL -> 422 SCRIPT_NOT_APPROVED", async () => {
  const res = await createJob(req("/api/jobs", { script_id: scriptId }));
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.code, "SCRIPT_NOT_APPROVED");
  assert.match(body.message_id, /Setuju/);
});

test("approve dengan kata terlarang -> 422 FORBIDDEN_WORDS (L-10 keras saat edit)", async () => {
  const bad = segments.map((s, i) =>
    i === 1 ? { ...s, text: s.text + ", dijamin paling bagus" } : s
  );
  const res = await approveScript(req(`/api/scripts/${scriptId}/approve`, { segments: bad }), ctxOf(scriptId));
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.code, "FORBIDDEN_WORDS");
});

test("setelah approve -> job dibuat (201) dan state QUEUED", async () => {
  const resApprove = await approveScript(req(`/api/scripts/${scriptId}/approve`, {}), ctxOf(scriptId));
  assert.equal(resApprove.status, 200);

  const res = await createJob(req("/api/jobs", { script_id: scriptId }));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.state, "QUEUED");

  // Dua tap/request berdekatan tidak boleh membuat job atau hold kedua.
  const duplicate = await createJob(req("/api/jobs", { script_id: scriptId }));
  assert.equal(duplicate.status, 200);
  const duplicateBody = await duplicate.json();
  assert.equal(duplicateBody.job_id, body.job_id);
  assert.equal(duplicateBody.duplicate, true);

  // JATAH VIDEO yang terpotong, bukan rupiah (sejak 2 Sep 2026). Naskah ini
  // bertier high_quality, yang dipetakan ke jatah "premium" — job dari naskah
  // lama tetap membayar, dan membayar dari jatah yang setara.
  const pakai = db
    .prepare("SELECT jenis, ember, delta FROM kredit_video WHERE user_id = ? AND tipe = 'pakai'")
    .all(user.id) as { jenis: string; ember: string; delta: number }[];
  assert.equal(pakai.length, 1, "dua request berdekatan memotong jatah dua kali");
  assert.equal(pakai[0].jenis, "premium");
  assert.equal(pakai[0].delta, -1);
  // Paket gratis pendaftar = 1 video premium, jadi sesudah satu job jatahnya habis.
  const { sisaKredit } = await import("../lib/kredit-video-sqlite");
  assert.equal(sisaKredit(user.id).premium.total, 0);
});
