/**
 * Repository storyboard — gerbang persetujuan pra-render.
 *
 * Storyboard hidup di antara SKRIP DISETUJUI dan JOB DIBUAT. Sebelum ini tidak
 * ada apa pun di sela itu: /api/scripts/:id/approve langsung diikuti POST
 * /api/jobs yang menahan uang. Lihat migrations/postgres/0040_storyboard.sql.
 */
import crypto from "node:crypto";
import { Pool } from "pg";
import { getPool } from "./pool";
import { MAKS_REGEN_PER_SCENE, MAKS_REGEN_TOTAL, type SceneStoryboard, type StatusStoryboard } from "../storyboard";

export interface BarisStoryboard {
  id: string;
  script_id: string;
  user_id: string;
  org_id: string | null;
  duration_sec: number;
  quality_tier: string;
  format: string;
  /** JSON parameter pembuatan job — lihat 0040_storyboard.sql. */
  params: string;
  status: StatusStoryboard;
  job_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface BarisScene {
  id: string;
  idx: number;
  duration_sec: number;
  prompt: string;
  dialog: string;
  start_state: string | null;
  image_key: string | null;
  tanpa_orang: boolean;
  withhold_product: boolean;
  regen_count: number;
}

export class PgStoryboardRepository {
  private readonly pool: Pool;
  private readonly now: () => string;
  private readonly uuid: () => string;

  constructor(databaseUrl: string, options: { now?: () => string; uuid?: () => string } = {}) {
    if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("PgStoryboardRepository membutuhkan DATABASE_URL PostgreSQL.");
    this.pool = getPool(databaseUrl);
    this.now = options.now ?? (() => new Date().toISOString());
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
  }
  async close() { /* pool dibagikan seluruh proses — lihat lib/postgres/pool.ts */ }

  /** Buat storyboard + scene-nya dalam SATU transaksi.
   *
   *  Kalau scene ditulis di luar transaksi induknya, kegagalan di tengah
   *  meninggalkan storyboard dengan 2 dari 3 kartu — dan UI tidak punya cara
   *  membedakannya dari storyboard yang memang cuma punya 2 scene. */
  async create(input: {
    scriptId: string; userId: string; orgId?: string | null;
    durationSec: number; qualityTier: string; format: string;
    /** Parameter pembuatan job apa adanya. Route job memakai ini, BUKAN body
     *  permintaan — supaya yang dirender mustahil berbeda dari yang disetujui. */
    params: Record<string, unknown>;
    scenes: SceneStoryboard[];
  }): Promise<string> {
    const id = this.uuid();
    const t = this.now();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO storyboards (id, script_id, user_id, org_id, duration_sec, quality_tier, format, params, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,$9)`,
        [id, input.scriptId, input.userId, input.orgId ?? null, input.durationSec, input.qualityTier, input.format,
         JSON.stringify(input.params), t]
      );
      for (const s of input.scenes) {
        await client.query(
          `INSERT INTO storyboard_scenes (id, storyboard_id, idx, duration_sec, prompt, dialog, start_state, tanpa_orang, withhold_product, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
          [this.uuid(), id, s.idx, s.durationSec, s.prompt, s.dialog, s.startState, s.tanpaOrang, s.withholdProduct, t]
        );
      }
      await client.query("COMMIT");
      return id;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async get(id: string): Promise<BarisStoryboard | undefined> {
    return (await this.pool.query<BarisStoryboard>("SELECT * FROM storyboards WHERE id=$1", [id])).rows[0];
  }

  /** Dipakai route: storyboard hanya boleh dilihat pemiliknya. */
  async getMilik(id: string, userId: string): Promise<BarisStoryboard | undefined> {
    return (await this.pool.query<BarisStoryboard>("SELECT * FROM storyboards WHERE id=$1 AND user_id=$2", [id, userId])).rows[0];
  }

