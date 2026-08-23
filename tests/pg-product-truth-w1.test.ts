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
  // Admission dashboard harus berhenti setelah enqueue boundary. Worker W1
  // dipanggil eksplisit oleh test; jangan pernah memulai inline SQLite atau
  // mewarisi konfigurasi Redis eksternal dari shell pemanggil.
  process.env.RACUN_WORKER_DISABLED = "1";
  process.env.RACUN_QUEUE_MODE = "inline";
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
  const getCalls: string[] = [];
  const putCalls: string[] = [];
  const snapshotSources = new Map<string, string>();
  return {
    materializeCalls,
    getCalls,
    putCalls,
    storage: {
      async put(key: string, body: Buffer) {
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
      async delete(key: string) {
        isi.delete(key);
      },
      async get(key: string) {
        getCalls.push(key);
        const body = isi.get(key);
        return body ? { body, size: body.length } : null;
      },
      async stat(key: string) {
        const body = isi.get(key);
        return body ? { size: body.length } : null;
      },
      async materialize(key: string) {
        materializeCalls.push(snapshotSources.get(key) ?? key);
        if (!wujudkan) return null; // HALT sebelum langkah berbayar apa pun
        const body = isi.get(key);
        if (!body) return null;
        const abs = path.join(tmpMaterialize, `${materializeCalls.length}-${path.basename(key)}`);
        fs.writeFileSync(abs, body);
        jalurMaterialize.set(abs, snapshotSources.get(key) ?? key);
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
  promptText: string;
  dipanggil: boolean;
}
let amatan: AmatanProvider = { utamaSha: null, utamaPath: null, extraPaths: [], promptText: "", dipanggil: false };

async function pasangProviderPengamat() {
  const { setVideoProvidersForTests } = await import("../lib/providers/registry");
  amatan = { utamaSha: null, utamaPath: null, extraPaths: [], promptText: "", dipanggil: false };
  setVideoProvidersForTests([
    {
      name: "pengamat-uji",
      async healthCheck() {
        return true;
      },
      estimateCost() {
        return 0;
      },
      async generate(spec: { shots: { imageRefPath: string; prompt: string }[]; extraReferenceImagePaths?: string[] }) {
        amatan.dipanggil = true;
        const utama = spec.shots[0]?.imageRefPath ?? null;
        amatan.utamaPath = utama;
        if (utama && fs.existsSync(utama)) amatan.utamaSha = sha256(fs.readFileSync(utama));
        amatan.extraPaths = [...(spec.extraReferenceImagePaths ?? [])];
        amatan.promptText = spec.shots.map((shot) => shot.prompt).join("\n");
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

/** Admission produksi PostgreSQL, bukan INSERT fixture worker. */
async function siapkanJobLewatAdmisi(images: string[]): Promise<{ jobId: string; productId: string }> {
  const productId = uid(), scriptId = uid(), t = at();
  await pool.query(
    `INSERT INTO products
      (id,user_id,name,price_idr,category,images,raw_meta,product_visual_desc,brand_brief,claims,created_at)
     VALUES ($1,$2,'Serum Glow Bright',85000,'beauty',$3,$4,'BOTOL-AMBER-AWAL','ARAH-BRAND-AWAL',$5,$6)`,
    [productId, userId, JSON.stringify(images), JSON.stringify({ brand: "Merek Awal" }), JSON.stringify(["klaim awal"]), t]
  );
  await pool.query(
    `INSERT INTO scripts
      (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,created_at)
     VALUES ($1,$2,'H1','senang','bestie',$3,'caption','[]','{}','silent_caption',$4)`,
    [scriptId, productId, JSON.stringify(segmen), t]
  );
  await pool.query(
    "INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES ($1,$2,50000,'bonus',$3)",
    [uid(), userId, t]
  );
  const { smokeCreateJob } = await import("../lib/postgres/smoke-runtime");
  const admitted = await smokeCreateJob(userId, {
    productId, scriptId, format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr: 12000,
  });
  assert.equal(admitted.duplicate, false);
  return { jobId: admitted.jobId, productId };
}

/** Admission dashboard organisasi sungguhan melalui renderSatuSel. */
async function siapkanJobOrgLewatAdmisi(images: string[]) {
  const orgId = uid(), intruderId = uid(), intruderOrgId = uid(), productId = uid(), scriptId = uid(), personaId = uid(), t = at();
  const segmenAdmisi = [
    { role: "hook", start: 0, end: 4, text: "Bestie Serum Glow Bright ini bikin rutinitas pagiku terasa praktis dan kemasannya cantik banget di meja rias", visual_direction: "x" },
    { role: "demo", start: 4, end: 11, text: "Makanya teksturnya ringan mudah diratakan dan nyaman dipakai sebelum makeup setiap hari", visual_direction: "x" },
    { role: "cta", start: 11, end: 15, text: "Kalau penasaran cek keranjang sekarang ya", visual_direction: "x" },
  ];
  await pool.query(
    "INSERT INTO users (id,phone,email,name,tier,locale,created_at) VALUES ($1,$2,$3,'Intruder E7','free','id-ID',$4)",
    [intruderId, `08127${process.pid}`, `w1-e7-intruder-${process.pid}@contoh.test`, t]
  );
  await pool.query(
    "INSERT INTO organizations (id,name,slug,created_at) VALUES ($1,'Org E7',$2,$5),($3,'Org E7 lain',$4,$5)",
    [orgId, `org-e7-${process.pid}`, intruderOrgId, `org-e7-lain-${process.pid}`, t]
  );
  await pool.query(
    "INSERT INTO org_members (id,org_id,user_id,role,created_at) VALUES ($1,$2,$3,'owner',$7),($4,$5,$6,'owner',$7)",
    [uid(), orgId, userId, uid(), intruderOrgId, intruderId, t]
  );
  await pool.query(
    `INSERT INTO products
      (id,user_id,org_id,name,price_idr,category,images,raw_meta,product_visual_desc,brand_brief,claims,promo_price_before_idr,created_at)
     VALUES ($1,$2,$3,'Serum Glow Bright',85000,'beauty',$4,$5,'BOTOL-AMBER-AWAL','ARAH-BRAND-AWAL',$6,110000,$7)`,
    [productId, userId, orgId, JSON.stringify(images), JSON.stringify({ brand: "Merek Awal" }), JSON.stringify(["klaim awal"]), t]
  );
  await pool.query(
    "INSERT INTO personas (id,user_id,name,creator_category,voice_id,register,created_at) VALUES ($1,$2,'Persona E7','hijaber','id_female_1','bestie',$3)",
    [personaId, userId, t]
  );
  await pool.query(
    `INSERT INTO scripts
      (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,created_at)
     VALUES ($1,$2,'H1','senang','bestie',$3,'caption','[]','{}','silent_caption',$4)`,
    [scriptId, productId, JSON.stringify(segmenAdmisi), t]
  );
  await pool.query(
    "INSERT INTO credit_ledger (id,user_id,org_id,delta,type,created_at) VALUES ($1,$2,$3,50000,'bonus',$4)",
    [uid(), userId, orgId, t]
  );
  const { renderSatuSel } = await import("../lib/dashboard/render-cell");
  const { PgJobsRepository } = await import("../lib/postgres/jobs");
  const { PgCreditPaymentRepository } = await import("../lib/postgres/credit-payment");
  assert.equal(process.env.RACUN_WORKER_DISABLED, "1", "fixture E7 dapat auto-process saat admission");
  assert.equal(process.env.RACUN_QUEUE_MODE, "inline", "fixture E7 dapat enqueue ke Redis eksternal");
  const result = await renderSatuSel({
    userId, orgId, productId, productName: "Serum Glow Bright", productPriceIdr: 85000,
    productSourceUrl: null, promoPriceBeforeIdr: 110000, scriptId, personaId,
    avatarCustomDesc: null, format: "talking_head", ratio: "9:16", noModel: false,
    tvcRoute: null, templateId: null, recordStyle: null, shotCount: null, runId: `e7-${process.pid}`,
  }, {
    pool,
    jobsRepo: new PgJobsRepository(URL_UJI),
    creditsRepo: new PgCreditPaymentRepository(URL_UJI),
  });
  assert.equal(result.status, "queued", `admission dashboard E7 gagal: ${JSON.stringify(result)}`);
  const admittedState = (await pool.query("SELECT state,provider_video,provider_voice FROM jobs WHERE id=$1", [result.job_id])).rows[0];
  assert.deepEqual(admittedState, { state: "QUEUED", provider_video: null, provider_voice: null },
    "admission E7 menjalankan worker otomatis sebelum processPostgresJob eksplisit");
  const { issueToken } = await import("../lib/auth");
  return {
    jobId: result.job_id, productId, orgId,
    ownerToken: await issueToken(userId, "081200000091"),
    intruderToken: await issueToken(intruderId, `08127${process.pid}`),
  };
}

/** Confirm nyata untuk Story Ads: request sengaja menghilangkan templateId. */
async function siapkanStoryAdsTanpaTemplateRequest(image: string, avatarCustomDesc: string | null = null) {
  const orgId = uid(), productId = uid(), scriptId = uid(), personaId = uid(), t = at();
  await pool.query("INSERT INTO organizations (id,name,slug,created_at) VALUES ($1,'Org Ads Boundary',$2,$3)",
    [orgId, `org-ads-boundary-${process.pid}`, t]);
  await pool.query("INSERT INTO org_members (id,org_id,user_id,role,created_at) VALUES ($1,$2,$3,'owner',$4)",
    [uid(), orgId, userId, t]);
  await pool.query(
    `INSERT INTO products (id,user_id,org_id,name,price_idr,category,images,raw_meta,created_at)
     VALUES ($1,$2,$3,'Jasa Uji',189000,'jasa',$4,'{}',$5)`,
    [productId, userId, orgId, JSON.stringify([image]), t]
  );
  await pool.query(
    "INSERT INTO personas (id,user_id,name,creator_category,voice_id,register,created_at) VALUES ($1,$2,'Persona Ads','hijaber','id_female_1','netral',$3)",
    [personaId, userId, t]
  );
  const { generateScripts } = await import("../lib/script-engine");
  const [script] = await generateScripts({
    product: { id: productId, name: "Jasa Uji", price_idr: 189000, category: "jasa" },
    register: "netral", qualityTier: "high_quality", durationSec: 15,
    contentType: "ads", templateId: "ads-meja-kosong", count: 1, tanpaLlm: true,
  });
  const validationResult = JSON.stringify({
    ...script.validation,
    admisi: {
      contentType: "ads", format: "ads", durationSec: 15,
      templateId: "ads-meja-kosong", hookLevel: "agak_gila", productCategory: "jasa",
    },
  });
  await pool.query(
    `INSERT INTO scripts
      (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,created_at)
     VALUES ($1,$2,'H13','penasaran','netral',$3,'caption','[]',$4,'high_quality',$5)`,
    [scriptId, productId, JSON.stringify(script.segments), validationResult, t]
  );
  await pool.query("INSERT INTO credit_ledger (id,user_id,org_id,delta,type,created_at) VALUES ($1,$2,$3,100000,'bonus',$4)",
    [uid(), userId, orgId, t]);
  const { renderSatuSel } = await import("../lib/dashboard/render-cell");
  const { PgJobsRepository } = await import("../lib/postgres/jobs");
  const { PgCreditPaymentRepository } = await import("../lib/postgres/credit-payment");
  const result = await renderSatuSel({
    userId, orgId, productId, productName: "NAMA REQUEST PALSU", productPriceIdr: 189000,
    productSourceUrl: null, promoPriceBeforeIdr: null, scriptId, personaId,
    avatarCustomDesc, format: "ads", ratio: "9:16", noModel: false,
    tvcRoute: null, templateId: null, recordStyle: null, shotCount: 4,
    runId: `ads-boundary-${process.pid}`,
  }, {
    pool, jobsRepo: new PgJobsRepository(URL_UJI), creditsRepo: new PgCreditPaymentRepository(URL_UJI),
  });
  assert.equal(result.status, "queued", JSON.stringify(result));
  return result.job_id;
}

async function assertBlockedSnapshotTanpaSideEffect(templateId: string) {
  const orgId = uid(), productId = uid(), scriptId = uid(), personaId = uid(), t = at();
  await pool.query("INSERT INTO organizations (id,name,slug,created_at) VALUES ($1,$2,$3,$4)",
    [orgId, `Org Block ${templateId}`, `org-block-${templateId}-${process.pid}`, t]);
  await pool.query("INSERT INTO org_members (id,org_id,user_id,role,created_at) VALUES ($1,$2,$3,'owner',$4)",
    [uid(), orgId, userId, t]);
  await pool.query(
    "INSERT INTO products (id,user_id,org_id,name,price_idr,category,images,raw_meta,created_at) VALUES ($1,$2,$3,'Serum Bukti',85000,'beauty','[]','{}',$4)",
    [productId, userId, orgId, t]
  );
  await pool.query(
    "INSERT INTO personas (id,user_id,name,creator_category,voice_id,register,created_at) VALUES ($1,$2,$3,'hijaber','id_female_1','netral',$4)",
    [personaId, userId, `Persona ${templateId}`, t]
  );
  const segments = [
    { role: "hook", start: 0, end: 3, text: "Pembuka bukti.", visual_direction: "x" },
    { role: "demo", start: 3, end: 10, text: "Isi bukti.", visual_direction: "x" },
    { role: "cta", start: 10, end: 15, text: "Penutup bukti.", visual_direction: "x" },
  ];
  const validationResult = JSON.stringify({
    passed: true, errors: [], warnings: [], checked_at: t,
    admisi: { contentType: "affiliate", format: "hands_only", durationSec: 15, templateId },
  });
  await pool.query(
    `INSERT INTO scripts
      (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,created_at)
     VALUES ($1,$2,'H1','netral','netral',$3,'caption','[]',$4,'silent_caption',$5)`,
    [scriptId, productId, JSON.stringify(segments), validationResult, t]
  );
  await pool.query("INSERT INTO credit_ledger (id,user_id,org_id,delta,type,created_at) VALUES ($1,$2,$3,50000,'bonus',$4)",
    [uid(), userId, orgId, t]);
  const { renderSatuSel } = await import("../lib/dashboard/render-cell");
  const { PgJobsRepository } = await import("../lib/postgres/jobs");
  const { PgCreditPaymentRepository } = await import("../lib/postgres/credit-payment");
  const { aiRenderBlockMessage } = await import("../lib/template-render-safety");
  const result = await renderSatuSel({
    userId, orgId, productId, productName: "Serum Bukti", productPriceIdr: 85000,
    productSourceUrl: null, promoPriceBeforeIdr: null, scriptId, personaId,
    avatarCustomDesc: null, format: "hands_only", ratio: "9:16", noModel: false,
    tvcRoute: null, templateId: null, recordStyle: null, shotCount: null,
    runId: `block-${templateId}-${process.pid}`,
  }, {
    pool, jobsRepo: new PgJobsRepository(URL_UJI), creditsRepo: new PgCreditPaymentRepository(URL_UJI),
  });
  assert.deepEqual(result, { status: "failed", script_id: scriptId, reason: aiRenderBlockMessage(templateId)! });
  const scriptAfter = (await pool.query(
    "SELECT job_id,approved_by_user_at,edited_by_user,segments,validation_result FROM scripts WHERE id=$1", [scriptId]
  )).rows[0];
  assert.deepEqual(scriptAfter, {
    job_id: null, approved_by_user_at: null, edited_by_user: 0,
    segments: JSON.stringify(segments), validation_result: validationResult,
  });
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM jobs WHERE script_id=$1", [scriptId])).rows[0].n), 0);
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM credit_ledger WHERE org_id=$1 AND type='hold'", [orgId])).rows[0].n), 0);
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=$1 AND action='script.approved'", [scriptId])).rows[0].n), 0);
}

async function patchProdukOrg(token: string, body: Record<string, unknown>) {
  const { cookieName } = await import("../lib/auth");
  const { PATCH } = await import("../app/api/dashboard/campaign/product/route");
  return PATCH(new Request("http://localhost/api/dashboard/campaign/product", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: `${cookieName()}=${encodeURIComponent(token)}` },
    body: JSON.stringify(body),
  }));
}

async function siapkanJobOrgDenganManifest(label: string) {
  const ownerId = uid(), intruderId = uid(), orgId = uid(), intruderOrgId = uid();
  const productId = uid(), scriptId = uid(), jobId = uid(), t = at();
  const approvedSource = `uploads/e9-${label}/approved.webp`;
  const approvedSecondSource = `uploads/e9-${label}/approved-second.webp`;
  const otherSource = `uploads/e9-${label}/other.webp`;
  const approvedBytes = Buffer.from(`APPROVED-E9-${label}`);
  const approvedSecondBytes = Buffer.from(`APPROVED-SECOND-E9-${label}`);
  const snapshotRel = `jobs/${jobId}/approved-references/0-${sha256(approvedBytes)}.webp`;
  const snapshotRelSecond = `jobs/${jobId}/approved-references/1-${sha256(approvedSecondBytes)}.webp`;
  await pool.query(
    "INSERT INTO users (id,phone,tier,locale,created_at) VALUES ($1,$2,'free','id-ID',$3),($4,$5,'free','id-ID',$3)",
    [ownerId, `08129${label}01`, t, intruderId, `08129${label}02`]
  );
  await pool.query(
    "INSERT INTO organizations (id,name,slug,created_at) VALUES ($1,$2,$3,$5),($4,$6,$7,$5)",
    [orgId, `Org ${label}`, `org-${label}-${process.pid}`, intruderOrgId, t, `Org lain ${label}`, `org-lain-${label}-${process.pid}`]
  );
  await pool.query(
    "INSERT INTO org_members (id,org_id,user_id,role,created_at) VALUES ($1,$2,$3,'owner',$6),($4,$5,$7,'owner',$6)",
    [uid(), orgId, ownerId, uid(), intruderOrgId, t, intruderId]
  );
  await pool.query(
    `INSERT INTO products
      (id,user_id,org_id,name,price_idr,category,images,raw_meta,created_at)
     VALUES ($1,$2,$3,$4,85000,'beauty',$5,$6,$7)`,
    [productId, ownerId, orgId, `Serum E9 ${label}`, JSON.stringify([approvedSource, approvedSecondSource, otherSource]), JSON.stringify({ brand: "Merek E9" }), t]
  );
  await pool.query(
    `INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,approved_by_user_at,created_at)
     VALUES ($1,$2,'H1','senang','bestie',$3,'caption','[]','{}','silent_caption',$4,$4)`,
    [scriptId, productId, JSON.stringify(segmen), t]
  );
  const manifest = JSON.stringify({ version: 1, references: [
    { rel: approvedSource, sha256: sha256(approvedBytes), versiBukti: 1, snapshotRel },
    { rel: approvedSecondSource, sha256: sha256(approvedSecondBytes), versiBukti: 1, snapshotRel: snapshotRelSecond },
  ] });
  const { createJobProductSnapshotRaw } = await import("../lib/job-product-snapshot");
  const productSnapshot = createJobProductSnapshotRaw({ name: `Serum E9 ${label}`, category: "beauty", raw_meta: JSON.stringify({ brand: "Merek E9" }) });
  await pool.query(
    `INSERT INTO jobs
      (id,user_id,org_id,product_id,script_id,format,quality_tier,duration_s,approved_reference_manifest,job_product_snapshot,state,created_at,state_changed_at)
     VALUES ($1,$2,$3,$4,$5,'talking_head','silent_caption',15,$6,$7,'QUEUED',$8,$8)`,
    [jobId, ownerId, orgId, productId, scriptId, manifest, productSnapshot, t]
  );
  await pool.query("UPDATE scripts SET job_id=$1 WHERE id=$2", [jobId, scriptId]);
  await pool.query(
    `INSERT INTO credit_ledger (id,user_id,org_id,delta,type,job_id,created_at)
     VALUES ($1,$2,$3,50000,'bonus',NULL,$6),($4,$2,$3,-12000,'hold',$5,$6)`,
    [uid(), ownerId, orgId, uid(), jobId, t]
  );
  const { issueToken } = await import("../lib/auth");
  return {
    ownerId, intruderId, orgId, productId, jobId, approvedSource, approvedSecondSource, otherSource,
    approvedBytes, approvedSecondBytes, snapshotRel, snapshotRelSecond,
    ownerToken: await issueToken(ownerId, `08129${label}01`),
    intruderToken: await issueToken(intruderId, `08129${label}02`),
  };
}

async function hapusFotoOrg(productId: string, target: string, token: string) {
  const { cookieName } = await import("../lib/auth");
  const { DELETE: deleteOrgPhoto } = await import("../app/api/dashboard/campaign/product/[id]/photos/route");
  return deleteOrgPhoto(new Request(`http://localhost/api/dashboard/campaign/product/${productId}/photos`, {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie: `${cookieName()}=${encodeURIComponent(token)}` },
    body: JSON.stringify({ path: target }),
  }), { params: Promise.resolve({ id: productId }) });
}

function storageE9(values: Map<string, Buffer>, cascade?: { from: string; to: string }) {
  const deleteCalls: string[] = [];
  const putCalls: string[] = [];
  const materializeCalls: string[] = [];
  return {
    deleteCalls, putCalls, materializeCalls,
    storage: {
      async put(key: string, body: Buffer) { putCalls.push(key); values.set(key, Buffer.from(body)); },
      async delete(key: string) {
        deleteCalls.push(key); values.delete(key);
        if (cascade?.from === key) values.delete(cascade.to);
      },
      async get(key: string) { const body = values.get(key); return body ? { body: Buffer.from(body), size: body.length } : null; },
      async stat(key: string) { const body = values.get(key); return body ? { size: body.length } : null; },
      async materialize(key: string) {
        materializeCalls.push(key);
        const body = values.get(key); if (!body) return null;
        const target = path.join(tmpMaterialize, `${uid()}-${path.basename(key)}`);
        fs.writeFileSync(target, body); jalurMaterialize.set(target, key); return target;
      },
    },
  };
}

async function assertNoPaidEffectsPg(jobId: string, storage: ReturnType<typeof storageE9>) {
  assert.equal(await hitung("SELECT COUNT(*)::int AS n FROM outputs WHERE job_id=$1", [jobId]), 0);
  assert.equal(await hitung("SELECT COUNT(*)::int AS n FROM credit_ledger WHERE job_id=$1 AND type IN ('capture','regen')", [jobId]), 0);
  const row = (await pool.query("SELECT state,provider_video,provider_voice,output_url,cost_actual_idr FROM jobs WHERE id=$1", [jobId])).rows[0];
  assert.ok(["FAILED", "REFUNDED"].includes(row.state), `job berhenti di state aktif ${row.state}`);
  assert.equal(row.provider_video, null); assert.equal(row.provider_voice, null);
  assert.equal(row.output_url, null); assert.equal(Number(row.cost_actual_idr), 0);
  assert.deepEqual(storage.putCalls, [], `worker meninggalkan object storage: ${JSON.stringify(storage.putCalls)}`);
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
  assert.deepEqual(
    putCalls.filter((key) => !key.includes("/approved-references/")),
    [],
    `${konteks}: worker menulis output ke storage`
  );
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

  assert.ok(spy.materializeCalls.length >= 1, "kontrol positif tidak sampai ke materialize; penilaian LOLOS tidak pernah terjadi");
  assert.ok(spy.materializeCalls.every((key) => key === rel), "worker meminta referensi di luar manifest");
  const r = ringkasanKanari();
  assert.equal(r.dinilai, 1, "penilaian yang LOLOS tidak dicatat; kanari hanya punya pembilang");
  assert.equal(r.lolos, 1);
  assert.equal(r.ditolak, 0);
  assert.deepEqual(r.perAlasan, {}, "penolakan dicatat padahal referensinya lolos");
});

test("confirm tanpa template_id tetap mempersist snapshot dan W1 mengirim nol reference Story Ads", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  await pasangProviderPengamat();
  const rel = `uploads/w1-neutral-story-ads-${process.pid}/0.png`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const injection = "woman holding a bottle marked ACME beside a blank card";
  const jobId = await siapkanStoryAdsTanpaTemplateRequest(rel, injection);
  const persisted = (await pool.query("SELECT template_id,format,avatar_custom_desc FROM jobs WHERE id=$1", [jobId])).rows[0];
  assert.deepEqual(persisted, { template_id: "ads-meja-kosong", format: "ads", avatar_custom_desc: injection });
  await jalankan(jobId, new Map([[rel, png], [`${rel}.meta.json`, sidecar(png, true)]]), true);
  assert.equal(amatan.dipanggil, true, "W1 tidak mencapai provider observer");
  assert.equal(amatan.utamaPath, null, "neutral Story Ads mengirim primary product reference");
  assert.deepEqual(amatan.extraPaths, [], "neutral Story Ads mengirim extra product references");
  assert.match(amatan.promptText, /neutral blank props|plain unprinted|blank/i);
  assert.doesNotMatch(amatan.promptText, /ACME|holding a bottle|marked ACME/i);
});

test("shared confirm memblokir empat snapshot real-footage saat request template_id dihilangkan, tanpa side effect", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  for (const templateId of ["before-after", "t05-before-after", "t08-day-1-vs-day-7", "t10-bukti-di-lengan"]) {
    await assertBlockedSnapshotTanpaSideEffect(templateId);
  }
});

// ------------------------------------------------------------------- C1

test("E7 HTTP PATCH + resume W1: provider menerima snapshot admission dan packshot sah", async (t) => {
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
  const { jobId, productId, ownerToken, intruderToken } = await siapkanJobOrgLewatAdmisi([relBanner, relPackshot]);
  const productSnapshot = (await pool.query("SELECT job_product_snapshot FROM jobs WHERE id=$1", [jobId])).rows[0].job_product_snapshot;
  assert.ok(productSnapshot, "admission PostgreSQL wajib memasang snapshot sebelum worker mulai");
  const mutasi = {
    product_id: productId,
    name: "NAMA MUTASI E7",
    price_idr: 73000,
    category: "food",
    product_visual_desc: "DESC-MUTASI-E7",
    brand_brief: "BRIEF-MUTASI-E7",
    claims: ["klaim mutasi satu", "klaim mutasi dua"],
    promo_price_before_idr: 98000,
    promo_ends_at: "2031-02-03T04:05:06.000Z",
    promo_stock_left: 9,
  };
  const forbidden = await patchProdukOrg(intruderToken, mutasi);
  assert.equal(forbidden.status, 404, "anggota org lain dapat memutasi produk E7");
  assert.equal((await pool.query("SELECT name FROM products WHERE id=$1", [productId])).rows[0].name, "Serum Glow Bright");
  const response = await patchProdukOrg(ownerToken, mutasi);
  if (response.status !== 200) assert.fail(`PATCH E7 gagal (${response.status}): ${await response.text()}`);
  const responseBody = await response.json() as Record<string, unknown>;
  assert.equal(responseBody.product_id, productId); assert.equal(responseBody.name, mutasi.name);
  assert.equal(responseBody.category, mutasi.category); assert.equal(responseBody.product_visual_desc, mutasi.product_visual_desc);
  assert.equal(responseBody.brand_brief, mutasi.brand_brief); assert.deepEqual(responseBody.claims, mutasi.claims);
  assert.equal(responseBody.promo_price_before_idr, mutasi.promo_price_before_idr);
  assert.equal(responseBody.promo_ends_at, mutasi.promo_ends_at); assert.equal(responseBody.promo_stock_left, mutasi.promo_stock_left);
  const current = (await pool.query(
    "SELECT name,price_idr,category,product_visual_desc,brand_brief,claims,raw_meta,promo_price_before_idr,promo_ends_at,promo_stock_left FROM products WHERE id=$1",
    [productId]
  )).rows[0];
  assert.equal(current.name, mutasi.name); assert.equal(current.category, mutasi.category);
  assert.equal(current.product_visual_desc, mutasi.product_visual_desc); assert.equal(current.brand_brief, mutasi.brand_brief);
  assert.deepEqual(JSON.parse(current.claims), mutasi.claims);
  assert.equal(current.promo_price_before_idr, mutasi.promo_price_before_idr);
  const { parseJobProductSnapshot, createJobProductSnapshotRaw } = await import("../lib/job-product-snapshot");
  const admission = parseJobProductSnapshot(productSnapshot);
  assert.deepEqual(admission, {
    version: 1, productName: "Serum Glow Bright", category: "beauty",
    trustedBrand: { source: "products.raw_meta.brand", value: "Merek Awal" },
    productVisualDesc: "BOTOL-AMBER-AWAL", brandBrief: "ARAH-BRAND-AWAL", claims: ["klaim awal"],
  });
  const rereadNow = parseJobProductSnapshot(createJobProductSnapshotRaw(current));
  assert.notDeepEqual(rereadNow, admission, "counterexample gagal: re-read produk kini sama dengan snapshot admission");
  assert.equal(rereadNow.productName, mutasi.name); assert.equal(rereadNow.category, mutasi.category);
  assert.equal(rereadNow.productVisualDesc, mutasi.product_visual_desc); assert.equal(rereadNow.brandBrief, mutasi.brand_brief);
  assert.deepEqual(rereadNow.claims, mutasi.claims);
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
  const auditJob = (await pool.query("SELECT action,meta FROM audit_log WHERE entity_id=$1 ORDER BY created_at", [jobId])).rows;
  assert.ok(
    amatan.dipanggil,
    "provider tidak pernah menerima spec — eksekusi berhenti sebelum boundary, jadi asersi hash " +
      `di bawah tidak akan mengamati apa pun. Audit: ${JSON.stringify(auditJob)}`
  );
  assert.equal(
    amatan.utamaSha,
    sha256(PACKSHOT),
    `bytes yang SAMPAI KE PROVIDER bukan packshot yang buktinya sah (path ${amatan.utamaPath}).`
  );
  assert.notEqual(amatan.utamaSha, sha256(BANNER), "BANNER sampai ke provider");
  assert.match(amatan.promptText, /Serum Glow Bright/);
  assert.match(amatan.promptText, /BOTOL-AMBER-AWAL/);
  assert.match(amatan.promptText, /ARAH-BRAND-AWAL/);
  assert.doesNotMatch(amatan.promptText, /NAMA MUTASI E7|DESC-MUTASI-E7|BRIEF-MUTASI-E7/);
  const durableProduct = (await pool.query("SELECT job_product_snapshot FROM jobs WHERE id=$1", [jobId])).rows[0].job_product_snapshot;
  assert.equal(durableProduct, productSnapshot, "snapshot metadata W1 ditimpa dari produk mutasi");
});

test("E9 HTTP DELETE approved source + resume W1 tetap memakai snapshot job berurutan", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  const s = await siapkanJobOrgDenganManifest("stable");
  const values = new Map<string, Buffer>([
    [s.approvedSource, s.approvedBytes], [`${s.approvedSource}.meta.json`, Buffer.from("meta")],
    [s.approvedSecondSource, s.approvedSecondBytes], [`${s.approvedSecondSource}.meta.json`, sidecar(s.approvedSecondBytes, true)],
    [s.otherSource, Buffer.from("OTHER-E9")], [`${s.otherSource}.meta.json`, Buffer.from("meta")],
    [s.snapshotRel, s.approvedBytes], [s.snapshotRelSecond, s.approvedSecondBytes],
  ]);
  const storage = storageE9(values);
  const { setMediaStorageForTests } = await import("../lib/storage");
  setMediaStorageForTests(storage.storage as never);
  await pasangProviderPengamat();

  const forbidden = await hapusFotoOrg(s.productId, s.approvedSource, s.intruderToken);
  assert.equal(forbidden.status, 404, "anggota org lain dapat menghapus foto E9");
  assert.deepEqual(JSON.parse((await pool.query("SELECT images FROM products WHERE id=$1", [s.productId])).rows[0].images), [s.approvedSource, s.approvedSecondSource, s.otherSource]);

  const response = await hapusFotoOrg(s.productId, s.approvedSource, s.ownerToken);
  const body = await response.json() as { images: string[]; cleanup_failed: boolean };
  assert.equal(response.status, 200);
  assert.equal(body.cleanup_failed, false, "cleanup E9 sukses dilaporkan gagal");
  assert.deepEqual(body.images, [s.approvedSecondSource, s.otherSource]);
  const authoritative = JSON.parse((await pool.query("SELECT images FROM products WHERE id=$1", [s.productId])).rows[0].images);
  assert.deepEqual(authoritative, body.images, "response E9 bukan daftar pasca-mutasi otoritatif");
  assert.equal(values.has(s.approvedSource), false, "approved source target E9 tidak dihapus");
  assert.equal(values.has(`${s.approvedSource}.meta.json`), false, "sidecar approved target E9 tidak dihapus");
  assert.deepEqual(storage.deleteCalls, [s.approvedSource, `${s.approvedSource}.meta.json`], "cleanup E9 menyasar object yang salah");
  assert.equal(values.has(s.otherSource), true, "foto unrelated ikut terhapus");
  assert.equal(values.has(`${s.otherSource}.meta.json`), true, "sidecar unrelated ikut terhapus");
  assert.equal(values.has(`${s.approvedSecondSource}.meta.json`), true, "sidecar kedua unrelated ikut terhapus");
  assert.equal(values.has(s.snapshotRel), true, "cleanup E9 menghapus object privat job");

  const { resolveApprovedReference } = await import("../lib/product-truth");
  const currentResolution = await resolveApprovedReference(authoritative);
  assert.equal(currentResolution.utama?.rel, s.approvedSecondSource, "resolver canonical tidak memilih source #2 dari daftar E9 pasca-DELETE");
  assert.equal(currentResolution.utama?.sha256, sha256(s.approvedSecondBytes), "resolver canonical memilih identitas bytes source #2 E9 yang salah");
  assert.deepEqual(currentResolution.tersetujui.map((ref) => ref.rel), [s.approvedSecondSource], "daftar current-policy E9 bukan counterexample tunggal source #2");

  const { processPostgresJob } = await import("../lib/postgres/worker");
  await processPostgresJob(s.jobId);
  assert.equal(amatan.dipanggil, true, "resume W1 tidak mencapai provider observer");
  assert.equal(amatan.utamaSha, sha256(s.approvedBytes), "resume W1 memilih approved kedua dari current list, bukan snapshot job lama");
  assert.deepEqual(storage.materializeCalls.slice(0, 2), [s.snapshotRel, s.snapshotRelSecond], "urutan manifest W1 berubah saat resume");
  await assertNoPaidEffectsPg(s.jobId, storage);
});

test("E9 HTTP DELETE yang membuat object manifest hilang gagal tertutup sebelum provider W1", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  const s = await siapkanJobOrgDenganManifest("missing");
  const values = new Map<string, Buffer>([
    [s.approvedSource, s.approvedBytes], [`${s.approvedSource}.meta.json`, Buffer.from("meta")],
    [s.approvedSecondSource, s.approvedSecondBytes], [`${s.approvedSecondSource}.meta.json`, Buffer.from("meta")],
    [s.otherSource, Buffer.from("OTHER-E9")], [`${s.otherSource}.meta.json`, Buffer.from("meta")],
    [s.snapshotRel, s.approvedBytes], [s.snapshotRelSecond, s.approvedSecondBytes],
  ]);
  const storage = storageE9(values, { from: s.approvedSource, to: s.snapshotRel });
  const { setMediaStorageForTests } = await import("../lib/storage");
  const { setVideoProvidersForTests } = await import("../lib/providers/registry");
  setMediaStorageForTests(storage.storage as never);
  let providerCalls = 0;
  setVideoProvidersForTests([{ name: "must-not-run-e9", async healthCheck() { return true; }, estimateCost() { return 0; },
    async generate() { providerCalls++; throw new Error("provider called"); } } as never]);

  const response = await hapusFotoOrg(s.productId, s.approvedSource, s.ownerToken);
  const body = await response.json() as { images: string[] };
  assert.equal(response.status, 200);
  assert.deepEqual(body.images, [s.approvedSecondSource, s.otherSource]);
  assert.deepEqual(JSON.parse((await pool.query("SELECT images FROM products WHERE id=$1", [s.productId])).rows[0].images), body.images);
  assert.equal(values.has(s.snapshotRel), false, "fixture tidak menghilangkan object manifest saat cleanup E9");

  const { processPostgresJob } = await import("../lib/postgres/worker");
  await processPostgresJob(s.jobId);
  assert.equal(providerCalls, 0, "manifest missing E9 mencapai provider");
  await assertNoPaidEffectsPg(s.jobId, storage);
  const audit = (await pool.query("SELECT meta FROM audit_log WHERE entity_id=$1 AND action='job.transition' ORDER BY created_at", [s.jobId])).rows;
  assert.ok(audit.some((row) => String(row.meta).includes("REF_MISSING")), "alasan truthful REF_MISSING E9 tidak tercatat");
});

