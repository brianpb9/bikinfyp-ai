/**
 * P0-B4b — W1 (`lib/postgres/worker.ts`) DIJALANKAN, bukan dibaca.
 *
 * KENAPA INI PRASYARAT, BUKAN UTANG. Sepanjang gelombang P0-A, gerbang statis
 * untuk W1 ditembus TIGA RONDE BERTURUT-TURUT oleh bentuk sintaksis baru:
 * `hasil.ditolak[0].rel` (ronde 4), pencucian lewat `const [ref] = images`
 * (ronde 3), lalu `hasil.utama ? hasil.ditolak[0].rel : hasil.ditolak[0].rel`
 * (ronde 5). Setiap kali gerbangnya ditambal, bentuk berikutnya muncul.
 *
 * Polanya bukan kebetulan: analisis sintaksis tidak bisa MEMBUKTIKAN nilai mana
 * yang mengalir. Ia hanya bisa menolak bentuk yang ia kenali. W2 punya jaring
 * runtime yang tidak peduli bentuk — `tests/product-truth-worker-reference.test.ts`
 * menjalankan `processJob` sungguhan — sementara W1 tidak punya apa pun di
 * bawah gerbang statisnya. W1 adalah jalur PRODUKSI (PostgreSQL + Redis), jadi
 * yang tidak terjaga justru yang benar-benar dipakai.
 *
 * CARA BERHENTI YANG AMAN: storage palsu mengembalikan `null` dari
 * `materialize()`, sehingga worker melempar "Foto produk tidak ditemukan di
 * storage." tepat SEBELUM langkah berbayar mana pun. Yang direkam spy adalah
 * PILIHAN worker — kunci mana yang ia minta lebih dulu.
 *
 * DILEWATI (bukan gagal) kalau `UJI_PG_URL` kosong, mengikuti pola
 * tests/pg-konkurensi-kredit.test.ts. Dijalankan lewat:
 *
 *   npm run test:pg:product-truth
 *
 * yang membuat database disposable per jalan lalu men-drop-nya — konvensi yang
 * sama dengan scripts/test-postgres-jobs.sh. Nol data nyata tersentuh.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";

const URL_UJI = process.env.UJI_PG_URL ?? "";
const lewati = !URL_UJI;

if (!lewati) {
  process.env.DATABASE_URL = URL_UJI;
  process.env.RACUN_DB_RUNTIME = "postgres";
  process.env.RACUN_NO_DOTENV = "1";
  process.env.STORAGE_MODE = "filesystem";
  process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "w1-store-"));
  // runProviderPipeline MENOLAK provider "mock" secara eksplisit; nilai nyata
  // dipasang supaya jalurnya terbuka. Provider tidak pernah benar-benar
  // dipanggil — worker berhenti di materialize, dan itu diasersi.
  process.env.PROVIDER_VIDEO = "byteplus";
  // Jangan sampai jalur fixture deterministik yang jalan; yang diuji di sini
  // justru runProviderPipeline.
  delete process.env.RACUN_WORKER_DETERMINISTIC;
}

// Nol jaringan: setiap fetch dihitung DAN dilempar.
let panggilanJaringan = 0;
const fetchAsli = globalThis.fetch;
globalThis.fetch = (async (...args: unknown[]) => {
  panggilanJaringan++;
  throw new Error(`W1 tidak boleh menyentuh jaringan di test ini: ${String(args[0])}`);
}) as unknown as typeof fetch;

let pool: Pool;
const at = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

const BANNER = Buffer.from("BYTES-BANNER-PROMO-W1");
const PACKSHOT = Buffer.from("BYTES-PACKSHOT-SAH-W1");
const PACKSHOT2 = Buffer.from("BYTES-PACKSHOT-KEDUA-W1");

function sidecar(bytes: Buffer, layak: boolean): Buffer {
  return Buffer.from(
    JSON.stringify({
      sha256: sha256(bytes),
      jenis: layak ? "product_photo" : "promotional_graphic",
      layakReferensi: layak,
      rasioAreaTeks: layak ? 0.004 : 0.21,
      jumlahKata: layak ? 2 : 15,
      alasan: layak ? "foto produk" : "materi promosi",
      versiBukti: 1,
    })
  );
}

/** Storage palsu yang mencatat SETIAP materialize dan selalu mengembalikan null. */
function storageSpy(isi: Map<string, Buffer>) {
  const materializeCalls: string[] = [];
  const putCalls: string[] = [];
  return {
    materializeCalls,
    putCalls,
    storage: {
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
        return null; // HALT sebelum langkah berbayar apa pun
      },
    },
  };
}

