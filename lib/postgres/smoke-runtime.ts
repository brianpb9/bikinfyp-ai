/**
 * Temporary, explicitly gated HTTP smoke composition for checkpoint 1E.
 *
 * It deliberately has no effect unless RACUN_POSTGRES_SMOKE=1.  The normal
 * application runtime continues to use SQLite until the later cutover.  The
 * functions below compose the already parity-tested repositories behind the
 * real route handlers, so the rehearsal exercises auth -> content -> job ->
 * output over PostgreSQL rather than calling verifier classes directly.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import type { UserRow } from "../db";
import { config } from "../config";
import { runtimeAuthSecret } from "../auth-secret-policy";
import { SQL_RIWAYAT_PG, bersihkanRiwayat } from "../script-engine/riwayat-mekanik";
import { PgAuthOtpAuditRepository } from "./auth-otp-audit";
import { PgProductPersonaScriptRepository, type PgProductInput, type PgScriptInput } from "./product-persona-script";
import { PgJobsRepository } from "./jobs";
import { PgCreditPaymentRepository } from "./credit-payment";
import { runFf } from "../media/ffmpeg";
import { mediaStorage } from "../storage";
import { getPool } from "./pool";
import { createJobProductSnapshotRaw } from "../job-product-snapshot";
import { cleanupSupersededReferenceKeys, cleanupUnadmittedReferenceKeys, prepareAdmissionReferenceManifest } from "../job-admission-reference";

/**
 * PostgreSQL runtime switch.  `RACUN_POSTGRES_SMOKE=1` is retained solely for
 * the disposable 1E smoke command; normal cutover uses
 * `RACUN_DB_RUNTIME=postgres`.  The switch is deliberately opt-in in local
 * development, preserving SQLite as a rollback path.
 */
export const postgresRuntimeEnabled = () =>
  process.env.RACUN_POSTGRES_SMOKE === "1" || process.env.RACUN_DB_RUNTIME === "postgres";
// Compatibility name for the already-tested 1E handlers.
export const postgresSmokeEnabled = () => process.env.RACUN_POSTGRES_SMOKE === "1";
function url() {
  if (!postgresRuntimeEnabled() || !/^postgres(?:ql)?:\/\//i.test(config.databaseUrl)) {
    throw new Error("Runtime PostgreSQL memerlukan RACUN_DB_RUNTIME=postgres dan DATABASE_URL PostgreSQL.");
  }
  return config.databaseUrl;
}
const id = () => crypto.randomUUID();
const at = () => new Date().toISOString();

