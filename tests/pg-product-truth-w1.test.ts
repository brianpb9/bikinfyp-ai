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
 *   npm run test:postgres-product-truth-w1
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
import { execFileSync } from "node:child_process";
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
let tmpMaterialize = "";
const jalurMaterialize = new Map<string, string>();

/**
 * `wujudkan: false` menghentikan worker di referensi utama (dipakai kasus C8,
 * yang memang tidak boleh sampai mana-mana). `wujudkan: true` menuliskan bytes
 * sungguhan supaya eksekusi BERLANJUT — tanpa itu, cabang referensi tambahan
 * tidak pernah dilewati dan asersinya lolos secara VAKUM. Temuan Reviewer.
 */
function storageSpy(isi: Map<string, Buffer>, wujudkan = false) {
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
        if (!wujudkan) return null; // HALT sebelum langkah berbayar apa pun
        const body = isi.get(key);
        if (!body) return null;
        const abs = path.join(tmpMaterialize, `${materializeCalls.length}-${path.basename(key)}`);
        fs.writeFileSync(abs, body);
        jalurMaterialize.set(abs, key);
        return abs;
      },
    },
  };
}

/**
 * PROVIDER PALSU — satu-satunya tempat yang bisa membuktikan bahan yang
 * BENAR-BENAR dikirim.
 *
 * Memeriksa "kunci mana yang di-materialize" hanya membuktikan PEMILIHANNYA;
 * ia tidak menangkap perubahan di hilir antara pemilihan dan pengiriman.
 * Temuan Reviewer 21 Agu, dan benar: asersi hash versi pertama menghitung ulang
 * dari Map fixture memakai kunci yang SUDAH diasersikan — melingkar.
 *
 * Fake ini membaca bytes DARI PATH YANG DITERIMANYA, mencatat hash-nya, lalu
 * MELEMPAR — jadi tidak ada satu rupiah pun keluar dan job tetap gagal-tertutup.
 */
interface AmatanProvider {
  utamaSha: string | null;
  utamaPath: string | null;
  extraPaths: string[];
  dipanggil: boolean;
}
let amatan: AmatanProvider = { utamaSha: null, utamaPath: null, extraPaths: [], dipanggil: false };

async function pasangProviderPengamat() {
  const { setVideoProvidersForTests } = await import("../lib/providers/registry");
  amatan = { utamaSha: null, utamaPath: null, extraPaths: [], dipanggil: false };
  setVideoProvidersForTests([
    {
      name: "pengamat-uji",
      async healthCheck() {
        return true;
      },
      estimateCost() {
        return 0;
      },
      async generate(spec: { shots: { imageRefPath: string }[]; extraReferenceImagePaths?: string[] }) {
        amatan.dipanggil = true;
        const utama = spec.shots[0]?.imageRefPath ?? null;
        amatan.utamaPath = utama;
        if (utama && fs.existsSync(utama)) amatan.utamaSha = sha256(fs.readFileSync(utama));
        amatan.extraPaths = [...(spec.extraReferenceImagePaths ?? [])];
        throw new Error("provider pengamat: berhenti sebelum biaya keluar");
      },
    } as never,
  ]);
}

let userId = "";

