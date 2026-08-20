// P0-03 RED WAVE R1 — W2: worker inline/SQLite (lib/worker.ts) memilih referensi.
//
// STATUS YANG DIHARAPKAN: MERAH pada 66b4b33.
// lib/worker.ts:104-110 mengambil `images[0]` mentah — foto PERTAMA, apa pun
// isinya — lalu me-materialize-nya sebagai referensi utama. Tidak ada satu pun
// pembacaan sidecar, tidak ada verifikasi hash, tidak ada gerbang kelayakan.
// Jadi produk yang foto#1-nya banner promo akan mengirim BANNER ke model,
// padahal foto#2 adalah packshot sah yang buktinya bersih.
//
// CARA BERHENTI YANG AMAN: storage palsu mengembalikan null dari materialize(),
// sehingga worker melempar "Foto produk tidak ditemukan di storage." tepat
// SEBELUM langkah berbayar mana pun (planShots / provider / ffmpeg). Yang
// direkam spy adalah PILIHAN worker — kunci mana yang ia minta lebih dulu —
// dan itulah bukti cacatnya.
//
// LARANGAN YANG DIPATUHI: SQLite lokal (bukan Postgres/Redis/R2), nol
// jaringan (fetch dijebak + dihitung), nol provider, nol ffmpeg, nol OCR.
// W1 (lib/postgres/worker.ts) TIDAK dijalankan di sini — ia butuh PostgreSQL;
// cakupannya struktural, di tests/product-truth-worker-wiring.test.ts.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

process.env.RACUN_NO_DOTENV = "1";
process.env.RACUN_WORKER_DISABLED = "1"; // pump() tidak boleh jalan sendiri
process.env.STORAGE_MODE = "filesystem";
process.env.DB_PATH = `/tmp/racun-test-p003-w2-${process.pid}.db`;
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "p003-w2-store-"));

// Sandbox biner: satu-satunya PATH adalah direktori kosong, dan FFMPEG/FFPROBE
// diarahkan ke berkas yang tidak ada. Worker seharusnya berhenti jauh sebelum
// menyentuh biner apa pun; ini jaring supaya kalau ia TIDAK berhenti, yang
// terjadi adalah ENOENT seketika — bukan render nyata.
const BIN_KOSONG = fs.mkdtempSync(path.join(os.tmpdir(), "p003-w2-nobin-"));
process.env.PATH = BIN_KOSONG;
process.env.FFMPEG_PATH = path.join(BIN_KOSONG, "ffmpeg-tidak-ada");
process.env.FFPROBE_PATH = path.join(BIN_KOSONG, "ffprobe-tidak-ada");

let panggilanJaringan = 0;
globalThis.fetch = (async (...args: unknown[]) => {
  panggilanJaringan++;
  throw new Error(`Worker tidak boleh menyentuh jaringan di test ini: ${String(args[0])}`);
}) as unknown as typeof fetch;

const { getDb, now, uuid } = await import("../lib/db");
const { setMediaStorageForTests } = await import("../lib/storage");
const { processJob } = await import("../lib/worker");
type MediaStorage = import("../lib/storage").MediaStorage;
type StoredObject = import("../lib/storage").StoredObject;

const db = getDb();
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

const BANNER = Buffer.from("BYTES-BANNER-PROMO-W2");
const PACKSHOT = Buffer.from("BYTES-PACKSHOT-SAH-W2");

function sidecar(bytes: Buffer, layak: boolean) {
  return Buffer.from(
    JSON.stringify({
      sha256: sha(bytes),
      jenis: layak ? "product_photo" : "promotional_graphic",
      layakReferensi: layak,
      rasioAreaTeks: layak ? 0.004 : 0.21,
      jumlahKata: layak ? 2 : 15,
      alasan: layak ? "foto produk" : "materi promosi",
      versiBukti: 1,
    })
  );
}