export async function smokeFindOrCreateUser(phone: string): Promise<UserRow> {
  const repo = new PgAuthOtpAuditRepository(url(), { authSecret: runtimeAuthSecret(), otpExpiryMin: config.otpExpiryMin, otpMaxAttempts: config.otpMaxAttempts, otpRateLimitPer15Min: config.otpRateLimitPer15Min });
  try { return await repo.findOrCreateUserByPhone(phone); } finally { await repo.close(); }
}
export async function smokeGetUser(userId: string): Promise<UserRow | null> {
  const pool = getPool(url());
  try { return (await pool.query<UserRow>("SELECT * FROM users WHERE id=$1", [userId])).rows[0] ?? null; } finally { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }
}
// org_id IS NULL (F-ENT-01 fix, 2026-08-11): SEBELUM filter ini, seorang
// user yang JUGA owner sebuah org (credit_ledger.user_id org SELALU diisi
// user_id owner, lihat admin-grant-org-credit.mjs) akan melihat saldo
// retailnya ketambahan saldo org — WHERE user_id=? polos ikut menjumlahkan
// baris org itu. Baris retail lama tidak pernah punya org_id jadi filter
// ini transparan buat semua user yang bukan owner org manapun.
export async function pgGetBalance(userId: string): Promise<number> {
  const pool = getPool(url());
  try { return Number((await pool.query<{ balance: string }>("SELECT COALESCE(SUM(delta),0) AS balance FROM credit_ledger WHERE user_id=$1 AND org_id IS NULL", [userId])).rows[0]?.balance ?? 0); }
  finally { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }
}
export async function pgGetLedger(userId: string, limit = 50) {
  const pool = getPool(url());
  try { return (await pool.query("SELECT * FROM credit_ledger WHERE user_id=$1 AND org_id IS NULL ORDER BY created_at DESC,id DESC LIMIT $2", [userId, limit])).rows; }
  finally { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }
}
export async function pgCreditTopup(input: { userId: string; packageId: string; gateway: string; gatewayRef: string; rawPayload?: unknown }) {
  const repo = new PgCreditPaymentRepository(url()); try { return await repo.creditTopup(input); } finally { await repo.close(); }
}
export async function pgCreateCheckout(input: { userId: string; gateway: string; gatewayRef: string; packageId: string; rawPayload?: unknown }) {
  const repo = new PgCreditPaymentRepository(url()); try { return await repo.createCheckout(input); } finally { await repo.close(); }
}
export async function pgMarkPaymentFailed(gateway: string, gatewayRef: string, rawPayload?: unknown) {
  const repo = new PgCreditPaymentRepository(url()); try { return await repo.markPaymentFailed(gateway, gatewayRef, rawPayload); } finally { await repo.close(); }
}
export async function pgMarkPaymentInitiationFailed(gateway: string, gatewayRef: string, rawPayload: unknown) {
  const repo = new PgCreditPaymentRepository(url()); try { return await repo.markPaymentInitiationFailed(gateway, gatewayRef, rawPayload); } finally { await repo.close(); }
}
export async function pgGetPayment(gatewayRef: string, userId?: string) {
  const pool = getPool(url());
  try { return (await pool.query(`SELECT * FROM payments WHERE gateway_ref=$1${userId ? " AND user_id=$2" : ""}`, userId ? [gatewayRef, userId] : [gatewayRef])).rows[0] ?? null; }
  finally { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }
}
export async function pgFindUser(input: { id?: string; phone?: string }) {
  const pool = getPool(url());
  try { return (await pool.query<UserRow>(input.id ? "SELECT * FROM users WHERE id=$1" : "SELECT * FROM users WHERE phone=$1", [input.id ?? input.phone ?? ""])).rows[0] ?? null; }
  finally { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }
}
export async function pgCanExtract(userId: string): Promise<boolean> {
  const pool = getPool(url());
  try {
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const result = await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM audit_log WHERE actor=$1 AND action='product.extract' AND created_at>$2", [userId, since]);
    return (result.rows[0]?.n ?? 0) < 10;
  } finally { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }
}
export async function pgAudit(actor: string, action: string, entity: string, entityId: string | null, meta: unknown = {}) {
  const repo = new PgAuthOtpAuditRepository(url(), { authSecret: runtimeAuthSecret(), otpExpiryMin: config.otpExpiryMin, otpMaxAttempts: config.otpMaxAttempts, otpRateLimitPer15Min: config.otpRateLimitPer15Min });
  try { await repo.appendAudit(actor, action, entity, entityId, meta); } finally { await repo.close(); }
}
export async function pgCanRequestOtp(email: string) {
  const repo = new PgAuthOtpAuditRepository(url(), { authSecret: runtimeAuthSecret(), otpExpiryMin: config.otpExpiryMin, otpMaxAttempts: config.otpMaxAttempts, otpRateLimitPer15Min: config.otpRateLimitPer15Min });
  try { return await repo.canRequestOtp(email); } finally { await repo.close(); }
}
export async function pgStoreOtp(email: string, code: string) {
  const repo = new PgAuthOtpAuditRepository(url(), { authSecret: runtimeAuthSecret(), otpExpiryMin: config.otpExpiryMin, otpMaxAttempts: config.otpMaxAttempts, otpRateLimitPer15Min: config.otpRateLimitPer15Min });
  try { await repo.storeOtp(email, code); } finally { await repo.close(); }
}
export async function pgVerifyOtp(email: string, code: string) {
  const repo = new PgAuthOtpAuditRepository(url(), { authSecret: runtimeAuthSecret(), otpExpiryMin: config.otpExpiryMin, otpMaxAttempts: config.otpMaxAttempts, otpRateLimitPer15Min: config.otpRateLimitPer15Min });
  try { return await repo.verifyOtp(email, code); } finally { await repo.close(); }
}
export async function smokeCreateProduct(userId: string, input: PgProductInput, productId?: string) {
  const repo = new PgProductPersonaScriptRepository(url(), productId ? { uuid: () => productId } : {});
  try { return await repo.createProduct(userId, input); } finally { await repo.close(); }
}
export async function smokeGetProduct(userId: string, productId: string) {
  const repo = new PgProductPersonaScriptRepository(url());
  try { return await repo.getOwnedProduct(userId, productId); } finally { await repo.close(); }
}
export async function pgUpdateProduct(userId: string, productId: string, patch: { name: string; priceIdr: number; category: string; productVisualDesc: string | null; promoPriceBeforeIdr?: number | null; promoEndsAt?: string | null; promoStockLeft?: number | null }) {
  const repo = new PgProductPersonaScriptRepository(url());
  try { return await repo.updateOwnedProduct(userId, productId, patch); } finally { await repo.close(); }
}
/**
 * Mekanik yang dipakai merek ini dalam jendela riwayat (slice 4, 20 Agu).
 * Dibaca dari kolom JSON yang sudah ada. (Alasan lama "migrasi terkunci"
 * sudah kedaluwarsa: 0030-0032 terpasang sejak 18 Agu, diverifikasi 20 Agu.
 * Bentuknya dipertahankan karena datanya memang cocok di JSON, bukan karena
 * migrasi tidak bisa dijalankan.) Sisa komentar lama di bawah:
 * — bekas alasan: rekonsiliasi
 * ledger selesai (keputusan Brian).
 */