before(async () => {
  if (lewati) return;
  pool = new Pool({ connectionString: URL_UJI, max: 5 });
  tmpMaterialize = fs.mkdtempSync(path.join(os.tmpdir(), "w1-materialize-"));
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
  const { setVideoProvidersForTests } = await import("../lib/providers/registry");
  setVideoProvidersForTests(undefined);
  if (tmpMaterialize) fs.rmSync(tmpMaterialize, { recursive: true, force: true });
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
  assert.ok(
    ["FAILED", "REFUNDED"].includes(job.state),
    `${konteks}: job berakhir ${job.state}, bukan gagal-tertutup. Nol output dan nol capture saja ` +
      "tidak cukup: job yang tertinggal di GENERATING_VISUAL juga punya nol keduanya, dan ia " +
      "menggantung — bukan gagal dengan bersih."
  );
  assert.equal(job.provider_video, null, `${konteks}: provider_video tercatat — ada panggilan provider`);
  assert.equal(job.provider_voice, null, `${konteks}: provider_voice tercatat`);
  assert.equal(job.output_url, null, `${konteks}: output_url terisi padahal worker berhenti`);
  assert.equal(Number(job.cost_actual_idr ?? 0), 0, `${konteks}: cost_actual_idr bukan 0`);
  assert.deepEqual(putCalls, [], `${konteks}: worker menulis ke storage`);
  assert.equal(panggilanJaringan, 0, `${konteks}: ada panggilan fetch`);
}

async function jalankan(jobId: string, isi: Map<string, Buffer>, wujudkan = false) {
  const { setMediaStorageForTests } = await import("../lib/storage");
  const spy = storageSpy(isi, wujudkan);
  setMediaStorageForTests(spy.storage as never);
  const { processPostgresJob } = await import("../lib/postgres/worker");
  await processPostgresJob(jobId);
  return spy;
}

// ------------------------------------------------------- P0-B4 KANARI (W1)
//
// Temuan Reviewer atas 691bf83, dan ia benar: kanari sempat hanya punya bukti
// runtime di worker SQLite. Mencabut pemanggilan di lib/postgres/worker.ts —
// JALUR PRODUKSI UTAMA — tidak membuat satu pun test merah. Slice yang mengklaim
// dua worker sementara hanya satu yang dijaga adalah klaim yang lebih luas dari
// buktinya.
//
// Dua arah wajib ada. Yang DITOLAK memberi pembilang; yang LOLOS memberi
// penyebut. Tanpa keduanya, rasio yang jadi alasan kanari ini ada tidak bisa
// dihitung.

test("W1 KANARI: penolakan tercatat sebagai KODE, dan vonisnya TIDAK berubah", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  const { resetKanariUntukTest, ringkasanKanari } = await import("../lib/kanari-bukti");
  const { ALASAN_TOLAK, RINCI_TOLAK } = await import("../lib/product-truth");
  resetKanariUntukTest();

  const rel = `uploads/w1-kanari-tolak-${process.pid}/0.webp`;
  const isi = new Map<string, Buffer>([[rel, PACKSHOT]]); // bytes ADA, sidecar HILANG
  const jobId = await siapkanJob([rel]);
  const spy = await jalankan(jobId, isi);

  // 1. Vonis tidak berubah: gagal-tertutup sebelum langkah berbayar.
  await assertNolEfekSamping(jobId, spy.putCalls, "W1 kanari tolak");
  assert.deepEqual(
    spy.materializeCalls,
    [],
    "kanari membuat W1 mengambil bytes lebih dulu — alat ukur mengubah urutan yang diukurnya"
  );

  // 2. Kanari benar-benar menyala DI W1, dengan kode, bukan kalimat.
  const r = ringkasanKanari();
  assert.equal(r.dinilai, 1, "kanari tidak menyala di lib/postgres/worker.ts — jalur produksi utama tanpa angka");
  assert.equal(r.ditolak, 1);
  assert.equal(r.lolos, 0);
  assert.equal(r.perAlasan[ALASAN_TOLAK.BUKTI_TIDAK_SAH], 1);
  assert.equal(r.perRinci[RINCI_TOLAK.SIDECAR_HILANG], 1);
});

test("W1 KANARI: jalur LOLOS juga tercatat — tanpa penyebut, rasio mustahil", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  const { resetKanariUntukTest, ringkasanKanari } = await import("../lib/kanari-bukti");
  resetKanariUntukTest();
  await pasangProviderPengamat();

  const rel = `uploads/w1-kanari-lolos-${process.pid}/0.webp`;
  const isi = new Map<string, Buffer>([[rel, PACKSHOT], [`${rel}.meta.json`, sidecar(PACKSHOT, true)]]);
  const jobId = await siapkanJob([rel]);
  const spy = await jalankan(jobId, isi, true);

  assert.deepEqual(spy.materializeCalls, [rel], "kontrol positif tidak sampai ke materialize; penilaian LOLOS tidak pernah terjadi");
  const r = ringkasanKanari();
  assert.equal(r.dinilai, 1, "penilaian yang LOLOS tidak dicatat; kanari hanya punya pembilang");
  assert.equal(r.lolos, 1);
  assert.equal(r.ditolak, 0);
  assert.deepEqual(r.perAlasan, {}, "penolakan dicatat padahal referensinya lolos");
});

// ------------------------------------------------------------------- C1

