import { config } from "../config";
import { getPool } from "./pool";
import type { TaskMemo } from "../providers/task-memo";

// Implementasi Postgres dari ingatan task provider.
//
// BATAS UMUR: task hanya dipakai ulang kalau baru dibuat. Task lama sudah
// kedaluwarsa di sisi BytePlus, dan melanjutkan polling ke task yang sudah
// hilang hanya menunda kegagalan sampai batas tunggu habis — lebih buruk
// daripada langsung mengirim ulang. Dua jam jauh di atas durasi render normal
// (3-8 menit) tapi jauh di bawah umur simpan task provider.
const MAX_REUSE_AGE_MS = 2 * 60 * 60 * 1000;

export const pgTaskMemo: TaskMemo = {
  async get(jobId, shotIndex, provider, payloadSha256) {
    const res = await getPool(config.databaseUrl).query<{ task_id: string; created_at: string; payload_sha256: string | null }>(
      "SELECT task_id, created_at, payload_sha256 FROM provider_tasks WHERE job_id=$1 AND shot_index=$2 AND provider=$3",
      [jobId, shotIndex, provider]
    );
    const row = res.rows[0];
    if (!row) return null;
    const age = Date.now() - Date.parse(row.created_at);
    if (!Number.isFinite(age) || age > MAX_REUSE_AGE_MS) return null;
    // Baris pra-0041 tetap dilanjutkan untuk mencegah submit/biaya ganda, tetapi
    // tidak akan pernah lolos pembekuan audit karena digest-nya NULL. Digest
    // yang ada namun berbeda berarti konfigurasi/prompt berubah saat request
    // masih hidup: berhenti, jangan diam-diam mengirim task kedua.
    if (row.payload_sha256 && row.payload_sha256 !== payloadSha256) {
      throw new Error("PROVIDER_TASK_PAYLOAD_MISMATCH");
    }
    return row.task_id;
  },

  async put(jobId, shotIndex, provider, taskId, payloadSha256) {
    // ON CONFLICT: percobaan ulang yang MEMANG mengirim task baru (mis. memo
    // sudah kedaluwarsa) harus menimpa yang lama, bukan gagal insert.
    await getPool(config.databaseUrl).query(
      `INSERT INTO provider_tasks (job_id, shot_index, provider, task_id, payload_sha256, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (job_id, shot_index, provider)
       DO UPDATE SET task_id=EXCLUDED.task_id, payload_sha256=EXCLUDED.payload_sha256, created_at=EXCLUDED.created_at`,
      [jobId, shotIndex, provider, taskId, payloadSha256, new Date().toISOString()]
    );
  },

  async clear(jobId) {
    await getPool(config.databaseUrl).query("DELETE FROM provider_tasks WHERE job_id=$1", [jobId]);
  },
};

/** Hapus ingatan SATU scene. Dipanggil saat brand menekan "Ganti scene ini".
 *
 * WAJIB. Tanpa ini, regenerate akan melanjutkan polling task LAMA dan
 * mengembalikan video yang sama persis — brand membayar token untuk hasil
 * yang identik, dan fitur gantinya jadi tidak berfungsi sama sekali. */
export async function pgForgetShotTask(jobId: string, shotIndex: number): Promise<void> {
  await getPool(config.databaseUrl).query(
    "DELETE FROM provider_tasks WHERE job_id=$1 AND shot_index=$2", [jobId, shotIndex]
  );
}