test("guard: bukti C12 memanggil handler E9 dan resume W1 nyata", () => {
  const source = fs.readFileSync(new URL(import.meta.url), "utf8");
  assert.match(source, /DELETE: deleteOrgPhoto/);
  assert.match(source, /await hapusFotoOrg/);
  assert.match(source, /await processPostgresJob\(s\.jobId\)/);
});

test("W1 A6/C9: manifest durable mengalahkan reorder/delete/add products.images", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  const approvedRel = `uploads/w1-manifest-${process.pid}/approved.webp`;
  const currentRel = `uploads/w1-manifest-${process.pid}/current.webp`;
  const approvedBytes = Buffer.from("APPROVED-IMMUTABLE-W1");
  const currentBytes = Buffer.from("CURRENT-NOT-APPROVED-W1");
  const jobId = await siapkanJob([currentRel]);
  const snapshotRel = `jobs/${jobId}/approved-references/0-approved.webp`;
  const raw = JSON.stringify({
    version: 1,
    references: [{ rel: approvedRel, sha256: sha256(approvedBytes), versiBukti: 1, snapshotRel }],
  });
  await pool.query("UPDATE jobs SET approved_reference_manifest=$1 WHERE id=$2", [raw, jobId]);
  const spy = await jalankan(jobId, new Map<string, Buffer>([
    [approvedRel, approvedBytes],
    [snapshotRel, approvedBytes],
    [currentRel, currentBytes],
    [`${currentRel}.meta.json`, sidecar(currentBytes, true)],
  ]));

  assert.deepEqual(spy.materializeCalls, [snapshotRel], "W1 tidak memakai snapshot durable manifest");
  assert.deepEqual(spy.getCalls, [], "W1 membaca ulang sidecar produk walau manifest durable sudah ada");
  const saved = (await pool.query("SELECT approved_reference_manifest FROM jobs WHERE id=$1", [jobId])).rows[0];
  assert.equal(saved.approved_reference_manifest, raw, "manifest W1 ditimpa saat resume");
  await assertNolEfekSamping(jobId, spy.putCalls, "W1 manifest reuse");
});

