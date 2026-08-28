// APAKAH RUNTIME INI BENAR-BENAR BISA MENGKLASIFIKASI GAMBAR?
//
// Pertanyaannya bukan retoris. Seluruh jalur unggah foto produk berjalan di
// service WEB (lima route; lihat docs/evidence/P0-03/B1-B2-MATRIKS-INGESTION.md),
// sementara secara historis ffmpeg/ffprobe/tesseract hanya dijamin oleh
// `Dockerfile.worker`. `render.yaml` kini punya candidate `Dockerfile.web`
// staging-only dengan ketiga dependency itu; production tetap `runtime: node`.
// Dockerfile tetap bukan bukti deployment, jadi probe ini tetap menjadi hakim
// atas runtime yang benar-benar hidup.
//
// Probe ini awalnya menutup ketiadaan bukti itu; managed staging kemudian
// menjawab negatif (`mampu=false`). Mesin pengembang punya ketiganya
// (`/opt/homebrew/bin`), jadi test lokal atau Dockerfile candidate tetap tidak
// mengatakan apa pun tentang runtime managed sampai `/api/health` menjawabnya
// di LINGKUNGAN SUNGGUHAN.
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

import fs from "node:fs";
import path from "node:path";
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
  /**
   * Jalur produksi benar-benar berhasil mengklasifikasi satu gambar uji.
   *
   * Inilah penentu `mampu`. `biner`/`bahasaOcr` di atas adalah DIAGNOSTIK —
   * mereka memberi tahu operator apa yang bermasalah, bukan memutuskan.
   */
  smoke: boolean;
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

/**
 * Probe yang SEDANG BERJALAN, per kunci PATH.
 *
 * Cache hasil saja tidak cukup: ia baru terisi sesudah seluruh probe selesai,
 * jadi dua permintaan `/api/health` yang datang sebelum probe pertama rampung
 * sama-sama mengalami cache miss dan masing-masing menelurkan sampai empat
 * proses. Pada biner yang menggantung, jendela itu berlangsung sampai lima
 * detik — persis saat platform paling sering menanyainya (cold start).
 *
 * Yang di-cache karena itu PROMISE-nya, bukan hanya nilainya.
 */
const sedangBerjalan = new Map<string, Promise<KapabilitasKlasifikasi>>();

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
    const berjalan = sedangBerjalan.get(jalur);
    if (berjalan) return berjalan;
  }

  const tugas = jalankanProbe(jalur).finally(() => sedangBerjalan.delete(jalur));
  sedangBerjalan.set(jalur, tugas);
  return tugas;
}

/**
 * SMOKE PIPELINE, bukan sekadar `-version`.
 *
 * Temuan Reviewer 21 Agu, dan ia benar: `-version` yang sukses tidak
 * membuktikan biner itu bisa melakukan pekerjaannya. ffmpeg bisa menjawab
 * versinya lalu gagal men-decode; tesseract bisa menjawab versinya dan
 * menyebut `eng` di `--list-langs` lalu gagal menghasilkan TSV. Probe yang
 * berhenti di `-version` melaporkan "mampu" untuk runtime yang sebenarnya
 * lumpuh — dan laporan itu yang dipakai orang untuk memutuskan apakah bukti
 * produksi bisa dipercaya.
 *
 * Yang dijalankan di sini adalah JALUR PRODUKSI yang sama persis:
 * `klasifikasiGambar` atas satu gambar kecil yang dibuat saat itu juga. Kalau
 * ia mengembalikan vonis sungguhan (`product_photo`/`promotional_graphic`),
 * runtime ini benar-benar bisa mengklasifikasi. Kalau ia mengembalikan
 * `belum_diperiksa`, runtime ini tidak bisa — apa pun kata `-version`.
 *
 * Pemeriksaan `-version` TETAP ADA, tapi perannya berubah: ia bukan lagi
 * penentu `mampu`, ia diagnostik. Operator yang membaca `/api/health` perlu
 * tahu biner MANA yang bermasalah, dan smoke sendirian tidak memberitahunya.
 */
async function jalankanProbe(jalur: string): Promise<KapabilitasKlasifikasi> {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: jalur };

  const [ffmpeg, ffprobe, tesseract] = await Promise.all([
    binerHidup("ffmpeg", ["-version"], env),
    binerHidup("ffprobe", ["-version"], env),
    binerHidup("tesseract", ["--version"], env),
  ]);
  const bahasaOcr = tesseract ? await punyaBahasaOcr(env) : false;
  const biner: Record<BinerKlasifikasi, boolean> = { ffmpeg, ffprobe, tesseract };

  const smoke = await smokeKlasifikasi(jalur);

  const hilang = BINER_KLASIFIKASI.filter((n) => !biner[n]);
  const mampu = smoke.berhasil;

  const bagian: string[] = [];
  if (hilang.length > 0) bagian.push(`biner tidak bisa dijalankan: ${hilang.join(", ")}`);
  if (tesseract && !bahasaOcr) bagian.push(`tesseract terpasang tanpa data bahasa "${BAHASA_OCR}"`);
  if (!smoke.berhasil) bagian.push(`smoke klasifikasi gagal: ${smoke.sebab}`);

  const hasil: KapabilitasKlasifikasi = {
    mampu,
    biner,
    bahasaOcr,
    smoke: smoke.berhasil,
    alasan: mampu
      ? "Runtime ini bisa mengklasifikasi gambar (terbukti lewat smoke pipeline, bukan hanya -version)."
      : `Runtime ini TIDAK bisa mengklasifikasi gambar — ${bagian.join("; ")}. ` +
        "Setiap unggahan di sini akan menerbitkan bukti berstatus belum_diperiksa " +
        "dan menunggu revalidasi di boundary yang punya binernya.",
    diperiksaPada: new Date().toISOString(),
  };

  cache.set(jalur, hasil);
  return hasil;
}

