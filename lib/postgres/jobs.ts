/**
 * PostgreSQL parity adapter for checkpoint 1C jobs.  It is test-only: no
 * route or worker imports this module while SQLite remains the live runtime.
 */
import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { JOB_STATES, type JobState } from "../jobs";
import { getPool } from "./pool";

export type PgJob = { id: string; user_id: string; org_id: string | null; state: JobState; created_at: string; state_changed_at: string | null; completed_at: string | null; cost_actual_idr: number; provider_video: string | null; provider_voice: string | null; output_url: string | null };
type StateTimeouts = Partial<Record<string, number>>;

export class PgJobsRepository {
  private readonly pool: Pool;
  private readonly now: () => string;
  private readonly uuid: () => string;
  private readonly timeouts: StateTimeouts;

  constructor(databaseUrl: string, options: { now?: () => string; uuid?: () => string; stateTimeoutsMin?: StateTimeouts } = {}) {
    if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("PgJobsRepository membutuhkan DATABASE_URL PostgreSQL.");
    this.pool = getPool(databaseUrl);
    this.now = options.now ?? (() => new Date().toISOString());
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
    this.timeouts = options.stateTimeoutsMin ?? {};
  }
  async close() { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }
  async getJob(id: string): Promise<PgJob | undefined> { return (await this.pool.query<PgJob>("SELECT id,user_id,org_id,state,created_at,state_changed_at,completed_at,cost_actual_idr,provider_video,provider_voice,output_url FROM jobs WHERE id=$1", [id])).rows[0]; }

  /** Mirrors SQLite's deliberately permissive active->active transition and terminal guard. */
  async transition(id: string, to: JobState, meta: Record<string, unknown> = {}): Promise<boolean> {
    if (!JOB_STATES.includes(to)) throw new Error(`State job tidak dikenal: ${to}`);
    return this.transaction(async (client) => {
      const at = this.now();
      const result = await client.query<PgJob>(to === "REFUNDED"
        ? "UPDATE jobs SET state=$1,state_changed_at=$2 WHERE id=$3 AND state='FAILED' RETURNING id,user_id,org_id,state,created_at,state_changed_at,completed_at,cost_actual_idr,provider_video,provider_voice,output_url"
        : "UPDATE jobs SET state=$1,state_changed_at=$2 WHERE id=$3 AND state NOT IN ('READY','FAILED','REFUNDED') RETURNING id,user_id,org_id,state,created_at,state_changed_at,completed_at,cost_actual_idr,provider_video,provider_voice,output_url", [to, at, id]);
      if (!result.rows[0]) return false;
      await this.audit(client, "worker", "job.transition", "jobs", id, { to, at, ...meta });
      return true;
    });
  }
  async addCost(id: string, idr: number) { await this.pool.query("UPDATE jobs SET cost_actual_idr=cost_actual_idr+$1 WHERE id=$2", [idr, id]); }
  async setProviders(id: string, video?: string, voice?: string) {
    if (video) await this.pool.query("UPDATE jobs SET provider_video=$1 WHERE id=$2", [video, id]);
    if (voice) await this.pool.query("UPDATE jobs SET provider_voice=$1 WHERE id=$2", [voice, id]);
  }

  /**
   * Install exactly once while holding the job row lock. A legacy job with any
   * durable provider/output trace is intentionally refused: its original
   * reference provenance cannot be reconstructed safely.
   */
  async installReferenceManifestIfSafe(id: string, candidateRaw: string): Promise<string | null> {
    return this.transaction(async (client) => {
      const result = await client.query<{
        approved_reference_manifest: string | null;
        provider_video: string | null;
        provider_voice: string | null;
        output_url: string | null;
        cost_actual_idr: number;
      }>(
        `SELECT approved_reference_manifest,provider_video,provider_voice,output_url,cost_actual_idr
         FROM jobs WHERE id=$1 FOR UPDATE`,
        [id]
      );
      const row = result.rows[0];
      if (!row) throw new Error("Job tidak ditemukan saat mematok manifest referensi.");
      if (row.approved_reference_manifest) return row.approved_reference_manifest;
      const traces = await client.query<{ unsafe: boolean }>(
        `SELECT (
          $2::boolean OR
          EXISTS (SELECT 1 FROM outputs WHERE job_id=$1) OR
          EXISTS (SELECT 1 FROM provider_tasks WHERE job_id=$1) OR
          EXISTS (SELECT 1 FROM job_shots WHERE job_id=$1)
        ) AS unsafe`,
        [id, Boolean(row.provider_video || row.provider_voice || row.output_url || Number(row.cost_actual_idr) > 0)]
      );
      if (traces.rows[0]?.unsafe) return null;
      await client.query("UPDATE jobs SET approved_reference_manifest=$1 WHERE id=$2", [candidateRaw, id]);
      return candidateRaw;
    });
  }

