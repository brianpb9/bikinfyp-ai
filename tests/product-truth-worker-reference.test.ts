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
// jaringan (fetch dijebak + dihitung), nol provider nyata (hanya seam pengamat
// lokal), nol ffmpeg, nol OCR.
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
process.env.JOB_INTAKE_MODE = "open";
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
const { setVideoProvidersForTests } = await import("../lib/providers/registry");
const { setPeriksaLabelFotoForTests } = await import("../lib/media/label-terbaca");
const { processJob } = await import("../lib/worker");
const { PATCH: patchRetailProduct } = await import("../app/api/products/[id]/route");
const { createJobProductSnapshotRaw, parseJobProductSnapshot } = await import("../lib/job-product-snapshot");
const { ringkasanKanari, resetKanariUntukTest, GagalTanpaReferensi, KODE_KANARI } = await import("../lib/kanari-bukti");
const { ALASAN_TOLAK, RINCI_TOLAK } = await import("../lib/product-truth");
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
      labelOcrStatus: "READABLE", labelOcrVersion: 1,
    })
  );
}

let installAdmissionManifestFixture: ((jobId: string, images: string[]) => string | null) | null = null;

function buildAdmissionManifestFixture(
  isi: Map<string, Buffer>,
  snapshotSources: Map<string, string>,
  jobId: string,
  images: string[],
): string | null {
  const references = images.slice(0, 7).flatMap((rel, index) => {
    const bytes = isi.get(rel);
    const sidecarBytes = isi.get(`${rel}.meta.json`);
    if (!bytes || !sidecarBytes) return [];
    let evidence: Record<string, unknown>;
    try { evidence = JSON.parse(sidecarBytes.toString("utf8")) as Record<string, unknown>; }
    catch { return []; }
    if (evidence.layakReferensi !== true || evidence.sha256 !== sha(bytes)
      || evidence.labelOcrStatus !== "READABLE" || evidence.labelOcrVersion !== 1) return [];
    const snapshotRel = `jobs/${jobId}/approved-references/${index}-${sha(bytes)}.webp`;
    isi.set(snapshotRel, Buffer.from(bytes));
    snapshotSources.set(snapshotRel, rel);
    return [{
      rel, snapshotRel, sha256: sha(bytes), versiBukti: Number(evidence.versiBukti),
      labelOcrStatus: "READABLE", labelOcrVersion: 1,
    }];
  });
  return references.length > 0 ? JSON.stringify({ version: 2, references }) : null;
}

/** Storage palsu: mencatat SETIAP materialize(key) dan selalu mengembalikan null. */
function storageSpy(isi: Map<string, Buffer>) {
  const materializeCalls: string[] = [];
  const getCalls: string[] = [];
  const putCalls: string[] = [];
  const snapshotSources = new Map<string, string>();
  installAdmissionManifestFixture = (jobId, images) => buildAdmissionManifestFixture(isi, snapshotSources, jobId, images);
  const storage: MediaStorage = {
    async put(key, body) {
      putCalls.push(key);
      if (key.includes("/approved-references/")) {
        const source = [...isi.entries()].find(([candidate, bytes]) =>
          !candidate.endsWith(".meta.json")
          && !candidate.includes("/approved-references/")
          && bytes.equals(body)
        )?.[0];
        if (source) snapshotSources.set(key, source);
      }
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
      materializeCalls.push(snapshotSources.get(key) ?? key);
      return null; // HALT: worker berhenti sebelum langkah berbayar apa pun
    },
  };
  return { storage, materializeCalls, getCalls, putCalls };
}

/** Storage yang benar-benar mewujudkan snapshot privat agar brand gate dan
 * provider boundary dapat ditempuh tanpa storage/jaringan eksternal. */
function storageTerwujud(isi: Map<string, Buffer>) {
  const putCalls: string[] = [];
  const materializeCalls: string[] = [];
  const dir = fs.mkdtempSync(path.join(process.env.STORAGE_DIR!, "c3-materialize-"));
  const snapshotSources = new Map<string, string>();
  installAdmissionManifestFixture = (jobId, images) => buildAdmissionManifestFixture(isi, snapshotSources, jobId, images);
  const storage: MediaStorage = {
    async put(key, body) { putCalls.push(key); isi.set(key, Buffer.from(body)); },
    async delete(key) { isi.delete(key); },
    async get(key) {
      const body = isi.get(key);
      return body ? { body: Buffer.from(body), size: body.length } : null;
    },
    async stat(key) {
      const body = isi.get(key);
      return body ? { size: body.length } : null;
    },
    async materialize(key) {
      materializeCalls.push(snapshotSources.get(key) ?? key);
      const body = isi.get(key);
      if (!body) return null;
      const target = path.join(dir, `${materializeCalls.length}-${path.basename(key)}`);
      fs.writeFileSync(target, body);
      return target;
    },
  };
  return { storage, putCalls, materializeCalls };
}

/**
 * Observer langsung untuk boundary provider. Counter bertambah SEBELUM fake
 * provider melempar, jadi panggilan generate yang gagal sebelum field DB
 * tercatat tetap terlihat oleh test.
 */
function pasangObserverProviderC8() {
  let panggilanGenerate = 0;
  setVideoProvidersForTests([
    {
      name: "pengamat-w2-c8",
      async healthCheck() {
        return true;
      },
      estimateCost() {
        return 0;
      },
      async generate() {
        panggilanGenerate++;
        throw new Error("provider pengamat W2 C8: bukti invalid mencapai boundary provider");
      },
    } as never,
  ]);
  return {
    jumlah: () => panggilanGenerate,
    reset: () => setVideoProvidersForTests(undefined),
  };
}

