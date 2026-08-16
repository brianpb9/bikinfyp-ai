/**
 * Repository for the Video Promosi (non-ecommerce) prototype. Deliberately
 * separate from PgJobsRepository (lib/postgres/jobs.ts) — no credit ledger,
 * no shared state machine with the e-commerce pipeline. Prototype only:
 * intentionally minimal, matches the "ugly is ok" stage-gate for Prototype.
 */
import crypto from "node:crypto";
import { Pool } from "pg";
import { getPool } from "./pool";

export type PromoJobState = "QUEUED" | "GENERATING_HOOK" | "STITCHING" | "READY" | "FAILED";

export interface PromoJobRow {
  id: string;
  user_id: string;
  state: PromoJobState;
  uploaded_clip_urls: string; // JSON array, raw column — use PromoJob.uploadedClipUrls
  generated_shot_url: string | null;
  output_url: string | null;
  error_message: string | null;
  cost_actual_idr: number;
  created_at: string;
  completed_at: string | null;
  virality_checklist: string | null; // JSON, raw column
  hook_id: string | null;
  avatar_kind: string | null;
  avatar_preset_id: string | null;
  avatar_custom_description: string | null;
}

export interface PromoJob extends Omit<PromoJobRow, "uploaded_clip_urls"> {
  uploadedClipUrls: string[];
}

function parseRow(row: PromoJobRow): PromoJob {
  const { uploaded_clip_urls, ...rest } = row;
  return { ...rest, uploadedClipUrls: JSON.parse(uploaded_clip_urls) };
}

export class PgPromoJobsRepository {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("PgPromoJobsRepository membutuhkan DATABASE_URL PostgreSQL.");
    this.pool = getPool(databaseUrl);
  }

  async close() { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }

  async create(
    userId: string,
    uploadedClipUrls: string[],
    hookId: string | null,
    avatar: { kind: "preset" | "custom"; presetId?: string; customDescription?: string } | null
  ): Promise<PromoJob> {
    if (uploadedClipUrls.length < 1) throw new Error("Minimal 1 klip upload wajib.");
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const avatarKind = avatar?.kind ?? null;
    const avatarPresetId = avatar?.presetId ?? null;
    const avatarCustomDescription = avatar?.customDescription ?? null;
    await this.pool.query(
      "INSERT INTO promo_jobs (id, user_id, state, uploaded_clip_urls, created_at, hook_id, avatar_kind, avatar_preset_id, avatar_custom_description) VALUES ($1,$2,'QUEUED',$3,$4,$5,$6,$7,$8)",
      [id, userId, JSON.stringify(uploadedClipUrls), createdAt, hookId, avatarKind, avatarPresetId, avatarCustomDescription]
    );
    return {
      id, user_id: userId, state: "QUEUED", uploadedClipUrls, generated_shot_url: null, output_url: null,
      error_message: null, cost_actual_idr: 0, created_at: createdAt, completed_at: null, virality_checklist: null,
      hook_id: hookId, avatar_kind: avatarKind, avatar_preset_id: avatarPresetId, avatar_custom_description: avatarCustomDescription,
    };
  }

  async get(id: string, userId: string): Promise<PromoJob | undefined> {
    const row = (await this.pool.query<PromoJobRow>("SELECT * FROM promo_jobs WHERE id=$1 AND user_id=$2", [id, userId])).rows[0];
    return row && parseRow(row);
  }

  /** Trusted worker context only — no user ownership filter. */
  async getById(id: string): Promise<PromoJob | undefined> {
    const row = (await this.pool.query<PromoJobRow>("SELECT * FROM promo_jobs WHERE id=$1", [id])).rows[0];
    return row && parseRow(row);
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

  async setViralityChecklist(id: string, checklist: unknown) {
    await this.pool.query("UPDATE promo_jobs SET virality_checklist=$1 WHERE id=$2", [JSON.stringify(checklist), id]);
  }

  // READY ITU FINAL. Keduanya di bawah menolak menimpa state terminal.
  //
  // Sebelum ini keduanya UPDATE tanpa syarat, dan itu membuka jalan video
  // gratis yang tidak tertutup oleh penjaga refund mana pun:
  //
  //   1. worker menandai job READY (video sudah bisa diunduh)
  //   2. captureCredits() gagal — koneksi kredit putus, misalnya
  //   3. blok catch memanggil markFailed()
  //   4. markFailed MENIMPA READY menjadi FAILED
  //   5. penjaga refund mencari state READY, melihat FAILED, lalu merefund
  //
  // Penjaga di lapisan kredit tidak bisa menolong kalau kenyataan yang ia
  // periksa sudah dihapus lebih dulu. Karena itu penjagaannya harus di sini,
  // di satu-satunya tempat yang menulis state — sama seperti tabel `jobs`
  // yang memang sudah memakai "WHERE state NOT IN (...)" sejak awal.
  //
  // Mengembalikan boolean supaya pemanggil bisa TAHU kalau tulisannya ditolak,
  // bukan menganggapnya berhasil diam-diam.
  async markReady(id: string, outputUrl: string): Promise<boolean> {
    const r = await this.pool.query(
      "UPDATE promo_jobs SET state='READY', output_url=$1, completed_at=$2 WHERE id=$3 AND state NOT IN ('READY','FAILED','REFUNDED')",
      [outputUrl, new Date().toISOString(), id]
    );
    return r.rowCount === 1;
  }

  async markFailed(id: string, reason: string): Promise<boolean> {
    const r = await this.pool.query(
      "UPDATE promo_jobs SET state='FAILED', error_message=$1, completed_at=$2 WHERE id=$3 AND state NOT IN ('READY','FAILED','REFUNDED')",
      [reason.slice(0, 500), new Date().toISOString(), id]
    );
    return r.rowCount === 1;
  }
}