test("W1 C1: foto#1 banner + foto#2 packshot — yang SAMPAI KE PROVIDER foto#2, dengan sha256-nya", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  await pasangProviderPengamat();
  const relBanner = `uploads/w1-c1-${process.pid}/0.webp`;
  const relPackshot = `uploads/w1-c1-${process.pid}/1.webp`;
  const isi = new Map<string, Buffer>([
    [relBanner, BANNER],
    [`${relBanner}.meta.json`, sidecar(BANNER, false)],
    [relPackshot, PACKSHOT],
    [`${relPackshot}.meta.json`, sidecar(PACKSHOT, true)],
  ]);
  const jobId = await siapkanJob([relBanner, relPackshot]);
  // wujudkan: eksekusi HARUS berlanjut sampai provider, kalau tidak asersi
  // hash di bawah tidak pernah mengamati apa pun.
  const spy = await jalankan(jobId, isi, true);

  await assertNolEfekSamping(jobId, spy.putCalls, "W1 C1");
  assert.equal(
    spy.materializeCalls[0],
    relPackshot,
    `W1 memilih referensi utama YANG SALAH.\n` +
      `  diminta worker : ${spy.materializeCalls[0]}\n` +
      `  seharusnya     : ${relPackshot}  (packshot, sidecar sah)\n` +
      `  seluruh urutan : ${JSON.stringify(spy.materializeCalls)}`
  );

  // BUKTI DI BOUNDARY, bukan hitung ulang dari fixture. Bytes dibaca dari path
  // yang BENAR-BENAR DITERIMA provider — jadi asersi ini menangkap juga
  // perubahan di hilir (path tertukar, primaryRef ditimpa) yang tidak bisa
  // dilihat dari daftar materialize.
  assert.ok(
    amatan.dipanggil,
    "provider tidak pernah menerima spec — eksekusi berhenti sebelum boundary, jadi asersi hash " +
      "di bawah tidak akan mengamati apa pun"
  );
  assert.equal(
    amatan.utamaSha,
    sha256(PACKSHOT),
    `bytes yang SAMPAI KE PROVIDER bukan packshot yang buktinya sah (path ${amatan.utamaPath}).`
  );
  assert.notEqual(amatan.utamaSha, sha256(BANNER), "BANNER sampai ke provider");
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
  test(`W1 C8: ${judul} — nol materialize, nol provider, gagal-tertutup, nol capture/regen`, async (t) => {
    if (lewati) return t.skip("UJI_PG_URL kosong");
    // Observer DIPASANG ULANG per kasus. Tanpa ini, fake dari kasus C1 tetap
    // terpasang dan `amatan.dipanggil` masih membawa nilai kasus sebelumnya —
    // jadi regresi yang MELEWATI gerbang bukti lalu memanggil provider dengan
    // path mentah tetap memenuhi seluruh asersi lain (nol materialize, nol
    // fetch, provider_video null, job FAILED). Temuan Reviewer 21 Agu.
    await pasangProviderPengamat();
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
    assert.equal(
      amatan.dipanggil,
      false,
      `provider DIPANGGIL walau bukti ${judul}. Nol materialize saja tidak membuktikan apa-apa ` +
        "kalau ada jalur yang melewati gerbang lalu memanggil provider dengan path mentah."
    );
    const state = (await pool.query("SELECT state FROM jobs WHERE id=$1", [jobId])).rows[0].state;
    assert.ok(["FAILED", "REFUNDED"].includes(state), `job dengan ${judul} berakhir ${state}, bukan gagal-tertutup`);
  });
}

// ------------------------------------------------- referensi tambahan

