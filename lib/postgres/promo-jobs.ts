/**
 * Repository for the Video Promosi (non-ecommerce) prototype. Deliberately
 * separate from PgJobsRepository (lib/postgres/jobs.ts) — no credit ledger,
 * no shared state machine with the e-commerce pipeline. Prototype only:
 * intentionally minimal, matches the "ugly is ok" stage-gate for Prototype.
 */
import crypto from "node:crypto";
import { Pool } from "pg";

export type PromoJobState = "QUEUED" | "GENERATING_HOOK" | "STITCHING" | "READY" | "FAILED";

export interface PromoJob {
  id: string;
  user_id: string;
  state: PromoJobState;
  uploaded_clip_url: string;
  generated_shot_url: string | null;
  output_url: string | null;
  error_message: string | null;
  cost_actual_idr: number;
  created_at: string;
  completed_at: string | null;
}

export class PgPromoJobsRepository {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("PgPromoJobsRepository membutuhkan DATABASE_URL PostgreSQL.");
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async close() { await this.pool.end(); }

  async create(userId: string, uploadedClipUrl: string): Promise<PromoJob> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await this.pool.query(
      "INSERT INTO promo_jobs (id, user_id, state, uploaded_clip_url, created_at) VALUES ($1,$2,'QUEUED',$3,$4)",
      [id, userId, uploadedClipUrl, createdAt]
    );
    return { id, user_id: userId, state: "QUEUED", uploaded_clip_url: uploadedClipUrl, generated_shot_url: null, output_url: null, error_message: null, cost_actual_idr: 0, created_at: createdAt, completed_at: null };
  }

  async get(id: string, userId: string): Promise<PromoJob | undefined> {
    return (await this.pool.query<PromoJob>("SELECT * FROM promo_jobs WHERE id=$1 AND user_id=$2", [id, userId])).rows[0];
  }

  /** Trusted worker context only — no user ownership filter. */
  async getById(id: string): Promise<PromoJob | undefined> {
    return (await this.pool.query<PromoJob>("SELECT * FROM promo_jobs WHERE id=$1", [id])).rows[0];
  }

  async setState(id: string, state: PromoJobState) {
    await this.pool.query("UPDATE promo_jobs SET state=$1 WHERE id=$2", [state, id]);
  }

  async setGeneratedShot(id: string, url: string) {
    await this.pool.query("UPDATE promo_jobs SET generated_shot_url=$1 WHERE id=$2", [url, id]);
  }

  async addCost(id: string, idr: number) {
    await this.pool.query("UPDATE promo_jobs SET cost_actual_idr=cost_actual_idr+$1 WHERE id=$2", [idr, id]);
  }

  async markReady(id: string, outputUrl: string) {
    await this.pool.query(
      "UPDATE promo_jobs SET state='READY', output_url=$1, completed_at=$2 WHERE id=$3",
      [outputUrl, new Date().toISOString(), id]
    );
  }

  async markFailed(id: string, reason: string) {
    await this.pool.query(
      "UPDATE promo_jobs SET state='FAILED', error_message=$1, completed_at=$2 WHERE id=$3",
      [reason.slice(0, 500), new Date().toISOString(), id]
    );
  }
}