let userId = "";

before(async () => {
  if (lewati) return;
  pool = new Pool({ connectionString: URL_UJI, max: 5 });
  userId = uid();
  await pool.query(
    "INSERT INTO users (id, phone, email, name, tier, locale, created_at) VALUES ($1,$2,$3,$4,'free','id-ID',$5)",
    [userId, "081200000091", `w1-${process.pid}@contoh.test`, "Uji W1", at()]
  );
});

after(async () => {
  globalThis.fetch = fetchAsli;
  if (lewati) return;
  const { setMediaStorageForTests } = await import("../lib/storage");
  setMediaStorageForTests(undefined);
  if (pool) await pool.end();
  const { closePool } = await import("../lib/postgres/pool");
  await closePool?.();
  if (process.env.STORAGE_DIR) fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });
});

const segmen = [
  { role: "hook", start: 0, end: 3, text: "Say, masa 85 ribu segini sih?", visual_direction: "x" },
  { role: "demo", start: 3, end: 10, text: "nah, teksturnya niat banget deh", visual_direction: "x" },
  { role: "cta", start: 10, end: 15, text: "linknya di keranjang kuning ya", visual_direction: "x" },
];

/** Satu produk + skrip + job QUEUED yang siap diproses W1. */
async function siapkanJob(images: string[], tier = "silent_caption"): Promise<string> {
  const pid = uid(), sid = uid(), jid = uid(), t = at();
  await pool.query(
    "INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ($1,$2,'Serum Glow Bright',85000,'beauty',$3,$4)",
    [pid, userId, JSON.stringify(images), t]
  );
  await pool.query(
    "INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,created_at) VALUES ($1,$2,'H1','senang','bestie',$3,'caption','[]','{}',$4)",
    [sid, pid, JSON.stringify(segmen), t]
  );
  await pool.query(
    "INSERT INTO jobs (id,user_id,product_id,script_id,format,quality_tier,duration_s,state,created_at,state_changed_at) VALUES ($1,$2,$3,$4,'hands_only',$5,15,'QUEUED',$6,$6)",
    [jid, userId, pid, sid, tier, t]
  );
  await pool.query("UPDATE scripts SET job_id=$1 WHERE id=$2", [jid, sid]);
  return jid;
}

const hitung = async (sql: string, args: unknown[]) =>
  Number((await pool.query(sql, args)).rows[0].n);

/**
 * NOL EFEK SAMPING PADA JOB YANG SAMA.
 *
 * Dipanggil SEBELUM asersi pilihan referensi, supaya pemeriksaan uang tetap
 * berjalan walau asersi referensinya gagal — kebocoran uang temuan yang lebih
 * mahal daripada pilihan referensi yang salah.
 *
 * `release`/refund SENGAJA tidak dilarang: job yang gagal wajib boleh
 * mengembalikan hold-nya.
 */