  async scenes(storyboardId: string): Promise<BarisScene[]> {
    return (await this.pool.query<BarisScene>(
      `SELECT id, idx, duration_sec, prompt, dialog, start_state, image_key, tanpa_orang, withhold_product, regen_count
         FROM storyboard_scenes WHERE storyboard_id=$1 ORDER BY idx`, [storyboardId])).rows;
  }

  async setStatus(id: string, status: StatusStoryboard, error?: string | null): Promise<void> {
    await this.pool.query("UPDATE storyboards SET status=$2, error=$3, updated_at=$4 WHERE id=$1",
      [id, status, error ?? null, this.now()]);
  }

  async setImage(storyboardId: string, idx: number, imageKey: string): Promise<void> {
    await this.pool.query(
      "UPDATE storyboard_scenes SET image_key=$3, updated_at=$4 WHERE storyboard_id=$1 AND idx=$2",
      [storyboardId, idx, imageKey, this.now()]);
  }

  /**
   * Naikkan pemakaian kuota HANYA bila KEDUA pagu masih tersisa (per-scene dan
   * total storyboard), dalam satu pernyataan.
   *
   * Cek-lalu-tulis dua langkah bisa dilewati dengan menekan tombol ganti dua
   * kali cepat: keduanya membaca regen_count yang sama, keduanya lolos, dan
   * kuota 2 berubah jadi 3 gambar. WHERE regen_count < batas membuat baris
   * kedua tidak memperbarui apa pun, dan rowCount memberi tahu pemanggil.
   */
  async pakaiKuotaRegen(storyboardId: string, idx: number): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE storyboard_scenes SET regen_count = regen_count + 1, updated_at=$5
        WHERE storyboard_id=$1 AND idx=$2 AND regen_count < $3
          AND (SELECT COALESCE(SUM(regen_count), 0) FROM storyboard_scenes WHERE storyboard_id=$1) < $4`,
      [storyboardId, idx, MAKS_REGEN_PER_SCENE, MAKS_REGEN_TOTAL, this.now()]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Kembalikan kuota bila generate-nya sendiri gagal. Pengguna tidak boleh
   *  kehilangan jatah karena kesalahan kita. */
  async kembalikanKuotaRegen(storyboardId: string, idx: number): Promise<void> {
    await this.pool.query(
      `UPDATE storyboard_scenes SET regen_count = GREATEST(0, regen_count - 1), updated_at=$3
        WHERE storyboard_id=$1 AND idx=$2`, [storyboardId, idx, this.now()]);
  }

  async tandaiDisetujui(id: string, jobId: string): Promise<void> {
    await this.pool.query("UPDATE storyboards SET status='APPROVED', job_id=$2, updated_at=$3 WHERE id=$1",
      [id, jobId, this.now()]);
  }

  /**
   * Hapus storyboard beserta scene-nya. Hanya yang BELUM disetujui.
   *
   * Storyboard yang sudah melahirkan job tidak boleh hilang: ia adalah catatan
   * apa yang pengguna setujui saat uangnya ditahan. Menghapusnya berarti
   * membuang satu-satunya bukti bahwa video yang dirender memang yang dipesan.
   */
  async hapus(id: string, userId: string): Promise<boolean> {
    const r = await this.pool.query(
      "DELETE FROM storyboards WHERE id=$1 AND user_id=$2 AND status <> 'APPROVED'", [id, userId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Storyboard aktif untuk sebuah skrip — supaya menekan "lanjut" dua kali
   *  tidak melahirkan dua storyboard dan dua kali biaya gambar. */
  async aktifUntukScript(scriptId: string, userId: string): Promise<BarisStoryboard | undefined> {
    return (await this.pool.query<BarisStoryboard>(
      `SELECT * FROM storyboards WHERE script_id=$1 AND user_id=$2 AND status <> 'APPROVED'
        ORDER BY created_at DESC LIMIT 1`, [scriptId, userId])).rows[0];
  }
}