const userId = uuid();
const intruderId = uuid();
db.prepare("INSERT INTO users (id, phone, email, name, tier, locale, created_at) VALUES (?,?,?,?,?,?,?)").run(
  userId,
  "081200000003",
  `p003-w2-${process.pid}@contoh.test`,
  "Uji P0-03",
  "free",
  "id-ID",
  now()
);
db.prepare("INSERT INTO users (id, phone, email, name, tier, locale, created_at) VALUES (?,?,?,?,?,?,?)").run(
  intruderId, "081200000004", `p003-w2-intruder-${process.pid}@contoh.test`, "Uji P0-03 lain", "free", "id-ID", now()
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
    `INSERT INTO products (id,user_id,source_url,name,price_idr,category,images,raw_meta,
      product_type_token,product_type_confirmed_token,product_type_confirmed_by,product_type_confirmed_at,
      product_type_version,product_type_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(productId, userId, null, "Serum Glow Bright", 85000, "beauty", JSON.stringify(images), null,
    "serum wajah", "serum wajah", userId, "2026-08-27T00:00:00.000Z", 1, "CONFIRMED", now());
  db.prepare("UPDATE products SET category_review_state='CLEAR',category_review_reason=NULL,category_review_version=1 WHERE id=?").run(productId);

  const scriptId = uuid();
  db.prepare(
    `INSERT INTO scripts (id, job_id, product_id, hook_family, emotion, register, segments, caption, hashtags, validation_result, quality_tier, hook_level, approved_by_user_at, edited_by_user, created_at)
     VALUES (?, NULL, ?, 'H1', 'senang', 'bestie', ?, 'caption', '[]', '{}', 'silent_caption', 'normal', ?, 0, ?)`
  ).run(scriptId, productId, JSON.stringify(segmen), now(), now());

  const jobId = uuid();
  const manifestRaw = installAdmissionManifestFixture?.(jobId, images) ?? null;
  const productSnapshot = createJobProductSnapshotRaw({
    name: "Serum Glow Bright", category: "beauty", price_idr: 85_000,
  });
  db.prepare(
    `INSERT INTO jobs (id, user_id, product_id, persona_id, script_id, format, quality_tier, duration_s, approved_reference_manifest, job_product_snapshot, state, created_at, state_changed_at)
     VALUES (?,?,?,NULL,?,'hands_only',?,15,?,?,'QUEUED',?,?)`
  ).run(jobId, userId, productId, scriptId, tier, manifestRaw, productSnapshot, now(), now());
  db.prepare("UPDATE scripts SET job_id = ? WHERE id = ?").run(jobId, scriptId);
  return { jobId, productId };
}

/** Admission HTTP SQLite sungguhan, lalu worker sengaja belum dijalankan. */
async function siapkanJobLewatAdmisi(images: string[]): Promise<{ jobId: string; productId: string }> {
  const productId = uuid();
  db.prepare(
    `INSERT INTO products
      (id,user_id,source_url,name,price_idr,category,images,raw_meta,product_visual_desc,brand_brief,claims,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(productId, userId, null, "Serum Glow Bright", 85000, "beauty", JSON.stringify(images),
    JSON.stringify({ brand: "Merek Awal" }), "BOTOL-AMBER-AWAL", "ARAH-BRAND-AWAL", JSON.stringify(["klaim awal"]), now());
  db.prepare(`UPDATE products SET product_type_token='serum wajah', product_type_confirmed_token='serum wajah',
    product_type_confirmed_by=?, product_type_confirmed_at=?, product_type_version=1, product_type_state='CONFIRMED'
    WHERE id=?`).run(userId, now(), productId);
  db.prepare("UPDATE products SET category_review_state='CLEAR',category_review_reason=NULL,category_review_version=1 WHERE id=?").run(productId);
  const scriptId = uuid();
  db.prepare(
    `INSERT INTO scripts
      (id,job_id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,hook_level,approved_by_user_at,edited_by_user,created_at)
     VALUES (?,NULL,?,'H1','senang','bestie',?,'caption','[]','{}','high_quality','normal',?,0,?)`
  ).run(scriptId, productId, JSON.stringify(segmen), now(), now());
  db.prepare("INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES (?,?,50000,'bonus',?)")
    .run(uuid(), userId, now());
  const { issueToken } = await import("../lib/auth");
  const { POST } = await import("../app/api/jobs/route");
  const token = await issueToken(userId, "081200000003");
  const response = await POST(new Request("http://localhost/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `racun_token=${encodeURIComponent(token)}` },
    body: JSON.stringify({ script_id: scriptId, format: "hands_only", quality_tier: "high_quality", duration_s: 15 }),
  }));
  if (response.status !== 201) assert.fail(`admission SQLite gagal (${response.status}): ${await response.text()}`);
  const body = await response.json() as { job_id: string };
  return { jobId: body.job_id, productId };
}

async function siapkanStoryAdsW2(image: string, snapshotRaw: string): Promise<{ jobId: string; productId: string }> {
  const productId = uuid();
  db.prepare(
    `INSERT INTO products (id,user_id,name,price_idr,category,images,raw_meta,
      product_type_token,product_type_confirmed_token,product_type_confirmed_by,product_type_confirmed_at,
      product_type_version,product_type_state,created_at)
     VALUES (?,?,?,189000,'jasa',?,'{}',?,?,?,?,?,?,?)`
  ).run(productId, userId, "Jasa Uji Snapshot", JSON.stringify([image]),
    "jasa", "jasa", userId, "2026-08-27T00:00:00.000Z", 1, "CONFIRMED", now());
  db.prepare("UPDATE products SET category_review_state='CLEAR',category_review_reason=NULL,category_review_version=1 WHERE id=?").run(productId);
  const { generateScripts } = await import("../lib/script-engine");
  const [script] = await generateScripts({
    product: { id: productId, name: "Jasa Uji Snapshot", price_idr: 189000, category: "jasa" },
    register: "netral", qualityTier: "silent_caption", durationSec: 15,
    contentType: "ads", templateId: "ads-meja-kosong", count: 1, tanpaLlm: true,
  });
  const scriptId = uuid();
  const validationResult = JSON.stringify({
    ...script.validation,
    admisi: { contentType: "ads", format: "ads", durationSec: 15, templateId: "ads-meja-kosong", productCategory: "jasa" },
  });
  db.prepare(
    `INSERT INTO scripts (id,job_id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,hook_level,approved_by_user_at,edited_by_user,created_at)
     VALUES (?,NULL,?,'H8','penasaran','netral',?,'caption','[]',?,'silent_caption','agak_gila',?,0,?)`
  ).run(scriptId, productId, JSON.stringify(script.segments), validationResult, now(), now());
  const jobId = uuid();
  const manifestRaw = installAdmissionManifestFixture?.(jobId, [image]) ?? null;
  db.prepare(
    `INSERT INTO jobs (id,user_id,product_id,persona_id,script_id,format,quality_tier,duration_s,approved_reference_manifest,job_product_snapshot,state,created_at,state_changed_at)
     VALUES (?,?,?,NULL,?,'ads','silent_caption',15,?,?,'QUEUED',?,?)`
  ).run(jobId, userId, productId, scriptId, manifestRaw, snapshotRaw, now(), now());
  db.prepare("UPDATE scripts SET job_id=? WHERE id=?").run(jobId, scriptId);
  return { jobId, productId };
}