async function assertNolEfekSamping(jobId: string, putCalls: string[], konteks: string) {
  assert.equal(
    await hitung("SELECT COUNT(*)::int AS n FROM outputs WHERE job_id=$1", [jobId]),
    0,
    `${konteks}: ada deliverable padahal worker berhenti`
  );
  for (const tipe of ["capture", "regen"]) {
    assert.equal(
      await hitung("SELECT COUNT(*)::int AS n FROM credit_ledger WHERE job_id=$1 AND type=$2", [jobId, tipe]),
      0,
      `${konteks}: ada credit_ledger '${tipe}' — uang diambil tanpa deliverable`
    );
  }
  const job = (await pool.query(
    "SELECT state, provider_video, provider_voice, output_url, cost_actual_idr FROM jobs WHERE id=$1",
    [jobId]
  )).rows[0];
  assert.equal(job.provider_video, null, `${konteks}: provider_video tercatat — ada panggilan provider`);
  assert.equal(job.provider_voice, null, `${konteks}: provider_voice tercatat`);
  assert.equal(job.output_url, null, `${konteks}: output_url terisi padahal worker berhenti`);
  assert.equal(Number(job.cost_actual_idr ?? 0), 0, `${konteks}: cost_actual_idr bukan 0`);
  assert.deepEqual(putCalls, [], `${konteks}: worker menulis ke storage`);
  assert.equal(panggilanJaringan, 0, `${konteks}: ada panggilan fetch`);
}

async function jalankan(jobId: string, isi: Map<string, Buffer>) {
  const { setMediaStorageForTests } = await import("../lib/storage");
  const spy = storageSpy(isi);
  setMediaStorageForTests(spy.storage as never);
  const { processPostgresJob } = await import("../lib/postgres/worker");
  await processPostgresJob(jobId);
  return spy;
}

// ------------------------------------------------------------------- C1

test("W1 C1: foto#1 banner + foto#2 packshot — yang di-materialize foto#2, dengan sha256-nya", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  const relBanner = `uploads/w1-c1-${process.pid}/0.webp`;
  const relPackshot = `uploads/w1-c1-${process.pid}/1.webp`;
  const isi = new Map<string, Buffer>([
    [relBanner, BANNER],
    [`${relBanner}.meta.json`, sidecar(BANNER, false)],
    [relPackshot, PACKSHOT],
    [`${relPackshot}.meta.json`, sidecar(PACKSHOT, true)],
  ]);
  const jobId = await siapkanJob([relBanner, relPackshot]);
  const spy = await jalankan(jobId, isi);

  await assertNolEfekSamping(jobId, spy.putCalls, "W1 C1");
  assert.equal(
    spy.materializeCalls[0],
    relPackshot,
    `W1 memilih referensi utama YANG SALAH.\n` +
      `  diminta worker : ${spy.materializeCalls[0]}\n` +
      `  seharusnya     : ${relPackshot}  (packshot, sidecar sah)\n` +
      `  seluruh urutan : ${JSON.stringify(spy.materializeCalls)}`
  );

  // sha256 yang SAMPAI KE INPUT PROVIDER wajib sha256 foto#2. Kunci yang
  // di-materialize itulah yang dibaca provider, jadi memverifikasi isinya
  // memverifikasi bahan yang benar-benar dikirim — bukan sekadar namanya.
  const bytesTerpilih = isi.get(spy.materializeCalls[0]!)!;
  assert.equal(
    sha256(bytesTerpilih),
    sha256(PACKSHOT),
    "bytes yang dipilih worker bukan bytes packshot yang buktinya sah"
  );
  assert.notEqual(sha256(bytesTerpilih), sha256(BANNER), "worker mengambil bytes BANNER");
});

// ------------------------------------------------------------------- C8