/**
 * Menjalankan JALUR PRODUKSI atas fixture berteks, lalu menuntut METRIKNYA.
 *
 * Dua temuan Reviewer 21 Agu tergabung di sini.
 *
 * (a) FIXTURE POLOS TIDAK MEMBUKTIKAN OCR BEKERJA. Gambar tanpa teks membuat
 *     setiap hasil selain `belum_diperiksa` terlihat sukses — termasuk
 *     tesseract yang selalu mengembalikan TSV KOSONG dengan exit 0, dan
 *     ffprobe yang mengeluarkan output kosong (classifier memakai dimensi
 *     cadangan 1440x1440 dan tetap menghasilkan vonis). Fixture sekarang
 *     berteks besar, dan metriknya yang dituntut:
 *
 *       jumlahKata >= 1     -> OCR benar-benar membaca kata. TSV kosong = 0.
 *       rasioAreaTeks >= AMBANG_SMOKE_RASIO
 *                           -> dimensi dari ffprobe benar-benar dipakai.
 *                              Fixture 1440x180 memberi rasio ~0.26; kalau
 *                              ffprobe gagal dan classifier memakai cadangan
 *                              1440x1440, rasio yang sama jatuh ~8x menjadi
 *                              ~0.033 — di bawah ambang ini.
 *
 *     Fixture-nya berkas yang DI-COMMIT, bukan dirender saat runtime: merender
 *     teks butuh font, dan container slim sering tidak punya. Probe yang gagal
 *     karena font akan salah melaporkan runtime sehat sebagai lumpuh.
 *
 * (b) BATAS WAKTU. `klasifikasiGambar` memakai 20 detik per tahap; tiga tahap
 *     berarti `/api/health` bisa tertahan satu menit oleh biner yang
 *     menggantung, dan platform menganggap service-nya mati. Probe memakai
 *     batas jauh lebih pendek — dan `execFile` membunuh anaknya dengan SIGKILL
 *     saat batas itu lewat, jadi prosesnya benar-benar berhenti, bukan sekadar
 *     tidak ditunggu.
 */
const FIXTURE_SMOKE = path.join(process.cwd(), "assets", "probe", "probe-teks.png");
const BATAS_SMOKE_MS = 4_000;
const AMBANG_SMOKE_RASIO = 0.08;

async function smokeKlasifikasi(jalur: string): Promise<{ berhasil: boolean; sebab: string }> {
  const pathAsli = process.env.PATH;
  try {
    if (!fs.existsSync(FIXTURE_SMOKE)) {
      return { berhasil: false, sebab: `fixture probe tidak ada di ${FIXTURE_SMOKE}` };
    }
    // `klasifikasiGambar` memanggil binernya lewat PATH proses, jadi PATH-nya
    // diarahkan sementara. Dipulihkan di `finally`; probe dijalankan sekali per
    // PATH dan hasilnya di-cache, jadi jendelanya sempit.
    process.env.PATH = jalur;
    const { klasifikasiGambar } = await import("./klasifikasi-gambar");
    const hasil = await klasifikasiGambar(FIXTURE_SMOKE, { batasMs: BATAS_SMOKE_MS });

    if (hasil.jenis === "belum_diperiksa") return { berhasil: false, sebab: hasil.alasan };
    if (hasil.jumlahKata < 1) {
      return {
        berhasil: false,
        sebab:
          "OCR tidak membaca satu kata pun dari fixture berteks — tesseract berjalan tapi tidak " +
          "menghasilkan apa-apa (TSV kosong / data bahasa tidak terpakai)",
      };
    }
    if (hasil.rasioAreaTeks < AMBANG_SMOKE_RASIO) {
      return {
        berhasil: false,
        sebab:
          `rasio area teks ${hasil.rasioAreaTeks.toFixed(4)} di bawah ambang smoke ` +
          `${AMBANG_SMOKE_RASIO} — dimensi dari ffprobe tampaknya tidak terpakai dan classifier ` +
          "jatuh ke dimensi cadangan",
      };
    }
    return { berhasil: true, sebab: "" };
  } catch (err) {
    return { berhasil: false, sebab: (err as Error).message };
  } finally {
    if (pathAsli === undefined) delete process.env.PATH;
    else process.env.PATH = pathAsli;
  }
}