  /** Same provenance/CAS rule as the reference manifest, for product prompt truth. */
  async installProductSnapshotIfSafe(id: string, candidateRaw: string): Promise<string | null> {
    return this.transaction(async (client) => {
      const result = await client.query<{
        job_product_snapshot: string | null;
        provider_video: string | null;
        provider_voice: string | null;
        output_url: string | null;
        cost_actual_idr: number;
      }>(
        `SELECT job_product_snapshot,provider_video,provider_voice,output_url,cost_actual_idr
         FROM jobs WHERE id=$1 FOR UPDATE`,
        [id]
      );
      const row = result.rows[0];
      if (!row) throw new Error("Job tidak ditemukan saat mematok snapshot metadata produk.");
      if (row.job_product_snapshot) return row.job_product_snapshot;
      const traces = await client.query<{ unsafe: boolean }>(
        `SELECT (
          $2::boolean OR
          EXISTS (SELECT 1 FROM outputs WHERE job_id=$1) OR
          EXISTS (SELECT 1 FROM provider_tasks WHERE job_id=$1) OR
          EXISTS (SELECT 1 FROM job_shots WHERE job_id=$1)
        ) AS unsafe`,
        [id, Boolean(row.provider_video || row.provider_voice || row.output_url || Number(row.cost_actual_idr) > 0)]
      );
      if (traces.rows[0]?.unsafe) return null;
      await client.query("UPDATE jobs SET job_product_snapshot=$1 WHERE id=$2", [candidateRaw, id]);
      return candidateRaw;
    });
  }

