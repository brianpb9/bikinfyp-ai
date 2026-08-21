// APAKAH RUNTIME INI BENAR-BENAR BISA MENGKLASIFIKASI GAMBAR?
//
// Pertanyaannya bukan retoris. Seluruh jalur unggah foto produk berjalan di
// service WEB (lima route; lihat docs/evidence/P0-03/B1-B2-MATRIKS-INGESTION.md),
// sementara ffmpeg/ffprobe/tesseract hanya dijamin oleh `Dockerfile.worker`.
// `render.yaml` dan `render.production.yaml` keduanya memakai `runtime: node`
// untuk service web, dan tidak ada satu pun konfigurasi yang menjanjikan ketiga
// biner ada di sana.
//
// Selama ini tidak ada bukti ke arah mana pun — dan itu masalahnya. Mesin
// pengembang punya ketiganya (`/opt/homebrew/bin`), jadi setiap test lokal
// hijau tanpa mengatakan apa pun tentang produksi. Modul ini menjawabnya di
// LINGKUNGAN SUNGGUHAN, lalu `/api/health` mengeksposnya supaya jawabannya bisa
// dibaca dari luar tanpa akses shell.
//
// TIGA KEPUTUSAN DESAIN, ketiganya berasal dari cacat nyata:
//
//   1. Biner benar-benar DIJALANKAN, bukan dicari namanya. Biner yang ada tapi
//      mati saat dieksekusi (arsitektur salah, pustaka hilang) adalah keadaan
//      nyata di image container yang salah rakit, dan "ada di PATH" tidak
//      membedakannya dari yang sehat.
//   2. DATA BAHASA OCR ikut diperiksa. `tesseract` tanpa `eng` terpasang mulus
//      dan gagal di setiap gambar — kegagalan yang baru terlihat sesudah
//      pengguna mengunggah.
//   3. Hasilnya DI-CACHE per PATH. `/api/health` dipanggil terus-menerus oleh
//      platform; hasil probe tidak bisa berubah tanpa redeploy, jadi empat
//      spawn per permintaan adalah beban tanpa informasi baru.
//
// MODUL INI TIDAK MENGAMBIL KEPUTUSAN GERBANG. Ia melaporkan. Yang memutuskan
// apa yang terjadi pada runtime yang tidak mampu adalah pemanggilnya —
// klasifikasiGambar sudah menjawabnya dengan `belum_diperiksa`.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const jalankan = promisify(execFile);

/** Biner yang wajib ada, sesuai pemanggilan di ./klasifikasi-gambar.ts. */
export const BINER_KLASIFIKASI = ["ffmpeg", "ffprobe", "tesseract"] as const;
export type BinerKlasifikasi = (typeof BINER_KLASIFIKASI)[number];

/** Data bahasa yang dipakai `tesseract … -l eng`. */
const BAHASA_OCR = "eng";

/** Probe tidak boleh ikut menggantung kalau binernya yang bermasalah. */
const BATAS_MS = 5_000;

export interface KapabilitasKlasifikasi {
  /** Runtime ini bisa menerbitkan bukti yang berupa VONIS, bukan `belum_diperiksa`. */
  mampu: boolean;
  biner: Record<BinerKlasifikasi, boolean>;
  /** `tesseract` punya data bahasa yang dipakai classifier. */
  bahasaOcr: boolean;
  /** Menyebut apa yang hilang, cukup spesifik untuk ditindaklanjuti. */
  alasan: string;
  diperiksaPada: string;
}

export interface OpsiProbe {
  /**
   * PATH yang dipakai saat menjalankan biner. Disuntik lewat opsi — BUKAN
   * dengan memutasi `process.env` — supaya test tidak saling mencemari lewat
   * keadaan global.
   */
  pathOverride?: string;
  /** Abaikan cache dan periksa ulang. Cache tidak boleh jadi penjara. */
  segarkan?: boolean;
}

/**
 * Cache per PATH.
 *
 * Kuncinya PATH karena itulah satu-satunya masukan yang mengubah jawabannya.
 * Di produksi PATH konstan, jadi peta ini berisi tepat satu entri seumur
 * proses; kunci per-PATH ada supaya test dengan lingkungan berbeda tidak saling
 * membaca hasil satu sama lain.
 */
const cache = new Map<string, KapabilitasKlasifikasi>();

async function binerHidup(nama: string, argumen: string[], env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    await jalankan(nama, argumen, { timeout: BATAS_MS, killSignal: "SIGKILL", env, maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    // Tidak ada di PATH, tidak bisa dieksekusi, exit non-nol, atau menggantung
    // melewati batas. Ketiganya berarti hal yang sama untuk kita: runtime ini
    // tidak bisa mengandalkannya.
    return false;
  }
}

async function punyaBahasaOcr(env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    const { stdout, stderr } = await jalankan("tesseract", ["--list-langs"], {
      timeout: BATAS_MS,
      killSignal: "SIGKILL",
      env,
      maxBuffer: 1024 * 1024,
    });
    // tesseract menulis daftarnya ke stdout pada versi baru dan ke stderr pada
    // sebagian versi lama; keduanya diperiksa supaya probe tidak melaporkan
    // "tidak ada data bahasa" hanya karena versinya berbeda.
    return `${stdout}\n${stderr}`
      .split("\n")
      .map((baris) => baris.trim())
      .includes(BAHASA_OCR);
  } catch {
    return false;
  }
}

export async function periksaKapabilitasKlasifikasi(opsi: OpsiProbe = {}): Promise<KapabilitasKlasifikasi> {
  const jalur = opsi.pathOverride ?? process.env.PATH ?? "";
  if (!opsi.segarkan) {
    const tersimpan = cache.get(jalur);
    if (tersimpan) return tersimpan;
  }

  const env: NodeJS.ProcessEnv = { ...process.env, PATH: jalur };

  const [ffmpeg, ffprobe, tesseract] = await Promise.all([
    binerHidup("ffmpeg", ["-version"], env),
    binerHidup("ffprobe", ["-version"], env),
    binerHidup("tesseract", ["--version"], env),
  ]);
  // Data bahasa hanya bermakna kalau binernya sendiri hidup.
  const bahasaOcr = tesseract ? await punyaBahasaOcr(env) : false;

  const biner: Record<BinerKlasifikasi, boolean> = { ffmpeg, ffprobe, tesseract };
  const hilang = BINER_KLASIFIKASI.filter((n) => !biner[n]);
  const mampu = hilang.length === 0 && bahasaOcr;

  const bagian: string[] = [];
  if (hilang.length > 0) bagian.push(`biner tidak bisa dijalankan: ${hilang.join(", ")}`);
  if (tesseract && !bahasaOcr) bagian.push(`tesseract terpasang tanpa data bahasa "${BAHASA_OCR}"`);

  const hasil: KapabilitasKlasifikasi = {
    mampu,
    biner,
    bahasaOcr,
    alasan: mampu
      ? "Runtime ini bisa mengklasifikasi gambar."
      : `Runtime ini TIDAK bisa mengklasifikasi gambar — ${bagian.join("; ")}. ` +
        "Setiap unggahan di sini akan menerbitkan bukti berstatus belum_diperiksa " +
        "dan menunggu revalidasi di boundary yang punya binernya.",
    diperiksaPada: new Date().toISOString(),
  };

  cache.set(jalur, hasil);
  return hasil;
}