async function patchProdukRetail(productId: string, user: string, phone: string, body: Record<string, unknown>) {
  const { issueToken, cookieName } = await import("../lib/auth");
  const token = await issueToken(user, phone);
  return patchRetailProduct(new Request(`http://localhost/api/products/${productId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: `${cookieName()}=${encodeURIComponent(token)}` },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: productId }) });
}

const jumlah = (sql: string, ...args: unknown[]) =>
  (db.prepare(sql).get(...(args as [])) as { n: number }).n;

// --------------------------------------------------------- P0-T43 C3 / W2

test("W2 C3: mismatch eksplisit pada referensi kedua memakai brand admission dan gagal sebelum provider", async () => {
  const rel1 = "uploads/w2-c3/0.webp";
  const rel2 = "uploads/w2-c3/1.webp";
  const cocok = Buffer.from("W2-C3-MEREK-COCOK");
  const salah = Buffer.from("W2-C3-MEREK-SALAH");
  const isi = new Map<string, Buffer>([
    [rel1, cocok], [`${rel1}.meta.json`, sidecar(cocok, true)],
    [rel2, salah], [`${rel2}.meta.json`, sidecar(salah, true)],
  ]);
  const storage = storageTerwujud(isi);
  setMediaStorageForTests(storage.storage);
  const { jobId, productId } = siapkanJob([rel1, rel2], "high_quality");
  const snapshot = createJobProductSnapshotRaw({
    name: "Serum Glow Bright", category: "beauty", price_idr: 85_000,
    raw_meta: JSON.stringify({ brand: "Merek Admission" }),
  });
  db.prepare("UPDATE jobs SET job_product_snapshot=? WHERE id=?").run(snapshot, jobId);
  db.prepare("UPDATE products SET raw_meta=? WHERE id=?")
    .run(JSON.stringify({ brand: "Merek Mutasi" }), productId);

  const brandDilihat: Array<string | null | undefined> = [];
  setPeriksaLabelFotoForTests(async (foto, _nama, brand) => {
    brandDilihat.push(brand);
    const body = fs.readFileSync(foto);
    return {
      terbaca: true, kata: ["Merek", "Produk"], cocokNama: true,
      cocokMerek: !body.equals(salah),
      alasan: body.equals(salah) ? "merek referensi kedua tidak cocok" : undefined,
    };
  });
  const provider = pasangObserverProviderC8();

  try {
    await assert.rejects(
      processJob(jobId, { retryViaQueue: true }),
      (error: unknown) => {
        const actual = error as { body?: { code?: string; retryable?: boolean } };
        assert.equal(actual.body?.code, "BRAND_MISMATCH");
        assert.equal(actual.body?.retryable, false);
        return true;
      },
    );
    assert.equal(provider.jumlah(), 0, "mismatch referensi kedua mencapai provider");
    assert.deepEqual(brandDilihat, ["Merek Admission", "Merek Admission"],
      "worker membaca brand row produk mutable atau berhenti setelah referensi pertama");

    brandDilihat.length = 0;
    await processJob(jobId);
    assert.equal(provider.jumlah(), 0, "retry mismatch mencapai provider");
    assertNolEfekSamping(jobId, storage, "W2 C3 mismatch");
    const row = db.prepare("SELECT state,job_product_snapshot FROM jobs WHERE id=?").get(jobId) as { state: string; job_product_snapshot: string };
    assert.ok(["FAILED", "REFUNDED"].includes(row.state));
    assert.equal(row.job_product_snapshot, snapshot, "snapshot brand admission ditimpa saat retry");
  } finally {
    provider.reset();
    setPeriksaLabelFotoForTests(undefined);
  }
});

test("W2 C3: brand cocok dan brand null tetap dapat mencapai provider", async () => {
  const providerCalls = new Map<string, number>();
  for (const kontrol of [
    { trustedBrand: "Merek Cocok", cocokMerek: true as const },
    { trustedBrand: null, cocokMerek: null },
  ]) {
    const { trustedBrand, cocokMerek } = kontrol;
    const rel = `uploads/w2-c3-positive/${trustedBrand ?? "null"}.webp`;
    const bytes = Buffer.from(`W2-C3-${trustedBrand ?? "NULL"}`);
    const storage = storageTerwujud(new Map([[rel, bytes], [`${rel}.meta.json`, sidecar(bytes, true)]]));
    setMediaStorageForTests(storage.storage);
    const { jobId } = siapkanJob([rel], "silent_caption");
    db.prepare("UPDATE jobs SET job_product_snapshot=? WHERE id=?").run(createJobProductSnapshotRaw({
      name: "Serum Glow Bright", category: "beauty", price_idr: 85_000,
      raw_meta: trustedBrand ? JSON.stringify({ brand: trustedBrand }) : "{}",
    }), jobId);
    let ocr = 0;
    const callKey = trustedBrand ?? "NO_BRAND";
    setPeriksaLabelFotoForTests(async () => {
      ocr++;
      return { terbaca: cocokMerek !== null, kata: [], cocokNama: true, cocokMerek };
    });
    setVideoProvidersForTests([{
      name: "w2-c3-positive", async healthCheck() { return true; }, estimateCost() { return 0; },
      async generate() {
        providerCalls.set(callKey, (providerCalls.get(callKey) ?? 0) + 1);
        throw new Error(`stop di provider positif W2 C3 ${callKey}=${providerCalls.get(callKey)}`);
      },
    } as never]);
    await processJob(jobId);
    assert.equal(providerCalls.get(callKey), 1, `${trustedBrand}: provider tidak tercapai`);
    assert.equal(ocr, trustedBrand ? 1 : 0, `${trustedBrand}: kebijakan unreadable/null/matching berubah`);
    assertNolEfekSamping(jobId, storage, `W2 C3 positif ${trustedBrand}`);
  }
  setVideoProvidersForTests(undefined);
  setPeriksaLabelFotoForTests(undefined);
});

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
  const outputWrites = spy.putCalls.filter((key) => !key.includes("/approved-references/"));
  assert.equal(outputWrites.length, 0, `${konteks}: worker menulis output ke storage (${JSON.stringify(outputWrites)})`);
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

test("W2 C8 KONTROL: observer provider benar-benar terpasang (asersi nol tidak hampa)", async (t) => {
  // Asersi "nol panggilan provider" hanya bermakna kalau observernya SUNGGUH
  // terdaftar. Kalau `setVideoProvidersForTests` tidak berpengaruh, cacahnya
  // akan selalu 0 dan kedua kasus C8 lulus tanpa menguji apa pun — kelulusan
  // HAMPA. Kontrol ini membuktikan arah sebaliknya: begitu jalur provider
  // BENAR-BENAR dilalui, observer yang sama menaikkan cacahnya.
  const provider = pasangObserverProviderC8();
  t.after(provider.reset);
  const { registeredVideoProviders, generateVideoWithFailover } = await import("../lib/providers/registry");
  assert.deepEqual(
    registeredVideoProviders(),
    ["pengamat-w2-c8"],
    "observer tidak terdaftar di registry — asersi nol pada kedua kasus C8 tidak membuktikan apa pun"
  );
  assert.equal(provider.jumlah(), 0, "cacah bocor sebelum provider dipanggil");
  await assert.rejects(
    () =>
      generateVideoWithFailover(
        {
          jobId: "w2-c8-observer-control",
          width: 720,
          height: 1280,
          shots: [],
          negativePrompt: "added text overlay",
          qualityTier: "silent_caption",
          generateAudio: false,
        },
        os.tmpdir()
      ),
    /provider pengamat W2 C8/,
    "provider pengamat tidak dipanggil walau jalur provider dilalui"
  );
  assert.equal(provider.jumlah(), 1, "observer tidak mencatat panggilan yang nyata-nyata terjadi");
});

test("W2 C8: sidecar KORUP — payload tidak boleh di-materialize sebelum bukti sah", async (t) => {
  const provider = pasangObserverProviderC8();
  t.after(provider.reset);
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
  assert.equal(provider.jumlah(), 0, "W2 C8 korup: provider generate sempat dipanggil");
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

test("W2 C8: sidecar HILANG (bytes ada) — payload tidak boleh di-materialize sebelum bukti sah", async (t) => {
  const provider = pasangObserverProviderC8();
  t.after(provider.reset);
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
  assert.equal(provider.jumlah(), 0, "W2 C8 hilang: provider generate sempat dipanggil");
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

// ------------------------------------------------------------------ W2 / C11

test("W2 C11: sidecar SAH tetapi berkas hilang saat worker mulai — REF_MISSING tanpa efek samping", async (t) => {
  const provider = pasangObserverProviderC8();
  t.after(provider.reset);
  t.after(() => setMediaStorageForTests(undefined));
  resetKanariUntukTest();

  const relFoto = "uploads/w2-c11-hilang/0.webp";
  // Sidecar ini sah dan menunjuk hash PACKSHOT, tetapi bytes utamanya sengaja
  // tidak ada sejak SEBELUM processJob dimulai. Ini membedakan C11 dari C8
  // sidecar-hilang dan dari TOCTOU sesudah resolver.
  const spy = storageSpy(
    new Map<string, Buffer>([[`${relFoto}.meta.json`, sidecar(PACKSHOT, true)]])
  );
  setMediaStorageForTests(spy.storage);

  const { jobId } = siapkanJob([relFoto]);
  await processJob(jobId);

  assert.deepEqual(
    spy.getCalls,
    [],
    "legacy worker membaca ulang sidecar/payload dari row produk mutable"
  );
  assert.deepEqual(spy.materializeCalls, [], "W2 C11: payload hilang tetap dicoba materialize");
  assert.equal(provider.jumlah(), 0, "W2 C11: provider generate sempat dipanggil");
  assertNolEfekSamping(jobId, spy, "W2 C11 REF_MISSING");
  const job = db.prepare("SELECT state FROM jobs WHERE id = ?").get(jobId) as { state: string };
  assert.ok(
    ["FAILED", "REFUNDED"].includes(job.state),
    `W2 C11: job berakhir ${job.state}, bukan terminal gagal-tertutup FAILED/REFUNDED`
  );

  const kanari = ringkasanKanari();
  assert.equal(kanari.dinilai, 0, "legacy worker menjalankan ulang resolver atas products.images");
  assert.equal(kanari.ditolak, 0);
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
  const snapshotSources = new Map<string, string>();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w2-toctou-"));
  setMediaStorageForTests({
    async put(key: string, body: Buffer) {
      putCalls.push(key);
      if (key.includes("/approved-references/")) {
        const source = isi.get(relFoto)?.equals(body) ? relFoto : undefined;
        if (source) snapshotSources.set(key, source);
      }
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
      materializeCalls.push(snapshotSources.get(key) ?? key);
      // Bytes DITUKAR di jendela antara get() dan materialize().
      const abs = path.join(tmp, path.basename(key));
      fs.writeFileSync(abs, Buffer.from("BYTES-DITUKAR-SESUDAH-DISETUJUI"));
      return abs;
    },
  } as never);
  installAdmissionManifestFixture = (jobId, images) => buildAdmissionManifestFixture(isi, snapshotSources, jobId, images);

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
  const snapshotSources = new Map<string, string>();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w2-bersama-"));
  const pathBersama = path.join(tmp, "bersama.webp");
  setMediaStorageForTests({
    async put(key: string, body: Buffer) {
      putCalls.push(key);
      if (key.includes("/approved-references/")) {
        const source = [relSah1, relSah2].find((rel) => isi.get(rel)?.equals(body));
        if (source) snapshotSources.set(key, source);
      }
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
      materializeCalls.push(snapshotSources.get(key) ?? key);
      const body = isi.get(key);
      if (!body) return null;
      fs.writeFileSync(pathBersama, body); // menimpa isi materialize sebelumnya
      return pathBersama;
    },
  } as never);
  installAdmissionManifestFixture = (jobId, images) => buildAdmissionManifestFixture(isi, snapshotSources, jobId, images);

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
test("E3 HTTP PATCH + resume W2: provider tetap menerima snapshot admission", async (t) => {
  if (!punyaPersonSafe()) return t.skip("python/OpenCV/model YuNet tidak ada — jalur hilir tidak bisa ditempuh");
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
  let promptDiterima = "";
  setVideoProvidersForTests([
    {
      name: "pengamat-w2",
      async healthCheck() {
        return true;
      },
      estimateCost() {
        return 0;
      },
      async generate(spec: { shots: { imageRefPath: string; prompt: string }[] }) {
        const p = spec.shots[0]?.imageRefPath;
        if (p && fs.existsSync(p)) utamaDiterima = sha256Uji(fs.readFileSync(p));
        promptDiterima = spec.shots.map((shot) => shot.prompt).join("\n");
        throw new Error("provider pengamat W2: berhenti sebelum biaya keluar");
      },
    } as never,
  ]);

  setPeriksaLabelFotoForTests(async (_path, _name, brand) => ({
    status: "READABLE", evidenceVersion: 1, terbaca: true,
    kata: ["Merek", "Awal"], cocokNama: true, cocokMerek: brand ? true : null,
  }));

  try {
    const { jobId, productId } = await siapkanJobLewatAdmisi([relSah1, relSah2]);
    const productSnapshot = (db.prepare("SELECT job_product_snapshot FROM jobs WHERE id=?").get(jobId) as { job_product_snapshot: string | null }).job_product_snapshot;
    assert.ok(productSnapshot, "admission SQLite wajib memasang snapshot sebelum worker mulai");
    const mutasi = {
      name: "NAMA MUTASI E3",
      price_idr: 72000,
      category: "food",
      product_visual_desc: "DESC-MUTASI-E3",
      brand: "Merek Mutasi E3",
      promo_price_before_idr: 99000,
      promo_ends_at: "2030-01-02T03:04:05.000Z",
      promo_stock_left: 7,
    };
    const forbidden = await patchProdukRetail(productId, intruderId, "081200000004", mutasi);
    assert.equal(forbidden.status, 404, "user lain dapat memutasi produk E3 milik owner");
    const beforeOwner = db.prepare("SELECT name FROM products WHERE id=?").get(productId) as { name: string };
    assert.equal(beforeOwner.name, "Serum Glow Bright", "PATCH intruder mengubah row sebelum owner bertindak");

    const response = await patchProdukRetail(productId, userId, "081200000003", mutasi);
    if (response.status !== 200) assert.fail(`PATCH E3 gagal (${response.status}): ${await response.text()}`);
    const responseBody = await response.json() as Record<string, unknown>;
    assert.equal(responseBody.ok, true);
    assert.equal(responseBody.product_id, productId);
    assert.equal(responseBody.name, mutasi.name);
    assert.equal(responseBody.price_idr, mutasi.price_idr);
    assert.equal(responseBody.category, mutasi.category);
    assert.equal(responseBody.product_type, "serum wajah");
    assert.deepEqual(responseBody.product_type_confirmation, {
      state: "CONFIRMED", actor_id: userId,
      confirmed_at: (db.prepare("SELECT product_type_confirmed_at FROM products WHERE id=?").get(productId) as { product_type_confirmed_at: string }).product_type_confirmed_at,
      version: 1, provenance: "USER_SELF_ASSERTION",
    }, "response E3 tidak membawa provenance confirmation terotorisasi");
    const current = db.prepare(
      "SELECT name,price_idr,category,product_visual_desc,brand_brief,claims,raw_meta,promo_price_before_idr,promo_ends_at,promo_stock_left FROM products WHERE id=?"
    ).get(productId) as {
      name: string; price_idr: number; category: string; product_visual_desc: string | null;
      brand_brief: string | null; claims: string | null; raw_meta: string | null;
      promo_price_before_idr: number | null; promo_ends_at: string | null; promo_stock_left: number | null;
    };
    assert.equal(current.name, mutasi.name); assert.equal(current.category, mutasi.category); assert.equal(current.price_idr, mutasi.price_idr);
    assert.equal(current.product_visual_desc, mutasi.product_visual_desc);
    assert.equal((JSON.parse(current.raw_meta ?? "{}") as { brand?: string }).brand, mutasi.brand);
    assert.equal(current.promo_price_before_idr, mutasi.promo_price_before_idr);
    assert.equal(current.promo_ends_at, mutasi.promo_ends_at); assert.equal(current.promo_stock_left, mutasi.promo_stock_left);
    const admission = parseJobProductSnapshot(productSnapshot);
    assert.deepEqual(admission, {
      version: 3, productName: "Serum Glow Bright", category: "beauty", priceIdr: 85_000,
      promoPriceBeforeIdr: null, promoEndsAt: null, promoStockLeft: null,
      trustedBrand: { source: "products.raw_meta.brand", value: "Merek Awal" },
      productVisualDesc: "BOTOL-AMBER-AWAL", brandBrief: "ARAH-BRAND-AWAL", claims: ["klaim awal"],
    });
    const rereadNow = parseJobProductSnapshot(createJobProductSnapshotRaw(current));
    assert.notDeepEqual(rereadNow, admission, "counterexample gagal: re-read produk kini sama dengan snapshot admission");
    assert.equal(rereadNow.productName, mutasi.name); assert.equal(rereadNow.category, mutasi.category); assert.equal(rereadNow.priceIdr, mutasi.price_idr);
    assert.equal(rereadNow.trustedBrand.value, mutasi.brand); assert.equal(rereadNow.productVisualDesc, mutasi.product_visual_desc);
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
    assert.match(promptDiterima, /Serum Glow Bright/);
    assert.match(promptDiterima, /BOTOL-AMBER-AWAL/);
    assert.match(promptDiterima, /ARAH-BRAND-AWAL/);
    assert.doesNotMatch(promptDiterima, /NAMA MUTASI E3|DESC-MUTASI-E3/);
    const durableProduct = (db.prepare("SELECT job_product_snapshot FROM jobs WHERE id=?").get(jobId) as { job_product_snapshot: string }).job_product_snapshot;
    assert.equal(durableProduct, productSnapshot, "worker W2 menimpa snapshot dari produk E3 mutasi");
  } finally {
    setVideoProvidersForTests(undefined);
    setPeriksaLabelFotoForTests(undefined);
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
  installAdmissionManifestFixture = (jobId, images) => buildAdmissionManifestFixture(isi, new Map(), jobId, images);

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

test("W2 A6/C9: manifest lama menang atas reorder/delete/add products.images", async () => {
  const approvedRel = "uploads/w2-manifest/approved.webp";
  const currentRel = "uploads/w2-manifest/current.webp";
  const approvedBytes = Buffer.from("APPROVED-IMMUTABLE-W2");
  const currentBytes = Buffer.from("CURRENT-NOT-APPROVED-W2");
  const snapshotRel = `jobs/w2-manifest-fixture/approved-references/0-approved.webp`;
  const spy = storageSpy(new Map<string, Buffer>([
    [approvedRel, approvedBytes],
    [snapshotRel, approvedBytes],
    [currentRel, currentBytes],
    [`${currentRel}.meta.json`, sidecar(currentBytes, true)],
  ]));
  setMediaStorageForTests(spy.storage);
  const { jobId } = siapkanJob([currentRel]);
  const raw = JSON.stringify({
    version: 2,
    references: [{ rel: approvedRel, sha256: sha(approvedBytes), versiBukti: 1, labelOcrStatus: "READABLE", labelOcrVersion: 1, snapshotRel }],
  });
  db.prepare("UPDATE jobs SET approved_reference_manifest=? WHERE id=?").run(raw, jobId);

  await processJob(jobId);

  assert.deepEqual(spy.materializeCalls, [snapshotRel], "W2 tidak memakai snapshot durable manifest");
  assert.deepEqual(spy.getCalls, [], "W2 membaca sidecar/list terkini walau manifest durable sudah ada");
  const saved = db.prepare("SELECT approved_reference_manifest FROM jobs WHERE id=?").get(jobId) as { approved_reference_manifest: string };
  assert.equal(saved.approved_reference_manifest, raw, "manifest immutable ditimpa saat resume");
  assertNolEfekSamping(jobId, spy, "W2 manifest reuse");
});

test("W2 legacy: jejak provider tanpa manifest tidak boleh diam-diam resnapshot", async () => {
  const rel = "uploads/w2-legacy/0.webp";
  const bytes = Buffer.from("LEGACY-W2");
  const spy = storageSpy(new Map<string, Buffer>([[rel, bytes], [`${rel}.meta.json`, sidecar(bytes, true)]]));
  setMediaStorageForTests(spy.storage);
  const { jobId } = siapkanJob([rel]);
  db.prepare("UPDATE jobs SET provider_video='legacy-provider',approved_reference_manifest=NULL WHERE id=?").run(jobId);

  await processJob(jobId);

  assert.deepEqual(spy.materializeCalls, [], "legacy unsafe mencapai materialize/provider");
  const row = db.prepare("SELECT approved_reference_manifest,job_product_snapshot,state FROM jobs WHERE id=?").get(jobId) as { approved_reference_manifest: string | null; job_product_snapshot: string | null; state: string };
  assert.equal(row.approved_reference_manifest, null);
  assert.ok(row.job_product_snapshot);
  assert.ok(["FAILED", "REFUNDED"].includes(row.state));
  const audits = db.prepare("SELECT meta FROM audit_log WHERE entity_id=? AND action='job.transition'").all(jobId) as { meta: string }[];
  assert.ok(audits.some((entry) => entry.meta.includes("REF_MANIFEST_LEGACY_UNSAFE")), "audit kehilangan reason legacy manifest");
});

test("W2 product snapshot missing gagal tertutup dan audit menyimpan canonical reason", async () => {
  const rel = "uploads/w2-product-snapshot-invalid/0.webp";
  const bytes = Buffer.from("INVALID-SNAPSHOT-W2");
  const spy = storageSpy(new Map<string, Buffer>([[rel, bytes], [`${rel}.meta.json`, sidecar(bytes, true)]]));
  setMediaStorageForTests(spy.storage);
  const { jobId } = siapkanJob([rel]);
  db.prepare("UPDATE jobs SET job_product_snapshot=NULL WHERE id=?").run(jobId);

  await processJob(jobId);

  assert.deepEqual(spy.materializeCalls, []);
  assertNolEfekSamping(jobId, spy, "W2 product snapshot missing");
  const audits = db.prepare("SELECT meta FROM audit_log WHERE entity_id=? AND action='job.transition'").all(jobId) as { meta: string }[];
  assert.ok(audits.some((entry) => entry.meta.includes("PRODUCT_SNAPSHOT_LEGACY_UNSAFE")), "audit kehilangan reason legacy product snapshot");
});

test("W2 non-Ads snapshot v1 dikarantina sebelum reference boundary dan tidak ditimpa", async () => {
  const rel = "uploads/w2-affiliate-snapshot-v1/0.webp";
  const bytes = Buffer.from("AFFILIATE-SNAPSHOT-V1-W2");
  const spy = storageSpy(new Map<string, Buffer>([[rel, bytes], [`${rel}.meta.json`, sidecar(bytes, true)]]));
  setMediaStorageForTests(spy.storage);
  const { jobId } = siapkanJob([rel]);
  const legacyRaw = JSON.stringify({
    version: 1, productName: "Serum Glow Bright", category: "beauty",
    trustedBrand: { source: "products.raw_meta.brand", value: null },
    productVisualDesc: null, brandBrief: null, claims: [],
  });
  db.prepare("UPDATE jobs SET job_product_snapshot=? WHERE id=?").run(legacyRaw, jobId);

  await processJob(jobId);

  assert.deepEqual(spy.materializeCalls, [], "snapshot v1 mencapai reference boundary");
  const durable = (db.prepare("SELECT job_product_snapshot FROM jobs WHERE id=?").get(jobId) as { job_product_snapshot: string }).job_product_snapshot;
  assert.equal(durable, legacyRaw, "worker menimpa snapshot v1 durable dengan row produk mutable");
  assertNolEfekSamping(jobId, spy, "W2 legacy snapshot v1");
});

test("W2 Story Ads SA6 memakai name/category/price snapshot admission setelah row produk dimutasi", async () => {
  const rel = "uploads/w2-story-ads-snapshot/0.webp";
  const bytes = Buffer.from("STORY-ADS-SNAPSHOT-W2");
  const spy = storageSpy(new Map<string, Buffer>([[rel, bytes], [`${rel}.meta.json`, sidecar(bytes, true)]]));
  setMediaStorageForTests(spy.storage);
  const snapshotRaw = createJobProductSnapshotRaw({
    name: "Jasa Uji Snapshot", category: "jasa", price_idr: 189_000, raw_meta: "{}",
  });
  const { jobId, productId } = await siapkanStoryAdsW2(rel, snapshotRaw);
  db.prepare("UPDATE products SET name='MUTASI SA6 W2',category='food',price_idr=73000 WHERE id=?").run(productId);

  let providerCalls = 0;
  setVideoProvidersForTests([{
    name: "story-ads-snapshot-observer-w2",
    async healthCheck() { return true; },
    estimateCost() { return 0; },
    async generate() {
      providerCalls++;
      throw new Error("observer stop sebelum biaya keluar");
    },
  } as never]);

  try {
    await processJob(jobId);
    assert.ok(spy.materializeCalls.length > 0,
      "Story Ads W2 berhenti sebelum reference boundary: SA6 kemungkinan membaca name/category/price row mutasi");
    assert.equal(providerCalls, 0, "fixture harus berhenti di materialize sebelum provider");
    assert.deepEqual(parseJobProductSnapshot(snapshotRaw), {
      version: 3, productName: "Jasa Uji Snapshot", category: "jasa", priceIdr: 189_000,
      promoPriceBeforeIdr: null, promoEndsAt: null, promoStockLeft: null,
      trustedBrand: { source: "products.raw_meta.brand", value: null }, productVisualDesc: null, brandBrief: null, claims: [],
    });
    const durable = (db.prepare("SELECT job_product_snapshot FROM jobs WHERE id=?").get(jobId) as { job_product_snapshot: string }).job_product_snapshot;
    assert.equal(durable, snapshotRaw, "worker W2 menimpa snapshot admission dengan row produk mutasi");
  } finally {
    setVideoProvidersForTests(undefined);
  }
});

test("W2 Story Ads snapshot legacy tanpa price gagal tertutup sebelum referensi/provider", async () => {
  const rel = "uploads/w2-story-ads-legacy-price/0.webp";
  const bytes = Buffer.from("STORY-ADS-LEGACY-PRICE-W2");
  const spy = storageSpy(new Map<string, Buffer>([[rel, bytes], [`${rel}.meta.json`, sidecar(bytes, true)]]));
  setMediaStorageForTests(spy.storage);
  const legacyRaw = JSON.stringify({
    version: 1, productName: "Jasa Uji Snapshot", category: "jasa",
    trustedBrand: { source: "products.raw_meta.brand", value: null }, productVisualDesc: null, brandBrief: null, claims: [],
  });
  const { jobId } = await siapkanStoryAdsW2(rel, legacyRaw);
  let providerCalls = 0;
  setVideoProvidersForTests([{
    name: "legacy-price-must-not-run-w2", async healthCheck() { return true; }, estimateCost() { return 0; },
    async generate() { providerCalls++; throw new Error("provider tidak boleh dipanggil"); },
  } as never]);

  try {
    await processJob(jobId);
    assert.equal(providerCalls, 0);
    assert.deepEqual(spy.getCalls, [], "legacy missing-price membaca bukti sebelum ditolak");
    assert.deepEqual(spy.materializeCalls, [], "legacy missing-price mencapai materialize");
    assertNolEfekSamping(jobId, spy, "W2 Story Ads legacy missing price");
  } finally {
    setVideoProvidersForTests(undefined);
  }
});

test("W2 C10: product type quarantine berhenti sebelum materialize/provider/capture", async () => {
  const rel = "uploads/w2-c10-type/0.webp";
  const bytes = Buffer.from("W2-C10-CONFIRMED-THEN-QUARANTINED");
  const spy = storageSpy(new Map<string, Buffer>([[rel, bytes], [`${rel}.meta.json`, sidecar(bytes, true)]]));
  setMediaStorageForTests(spy.storage);
  const { jobId, productId } = siapkanJob([rel]);
  db.prepare("UPDATE products SET product_type_state='QUARANTINED' WHERE id=?").run(productId);
  const provider = pasangObserverProviderC8();
  try {
    await processJob(jobId);
    assert.equal(provider.jumlah(), 0);
    assert.deepEqual(spy.materializeCalls, []);
    assertNolEfekSamping(jobId, spy, "W2 C10 product type quarantine");
    const audits = db.prepare("SELECT meta FROM audit_log WHERE entity_id=? AND action='job.transition'").all(jobId) as { meta: string }[];
    assert.ok(audits.some((entry) => entry.meta.includes("PRODUCT_TYPE_CONFIRMATION_REQUIRED")),
      "audit W2 kehilangan canonical product-type reason");
  } finally {
    provider.reset();
  }
});

test("W2 C5 quarantine has zero effects, then exact Founder release reaches provider",async()=>{
  const rel="uploads/w2-c5/0.webp";
  const bytes=Buffer.from("W2-C5-RELEASE");
  const spy=storageTerwujud(new Map<string,Buffer>([[rel,bytes],[`${rel}.meta.json`,sidecar(bytes,true)]]));
  setMediaStorageForTests(spy.storage);
  const blocked=siapkanJob([rel]);
  db.prepare(`UPDATE products SET category_review_state='QUARANTINED',category_review_reason='CATEGORY_UNKNOWN',
    category_reviewed_by=NULL,category_reviewed_role=NULL,category_reviewed_at=NULL,category_review_version=1 WHERE id=?`)
    .run(blocked.productId);
  const provider=pasangObserverProviderC8();
  try {
    await processJob(blocked.jobId);
    assert.equal(provider.jumlah(),0); assert.deepEqual(spy.materializeCalls,[]);
    assertNolEfekSamping(blocked.jobId,spy,"W2 C5 quarantine");

    const released=siapkanJob([rel]);
    db.prepare(`UPDATE products SET category_review_state='CLEAR',category_review_reason=NULL,
      category_reviewed_by='founder-1',category_reviewed_role='Founder/CEO',category_reviewed_at=?,
      category_review_version=2 WHERE id=?`).run("2026-08-27T20:00:00.000Z",released.productId);
    await processJob(released.jobId);
    const releasedState=db.prepare("SELECT state FROM jobs WHERE id=?").get(released.jobId) as {state:string};
    const releasedAudits=db.prepare("SELECT meta FROM audit_log WHERE entity_id=? ORDER BY created_at").all(released.jobId) as {meta:string}[];
    assert.equal(provider.jumlah(),1,`W2 did not admit exact Founder-released product: ${releasedState.state} ${JSON.stringify(releasedAudits)}`);
    assert.ok(spy.materializeCalls.length>0,"W2 released control never reached immutable materialization");
    assertNolEfekSamping(released.jobId,spy,"W2 C5 released control halted at observer");
  } finally { provider.reset(); }
});

after(() => {
  setMediaStorageForTests(undefined);
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
  fs.rmSync(BIN_KOSONG, { recursive: true, force: true });
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${process.env.DB_PATH}${suffix}`, { force: true });
});