  /** FAILED -> release ledger -> REFUNDED is one serializable transaction. */
  async failJob(id: string, reason: string): Promise<{ changed: boolean; refunded: number }> {
    return this.transaction(async (client) => {
      const at = this.now();
      const failed = await client.query<PgJob>("UPDATE jobs SET state='FAILED',completed_at=$1,state_changed_at=$1 WHERE id=$2 AND state NOT IN ('READY','FAILED','REFUNDED') RETURNING id,user_id,org_id,state,created_at,state_changed_at,completed_at,cost_actual_idr,provider_video,provider_voice,output_url", [at, id]);
      const job = failed.rows[0]; if (!job) return { changed: false, refunded: 0 };
      await this.audit(client, "worker", "job.transition", "jobs", id, { to: "FAILED", at, reason });
      // Wallet yang dikunci ikut job.org_id (pool org bila job dibuat lewat
      // dashboard bulk-generate, kalau tidak baris user biasa) — lihat
      // lockWallet yang sama di PgCreditPaymentRepository.
      if (job.org_id) await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [job.org_id]);
      else await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [job.user_id]);
      const terminal = await client.query("SELECT id FROM credit_ledger WHERE job_id=$1 AND type IN ('capture','release')", [id]);
      let refunded = 0;
      if (!terminal.rowCount) {
        const held = await client.query<{ held: string }>("SELECT COALESCE(-SUM(delta),0) AS held FROM credit_ledger WHERE job_id=$1 AND type='hold'", [id]);
        refunded = Number(held.rows[0].held);
        if (refunded > 0) {
          await client.query("INSERT INTO credit_ledger (id,user_id,org_id,delta,type,job_id,payment_id,created_at) VALUES ($1,$2,$3,$4,'release',$5,NULL,$6)", [this.uuid(), job.user_id, job.org_id, refunded, id, at]);
          await this.audit(client, job.user_id, "credit.release", "jobs", id, { amount_idr: refunded, org_id: job.org_id ?? undefined });
        }
      }
      const done = await client.query("UPDATE jobs SET state='REFUNDED',state_changed_at=$1 WHERE id=$2 AND state='FAILED'", [at, id]);
      if (done.rowCount !== 1) throw new Error("FAILED job tidak dapat dipindahkan ke REFUNDED.");
      await this.audit(client, "worker", "job.transition", "jobs", id, { to: "REFUNDED", at, refunded_credits: refunded });
      return { changed: true, refunded };
    });
  }

  /** AWAITING_APPROVAL sengaja dikecualikan: job itu menunggu MANUSIA
   * (brand review scene), bukan macet — men-sweep-nya akan me-refund job
   * yang sebenarnya sehat. */
  async sweepStaleJobs(referenceNow = new Date(this.now()).getTime()): Promise<number> {
    const active = await this.pool.query<PgJob>("SELECT id,user_id,org_id,state,created_at,state_changed_at,completed_at,cost_actual_idr,provider_video,provider_voice,output_url FROM jobs WHERE state NOT IN ('READY','FAILED','REFUNDED','AWAITING_APPROVAL')");
    let swept = 0;
    for (const job of active.rows) {
      const changed = new Date(job.state_changed_at ?? job.created_at).getTime();
      const minutes = this.timeouts[job.state] ?? 90;
      if (referenceNow - changed > minutes * 60_000 && (await this.failJob(job.id, `Job di state ${job.state} lebih dari ${minutes} menit`)).changed) swept++;
    }
    return swept;
  }

  /**
   * Job READY yang hold-nya tidak pernah ter-capture.
   *
   * captureCredits berjalan SETELAH transisi READY, di koneksi terpisah. Kalau
   * proses mati (atau koneksi kredit gagal) di antara keduanya, videonya sudah
   * diserahkan tapi ledger berhenti di 'hold'. Saldo pengguna memang sudah
   * terpotong sejak hold, jadi tidak ada yang dirugikan uangnya — yang rusak
   * pembukuannya: pendapatan yang benar-benar terjadi tidak pernah tercatat
   * final, dan setiap laporan yang menghitung 'capture' akan kurang hitung.
   *
   * VERSI PERTAMA FUNGSI INI SALAH, dan salahnya terukur. Ia memakai SELECT
   * lalu INSERT ... SELECT dengan NOT EXISTS, keduanya lewat pool tanpa
   * transaksi maupun lock, dan komentarnya mengklaim itu sudah cukup untuk
   * dua sweeper bersamaan. Uji paralel PostgreSQL membantahnya: 30 hold READY
   * dengan 8 reconciler bersamaan menghasilkan 14 job ber-capture ganda,
   * sebagian sampai enam. Di READ COMMITTED, dua transaksi bisa sama-sama
   * membaca NOT EXISTS sebagai benar sebelum salah satunya menulis.
   *
   * Sekarang ada TIGA lapis, dan yang paling luar sengaja bukan kode:
   *   1. indeks unik parsial uniq_ledger_terminal_per_job (migrasi 0030) —
   *      database menolak capture/release kedua untuk satu job, apa pun yang
   *      lupa dipasang di kode;
   *   2. satu transaksi SERIALIZABLE per job, dengan baris job dikunci
   *      FOR UPDATE sebelum ledger-nya dibaca;
   *   3. pelanggaran unik (23505) diperlakukan sebagai "sudah ditutup pihak
   *      lain" — bukan galat — supaya balapan yang kalah berakhir tenang.
   */
  async reconcileReadyHolds(): Promise<number> {
    const menggantung = await this.pool.query<{ id: string }>(
      `SELECT j.id FROM jobs j
       WHERE j.state = 'READY'
         AND EXISTS (SELECT 1 FROM credit_ledger h WHERE h.job_id = j.id AND h.type = 'hold')
         AND NOT EXISTS (SELECT 1 FROM credit_ledger t WHERE t.job_id = j.id AND t.type IN ('capture','release'))`
    );
    let ditutup = 0;
    for (const { id } of menggantung.rows) {
      try {
        const ok = await this.transaction(async (client) => {
          // Kunci baris job DULU. Tanpa ini, worker yang sedang menuntaskan
          // job yang sama bisa menulis capture-nya sendiri di antara
          // pembacaan dan penulisan di bawah.
          const job = await client.query<{ user_id: string; org_id: string | null }>(
            "SELECT user_id, org_id FROM jobs WHERE id=$1 AND state='READY' FOR UPDATE", [id]
          );
          if (!job.rows[0]) return false;
          const terminal = await client.query(
            "SELECT 1 FROM credit_ledger WHERE job_id=$1 AND type IN ('capture','release')", [id]
          );
          if (terminal.rowCount) return false;
          const hold = await client.query("SELECT 1 FROM credit_ledger WHERE job_id=$1 AND type='hold'", [id]);
          if (!hold.rowCount) return false;
          await client.query(
            "INSERT INTO credit_ledger (id,user_id,org_id,delta,type,job_id,payment_id,created_at) VALUES ($1,$2,$3,0,'capture',$4,NULL,$5)",
            [this.uuid(), job.rows[0].user_id, job.rows[0].org_id, id, this.now()]
          );
          await this.audit(client, "sweep", "credit.capture", "jobs", id, { alasan: "hold menggantung pada job READY" });
          return true;
        });
        if (ok) ditutup++;
      } catch (err) {
        // 23505 = indeks unik terminal menolak. Artinya pihak lain sudah
        // menutup job ini lebih dulu — hasil yang BENAR, bukan kegagalan.
        if ((err as { code?: string }).code !== "23505") throw err;
      }
    }
    return ditutup;
  }

  /**
   * Padanan untuk promo_jobs, yang punya tabel state sendiri.
   *
   * Reconciler pertama cuma membaca tabel `jobs` — job promo yang hold-nya
   * menggantung tidak pernah tersentuh sama sekali.
   */
  async reconcileReadyPromoHolds(): Promise<number> {
    const menggantung = await this.pool.query<{ id: string; user_id: string }>(
      `SELECT p.id, p.user_id FROM promo_jobs p
       WHERE p.state = 'READY'
         AND EXISTS (SELECT 1 FROM credit_ledger h WHERE h.job_id = p.id AND h.type = 'hold')
         AND NOT EXISTS (SELECT 1 FROM credit_ledger t WHERE t.job_id = p.id AND t.type IN ('capture','release'))`
    );
    let ditutup = 0;
    for (const baris of menggantung.rows) {
      try {
        const ok = await this.transaction(async (client) => {
          const job = await client.query(
            "SELECT user_id FROM promo_jobs WHERE id=$1 AND state='READY' FOR UPDATE", [baris.id]
          );
          if (!job.rows[0]) return false;
          const terminal = await client.query(
            "SELECT 1 FROM credit_ledger WHERE job_id=$1 AND type IN ('capture','release')", [baris.id]
          );
          if (terminal.rowCount) return false;
          const hold = await client.query("SELECT 1 FROM credit_ledger WHERE job_id=$1 AND type='hold'", [baris.id]);
          if (!hold.rowCount) return false;
          await client.query(
            "INSERT INTO credit_ledger (id,user_id,org_id,delta,type,job_id,payment_id,created_at) VALUES ($1,$2,NULL,0,'capture',$3,NULL,$4)",
            [this.uuid(), baris.user_id, baris.id, this.now()]
          );
          await this.audit(client, "sweep", "credit.capture", "promo_jobs", baris.id, { alasan: "hold menggantung pada promo READY" });
          return true;
        });
        if (ok) ditutup++;
      } catch (err) {
        if ((err as { code?: string }).code !== "23505") throw err;
      }
    }
    return ditutup;
  }

  async upsertOutput(input: { jobId: string; userId: string; videoUrl: string; caption: string; hashtags: string; suggestedPostTime: string; complianceChecklist: string }) {
    return this.transaction(async (client) => {
      const owned = await client.query("SELECT id FROM jobs WHERE id=$1 AND user_id=$2 FOR UPDATE", [input.jobId, input.userId]);
      if (!owned.rowCount) return false;
      await client.query(`INSERT INTO outputs (job_id,video_url,caption,hashtags,suggested_post_time,compliance_checklist)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (job_id) DO UPDATE SET video_url=EXCLUDED.video_url,caption=EXCLUDED.caption,hashtags=EXCLUDED.hashtags,suggested_post_time=EXCLUDED.suggested_post_time,compliance_checklist=EXCLUDED.compliance_checklist`, [input.jobId,input.videoUrl,input.caption,input.hashtags,input.suggestedPostTime,input.complianceChecklist]);
      return true;
    });
  }
  async getOutput(jobId: string, userId: string) { return (await this.pool.query("SELECT o.* FROM outputs o JOIN jobs j ON j.id=o.job_id WHERE o.job_id=$1 AND j.user_id=$2", [jobId,userId])).rows[0]; }

  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    // SERIALIZABLE memang boleh mengembalikan 40001; itu instruksi untuk
    // mengulang SELURUH transaksi, bukan kegagalan bisnis. Tiga retry tanpa
    // jeda terbukti habis ketika reconciler uang dan worker W1 aktif bersamaan:
    // seluruh peserta bangun pada saat yang sama lalu bertabrakan lagi.
    // Jitter + backoff terkurung memecah herd tanpa menurunkan isolation level.
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const value = await fn(client);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const code = (error as { code?: string }).code;
        if ((code === "40001" || code === "40P01") && attempt < maxAttempts - 1) {
          const backoffMs = Math.min(200, 5 * (2 ** attempt)) + Math.floor(Math.random() * 11);
          await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        throw error;
      } finally {
        client.release();
      }
    }
    throw new Error("Transaksi PostgreSQL habis retry.");
  }
  private async audit(client: PoolClient, actor: string, action: string, entity: string, entityId: string | null, meta: unknown) { await client.query("INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [this.uuid(),actor,action,entity,entityId,JSON.stringify(meta),this.now()]); }
}
