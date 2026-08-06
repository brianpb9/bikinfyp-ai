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
import { Pool } from "pg";
import type { UserRow } from "../db";
import { config } from "../config";
import { PgAuthOtpAuditRepository } from "./auth-otp-audit";
import { PgProductPersonaScriptRepository, type PgProductInput, type PgScriptInput } from "./product-persona-script";
import { PgJobsRepository } from "./jobs";
import { PgCreditPaymentRepository } from "./credit-payment";
import { runFf } from "../media/ffmpeg";
import { mediaStorage } from "../storage";

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
  const repo = new PgAuthOtpAuditRepository(url(), { authSecret: config.authSecret, otpExpiryMin: config.otpExpiryMin, otpMaxAttempts: config.otpMaxAttempts, otpRateLimitPer15Min: config.otpRateLimitPer15Min });
  try { return await repo.findOrCreateUserByPhone(phone); } finally { await repo.close(); }
}
export async function smokeGetUser(userId: string): Promise<UserRow | null> {
  const pool = new Pool({ connectionString: url() });
  try { return (await pool.query<UserRow>("SELECT * FROM users WHERE id=$1", [userId])).rows[0] ?? null; } finally { await pool.end(); }
}
export async function pgGetBalance(userId: string): Promise<number> {
  const pool = new Pool({ connectionString: url() });
  try { return Number((await pool.query<{ balance: string }>("SELECT COALESCE(SUM(delta),0) AS balance FROM credit_ledger WHERE user_id=$1", [userId])).rows[0]?.balance ?? 0); }
  finally { await pool.end(); }
}
export async function pgGetLedger(userId: string, limit = 50) {
  const pool = new Pool({ connectionString: url() });
  try { return (await pool.query("SELECT * FROM credit_ledger WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2", [userId, limit])).rows; }
  finally { await pool.end(); }
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
  const pool = new Pool({ connectionString: url() });
  try { return (await pool.query(`SELECT * FROM payments WHERE gateway_ref=$1${userId ? " AND user_id=$2" : ""}`, userId ? [gatewayRef, userId] : [gatewayRef])).rows[0] ?? null; }
  finally { await pool.end(); }
}
export async function pgFindUser(input: { id?: string; phone?: string }) {
  const pool = new Pool({ connectionString: url() });
  try { return (await pool.query<UserRow>(input.id ? "SELECT * FROM users WHERE id=$1" : "SELECT * FROM users WHERE phone=$1", [input.id ?? input.phone ?? ""])).rows[0] ?? null; }
  finally { await pool.end(); }
}
export async function pgCanExtract(userId: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url() });
  try {
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const result = await pool.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM audit_log WHERE actor=$1 AND action='product.extract' AND created_at>$2", [userId, since]);
    return (result.rows[0]?.n ?? 0) < 10;
  } finally { await pool.end(); }
}
export async function pgAudit(actor: string, action: string, entity: string, entityId: string | null, meta: unknown = {}) {
  const repo = new PgAuthOtpAuditRepository(url(), { authSecret: config.authSecret, otpExpiryMin: config.otpExpiryMin, otpMaxAttempts: config.otpMaxAttempts, otpRateLimitPer15Min: config.otpRateLimitPer15Min });
  try { await repo.appendAudit(actor, action, entity, entityId, meta); } finally { await repo.close(); }
}
export async function pgCanRequestOtp(email: string) {
  const repo = new PgAuthOtpAuditRepository(url(), { authSecret: config.authSecret, otpExpiryMin: config.otpExpiryMin, otpMaxAttempts: config.otpMaxAttempts, otpRateLimitPer15Min: config.otpRateLimitPer15Min });
  try { return await repo.canRequestOtp(email); } finally { await repo.close(); }
}
export async function pgStoreOtp(email: string, code: string) {
  const repo = new PgAuthOtpAuditRepository(url(), { authSecret: config.authSecret, otpExpiryMin: config.otpExpiryMin, otpMaxAttempts: config.otpMaxAttempts, otpRateLimitPer15Min: config.otpRateLimitPer15Min });
  try { await repo.storeOtp(email, code); } finally { await repo.close(); }
}
export async function pgVerifyOtp(email: string, code: string) {
  const repo = new PgAuthOtpAuditRepository(url(), { authSecret: config.authSecret, otpExpiryMin: config.otpExpiryMin, otpMaxAttempts: config.otpMaxAttempts, otpRateLimitPer15Min: config.otpRateLimitPer15Min });
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
export async function pgFindOrCreatePersona(userId: string, category: { id: string; name: string }) {
  const repo = new PgProductPersonaScriptRepository(url());
  try { return await repo.findOrCreatePersona(userId, category); } finally { await repo.close(); }
}
export async function pgGetPersona(userId: string, personaId: string) {
  const repo = new PgProductPersonaScriptRepository(url());
  try { return await repo.getOwnedPersona(userId, personaId); } finally { await repo.close(); }
}
export async function smokeCreateScripts(userId: string, productId: string, variants: PgScriptInput[]) {
  const repo = new PgProductPersonaScriptRepository(url());
  try { return await repo.createScripts(userId, productId, variants); } finally { await repo.close(); }
}
export async function smokeGetScript(userId: string, scriptId: string) {
  const repo = new PgProductPersonaScriptRepository(url());
  try { return await repo.getOwnedScript(userId, scriptId); } finally { await repo.close(); }
}
export async function smokeApproveScript(userId: string, scriptId: string, update: { segments: unknown; edited: boolean; validationResult: unknown }) {
  const repo = new PgProductPersonaScriptRepository(url());
  try { return await repo.approveOwnedScript(userId, scriptId, update); } finally { await repo.close(); }
}

export async function smokeCreateJob(userId: string, input: { productId: string; scriptId: string; format: string; qualityTier: string; durationS: number; priceIdr: number }) {
  const pool = new Pool({ connectionString: url() });
  try {
    // The user-row lock serializes wallet spends and the script-row lock
    // serializes duplicate decisions. Read Committed then observes the latest
    // balance after the lock wait; SERIALIZABLE would retain a pre-wait
    // snapshot and abort independent admissions under a burst.
    for (let attempt = 0; attempt < 5; attempt++) {
      const client = await pool.connect();
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
          if (active.rows[0]) { await client.query("COMMIT"); return { jobId: active.rows[0].id, duplicate: true }; }
        }
        const balance = await client.query<{ balance: string }>("SELECT COALESCE(SUM(delta),0) AS balance FROM credit_ledger WHERE user_id=$1", [userId]);
        if (Number(balance.rows[0].balance) < input.priceIdr) throw new Error("INSUFFICIENT_CREDITS");
        const jobId = id(); const timestamp = at();
        await client.query("INSERT INTO jobs (id,user_id,product_id,persona_id,script_id,format,quality_tier,duration_s,state,created_at,state_changed_at) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,'QUEUED',$8,$8)", [jobId,userId,input.productId,input.scriptId,input.format,input.qualityTier,input.durationS,timestamp]);
        await client.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,payment_id,created_at) VALUES ($1,$2,$3,'hold',$4,NULL,$5)", [id(),userId,-input.priceIdr,jobId,timestamp]);
        await client.query("UPDATE scripts SET job_id=$1 WHERE id=$2", [jobId,input.scriptId]);
        await client.query("INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,$2,'job.created','jobs',$3,$4,$5)", [id(),userId,jobId,JSON.stringify({ script_id: input.scriptId, smoke: true }),timestamp]);
        await client.query("COMMIT"); return { jobId, duplicate: false };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const code = (error as { code?: string }).code;
        if ((code === "40001" || code === "40P01") && attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 25 * (2 ** attempt) + Math.floor(Math.random() * 25)));
          continue;
        }
        throw error;
      } finally { client.release(); }
    }
    throw new Error("Transaksi PostgreSQL admission habis retry.");
  } finally { await pool.end(); }
}

