/**
 * Antrean storyboard — generate gambar per scene di worker, bukan di web.
 *
 * ---------------------------------------------------------------------------
 * KENAPA ANTREAN, BUKAN LANGSUNG DI ROUTE
 * ---------------------------------------------------------------------------
 * Diukur di server produksi 7 Sep 2026: Seedream 5.0 pro butuh ~21 detik untuk
 * satu gambar 1K (~45 detik untuk 2K). Storyboard 15 detik punya 3 scene.
 *
 * Menjalankannya di dalam satu permintaan HTTP berarti pengguna menatap layar
 * kosong ~25 detik terbaiknya, dan kehilangan seluruh pekerjaan kalau koneksi
 * putus di detik ke-20. Lewat antrean, kartu-kartunya terisi satu per satu dan
 * menutup tab tidak membatalkan apa pun.
 *
 * Antrean SENDIRI, bukan config.redisQueueName: antrean itu membawa semantik
 * refund dan percobaan ulang milik job berbayar (scripts/worker.ts). Storyboard
 * tidak menahan uang sama sekali — mencampurnya berarti kegagalan generate
 * gambar bisa memicu jalur refund untuk uang yang tidak pernah ditahan.
 */
import { Queue } from "bullmq";
import { config } from "./config";

export const STORYBOARD_QUEUE_NAME = "aiugc-storyboard";

export interface TugasStoryboard {
  storyboardId: string;
  /** Ada = ganti satu scene (kuota sudah dipotong route). Tidak ada = bangun semua. */
  idx?: number;
}

let queue: Queue<TugasStoryboard> | undefined;

export function getStoryboardQueue(): Queue<TugasStoryboard> {
  if (!queue) {
    if (!config.redisUrl) throw new Error("REDIS_URL wajib untuk antrean storyboard.");
    queue = new Queue<TugasStoryboard>(STORYBOARD_QUEUE_NAME, {
      connection: { url: config.redisUrl, maxRetriesPerRequest: null },
    });
  }
  return queue;
}

export async function enqueueStoryboard(storyboardId: string): Promise<void> {
  await getStoryboardQueue().add("build", { storyboardId }, {
    // jobId dedup: menekan "lanjut" dua kali tidak boleh menggandakan biaya.
    jobId: `sb:${storyboardId}`,
    attempts: 3,
    backoff: { type: "fixed", delay: 4_000 },
    removeOnComplete: { age: 3_600, count: 200 },
    removeOnFail: { age: 86_400, count: 200 },
  });
}

export async function enqueueRegenScene(storyboardId: string, idx: number): Promise<void> {
  await getStoryboardQueue().add("regen", { storyboardId, idx }, {
    // Kuota sudah dipotong route sebelum ini dipanggil, jadi dedup memakai cap
    // waktu: dua permintaan ganti yang SAH untuk scene yang sama harus
    // benar-benar menghasilkan dua gambar.
    jobId: `sb:${storyboardId}:${idx}:${Date.now()}`,
    attempts: 2,
    backoff: { type: "fixed", delay: 4_000 },
    removeOnComplete: { age: 3_600, count: 200 },
    removeOnFail: { age: 86_400, count: 200 },
  });
}

export async function closeStoryboardQueue(): Promise<void> {
  if (queue) { await queue.close(); queue = undefined; }
}