test("W1: loop referensi tambahan HANYA meminta yang tersetujui, urut (berhenti di boundary person-safe)", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  await pasangProviderPengamat();
  // Tier bersuara supaya cabang referensi tambahan benar-benar DILEWATI.
  // Versi pertama test ini memakai materialize yang selalu null, jadi worker
  // berhenti di referensi utama dan cabang tambahan TIDAK PERNAH jalan —
  // asersinya lolos secara vakum. Temuan Reviewer 21 Agu.
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
  const spy = await jalankan(jobId, isi, true);

  await assertNolEfekSamping(jobId, spy.putCalls, "W1 extra");
  assert.deepEqual(
    spy.materializeCalls,
    [relSah1, relSah2],
    `urutan materialize salah: ${JSON.stringify(spy.materializeCalls)}. Yang dituntut PERSIS ` +
      "[foto sah pertama, foto sah kedua] — banner tidak boleh diminta sama sekali, dan foto sah " +
      "kedua WAJIB benar-benar diminta (kalau ia hilang, cabang tambahan tidak pernah dilewati)."
  );
  assert.ok(
    !spy.materializeCalls.includes(relBanner),
    "banner ikut diminta sebagai referensi tambahan — foto ke-2 dst juga dikirim ke model sebagai " +
      "referensi identitas, sama berbahayanya kalau salah"
  );

  // BOUNDARY BERHENTINYA: `personSafeReferencePhotos`, yang berjalan tepat
  // SESUDAH loop referensi tambahan dan SEBELUM planner/provider. Ia gagal di
  // sini karena bytes fixture bukan gambar sungguhan — deterministik, dan
  // persis boundary aman yang diminta: cukup jauh untuk membuktikan loopnya
  // benar-benar dilewati, cukup dekat untuk tidak mengeluarkan biaya.
  //
  // Provider karena itu SENGAJA tidak diamati di test ini; pengamatan boundary
  // provider ada di test C1, yang tier-nya silent_caption sehingga jalur
  // person-safe dilewati.
  assert.equal(amatan.dipanggil, false, "eksekusi melewati boundary aman dan mencapai provider");
  // Alasan gagal tercatat di audit_log (bukan kolom jobs). Diperiksa supaya
  // test ini BERISIK kalau boundary-nya bergeser: kegagalan karena gerbang
  // bukti akan berbunyi lain dari kegagalan karena person-safe, dan keduanya
  // tidak boleh tertukar diam-diam.
  const jejak = await pool.query(
    "SELECT meta FROM audit_log WHERE entity='jobs' AND entity_id=$1 AND action='job.transition'",
    [jobId]
  );
  // `meta` bisa datang sebagai objek (jsonb) atau string (text) tergantung tipe
  // kolomnya; keduanya ditangani supaya test tidak bergantung pada detail itu.
  // Dan barisnya DISARING, bukan diambil yang terakhir: beberapa transisi bisa
  // punya `created_at` yang sama sampai milidetik, jadi "terbaru" ambigu.
  const semuaMeta = jejak.rows
    .map((r) => (typeof r.meta === "string" ? (JSON.parse(r.meta) as Record<string, unknown>) : (r.meta as Record<string, unknown>)))
    .filter(Boolean);
  const meta = semuaMeta.find((m) => m.to === "FAILED") as { to?: string; reason?: string } | undefined;
  assert.ok(
    meta,
    `transisi FAILED tidak tercatat di audit_log; yang ada: ${JSON.stringify(semuaMeta.map((m) => m.to))}`
  );
  const alasan = meta.reason ?? "";
  assert.ok(alasan.length > 0, "job gagal tanpa alasan tercatat");
  assert.ok(
    !/EVIDENCE_INVALID|REF_HASH_MISMATCH|acuan video/i.test(alasan),
    `job berhenti karena GERBANG BUKTI ("${alasan}"), bukan karena boundary person-safe. ` +
      "Kalau begitu, loop referensi tambahan tidak pernah benar-benar dilewati dan asersi urutan " +
      "di atas kehilangan maknanya."
  );
});

// ------------------------------- referensi tambahan DI BOUNDARY PROVIDER

/**
 * Yang BENAR-BENAR DITERIMA provider sebagai referensi tambahan.
 *
 * Temuan Reviewer 21 Agu: test di atas bernama "sampai ke provider" padahal
 * justru menuntut provider TIDAK dipanggil, dan `extraReferenceImagePaths`
 * tidak pernah diasersikan. Perubahan SESUDAH materialize — menghapus,
 * menukar urutan, menyisipkan banner — tetap hijau di sana.
 *
 * Kasus ini menempuh jalur AMAN sampai fake gratis: bytes-nya PNG sungguhan
 * berukuran 800x800 tanpa wajah, jadi `personSafeReferencePhotos` melewatinya
 * apa adanya (tanpa crop, tanpa upscale) dan eksekusi berlanjut ke provider.
 * Karena itu ia butuh python + OpenCV + model YuNet; kalau tidak ada, kasus ini
 * DILEWATI, dan kasus boundary person-safe di atas tetap menjaga urutan
 * materialize.
 */
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