test("W1 manifest create konkuren: row lock menghasilkan tepat satu pemenang", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  const jobId = await siapkanJob([]);
  const { PgJobsRepository } = await import("../lib/postgres/jobs");
  const repoA = new PgJobsRepository(URL_UJI);
  const repoB = new PgJobsRepository(URL_UJI);
  const rawA = JSON.stringify({ version: 1, references: [{ rel: "a.webp", sha256: "a".repeat(64), versiBukti: 1, snapshotRel: `jobs/${jobId}/approved-references/a.webp` }] });
  const rawB = JSON.stringify({ version: 1, references: [{ rel: "b.webp", sha256: "b".repeat(64), versiBukti: 1, snapshotRel: `jobs/${jobId}/approved-references/b.webp` }] });
  const [a, b] = await Promise.all([
    repoA.installReferenceManifestIfSafe(jobId, rawA),
    repoB.installReferenceManifestIfSafe(jobId, rawB),
  ]);
  assert.ok(a && b);
  assert.equal(a, b, "dua worker memegang manifest berbeda untuk job sama");
  const durable = (await pool.query("SELECT approved_reference_manifest FROM jobs WHERE id=$1", [jobId])).rows[0].approved_reference_manifest;
  assert.equal(durable, a);
});

test("W1 product snapshot create konkuren: row lock menghasilkan tepat satu pemenang", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  const jobId = await siapkanJob([]);
  const { PgJobsRepository } = await import("../lib/postgres/jobs");
  const repoA = new PgJobsRepository(URL_UJI);
  const repoB = new PgJobsRepository(URL_UJI);
  const base = {
    version: 1,
    category: "beauty",
    trustedBrand: { source: "products.raw_meta.brand", value: "Merek" },
    productVisualDesc: null,
    brandBrief: null,
    claims: [],
  };
  const rawA = JSON.stringify({ ...base, productName: "A" });
  const rawB = JSON.stringify({ ...base, productName: "B" });
  const [a, b] = await Promise.all([
    repoA.installProductSnapshotIfSafe(jobId, rawA),
    repoB.installProductSnapshotIfSafe(jobId, rawB),
  ]);
  assert.ok(a && b);
  assert.equal(a, b, "dua worker memegang metadata snapshot berbeda untuk job sama");
  const durable = (await pool.query("SELECT job_product_snapshot FROM jobs WHERE id=$1", [jobId])).rows[0].job_product_snapshot;
  assert.equal(durable, a);
});