export async function pgMekanikDipakaiBrand(productId: string, sejakIso: string) {
  const pool = getPool(url());
  const r = await pool.query<{ mechanic: string | null }>(SQL_RIWAYAT_PG, [productId, sejakIso]);
  return bersihkanRiwayat(r.rows);
}
export async function pgSetProductBrand(userId: string, productId: string, brand: string | null) {
  const repo = new PgProductPersonaScriptRepository(url());
  try { return await repo.setOwnedProductBrand(userId, productId, brand); } finally { await repo.close(); }
}
export async function pgFindOrCreatePersona(userId: string, category: { id: string; name: string }) {
  const repo = new PgProductPersonaScriptRepository(url());
  try { return await repo.findOrCreatePersona(userId, category); } finally { await repo.close(); }
}
export async function pgGetPersona(userId: string, personaId: string) {
  const repo = new PgProductPersonaScriptRepository(url());
  try { return await repo.getOwnedPersona(userId, personaId); } finally { await repo.close(); }
}
export async function smokeCreateScripts(userId: string, productId: string, variants: PgScriptInput[], orgId?: string) {
  const repo = new PgProductPersonaScriptRepository(url());
  try { return await repo.createScripts(userId, productId, variants, orgId); } finally { await repo.close(); }
}
/** Produk milik org — dipakai seluruh permukaan dashboard. Lihat getOrgProduct. */
export async function smokeGetOrgProduct(orgId: string, productId: string) {
  const repo = new PgProductPersonaScriptRepository(url());
  try { return await repo.getOrgProduct(orgId, productId); } finally { await repo.close(); }
}
/**
 * Event funnel di runtime PostgreSQL.
 *
 * Tabelnya sudah ada sejak migrasi 0010; yang tidak pernah ada adalah
 * PENULISNYA. app/api/events cuma menulis ke SQLite, jadi di produksi SETIAP
 * event dibuang — funnel, konversi, dan seluruh dasar keputusan produk kosong
 * tanpa satu pun tanda bahwa ada yang hilang.
 *
 * Tetap fire-and-forget: telemetri tidak boleh pernah mengganggu jalur produk.
 */
export async function pgInsertEvent(input: { userId: string | null; anonId: string | null; name: string; meta: string | null }) {
  const pool = getPool(url());
  await pool.query(
    "INSERT INTO events (id,user_id,anon_id,name,meta,created_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [crypto.randomUUID(), input.userId, input.anonId, input.name, input.meta, new Date().toISOString()]
  );
}