test("W1: referensi tambahan yang DITERIMA PROVIDER — urutan, hash, dan tanpa banner", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  if (!punyaPersonSafe()) return t.skip("python/OpenCV/model YuNet tidak ada — jalur aman tidak bisa ditempuh");
  await pasangProviderPengamat();

  const sharp = (await import("sharp")).default;
  const gambar = async (r: number, g: number, b: number) =>
    sharp({ create: { width: 800, height: 800, channels: 3, background: { r, g, b } } }).png().toBuffer();
  const bannerPng = await gambar(240, 40, 40);
  const sah1 = await gambar(40, 200, 120);
  const sah2 = await gambar(60, 120, 220);

  const dasar = `uploads/w1-prov-${process.pid}`;
  const relBanner = `${dasar}/0.png`;
  const relSah1 = `${dasar}/1.png`;
  const relSah2 = `${dasar}/2.png`;
  const isi = new Map<string, Buffer>([
    [relBanner, bannerPng],
    [`${relBanner}.meta.json`, sidecar(bannerPng, false)],
    [relSah1, sah1],
    [`${relSah1}.meta.json`, sidecar(sah1, true)],
    [relSah2, sah2],
    [`${relSah2}.meta.json`, sidecar(sah2, true)],
  ]);
  const jobId = await siapkanJob([relBanner, relSah1, relSah2], "high_quality");
  const spy = await jalankan(jobId, isi, true);

  await assertNolEfekSamping(jobId, spy.putCalls, "W1 provider extras");
  assert.ok(
    amatan.dipanggil,
    "provider tidak pernah menerima spec — jalur amannya tidak tertempuh, jadi asersi di bawah " +
      "tidak mengamati apa pun"
  );

  // UTAMA: bytes yang diterima provider = foto sah pertama.
  assert.equal(amatan.utamaSha, sha256(sah1), `referensi utama di provider salah (${amatan.utamaPath})`);

  // TAMBAHAN: jumlah, urutan, DAN isinya — dibaca dari path yang benar-benar
  // diterima, bukan disimpulkan dari daftar materialize.
  const shaTambahan = amatan.extraPaths.map((p) => sha256(fs.readFileSync(p)));
  assert.deepEqual(
    shaTambahan,
    [sha256(sah2)],
    `referensi tambahan yang diterima provider salah. Diterima ${amatan.extraPaths.length} path: ` +
      JSON.stringify(amatan.extraPaths)
  );
  assert.ok(
    !shaTambahan.includes(sha256(bannerPng)),
    "BANNER sampai ke provider sebagai referensi identitas tambahan"
  );
});

// ------------------------- batas tujuh referensi, DI BOUNDARY PROVIDER

/**
 * DELAPAN foto tersetujui, TUJUH referensi terkirim — diamati di provider.
 *
 * Temuan Reviewer 21 Agu: kasus provider W1 hanya memakai DUA foto sah, jadi
 * mutasi yang mengembalikan W1 ke primary + tujuh tambahan (delapan total)
 * tidak akan terdeteksi. Batasnya baru terkunci kalau jumlahnya benar-benar
 * diuji di titik jumlah itu berarti: yang diterima provider.
 *
 * `MAKS_REFERENSI_PER_GENERASI = 7` menghitung primary + tambahan, jadi yang
 * dituntut satu primary dan PALING BANYAK enam tambahan.
 */
test("W1: delapan foto tersetujui — provider menerima satu primary + maksimal enam tambahan", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  if (!punyaPersonSafe()) return t.skip("python/OpenCV/model YuNet tidak ada — jalur aman tidak bisa ditempuh");
  await pasangProviderPengamat();

  const sharp = (await import("sharp")).default;
  const dasar = `uploads/w1-delapan-${process.pid}`;
  const isi = new Map<string, Buffer>();
  const rels: string[] = [];
  const bytesPer: Buffer[] = [];
  for (let i = 0; i < 8; i++) {
    const png = await sharp({
      create: { width: 800, height: 800, channels: 3, background: { r: 20 + i * 25, g: 180, b: 90 + i * 10 } },
    })
      .png()
      .toBuffer();
    const rel = `${dasar}/${i}.png`;
    isi.set(rel, png);
    isi.set(`${rel}.meta.json`, sidecar(png, true));
    rels.push(rel);
    bytesPer.push(png);
  }

  const jobId = await siapkanJob(rels, "high_quality");
  const spy = await jalankan(jobId, isi, true);

  await assertNolEfekSamping(jobId, spy.putCalls, "W1 delapan foto");
  assert.ok(amatan.dipanggil, "provider tidak pernah menerima spec — batasnya tidak teruji");
  assert.equal(amatan.utamaSha, sha256(bytesPer[0]), "referensi utama di provider bukan foto sah pertama");
  assert.ok(
    amatan.extraPaths.length <= 6,
    `provider menerima ${amatan.extraPaths.length} referensi tambahan; dengan primary itu ` +
      `${amatan.extraPaths.length + 1} referensi. MAKS_REFERENSI_PER_GENERASI=7 menghitung ` +
      "primary + tambahan, jadi delapan berarti kontraknya sendiri dilewati."
  );
  const shaDiterima = new Set(amatan.extraPaths.map((pth) => sha256(fs.readFileSync(pth))));
  assert.ok(
    !shaDiterima.has(sha256(bytesPer[7])),
    "foto KEDELAPAN sampai ke provider — batas generasi tidak diterapkan"
  );
  assert.ok(spy.materializeCalls.length <= 7, `worker meminta ${spy.materializeCalls.length} referensi`);
});