// ---------------------------------------------------------------------------
// P0-B4 — KANARI DI BATAS WORKER
//
// Kanari hanya berguna kalau ia benar-benar menyala di tempat vonisnya diambil,
// dan hanya AMAN kalau ia tidak mengubah vonis itu. Dua-duanya diperiksa di
// sini lewat worker sungguhan, bukan lewat pemanggilan modul langsung.
// ---------------------------------------------------------------------------

test("W2 legacy quarantine tidak menjalankan ulang resolver/kanari dari products.images", async () => {
  resetKanariUntukTest();
  const relFoto = "uploads/w2-kanari-tolak/0.webp";
  const spy = storageSpy(new Map<string, Buffer>([[relFoto, PACKSHOT]])); // sidecar HILANG
  setMediaStorageForTests(spy.storage);

  const { jobId } = siapkanJob([relFoto]);
  await processJob(jobId);

  // 1. Vonis tidak berubah: gagal-tertutup, nol efek samping, nol materialize.
  assertNolEfekSamping(jobId, spy, "W2 kanari tolak");
  assert.deepEqual(spy.materializeCalls, [], "kanari membuat worker mengambil bytes lebih dulu");
  const job = db.prepare("SELECT state FROM jobs WHERE id = ?").get(jobId) as { state: string };
  assert.ok(["FAILED", "REFUNDED"].includes(job.state), `vonis berubah gara-gara kanari: ${job.state}`);

  // Resolver/kanari belongs to admission. Legacy worker classification is
  // read-only and must not inspect mutable product bytes again.
  const r = ringkasanKanari();
  assert.equal(r.dinilai, 0);
  assert.equal(r.ditolak, 0);
  assert.equal(r.lolos, 0);
  assert.deepEqual(spy.getCalls, []);
});