/** Deterministic local provider hook: no external media/provider credentials. */
export async function smokeCompleteJob(jobId: string) {
  const jobs = new PgJobsRepository(url(), { stateTimeoutsMin: config.stateTimeoutsMin });
  const pool = new Pool({ connectionString: url() });
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
  } finally { await jobs.close(); await pool.end(); }
}
export async function smokeGetJob(userId: string, jobId: string) { const pool = new Pool({ connectionString: url() }); try { return (await pool.query("SELECT * FROM jobs WHERE id=$1 AND user_id=$2", [jobId,userId])).rows[0] ?? null; } finally { await pool.end(); } }
export async function smokeGetOutput(userId: string, jobId: string) { const pool = new Pool({ connectionString: url() }); try { return (await pool.query("SELECT o.* FROM outputs o JOIN jobs j ON j.id=o.job_id WHERE o.job_id=$1 AND j.user_id=$2", [jobId,userId])).rows[0] ?? null; } finally { await pool.end(); } }
export async function pgListJobs(userId: string) {
  const pool = new Pool({ connectionString: url() });
  try { return (await pool.query("SELECT j.id,j.state,j.format,j.duration_s,j.created_at,j.completed_at,j.provider_video,j.provider_voice,j.cost_actual_idr,j.script_id,p.name AS product_name,p.images AS product_images,fs.score AS fyp_score,fs.posted_url AS fyp_posted_url FROM jobs j JOIN products p ON p.id=j.product_id LEFT JOIN fyp_snapshots fs ON fs.job_id=j.id WHERE j.user_id=$1 ORDER BY j.created_at DESC LIMIT 50", [userId])).rows; }
  finally { await pool.end(); }
}

/** Snapshot Skor FYP beku (padanan createFypSnapshot SQLite) — idempoten via
 * ON CONFLICT DO NOTHING; dipanggil non-fatal setelah job dibuat. */
export async function pgSaveFypSnapshot(input: {
  jobId: string; scriptId: string; modelVersion: string; score: number;
  rawProbability: number; featuresJson: string;
}) {
  const pool = new Pool({ connectionString: url() });
  try {
    await pool.query(
      `INSERT INTO fyp_snapshots (job_id, script_id, model_version, score, raw_probability, features_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (job_id) DO NOTHING`,
      [input.jobId, input.scriptId, input.modelVersion, input.score, input.rawProbability, input.featuresJson, at()]
    );
  } finally { await pool.end(); }
}

/** Lapor hasil posting (padanan applyFypReport SQLite): posted_url BEKU setelah
 * terisi (nilai beda -> Error), outcome upsert. Validasi URL dilakukan pemanggil. */
export async function pgApplyFypReport(userId: string, jobId: string, report: { postedUrl: string; views: number | null; orders: number | null }) {
  const pool = new Pool({ connectionString: url() });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT fs.* FROM fyp_snapshots fs JOIN jobs j ON j.id=fs.job_id WHERE fs.job_id=$1 AND j.user_id=$2 FOR UPDATE`,
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
  } finally { client.release(); await pool.end(); }
}