// ------------------- path bersama ditimpa SESUDAH diperiksa (TOCTOU nyata)

/**
 * PATH DARI materialize() ADALAH PATH BERSAMA YANG BISA DITIMPA.
 *
 * Temuan Reviewer 21 Agu, dan ia menunjuk mekanismenya persis:
 * `FilesystemStorage.materialize` mengembalikan berkas storage kanoniknya
 * sendiri; `R2Storage.materialize` memakai cache bersama `.object-cache/<key>`.
 * Put berikutnya, materialize KEDUA atas kunci yang sama, atau job lain yang
 * berjalan bersamaan bisa menimpa path itu SESUDAH pemeriksaan hash tapi
 * SEBELUM person-safe/planner/provider membacanya. Memeriksa hash sekali di
 * awal hanya mempersempit jendela, tidak menutupnya.
 *
 * Storage di bawah memodelkan jendela itu seketat mungkin: SETIAP materialize
 * menulis ke SATU path yang sama. Jadi materialize referensi tambahan menimpa
 * bytes referensi utama, tepat sesudah utama diperiksa.
 *
 * Tanpa snapshot privat per job, provider akan menerima bytes referensi
 * TAMBAHAN sebagai referensi UTAMA.
 */
test("W1 TOCTOU: path bersama ditimpa sesudah diperiksa — provider tetap menerima bytes yang disetujui", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  if (!punyaPersonSafe()) return t.skip("python/OpenCV/model YuNet tidak ada — jalur aman tidak bisa ditempuh");
  await pasangProviderPengamat();

  const sharp = (await import("sharp")).default;
  const gambar = async (r: number, g: number, b: number) =>
    sharp({ create: { width: 800, height: 800, channels: 3, background: { r, g, b } } }).png().toBuffer();
  const sah1 = await gambar(30, 190, 110);
  const sah2 = await gambar(70, 110, 210);

  const dasar = `uploads/w1-toctou-${process.pid}`;
  const relSah1 = `${dasar}/0.png`;
  const relSah2 = `${dasar}/1.png`;
  const isi = new Map<string, Buffer>([
    [relSah1, sah1],
    [`${relSah1}.meta.json`, sidecar(sah1, true)],
    [relSah2, sah2],
    [`${relSah2}.meta.json`, sidecar(sah2, true)],
  ]);

  const { setMediaStorageForTests } = await import("../lib/storage");
  const materializeCalls: string[] = [];
  const putCalls: string[] = [];
  // SATU path untuk semua materialize — inilah "path bersama" itu.
  const pathBersama = path.join(tmpMaterialize, `bersama-${process.pid}.png`);
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

  const jobId = await siapkanJob([relSah1, relSah2], "high_quality");
  const { processPostgresJob } = await import("../lib/postgres/worker");
  await processPostgresJob(jobId);

  await assertNolEfekSamping(jobId, putCalls, "W1 TOCTOU");
  assert.deepEqual(materializeCalls, [relSah1, relSah2], "kedua referensi wajib diminta");
  assert.equal(
    sha256(fs.readFileSync(pathBersama)),
    sha256(sah2),
    "prasyarat: path bersama memang sudah ditimpa bytes referensi kedua"
  );

  assert.ok(amatan.dipanggil, "provider tidak pernah menerima spec — jendela TOCTOU tidak teruji");
  assert.equal(
    amatan.utamaSha,
    sha256(sah1),
    "provider menerima bytes referensi TAMBAHAN sebagai referensi UTAMA. Path dari materialize() " +
      "ditimpa sesudah diperiksa; yang dikirim wajib salinan privat job ini, bukan path bersama."
  );
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