test("W2 current manifest tidak menjalankan ulang resolver/kanari dari products.images", async () => {
  resetKanariUntukTest();
  const relFoto = "uploads/w2-kanari-lolos/0.webp";
  const isi = new Map<string, Buffer>([[relFoto, PACKSHOT], [`${relFoto}.meta.json`, sidecar(PACKSHOT, true)]]);
  const spy = storageSpy(isi);
  setMediaStorageForTests(spy.storage);

  const { jobId } = siapkanJob([relFoto]);
  await processJob(jobId);

  const r = ringkasanKanari();
  assert.equal(r.dinilai, 0);
  assert.equal(r.lolos, 0);
  assert.equal(r.ditolak, 0);
  assert.deepEqual(spy.getCalls, [], "worker membaca ulang sidecar produk walau manifest current ada");
});

test("W2 KANARI: galat yang dilempar worker membawa kode, bukan hanya kalimat", () => {
  // Kontrak tipe, diuji langsung: selama alasan hanya ada di dalam pesan,
  // satu-satunya cara menghitungnya adalah mencocokkan teks.
  const e = new GagalTanpaReferensi("pesan untuk manusia", {
    utama: null,
    tersetujui: [],
    ditolak: [{ rel: "x.webp", alasan: ALASAN_TOLAK.PROMOSI, pesan: "banner" }],
  });
  assert.ok(e instanceof Error, "pencatat kegagalan lama memperlakukan galat worker sebagai Error");
  assert.equal(e.message, "pesan untuk manusia");
  assert.equal(e.kode, KODE_KANARI.TANPA_REFERENSI);
  assert.deepEqual(e.rincian, [{ rel: "x.webp", alasan: ALASAN_TOLAK.PROMOSI }]);
});