test("W1 legacy: jejak provider tanpa manifest gagal tertutup tanpa resnapshot", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  await pasangProviderPengamat();
  const rel = `uploads/w1-legacy-${process.pid}/0.webp`;
  const jobId = await siapkanJob([rel]);
  await pool.query("UPDATE jobs SET provider_video='legacy-provider' WHERE id=$1", [jobId]);
  const spy = await jalankan(jobId, new Map<string, Buffer>([[rel, PACKSHOT], [`${rel}.meta.json`, sidecar(PACKSHOT, true)]]));
  assert.deepEqual(spy.materializeCalls, [], "legacy unsafe mencapai materialize");
  assert.equal(amatan.dipanggil, false, "legacy unsafe mencapai provider");
  const row = (await pool.query("SELECT approved_reference_manifest,job_product_snapshot,state FROM jobs WHERE id=$1", [jobId])).rows[0];
  assert.equal(row.approved_reference_manifest, null);
  assert.equal(row.job_product_snapshot, null);
  assert.ok(["FAILED", "REFUNDED"].includes(row.state));
  assert.equal(await hitung("SELECT COUNT(*)::int AS n FROM outputs WHERE job_id=$1", [jobId]), 0);
  assert.equal(await hitung("SELECT COUNT(*)::int AS n FROM credit_ledger WHERE job_id=$1 AND type IN ('capture','regen')", [jobId]), 0);
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

// ------------------------------------------------------------------- C11

test("W1 C11: sidecar SAH tetapi berkas hilang saat worker mulai — REF_MISSING tanpa efek samping", async (t) => {
  if (lewati) return t.skip("UJI_PG_URL kosong");
  const { setMediaStorageForTests } = await import("../lib/storage");
  const { setVideoProvidersForTests } = await import("../lib/providers/registry");
  t.after(() => {
    setMediaStorageForTests(undefined);
    setVideoProvidersForTests(undefined);
  });
  const { resetKanariUntukTest, ringkasanKanari } = await import("../lib/kanari-bukti");
  const { ALASAN_TOLAK } = await import("../lib/product-truth");
  resetKanariUntukTest();
  await pasangProviderPengamat();

  const rel = `uploads/w1-c11-hilang-${process.pid}/0.webp`;
  // Sidecar sah sudah ada ketika worker mulai, tetapi payload yang dirujuknya
  // tidak ada. Dengan demikian vonis yang benar REF_MISSING, bukan C8
  // EVIDENCE_INVALID dan bukan race sesudah materialize.
  const isi = new Map<string, Buffer>([[`${rel}.meta.json`, sidecar(PACKSHOT, true)]]);
  const jobId = await siapkanJob([rel]);
  const spy = await jalankan(jobId, isi);

  assert.deepEqual(
    spy.getCalls,
    [`${rel}.meta.json`, rel],
    "fixture C11 tidak melewati urutan sidecar sah lalu payload hilang"
  );
  assert.deepEqual(spy.materializeCalls, [], "W1 C11: payload hilang tetap dicoba materialize");
  assert.equal(amatan.dipanggil, false, "W1 C11: provider sempat dipanggil");
  await assertNolEfekSamping(jobId, spy.putCalls, "W1 C11 REF_MISSING");

  const kanari = ringkasanKanari();
  assert.equal(kanari.dinilai, 1, "W1 C11: boundary resolver tidak tercatat");
  assert.equal(kanari.ditolak, 1, "W1 C11: referensi hilang tidak ditolak");
  assert.equal(
    kanari.perAlasan[ALASAN_TOLAK.BERKAS_HILANG],
    1,
    "W1 C11: jalur yang ditempuh bukan REF_MISSING"
  );
});

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
  assert.ok(new Set(spy.materializeCalls).size <= 7, `worker meminta ${new Set(spy.materializeCalls).size} identitas referensi`);
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
  const snapshotSources = new Map<string, string>();
  // SATU path untuk semua materialize — inilah "path bersama" itu.
  const pathBersama = path.join(tmpMaterialize, `bersama-${process.pid}.png`);
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

  const jobId = await siapkanJob([relSah1, relSah2], "high_quality");
  const { processPostgresJob } = await import("../lib/postgres/worker");
  await processPostgresJob(jobId);

  await assertNolEfekSamping(jobId, putCalls, "W1 TOCTOU");
  assert.equal(materializeCalls.length % 2, 0, "verifikasi manifest tidak terdiri dari batch lengkap");
  for (let i = 0; i < materializeCalls.length; i += 2) {
    assert.deepEqual(materializeCalls.slice(i, i + 2), [relSah1, relSah2], "setiap boundary provider wajib memverifikasi kedua referensi berurutan");
  }
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