for (const [judul, buatIsi] of [
  [
    "sidecar KORUP",
    (rel: string) => new Map<string, Buffer>([[rel, PACKSHOT], [`${rel}.meta.json`, Buffer.from('{"sha256": "abc", "jenis":')]]),
  ],
  ["sidecar HILANG", (rel: string) => new Map<string, Buffer>([[rel, PACKSHOT]])],
  [
    "sha256 BEDA dari bytes tersimpan",
    (rel: string) =>
      new Map<string, Buffer>([[rel, Buffer.from("BYTES-DITUKAR")], [`${rel}.meta.json`, sidecar(PACKSHOT, true)]]),
  ],
] as [string, (rel: string) => Map<string, Buffer>][]) {
  test(`W1 C8: ${judul} — nol materialize, gagal-tertutup, nol capture/regen`, async (t) => {
    if (lewati) return t.skip("UJI_PG_URL kosong");
    const rel = `uploads/w1-c8-${process.pid}-${judul.replace(/\W+/g, "")}/0.webp`;
    const jobId = await siapkanJob([rel]);
    const spy = await jalankan(jobId, buatIsi(rel));

    await assertNolEfekSamping(jobId, spy.putCalls, `W1 C8 ${judul}`);
    assert.deepEqual(
      spy.materializeCalls,
      [],
      `EVIDENCE_INVALID: dengan ${judul}, W1 tetap men-materialize payload ` +
        `${JSON.stringify(spy.materializeCalls)}. Worker wajib gagal-tertutup SEBELUM mengambil ` +
        "bytes referensi."
    );
    const state = (await pool.query("SELECT state FROM jobs WHERE id=$1", [jobId])).rows[0].state;
    assert.ok(["FAILED", "REFUNDED"].includes(state), `job dengan ${judul} berakhir ${state}, bukan gagal-tertutup`);
  });
}

// ------------------------------------------------- referensi tambahan

test("W1: referensi TAMBAHAN juga hanya dari daftar tersetujui", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  // Tier bersuara supaya cabang referensi tambahan benar-benar dilewati.
  const dasar = `uploads/w1-extra-${process.pid}`;
  const relBanner = `${dasar}/0.webp`;
  const relSah1 = `${dasar}/1.webp`;
  const relSah2 = `${dasar}/2.webp`;
  const isi = new Map<string, Buffer>([
    [relBanner, BANNER],
    [`${relBanner}.meta.json`, sidecar(BANNER, false)],
    [relSah1, PACKSHOT],
    [`${relSah1}.meta.json`, sidecar(PACKSHOT, true)],
    [relSah2, PACKSHOT2],
    [`${relSah2}.meta.json`, sidecar(PACKSHOT2, true)],
  ]);
  const jobId = await siapkanJob([relBanner, relSah1, relSah2], "high_quality");
  const spy = await jalankan(jobId, isi);

  await assertNolEfekSamping(jobId, spy.putCalls, "W1 extra");
  assert.ok(
    !spy.materializeCalls.includes(relBanner),
    `banner ikut diminta sebagai referensi tambahan: ${JSON.stringify(spy.materializeCalls)}. ` +
      "Foto ke-2 dst juga dikirim ke model sebagai referensi identitas — sama berbahayanya kalau salah."
  );
  assert.equal(spy.materializeCalls[0], relSah1, "referensi utama bukan foto sah pertama");
});

// -------------------------------------------------------- kontrol positif

test("W1 kontrol positif: bukti SAH sampai ke materialize, lalu halt bersih", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  const rel = `uploads/w1-halt-${process.pid}/0.webp`;
  const isi = new Map<string, Buffer>([[rel, PACKSHOT], [`${rel}.meta.json`, sidecar(PACKSHOT, true)]]);
  const jobId = await siapkanJob([rel]);
  const spy = await jalankan(jobId, isi);

  assert.deepEqual(
    spy.materializeCalls,
    [rel],
    "bukti SAH harus sampai ke materialize tepat sekali — kalau ini merah, gerbangnya terlalu KETAT " +
      "(menolak bukti yang sah), bukan terlalu longgar"
  );
  await assertNolEfekSamping(jobId, spy.putCalls, "W1 halt");
  const state = (await pool.query("SELECT state FROM jobs WHERE id=$1", [jobId])).rows[0].state;
  assert.ok(["FAILED", "REFUNDED"].includes(state), `job berakhir ${state}`);
});

test("nol jaringan selama seluruh berkas test ini", (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  assert.equal(panggilanJaringan, 0, "ada panggilan fetch — W1 menyentuh jaringan");
});