/**
 * Simpan arsip prompt. Idempoten (job yang di-retry menimpa arsipnya sendiri,
 * karena prompt bisa BERUBAH antar percobaan dan yang berguna dibedah adalah
 * yang terakhir dikirim).
 *
 * Kegagalan di sini TIDAK boleh menggagalkan job — pemanggil membungkusnya.
 */
export async function pgSimpanArsipPrompt(input: {
  jobId: string; specJson: string; segmentsJson: string; negativePrompt: string;
  modelParams: string; ideId?: string | null; ideSkor?: number | null;
}) {
  const pool = getPool(url());
  await pool.query(
    `INSERT INTO job_prompts (job_id,spec_json,segments_json,negative_prompt,model_params,ide_id,ide_skor,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (job_id) DO UPDATE SET
       spec_json=EXCLUDED.spec_json, segments_json=EXCLUDED.segments_json,
       negative_prompt=EXCLUDED.negative_prompt, model_params=EXCLUDED.model_params,
       ide_id=EXCLUDED.ide_id, ide_skor=EXCLUDED.ide_skor, created_at=EXCLUDED.created_at`,
    [input.jobId, input.specJson, input.segmentsJson, input.negativePrompt, input.modelParams,
     input.ideId ?? null, input.ideSkor ?? null, new Date().toISOString()]
  );
}

export async function smokeGetScript(userId: string, scriptId: string, orgId?: string) {
  const repo = new PgProductPersonaScriptRepository(url());
  try { return await repo.getOwnedScript(userId, scriptId, orgId); } finally { await repo.close(); }
}
export async function smokeApproveScript(userId: string, scriptId: string, update: { segments: unknown; edited: boolean; validationResult: unknown }, orgId?: string) {
  const repo = new PgProductPersonaScriptRepository(url());
  try { return await repo.approveOwnedScript(userId, scriptId, update, orgId); } finally { await repo.close(); }
}

