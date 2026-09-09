/**
 * Riwayat panggilan provider video — apa yang dikirim, apa yang dijawab.
 *
 * ---------------------------------------------------------------------------
 * KENAPA ADA
 * ---------------------------------------------------------------------------
 * Sampai 9 Sep 2026 satu-satunya jejak panggilan BytePlus adalah log kontainer,
 * dan deploy blue/green menghapusnya beberapa kali sehari. Saat sebuah job
 * gagal, mengetahui task id-nya bergantung pada apakah kita sempat membuka log
 * sebelum deploy berikutnya. Itu bukan jejak audit; itu keberuntungan.
 *
 * ---------------------------------------------------------------------------
 * MENCATAT TIDAK BOLEH MENGGAGALKAN RENDER
 * ---------------------------------------------------------------------------
 * Setiap fungsi di sini MENELAN galatnya sendiri. Sebuah baris log yang gagal
 * ditulis adalah kehilangan catatan; sebuah render yang gagal karena
 * pencatatannya bermasalah adalah kehilangan uang pelanggan. Urutannya tidak
 * boleh terbalik.
 */
import crypto from "node:crypto";
import { config } from "./config";
import { getPool } from "./postgres/pool";
import { postgresRuntimeEnabled } from "./postgres/smoke-runtime";

export type FaseProvider = "submit" | "poll" | "selesai" | "gagal";

/** Batas potong jawaban provider.
 *
 *  Jawaban GAGAL kadang memantulkan seluruh permintaan — termasuk gambar acuan
 *  base64 yang justru kita hindari menyimpannya. Dipotong di sini, bukan
 *  dipercayakan pada pemanggil. */
const MAKS_RESPONSE = 4_000;

/** Pola kredensial yang tidak boleh pernah mendarat di tabel ini, seandainya
 *  provider memantulkannya di dalam pesan galat. */
const RAHASIA = [
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /"?(api[_-]?key|authorization|token|secret)"?\s*[:=]\s*"?[A-Za-z0-9._\-]{8,}"?/gi,
  /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/gi,
];

/** Buang kredensial dan data URI, lalu potong. Dipakai untuk SETIAP teks yang
 *  berasal dari provider. */
export function bersihkan(teks: unknown, maks = MAKS_RESPONSE): string | null {
  if (teks === null || teks === undefined) return null;
  let s = typeof teks === "string" ? teks : JSON.stringify(teks);
  if (!s) return null;
  for (const pola of RAHASIA) s = s.replace(pola, "[disamarkan]");
  return s.length > maks ? `${s.slice(0, maks)}… (${s.length} karakter, dipotong)` : s;
}

export interface BarisLog {
  jobId?: string | null;
  shotIndex?: number | null;
  provider: string;
  model?: string | null;
  taskId?: string | null;
  fase: FaseProvider;
  httpStatus?: number | null;
  /** RINGKASAN permintaan, bukan badannya — badannya memuat gambar base64. */
  requestRingkas?: string | null;
  response?: unknown;
  error?: unknown;
  durasiMs?: number | null;
  tokenTerpakai?: number | null;
  biayaIdr?: number | null;
}

export async function catatProvider(baris: BarisLog): Promise<void> {
  if (!postgresRuntimeEnabled()) return;
  try {
    await getPool(config.databaseUrl).query(
      `INSERT INTO provider_log
         (id,job_id,shot_index,provider,model,task_id,fase,http_status,
          request_ringkas,response_ringkas,error,durasi_ms,token_terpakai,biaya_idr,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        crypto.randomUUID(),
        baris.jobId ?? null,
        baris.shotIndex ?? null,
        baris.provider,
        baris.model ?? null,
        baris.taskId ?? null,
        baris.fase,
        baris.httpStatus ?? null,
        bersihkan(baris.requestRingkas, 1_000),
        bersihkan(baris.response),
        bersihkan(baris.error, 1_000),
        baris.durasiMs ?? null,
        baris.tokenTerpakai ?? null,
        baris.biayaIdr ?? null,
        // KELIMA BELAS. Sampai 9 Sep 2026 nilai ini tidak pernah dikirim:
        // daftar kolomnya 15 dan placeholder-nya $1..$15, tapi array-nya cuma
        // 14 isi. Postgres menolak SETIAP baris dengan "bind message supplies
        // 14 parameters, but prepared statement requires 15" — dan karena
        // catatProvider sengaja menelan galatnya sendiri (mencatat tidak boleh
        // menggagalkan render), kegagalannya cuma muncul sebagai satu baris
        // console.warn di worker. Tabelnya kosong sejak hari pertama, dan tab
        // "Provider" yang Brian minta tidak pernah punya apa pun untuk
        // ditampilkan.
        //
        // Pelajarannya bukan "kurang teliti": jalur yang menelan galatnya
        // sendiri WAJIB punya tes yang memanggilnya sungguhan, karena tidak
        // ada satu pun sinyal lain yang akan memberitahu.
        new Date().toISOString(),
      ],
    );
  } catch (e) {
    // Lihat catatan di kepala berkas: mencatat tidak boleh menggagalkan render.
    console.warn("[provider-log] gagal mencatat:", e instanceof Error ? e.message : e);
  }
}

/** Buang baris yang lebih tua dari `hari`. Dipanggil penyapu worker.
 *
 *  Ada batasnya karena tabel ini tumbuh per SHOT, bukan per job — satu video 6
 *  shot menulis belasan baris, dan tanpa pemangkasan ia akan jadi tabel
 *  terbesar di basis data dalam beberapa bulan tanpa ada yang menyadarinya. */
export async function pangkasProviderLog(hari = 90): Promise<number> {
  if (!postgresRuntimeEnabled()) return 0;
  try {
    const batas = new Date(Date.now() - hari * 86_400_000).toISOString();
    const r = await getPool(config.databaseUrl).query(
      "DELETE FROM provider_log WHERE created_at < $1", [batas],
    );
    return r.rowCount ?? 0;
  } catch {
    return 0;
  }
}