/** Storage palsu: mencatat SETIAP materialize(key) dan selalu mengembalikan null. */
function storageSpy(isi: Map<string, Buffer>) {
  const materializeCalls: string[] = [];
  const getCalls: string[] = [];
  const putCalls: string[] = [];
  const storage: MediaStorage = {
    async put(key, body) {
      putCalls.push(key);
      isi.set(key, body);
    },
    async delete(key) {
      isi.delete(key);
    },
    async get(key): Promise<StoredObject | null> {
      getCalls.push(key);
      const body = isi.get(key);
      return body ? { body, size: body.length } : null;
    },
    async stat(key) {
      const body = isi.get(key);
      return body ? { size: body.length } : null;
    },
    async materialize(key) {
      materializeCalls.push(key);
      return null; // HALT: worker berhenti sebelum langkah berbayar apa pun
    },
  };
  return { storage, materializeCalls, getCalls, putCalls };
}

const userId = uuid();
db.prepare("INSERT INTO users (id, phone, email, name, tier, locale, created_at) VALUES (?,?,?,?,?,?,?)").run(
  userId,
  "081200000003",
  `p003-w2-${process.pid}@contoh.test`,
  "Uji P0-03",
  "free",
  "id-ID",
  now()
);

const segmen = [
  { role: "hook", start: 0, end: 3, text: "Say, masa 85 ribu segini sih?", visual_direction: "x" },
  { role: "demo", start: 3, end: 10, text: "nah, teksturnya niat banget deh", visual_direction: "x" },
  { role: "cta", start: 10, end: 15, text: "linknya di keranjang kuning ya", visual_direction: "x" },
];