export async function smokeCreateJob(userId: string, input: {
  productId: string; scriptId: string; format: string; qualityTier: string;
  durationS: number; priceIdr: number; avatarCustomDesc?: string | null;
  /** Disposable PostgreSQL verifier only; application routes never set it. */
  onRetryForTests?: (event: { attempt: number; jobId: string; code: "40001" | "40P01" }) => Promise<void>;
}) {
  const pool = getPool(url());
  try {
    // The user-row lock serializes wallet spends and the script-row lock
    // serializes duplicate decisions. Read Committed then observes the latest
    // balance after the lock wait; SERIALIZABLE would retain a pre-wait
    // snapshot and abort independent admissions under a burst.
    // One id across bounded transaction retries makes storage-first writes
    // deterministic and idempotent even after 40001/40P01.
    const jobId = id();
    const preparedSnapshotRels = new Set<string>();
    for (let attempt = 0; attempt < 5; attempt++) {
      const client = await pool.connect();
      let commitAttempted = false;
      try {
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        // Serialize spends for the same wallet before any predicate read. It
        // prevents concurrent balance aggregates from becoming serialization
        // pivots, while admissions for different users remain concurrent.
        const user = await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
        if (!user.rows[0]) throw new Error("USER_NOT_FOUND");
        // Lock the script row, not a predicate over the whole jobs table. The
        // old predicate read made independent scripts conflict under
        // SERIALIZABLE admission. `scripts.job_id` is the canonical latest
        // job pointer, so this preserves duplicate prevention while allowing
        // different scripts to be admitted concurrently.
        const script = await client.query<{ job_id: string | null }>("SELECT job_id FROM scripts WHERE id=$1 FOR UPDATE", [input.scriptId]);
        if (!script.rows[0]) throw new Error("SCRIPT_NOT_FOUND");
        if (script.rows[0].job_id) {
          const active = await client.query<{ id: string }>("SELECT id FROM jobs WHERE id=$1 AND state NOT IN ('FAILED','REFUNDED','READY') FOR UPDATE", [script.rows[0].job_id]);
          if (active.rows[0]) {
            commitAttempted = true;
            await client.query("COMMIT");
            await cleanupUnadmittedReferenceKeys({
              jobId,
              snapshotRels: preparedSnapshotRels,
              runtime: "admission-postgres-retail",
              proveJobAbsent: async () => !(await client.query("SELECT id FROM jobs WHERE id=$1", [jobId])).rows[0],
            });
            return { jobId: active.rows[0].id, duplicate: true };
          }
        }
        // Preflight under the wallet lock prevents known-insufficient requests
        // from producing durable objects. The final balance read remains after
        // preparation and is still the authoritative admission check.
        const preflightBalance = await client.query<{ balance: string }>("SELECT COALESCE(SUM(delta),0) AS balance FROM credit_ledger WHERE user_id=$1", [userId]);
        if (Number(preflightBalance.rows[0].balance) < input.priceIdr) throw new Error("INSUFFICIENT_CREDITS");
        // A shared row lock keeps product mutation behind COMMIT while the
        // admission snapshot and job row are installed atomically.
        const product = await client.query<{
          name: string; category: string; price_idr: number; raw_meta: string | null;
          product_visual_desc: string | null; brand_brief: string | null; claims: string | null; images: string;
        }>("SELECT name,category,price_idr,raw_meta,product_visual_desc,brand_brief,claims,images FROM products WHERE id=$1 AND user_id=$2 FOR SHARE", [input.productId, userId]);
        if (!product.rows[0]) throw new Error("PRODUCT_NOT_FOUND");
        const productSnapshotRaw = createJobProductSnapshotRaw(product.rows[0]);
        // Product FOR SHARE blocks E3/E5 until the job row and exact manifest
        // commit. Storage failure happens before hold/queue visibility.
        const preparedReference = await prepareAdmissionReferenceManifest({
          jobId,
          productId: input.productId,
          candidateRels: JSON.parse(product.rows[0].images) as string[],
          runtime: "admission-postgres-retail",
          onSnapshotTarget: (snapshotRel) => preparedSnapshotRels.add(snapshotRel),
        });
        preparedReference.manifest.references.forEach((ref) => preparedSnapshotRels.add(ref.snapshotRel));
        const balance = await client.query<{ balance: string }>("SELECT COALESCE(SUM(delta),0) AS balance FROM credit_ledger WHERE user_id=$1", [userId]);
        if (Number(balance.rows[0].balance) < input.priceIdr) throw new Error("INSUFFICIENT_CREDITS");
        const timestamp = at();
        // avatar_custom_desc ikut ditulis: sejak avatar premium dibuka untuk
        // retail, deskripsi presetnya harus sampai ke worker — worker Postgres
        // sudah membacanya sejak M8, jalur retail yang belum mengirimnya.
        await client.query("INSERT INTO jobs (id,user_id,product_id,persona_id,script_id,format,quality_tier,duration_s,avatar_custom_desc,approved_reference_manifest,job_product_snapshot,state,created_at,state_changed_at) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,'QUEUED',$11,$11)", [jobId,userId,input.productId,input.scriptId,input.format,input.qualityTier,input.durationS,input.avatarCustomDesc ?? null,preparedReference.raw,productSnapshotRaw,timestamp]);
        await client.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,payment_id,created_at) VALUES ($1,$2,$3,'hold',$4,NULL,$5)", [id(),userId,-input.priceIdr,jobId,timestamp]);
        await client.query("UPDATE scripts SET job_id=$1 WHERE id=$2", [jobId,input.scriptId]);
        await client.query("INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,$2,'job.created','jobs',$3,$4,$5)", [id(),userId,jobId,JSON.stringify({ script_id: input.scriptId, smoke: true }),timestamp]);
        commitAttempted = true;
        await client.query("COMMIT");
        await cleanupSupersededReferenceKeys({
          jobId,
          snapshotRels: preparedSnapshotRels,
          runtime: "admission-postgres-retail",
          readCommittedManifest: async () => (await client.query<{ approved_reference_manifest: string }>(
            "SELECT approved_reference_manifest FROM jobs WHERE id=$1", [jobId]
          )).rows[0]?.approved_reference_manifest ?? null,
        });
        return { jobId, duplicate: false };
      } catch (error) {
        const rollbackSucceeded = await client.query("ROLLBACK").then(() => true, () => false);
        const code = (error as { code?: string }).code;
        if ((code === "40001" || code === "40P01") && attempt < 4) {
          await input.onRetryForTests?.({ attempt, jobId, code });
          await new Promise((resolve) => setTimeout(resolve, 25 * (2 ** attempt) + Math.floor(Math.random() * 25)));
          continue;
        }
        // A successful rollback before COMMIT plus a fresh absent-row query is
        // positive proof that this job id did not win. COMMIT/network errors
        // remain ambiguous and deliberately retain the deterministic objects.
        if (!commitAttempted && rollbackSucceeded && preparedSnapshotRels.size > 0) {
          await cleanupUnadmittedReferenceKeys({
            jobId,
            snapshotRels: preparedSnapshotRels,
            runtime: "admission-postgres-retail",
            proveJobAbsent: async () => !(await client.query("SELECT id FROM jobs WHERE id=$1", [jobId])).rows[0],
          });
        }
        throw error;
      } finally { client.release(); }
    }
    throw new Error("Transaksi PostgreSQL admission habis retry.");
  } finally { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }
}

