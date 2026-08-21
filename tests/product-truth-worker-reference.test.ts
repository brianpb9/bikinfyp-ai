// P0-03 RED WAVE R1 (diamandemen) — W2: worker inline/SQLite (lib/worker.ts)
// memilih referensi.
//
// STATUS YANG DIHARAPKAN: MERAH pada 0c443ff (dan pada 39d363e, commit yang
// benar-benar berisi versi R1 yang diamandemen — BUKAN 6623c4f, yang hanya
// mengubah satu baris dokumen bukti).
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
import { execFileSync } from "node:child_process";

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
const sha256Uji = sha;

/** person-safe butuh python + OpenCV + model YuNet; tanpa itu jalur hilir tidak bisa ditempuh. */
function punyaPersonSafe(): boolean {
  try {
    const venv = path.join(process.cwd(), ".venv", "bin", "python");
    const py = fs.existsSync(venv) ? venv : "python3";
    execFileSync(py, ["-c", "import cv2"], { stdio: "ignore" });
    return fs.existsSync(path.join(process.cwd(), "assets", "models", "face_detection_yunet_2023mar.onnx"));
  } catch {
    return false;
  }
}

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
function siapkanJob(images: string[], tier = "silent_caption"): { jobId: string; productId: string } {
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
     VALUES (?,?,?,NULL,?,'hands_only',?,15,'QUEUED',?,?)`
  ).run(jobId, userId, productId, scriptId, tier, now(), now());
  db.prepare("UPDATE scripts SET job_id = ? WHERE id = ?").run(jobId, scriptId);
  return { jobId, productId };
}

const jumlah = (sql: string, ...args: unknown[]) =>
  (db.prepare(sql).get(...(args as [])) as { n: number }).n;

/**
 * NOL EFEK SAMPING PADA JOB YANG SAMA.
 *
 * Dipanggil untuk SETIAP job di berkas ini, dan SEBELUM asersi merah utama —
 * supaya pemeriksaan uang/deliverable tetap berjalan walau asersi pilihan
 * referensi gagal. Kalau ia dipanggil sesudahnya, kegagalan pertama akan
 * menyembunyikan kebocoran uang, dan kebocoran uang adalah temuan yang lebih
 * mahal daripada pilihan referensi yang salah.
 *
 * SENGAJA TIDAK melarang `release`. Job yang gagal WAJIB boleh mengembalikan
 * hold-nya; melarang release berarti menuntut kredit user hangus saat gerbang
 * bukti menolak — kebalikan dari yang benar. Yang dilarang adalah pengambilan
 * uang (`capture`, `regen`) dan segala jejak produksi.
 */
function assertNolEfekSamping(
  jobId: string,
  spy: { putCalls: string[] },
  konteks: string
): void {
  assert.equal(
    jumlah("SELECT COUNT(*) AS n FROM outputs WHERE job_id = ?", jobId),
    0,
    `${konteks}: ada deliverable untuk job ini padahal worker berhenti`
  );
  assert.equal(
    jumlah("SELECT COUNT(*) AS n FROM credit_ledger WHERE job_id = ? AND type = 'capture'", jobId),
    0,
    `${konteks}: ada credit_ledger 'capture' untuk job ini — uang diambil tanpa deliverable`
  );
  assert.equal(
    jumlah("SELECT COUNT(*) AS n FROM credit_ledger WHERE job_id = ? AND type = 'regen'", jobId),
    0,
    `${konteks}: ada credit_ledger 'regen' untuk job ini — biaya regenerate scene tanpa scene`
  );
  const job = db
    .prepare("SELECT state, provider_video, provider_voice, output_url, cost_actual_idr FROM jobs WHERE id = ?")
    .get(jobId) as {
    state: string;
    provider_video: string | null;
    provider_voice: string | null;
    output_url: string | null;
    cost_actual_idr: number;
  };
  assert.equal(job.provider_video, null, `${konteks}: provider_video tercatat — ada panggilan provider video`);
  assert.equal(job.provider_voice, null, `${konteks}: provider_voice tercatat — ada panggilan provider suara`);
  assert.equal(job.output_url, null, `${konteks}: output_url terisi padahal worker berhenti`);
  assert.equal(job.cost_actual_idr, 0, `${konteks}: cost_actual_idr bukan 0 — ada biaya provider tercatat`);
  assert.equal(spy.putCalls.length, 0, `${konteks}: worker menulis ke storage (${JSON.stringify(spy.putCalls)})`);
  assert.equal(panggilanJaringan, 0, `${konteks}: ada panggilan fetch — worker menyentuh jaringan`);
}

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

  assertNolEfekSamping(jobId, spy, "W2 C1");
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

// Dua kasus C8 di bawah menuntut hal yang SAMA: `materialize()` adalah
// pengambilan PAYLOAD — menyalin bytes gambar ke disk lokal supaya bisa
// disodorkan ke provider. Itu tidak boleh terjadi sebelum bukti dinyatakan
// sah. Yang TIDAK dilarang adalah `get()`/`stat()`: validator memang harus
// membaca sidecar dan bytes-nya untuk memverifikasi sha256. Test versi
// sebelumnya menulis "tidak boleh menyentuh storage sama sekali" — itu terlalu
// keras dan akan memaksa implementasi yang benar jadi merah.

test("W2 C8: sidecar KORUP — payload tidak boleh di-materialize sebelum bukti sah", async () => {
  const relFoto = "uploads/w2-c8-korup/0.webp";
  const isi = new Map<string, Buffer>([
    [relFoto, PACKSHOT],
    [`${relFoto}.meta.json`, Buffer.from('{"sha256": "abc", "jenis":')], // korup
  ]);
  const spy = storageSpy(isi);
  setMediaStorageForTests(spy.storage);

  const { jobId } = siapkanJob([relFoto]);
  await processJob(jobId);

  assertNolEfekSamping(jobId, spy, "W2 C8 korup");
  assert.deepEqual(
    spy.materializeCalls,
    [],
    `EVIDENCE_INVALID: dengan sidecar KORUP, W2 tetap men-materialize payload ` +
      `${JSON.stringify(spy.materializeCalls)}. Worker harus gagal-tertutup SEBELUM mengambil ` +
      "bytes referensi — ia tidak pernah membaca sidecar sama sekali (lib/worker.ts:104-110), " +
      "jadi bukti rusak dan bukti bersih diperlakukan identik. (Membaca sidecar lewat get()/stat() " +
      "untuk MEMVALIDASI justru wajib, dan tidak dilarang test ini.)"
  );

  const job = db.prepare("SELECT state FROM jobs WHERE id = ?").get(jobId) as { state: string };
  assert.ok(
    ["FAILED", "REFUNDED"].includes(job.state),
    `job dengan bukti korup harus berakhir gagal-tertutup, bukan ${job.state}`
  );
});

test("W2 C8: sidecar HILANG (bytes ada) — payload tidak boleh di-materialize sebelum bukti sah", async () => {
  // Persis produk jalur org: `saveUniqueProductImages` tidak pernah menulis
  // sidecar sama sekali (matriks P0-03 baris E8), jadi ini bukan kasus
  // hipotetis — ini keadaan normal untuk setiap produk yang dibuat lewat
  // dashboard enterprise.
  const relFoto = "uploads/w2-c8-hilang/0.webp";
  const spy = storageSpy(new Map<string, Buffer>([[relFoto, PACKSHOT]]));
  setMediaStorageForTests(spy.storage);

  const { jobId } = siapkanJob([relFoto]);
  await processJob(jobId);

  assertNolEfekSamping(jobId, spy, "W2 C8 hilang");
  assert.deepEqual(
    spy.materializeCalls,
    [],
    `EVIDENCE_INVALID: TANPA sidecar sama sekali, W2 tetap men-materialize payload ` +
      `${JSON.stringify(spy.materializeCalls)}. Tidak ada satu pun bukti yang menyatakan gambar ini ` +
      "layak jadi referensi, tapi worker langsung mengambil bytes-nya karena ia hanya melihat " +
      "posisi images[0] (lib/worker.ts:104-110)."
  );

  const job = db.prepare("SELECT state FROM jobs WHERE id = ?").get(jobId) as { state: string };
  assert.ok(
    ["FAILED", "REFUNDED"].includes(job.state),
    `job tanpa bukti harus berakhir gagal-tertutup, bukan ${job.state}`
  );
});

// ------------------------------------------- bytes berubah sesudah disetujui

/**
 * TOCTOU — bytes yang DIKIRIM wajib sama dengan yang DISETUJUI.
 *
 * Temuan Reviewer 21 Agu. Resolver memverifikasi bytes lewat `get()` dan
 * mengembalikan sha256-nya, tapi `materialize()` MENGAMBIL OBJEKNYA LAGI — di
 * R2 itu GET kedua ke jaringan. Kalau objeknya berubah di antara dua pembacaan,
 * provider menerima bytes yang tidak pernah disetujui siapa pun, dan seluruh
 * rantai bukti di atasnya jadi hiasan.
 *
 * Storage di bawah ini memodelkan persis jendela itu: `get()` mengembalikan
 * bytes yang buktinya sah, `materialize()` menuliskan bytes LAIN.
 */
test("W2 TOCTOU: bytes berubah antara verifikasi dan pengambilan — job berhenti sebelum berbayar", async () => {
  const relFoto = "uploads/w2-toctou/0.webp";
  const isi = new Map<string, Buffer>([
    [relFoto, PACKSHOT],
    [`${relFoto}.meta.json`, sidecar(PACKSHOT, true)],
  ]);
  const materializeCalls: string[] = [];
  const putCalls: string[] = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w2-toctou-"));
  setMediaStorageForTests({
    async put(key: string, body: Buffer) {
      putCalls.push(key);
      isi.set(key, body);
    },
    async delete(key: string) {
      isi.delete(key);
    },
    async get(key: string) {
      const body = isi.get(key);
      return body ? { body, size: body.length } : null;
    },
    async stat(key: string) {
      const body = isi.get(key);
      return body ? { size: body.length } : null;
    },
    async materialize(key: string) {
      materializeCalls.push(key);
      // Bytes DITUKAR di jendela antara get() dan materialize().
      const abs = path.join(tmp, path.basename(key));
      fs.writeFileSync(abs, Buffer.from("BYTES-DITUKAR-SESUDAH-DISETUJUI"));
      return abs;
    },
  } as never);

  try {
    const { jobId } = siapkanJob([relFoto]);
    await processJob(jobId);

    assertNolEfekSamping(jobId, { putCalls }, "W2 TOCTOU");
    const job = db.prepare("SELECT state FROM jobs WHERE id = ?").get(jobId) as { state: string };
    assert.ok(
      ["FAILED", "REFUNDED"].includes(job.state),
      `bytes yang berubah sesudah disetujui tetap diteruskan; job berakhir ${job.state}`
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/**
 * W2 TOCTOU JENDELA NYATA — path BERSAMA ditimpa SESUDAH diperiksa.
 *
 * Temuan Reviewer 21 Agu: kasus TOCTOU W2 di atas menukar bytes SEBELUM
 * `pastikanBytesTersetujui`, jadi ia tetap hijau walau snapshot privat di
 * lib/worker.ts dihapus — ia menguji pemeriksaan hash, bukan jendela yang baru
 * ditutup.
 *
 * Di sini SETIAP materialize menulis ke SATU path yang sama, jadi materialize
 * referensi TAMBAHAN menimpa bytes referensi UTAMA tepat sesudah utama
 * diverifikasi. Tanpa snapshot privat, yang diteruskan sebagai referensi utama
 * adalah bytes foto lain.
 */
test("W2 TOCTOU: path bersama ditimpa sesudah verifikasi — referensi utama tetap bytes yang disetujui", async () => {
  const dasar = "uploads/w2-toctou-bersama";
  const relSah1 = `${dasar}/0.webp`;
  const relSah2 = `${dasar}/1.webp`;
  const sah1 = Buffer.from("BYTES-SAH-PERTAMA-W2-TOCTOU");
  const sah2 = Buffer.from("BYTES-SAH-KEDUA-W2-TOCTOU");
  const isi = new Map<string, Buffer>([
    [relSah1, sah1],
    [`${relSah1}.meta.json`, sidecar(sah1, true)],
    [relSah2, sah2],
    [`${relSah2}.meta.json`, sidecar(sah2, true)],
  ]);
  const materializeCalls: string[] = [];
  const putCalls: string[] = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w2-bersama-"));
  const pathBersama = path.join(tmp, "bersama.webp");
  setMediaStorageForTests({
    async put(key: string, body: Buffer) {
      putCalls.push(key);
      isi.set(key, body);
    },
    async delete(key: string) {
      isi.delete(key);
    },
    async get(key: string) {
      const body = isi.get(key);
      return body ? { body, size: body.length } : null;
    },
    async stat(key: string) {
      const body = isi.get(key);
      return body ? { size: body.length } : null;
    },
    async materialize(key: string) {
      materializeCalls.push(key);
      const body = isi.get(key);
      if (!body) return null;
      fs.writeFileSync(pathBersama, body); // menimpa isi materialize sebelumnya
      return pathBersama;
    },
  } as never);

  try {
    const { jobId } = siapkanJob([relSah1, relSah2], "high_quality");
    await processJob(jobId);

    assertNolEfekSamping(jobId, { putCalls }, "W2 TOCTOU bersama");
    assert.deepEqual(materializeCalls, [relSah1, relSah2], "kedua referensi wajib diminta");
    assert.equal(
      sha256Uji(fs.readFileSync(pathBersama)),
      sha256Uji(sah2),
      "prasyarat: path bersama memang sudah ditimpa bytes referensi kedua"
    );

    // Snapshot privat job ini berisi bytes yang DISETUJUI, bukan isi path
    // bersama yang sudah ditimpa. Diperiksa dari berkas snapshot-nya sendiri:
    // itulah yang diteruskan ke hilir.
    const dirSnapshot = path.join(process.env.STORAGE_DIR!, "jobs", jobId, "ref-tersetujui");
    assert.ok(fs.existsSync(dirSnapshot), "snapshot bukti tidak dibuat — path bersama diteruskan apa adanya");
    const berkasSnapshot = fs.readdirSync(dirSnapshot).map((f) => path.join(dirSnapshot, f));
    const shaSnapshot = berkasSnapshot.map((f) => sha256Uji(fs.readFileSync(f)));
    assert.ok(
      shaSnapshot.includes(sha256Uji(sah1)),
      `snapshot tidak memuat bytes referensi utama yang disetujui. Isi snapshot: ${JSON.stringify(shaSnapshot)}`
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/**
 * SNAPSHOT DIPAKAI DI HILIR — bukan sekadar dibuat.
 *
 * Temuan Reviewer 21 Agu atas kasus di atas: ia berhenti sebelum
 * person-safe/planner/provider lalu hanya membaca direktori `ref-tersetujui`.
 * Regresi yang tetap MEMBUAT snapshot tapi meneruskan `imageRef` (path bersama
 * yang sudah tertimpa) ke hilir akan tetap hijau — snapshot yang dibuat lalu
 * diabaikan sama tidak bergunanya dengan snapshot yang tidak pernah dibuat.
 *
 * Kasus ini menempuh sampai PROVIDER lewat seam
 * `setVideoProvidersForTests`, dengan PNG sungguhan supaya person-safe
 * melewatinya apa adanya, lalu membaca bytes yang BENAR-BENAR diterima.
 */
test("W2 TOCTOU: bytes yang DITERIMA PROVIDER tetap referensi utama yang disetujui", async (t) => {
  if (!punyaPersonSafe()) return t.skip("python/OpenCV/model YuNet tidak ada — jalur hilir tidak bisa ditempuh");
  const { setVideoProvidersForTests } = await import("../lib/providers/registry");
  const sharp = (await import("sharp")).default;
  const gambar = (r: number, g: number, b: number) =>
    sharp({ create: { width: 800, height: 800, channels: 3, background: { r, g, b } } }).png().toBuffer();
  const sah1 = await gambar(30, 190, 110);
  const sah2 = await gambar(70, 110, 210);

  const dasar = "uploads/w2-hilir";
  const relSah1 = `${dasar}/0.png`;
  const relSah2 = `${dasar}/1.png`;
  const isi = new Map<string, Buffer>([
    [relSah1, sah1],
    [`${relSah1}.meta.json`, sidecar(sah1, true)],
    [relSah2, sah2],
    [`${relSah2}.meta.json`, sidecar(sah2, true)],
  ]);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w2-hilir-"));
  const pathBersama = path.join(tmp, "bersama.png");
  const putCalls: string[] = [];
  setMediaStorageForTests({
    async put(key: string, body: Buffer) {
      putCalls.push(key);
      isi.set(key, body);
    },
    async delete(key: string) {
      isi.delete(key);
    },
    async get(key: string) {
      const body = isi.get(key);
      return body ? { body, size: body.length } : null;
    },
    async stat(key: string) {
      const body = isi.get(key);
      return body ? { size: body.length } : null;
    },
    async materialize(key: string) {
      const body = isi.get(key);
      if (!body) return null;
      fs.writeFileSync(pathBersama, body); // materialize kedua menimpa yang pertama
      return pathBersama;
    },
  } as never);

  let utamaDiterima: string | null = null;
  setVideoProvidersForTests([
    {
      name: "pengamat-w2",
      async healthCheck() {
        return true;
      },
      estimateCost() {
        return 0;
      },
      async generate(spec: { shots: { imageRefPath: string }[] }) {
        const p = spec.shots[0]?.imageRefPath;
        if (p && fs.existsSync(p)) utamaDiterima = sha256Uji(fs.readFileSync(p));
        throw new Error("provider pengamat W2: berhenti sebelum biaya keluar");
      },
    } as never,
  ]);

  try {
    const { jobId } = siapkanJob([relSah1, relSah2], "high_quality");
    await processJob(jobId);

    assertNolEfekSamping(jobId, { putCalls }, "W2 hilir");
    assert.equal(
      sha256Uji(fs.readFileSync(pathBersama)),
      sha256Uji(sah2),
      "prasyarat: path bersama memang sudah ditimpa bytes referensi kedua"
    );
    assert.ok(utamaDiterima, "provider tidak pernah menerima spec — jalur hilir tidak tertempuh");
    assert.equal(
      utamaDiterima,
      sha256Uji(sah1),
      "provider menerima isi PATH BERSAMA sebagai referensi utama. Snapshot dibuat tapi tidak " +
        "dipakai di hilir — sama tidak bergunanya dengan tidak dibuat sama sekali."
    );
  } finally {
    setVideoProvidersForTests(undefined);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ------------------------------------------- batas referensi per generasi

/**
 * DELAPAN foto tersetujui, TUJUH referensi terkirim.
 *
 * `MAKS_REFERENSI_PER_GENERASI = 7` adalah kontrak TERPISAH dari
 * `MAX_IMAGES = 8` (batas unggah). `slice(1, MAX_IMAGES)` menghasilkan primary
 * + tujuh = DELAPAN referensi per generasi — melewati kontraknya sendiri, di
 * kedua worker. Temuan Reviewer 21 Agu.
 */
test("W2: delapan foto tersetujui menghasilkan paling banyak TUJUH referensi", async () => {
  const dasar = "uploads/w2-delapan";
  const isi = new Map<string, Buffer>();
  const rels: string[] = [];
  for (let i = 0; i < 8; i++) {
    const rel = `${dasar}/${i}.webp`;
    const bytes = Buffer.from(`BYTES-PACKSHOT-SAH-${i}`);
    isi.set(rel, bytes);
    isi.set(`${rel}.meta.json`, sidecar(bytes, true));
    rels.push(rel);
  }
  const materializeCalls: string[] = [];
  const putCalls: string[] = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w2-delapan-"));
  setMediaStorageForTests({
    async put(key: string, body: Buffer) {
      putCalls.push(key);
      isi.set(key, body);
    },
    async delete(key: string) {
      isi.delete(key);
    },
    async get(key: string) {
      const body = isi.get(key);
      return body ? { body, size: body.length } : null;
    },
    async stat(key: string) {
      const body = isi.get(key);
      return body ? { size: body.length } : null;
    },
    async materialize(key: string) {
      materializeCalls.push(key);
      // Bytes yang BENAR, supaya pemeriksaan hash lolos dan jalurnya berlanjut
      // sampai batas referensi benar-benar terpakai.
      const body = isi.get(key);
      if (!body) return null;
      const abs = path.join(tmp, path.basename(key));
      fs.writeFileSync(abs, body);
      return abs;
    },
  } as never);

  try {
    // Tier bersuara supaya cabang referensi tambahan benar-benar dilewati.
    const { jobId } = siapkanJob(rels, "high_quality");
    await processJob(jobId);

    assert.ok(materializeCalls.length > 1, "cabang referensi tambahan tidak pernah dilewati — fixture salah");
    assert.ok(
      materializeCalls.length <= 7,
      `worker meminta ${materializeCalls.length} referensi (${JSON.stringify(materializeCalls)}). ` +
        "MAKS_REFERENSI_PER_GENERASI=7 menghitung primary + tambahan; delapan berarti kontraknya " +
        "sendiri dilewati."
    );
    assert.ok(
      !materializeCalls.includes(`${dasar}/7.webp`),
      "foto kedelapan ikut diminta — batas generasi tidak diterapkan"
    );
    assertNolEfekSamping(jobId, { putCalls }, "W2 delapan foto");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ----------------------------------------------------- kebersihan sesudah halt

test("W2 kontrol positif: bukti SAH sampai ke materialize, lalu halt bersih", async () => {
  // Kontrol positif untuk assertNolEfekSamping itu sendiri: kalau helper ini
  // hijau di mana-mana hanya karena ia tidak memeriksa apa pun, test ini pun
  // tidak akan pernah bisa merah. Ia dijalankan pada job yang BENAR-BENAR
  // diproses worker sampai halt, bukan job kosong.
  //
  // FIXTURE DIPERBAIKI (temuan Reviewer 21 Agu). Versi R1 memakai foto TANPA
  // sidecar sambil menuntut `materializeCalls.length > 0`. Itu hijau hari ini
  // hanya karena worker belum memeriksa bukti sama sekali — dan begitu
  // resolver ketat menyala, test ini akan MERAH karena alasan yang justru
  // BENAR (tidak ada bukti -> tidak boleh materialize), persis seperti yang
  // dituntut dua test C8 di atas. Kontrol positif yang menuntut keberhasilan
  // wajib membawa bukti yang sah; kalau tidak, ia menekan implementasi untuk
  // melemahkan gerbangnya sendiri.
  //
  // Sekarang fotonya membawa sidecar SAH (sha256 cocok dengan bytes tersimpan,
  // versiBukti terkini, layakReferensi true), jadi jalur yang diuji adalah:
  // bukti sah -> referensi tersetujui -> materialize -> storage mengembalikan
  // null -> halt bersih sebelum langkah berbayar.
  const relFoto = "uploads/w2-halt/0.webp";
  const spy = storageSpy(
    new Map<string, Buffer>([
      [relFoto, PACKSHOT],
      [`${relFoto}.meta.json`, sidecar(PACKSHOT, true)],
    ])
  );
  setMediaStorageForTests(spy.storage);

  const { jobId } = siapkanJob([relFoto]);
  await processJob(jobId);

  assert.deepEqual(
    spy.materializeCalls,
    [relFoto],
    "bukti SAH harus sampai ke materialize tepat sekali — kalau ini merah, gerbangnya terlalu " +
      "ketat (menolak bukti yang sah), bukan terlalu longgar"
  );
  assertNolEfekSamping(jobId, spy, "W2 halt");

  // Refund TIDAK dilarang: job yang gagal wajib boleh mengembalikan hold-nya.
  const job = db.prepare("SELECT state FROM jobs WHERE id = ?").get(jobId) as { state: string };
  assert.ok(["FAILED", "REFUNDED"].includes(job.state), `job harus berakhir gagal-tertutup, bukan ${job.state}`);
});

after(() => {
  setMediaStorageForTests(undefined);
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
  fs.rmSync(BIN_KOSONG, { recursive: true, force: true });
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${process.env.DB_PATH}${suffix}`, { force: true });
});