/** Satu produk + skrip + job QUEUED, siap diproses worker inline. */
function siapkanJob(images: string[]): { jobId: string; productId: string } {
  const productId = uuid();
  db.prepare(
    "INSERT INTO products (id, user_id, source_url, name, price_idr, category, images, raw_meta, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(productId, userId, null, "Serum Glow Bright", 85000, "beauty", JSON.stringify(images), null, now());

  const scriptId = uuid();
  db.prepare(
    `INSERT INTO scripts (id, job_id, product_id, hook_family, emotion, register, segments, caption, hashtags, validation_result, quality_tier, hook_level, approved_by_user_at, edited_by_user, created_at)
     VALUES (?, NULL, ?, 'H1', 'senang', 'bestie', ?, 'caption', '[]', '{}', 'silent_caption', 'normal', ?, 0, ?)`
  ).run(scriptId, productId, JSON.stringify(segmen), now(), now());

  const jobId = uuid();
  db.prepare(
    `INSERT INTO jobs (id, user_id, product_id, persona_id, script_id, format, quality_tier, duration_s, state, created_at, state_changed_at)
     VALUES (?,?,?,NULL,?,'hands_only','silent_caption',15,'QUEUED',?,?)`
  ).run(jobId, userId, productId, scriptId, now(), now());
  db.prepare("UPDATE scripts SET job_id = ? WHERE id = ?").run(jobId, scriptId);
  return { jobId, productId };
}

const jumlah = (sql: string, ...args: unknown[]) =>
  (db.prepare(sql).get(...(args as [])) as { n: number }).n;

// ------------------------------------------------------------------- W2 / C1

test("W2 C1: worker wajib memilih packshot sah, bukan images[0] (banner promo)", async () => {
  const relBanner = "uploads/w2-c1/0.webp";
  const relPackshot = "uploads/w2-c1/1.webp";
  const isi = new Map<string, Buffer>([
    [relBanner, BANNER],
    [`${relBanner}.meta.json`, sidecar(BANNER, false)],
    [relPackshot, PACKSHOT],
    [`${relPackshot}.meta.json`, sidecar(PACKSHOT, true)],
  ]);
  const spy = storageSpy(isi);
  setMediaStorageForTests(spy.storage);

  const { jobId } = siapkanJob([relBanner, relPackshot]);
  await processJob(jobId);

  assert.ok(spy.materializeCalls.length > 0, "worker tidak menyentuh storage sama sekali — fixture salah, bukan cacat");
  assert.equal(
    spy.materializeCalls[0],
    relPackshot,
    `W2 memilih referensi utama YANG SALAH.\n` +
      `  diminta worker : ${spy.materializeCalls[0]}  (banner promo, layakReferensi=false)\n` +
      `  seharusnya     : ${relPackshot}  (packshot, sidecar sah, sha256 cocok)\n` +
      `  seluruh urutan : ${JSON.stringify(spy.materializeCalls)}\n` +
      "lib/worker.ts:109 memakai images[0] mentah — foto pertama menang hanya karena urutannya, " +
      "tanpa satu pun pembacaan bukti."
  );
});

// ------------------------------------------------------------------- W2 / C8

test("W2 C8: bukti korup -> worker tidak boleh menyentuh storage sama sekali", async () => {
  const relFoto = "uploads/w2-c8/0.webp";
  const isi = new Map<string, Buffer>([
    [relFoto, PACKSHOT],
    [`${relFoto}.meta.json`, Buffer.from('{"sha256": "abc", "jenis":')], // korup
  ]);
  const spy = storageSpy(isi);
  setMediaStorageForTests(spy.storage);

  const { jobId } = siapkanJob([relFoto]);
  await processJob(jobId);

  assert.deepEqual(
    spy.materializeCalls,
    [],
    `EVIDENCE_INVALID: dengan sidecar KORUP, W2 tetap men-materialize ` +
      `${JSON.stringify(spy.materializeCalls)}. Worker harus gagal-tertutup SEBELUM menyentuh ` +
      "berkas referensi — ia tidak pernah membaca sidecar sama sekali (lib/worker.ts:104-110), " +
      "jadi bukti rusak dan bukti bersih diperlakukan identik."
  );

  const job = db.prepare("SELECT state FROM jobs WHERE id = ?").get(jobId) as { state: string };
  assert.ok(
    ["FAILED", "REFUNDED"].includes(job.state),
    `job dengan bukti korup harus berakhir gagal-tertutup, bukan ${job.state}`
  );
});

// ----------------------------------------------------- kebersihan sesudah halt

test("W2 kontrol positif: sesudah halt — nol output, nol capture, nol provider, nol jaringan", async () => {
  const relFoto = "uploads/w2-halt/0.webp";
  const spy = storageSpy(new Map<string, Buffer>([[relFoto, PACKSHOT]]));
  setMediaStorageForTests(spy.storage);

  const { jobId } = siapkanJob([relFoto]);
  await processJob(jobId);

  assert.equal(jumlah("SELECT COUNT(*) AS n FROM outputs WHERE job_id = ?", jobId), 0, "ada deliverable padahal worker berhenti");
  assert.equal(
    jumlah("SELECT COUNT(*) AS n FROM credit_ledger WHERE job_id = ? AND type = 'capture'", jobId),
    0,
    "ada capture kredit padahal worker berhenti"
  );
  const job = db.prepare("SELECT state, provider_video, provider_voice, output_url, cost_actual_idr FROM jobs WHERE id = ?").get(jobId) as {
    state: string;
    provider_video: string | null;
    provider_voice: string | null;
    output_url: string | null;
    cost_actual_idr: number;
  };
  assert.equal(job.provider_video, null, "provider video tercatat — berarti ada panggilan provider");
  assert.equal(job.provider_voice, null, "provider suara tercatat — berarti ada panggilan provider");
  assert.equal(job.output_url, null, "output_url terisi padahal worker berhenti");
  assert.equal(job.cost_actual_idr, 0, "ada biaya provider tercatat padahal worker berhenti");
  assert.equal(spy.putCalls.length, 0, "worker menulis ke storage padahal berhenti sebelum produksi");
  assert.equal(panggilanJaringan, 0, "ada panggilan fetch — worker menyentuh jaringan");
});

after(() => {
  setMediaStorageForTests(undefined);
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
  fs.rmSync(BIN_KOSONG, { recursive: true, force: true });
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${process.env.DB_PATH}${suffix}`, { force: true });
});