/** Deterministic local provider hook: no external media/provider credentials. */
export async function smokeCompleteJob(jobId: string) {
  const jobs = new PgJobsRepository(url(), { stateTimeoutsMin: config.stateTimeoutsMin });
  const pool = getPool(url());
  try {
    for (const state of ["GENERATING_VISUAL", "GENERATING_VOICE", "COMPOSITING", "QC_CHECK", "LABELING"] as const) {
      if (!(await jobs.transition(jobId, state, { provider: "deterministic-smoke" }))) throw new Error("Job smoke tidak aktif.");
    }
    const found = await pool.query("SELECT j.*, s.caption, s.hashtags, p.category FROM jobs j JOIN scripts s ON s.id=j.script_id JOIN products p ON p.id=j.product_id WHERE j.id=$1", [jobId]);
    const job = found.rows[0]; if (!job) throw new Error("Job smoke tidak ditemukan.");
    const outputUrl = `smoke/${jobId}.mp4`;
    const outputPath = path.join(config.storageDir, outputUrl);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    // Local deterministic provider fixture: a 15s H.264/AAC asset, with a
    // quiet tone so the existing smoke's duration/audio assertions stay real.
    await runFf(config.ffmpegPath, ["-y", "-f", "lavfi", "-i", "color=c=0x1f2937:s=720x1280:r=30:d=15", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=15", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", outputPath]);
    await mediaStorage().put(outputUrl, fs.readFileSync(outputPath), "video/mp4");
    if (config.storageMode === "r2") fs.rmSync(outputPath, { force: true });
    console.log(`[job ${jobId.slice(0, 8)}] watermark AIGC aktif (deterministic PostgreSQL smoke)`);
    await pool.query("INSERT INTO outputs (job_id,video_url,caption,hashtags,suggested_post_time,compliance_checklist) VALUES ($1,$2,$3,$4,$5,$6)", [jobId,outputUrl,job.caption,job.hashtags,"19:00",JSON.stringify(["AIGC label verified (deterministic smoke)"])]);
    await pool.query("UPDATE jobs SET provider_video='deterministic-smoke',provider_voice='none-silent-caption',cost_actual_idr=0,output_url=$1,qc_result=$2,completed_at=$3 WHERE id=$4", [outputUrl,JSON.stringify({ passed: true, checks: [{ code: "QC-08", status: "pass" }]}),at(),jobId]);
    if (!(await jobs.transition(jobId, "READY", { provider: "deterministic-smoke" }))) throw new Error("READY ditolak.");
    await pool.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,payment_id,created_at) VALUES ($1,$2,0,'capture',$3,NULL,$4)", [id(),job.user_id,jobId,at()]);
  } finally { await jobs.close(); /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }
}
// "org_id IS NULL" — jalur RETAIL hanya melihat job retail.
//
// Pembuatan job organisasi lewat API retail sudah ditutup, tapi PEMBACAANNYA
// belum: anggota org masih bisa menarik job, output, dan report organisasi
// lewat endpoint retail berdasarkan user_id saja. Yang bocor bukan uangnya
// melainkan pemisahan jalurnya — job merek muncul di riwayat pribadi, di luar
// library dan di luar kendali organisasinya.
export async function smokeGetJob(userId: string, jobId: string) { const pool = getPool(url()); try { return (await pool.query("SELECT * FROM jobs WHERE id=$1 AND user_id=$2 AND org_id IS NULL", [jobId,userId])).rows[0] ?? null; } finally { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ } }
export async function smokeGetOutput(userId: string, jobId: string) { const pool = getPool(url()); try { return (await pool.query("SELECT o.* FROM outputs o JOIN jobs j ON j.id=o.job_id WHERE o.job_id=$1 AND j.user_id=$2 AND j.org_id IS NULL", [jobId,userId])).rows[0] ?? null; } finally { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ } }
export async function pgListJobs(userId: string) {
  const pool = getPool(url());
  // o.video_url ikut diambil supaya daftar riwayat bisa menampilkan frame video
  // hasil, bukan foto produk yang sama untuk semua video (lihat attachPreview
  // di app/api/jobs/route.ts). LEFT JOIN — job yang belum selesai tidak punya
  // baris outputs.
  try { return (await pool.query("SELECT j.id,j.state,j.format,j.duration_s,j.created_at,j.completed_at,j.provider_video,j.provider_voice,j.cost_actual_idr,j.script_id,p.name AS product_name,p.images AS product_images,o.video_url AS output_video,fs.score AS fyp_score,fs.posted_url AS fyp_posted_url FROM jobs j JOIN products p ON p.id=j.product_id LEFT JOIN outputs o ON o.job_id=j.id LEFT JOIN fyp_snapshots fs ON fs.job_id=j.id WHERE j.user_id=$1 AND j.org_id IS NULL ORDER BY j.created_at DESC LIMIT 50", [userId])).rows; }
  finally { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }
}

/** Atomic retail append. The resulting list is derived inside PostgreSQL so a
 * concurrent delete cannot be resurrected by a stale route snapshot. */
export async function pgAppendRetailProductImages(userId: string, productId: string, added: string[], maxImages: number) {
  const pool = getPool(url());
  try {
    const result = await pool.query(
      `UPDATE products
       SET images=(COALESCE(NULLIF(images,''),'[]')::jsonb || $3::jsonb)::text
       WHERE id=$1 AND user_id=$2 AND org_id IS NULL
         AND jsonb_array_length(COALESCE(NULLIF(images,''),'[]')::jsonb) + $4 <= $5
       RETURNING images`,
      [productId, userId, JSON.stringify(added), added.length, maxImages]
    );
    return result.rows[0]?.images ? JSON.parse(result.rows[0].images) as string[] : null;
  } finally { /* shared pool */ }
}

/** Atomic retail removal paired with pgAppendRetailProductImages. */
export async function pgRemoveRetailProductImage(userId: string, productId: string, target: string, client?: PoolClient) {
  const pool = client ?? getPool(url());
  try {
    const result = await pool.query(
      `UPDATE products
       SET images=(SELECT COALESCE(jsonb_agg(value),'[]'::jsonb)::text
                   FROM jsonb_array_elements_text(COALESCE(NULLIF(images,''),'[]')::jsonb) AS value
                   WHERE value <> $3)
       WHERE id=$1 AND user_id=$2 AND org_id IS NULL
         AND COALESCE(NULLIF(images,''),'[]')::jsonb ? $3
       RETURNING images`,
      [productId, userId, target]
    );
    return result.rows[0]?.images ? JSON.parse(result.rows[0].images) as string[] : null;
  } finally { /* shared pool */ }
}

/** Organization product photo mutation. The org key is part of the UPDATE,
 * not merely checked beforehand, so a cross-org id cannot win a race. */
export async function pgAppendOrgProductImages(
  orgId: string,
  productId: string,
  expectedImages: string[],
  added: string[],
  maxImages: number
) {
  const pool = getPool(url());
  try {
    const result = await pool.query(
      `UPDATE products
       SET images=(COALESCE(NULLIF(images,''),'[]')::jsonb || $4::jsonb)::text
       WHERE id=$1 AND org_id=$2
         AND COALESCE(NULLIF(images,''),'[]')::jsonb = $3::jsonb
         AND jsonb_array_length(COALESCE(NULLIF(images,''),'[]')::jsonb) + $5 <= $6
       RETURNING images`,
      [productId, orgId, JSON.stringify(expectedImages), JSON.stringify(added), added.length, maxImages]
    );
    return result.rows[0]?.images ? JSON.parse(result.rows[0].images) as string[] : null;
  } finally { /* shared pool */ }
}

/** Atomic removal: concurrent appends survive, and a repeated delete cannot
 * claim success for a path that is already absent. */
export async function pgRemoveOrgProductImage(orgId: string, productId: string, target: string, client?: PoolClient) {
  const pool = client ?? getPool(url());
  try {
    const result = await pool.query(
      `UPDATE products
       SET images=(SELECT COALESCE(jsonb_agg(value),'[]'::jsonb)::text
                   FROM jsonb_array_elements_text(COALESCE(NULLIF(images,''),'[]')::jsonb) AS value
                   WHERE value <> $3)
       WHERE id=$1 AND org_id=$2
         AND COALESCE(NULLIF(images,''),'[]')::jsonb ? $3
       RETURNING images`,
      [productId, orgId, target]
    );
    return result.rows[0]?.images ? JSON.parse(result.rows[0].images) as string[] : null;
  } finally { /* shared pool */ }
}

/** Snapshot Skor FYP beku (padanan createFypSnapshot SQLite) — idempoten via
 * ON CONFLICT DO NOTHING; dipanggil non-fatal setelah job dibuat. */
export async function pgSaveFypSnapshot(input: {
  jobId: string; scriptId: string; modelVersion: string; score: number;
  rawProbability: number; featuresJson: string;
}) {
  const pool = getPool(url());
  try {
    await pool.query(
      `INSERT INTO fyp_snapshots (job_id, script_id, model_version, score, raw_probability, features_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (job_id) DO NOTHING`,
      [input.jobId, input.scriptId, input.modelVersion, input.score, input.rawProbability, input.featuresJson, at()]
    );
  } finally { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }
}

/** Lapor hasil posting (padanan applyFypReport SQLite): posted_url BEKU setelah
 * terisi (nilai beda -> Error), outcome upsert. Validasi URL dilakukan pemanggil. */
export async function pgApplyFypReport(userId: string, jobId: string, report: { postedUrl: string; views: number | null; orders: number | null }) {
  const pool = getPool(url());
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT fs.* FROM fyp_snapshots fs JOIN jobs j ON j.id=fs.job_id WHERE fs.job_id=$1 AND j.user_id=$2 AND j.org_id IS NULL FOR UPDATE`,
      [jobId, userId]
    );
    const row = found.rows[0];
    if (!row) { await client.query("ROLLBACK"); return null; }
    if (row.posted_url && row.posted_url !== report.postedUrl) {
      await client.query("ROLLBACK");
      throw new Error("FYP_POSTED_URL_FROZEN");
    }
    const prev = row.outcome_json ? JSON.parse(row.outcome_json) : {};
    const outcome = { views: report.views ?? prev.views ?? null, orders: report.orders ?? prev.orders ?? null };
    const hasOutcome = outcome.views !== null || outcome.orders !== null;
    await client.query(
      `UPDATE fyp_snapshots SET posted_url = COALESCE(posted_url,$1), posted_at = COALESCE(posted_at,$2),
         outcome_json = $3, outcome_updated_at = CASE WHEN $4 THEN $2 ELSE outcome_updated_at END
       WHERE job_id = $5`,
      [report.postedUrl, at(), hasOutcome ? JSON.stringify(outcome) : row.outcome_json, hasOutcome, jobId]
    );
    const updated = await client.query("SELECT * FROM fyp_snapshots WHERE job_id=$1", [jobId]);
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }
}
