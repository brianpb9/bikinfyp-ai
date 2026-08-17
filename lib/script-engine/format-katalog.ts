/**
 * Katalog format: struktur beat yang diturunkan dari preset Marketing Studio.
 *
 * PRESETNYA TIDAK PERNAH DIPANGGIL. Marketing Studio menolak avatar lewat API
 * (`params.avatars` dijawab "Marketing Studio does not support this parameter"),
 * jadi yang kita ambil strukturnya — tabel beat, teknik, dan cara gagalnya —
 * sementara videonya tetap kita buat sendiri dengan Seedance + frame turunan.
 * Itu justru lebih terkontrol: wajah bisa dikunci dan durasinya tepat.
 *
 * Dimuat dari knowledge/formats/*.json, bukan ditulis di sini, karena isinya
 * pengetahuan produksi yang akan tumbuh — dan orang yang menambah format
 * berikutnya tidak seharusnya perlu menyentuh TypeScript.
 */
import fs from "node:fs";
import path from "node:path";

export interface Beat {
  beat: number;
  durasi: number;
  isi: string;
}

export interface FormatKatalog {
  id: string;
  slug_higgsfield: string;
  nama: string;
  kekuatan: string;
  cocok_untuk: string[];
  beat_table: Beat[];
  /** Cara mengerjakannya supaya formatnya benar-benar bekerja. */
  technique: string;
  /** Cara format ini gagal — sama pentingnya dengan cara ia berhasil. */
  failure_mode: string;
  no_face_recommended: boolean;
  alasan_tanpa_wajah?: string;
  /** Level hook minimal. giant_figure hanya masuk akal di level tontonan. */
  hook_level_min: string;
  butuh_cgi: boolean;
}

const DIR = path.join(process.cwd(), "knowledge", "formats");

let cache: FormatKatalog[] | null = null;

/**
 * Muat semua format. Gagal memuat TIDAK melempar.
 *
 * Katalog ini lapisan mutu, bukan syarat hidup: kalau berkasnya hilang di
 * lingkungan tertentu (mis. build yang tidak menyalin knowledge/), Idea Stage
 * harus tetap bisa jalan tanpa pasangan format — bukan mati total. Yang wajib
 * adalah kehilangan itu TERLIHAT, bukan bahwa ia menghentikan semuanya.
 */
export function muatFormat(): FormatKatalog[] {
  if (cache) return cache;
  try {
    const berkas = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
    cache = berkas
      .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as FormatKatalog)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (cache.length === 0) console.warn("[format] knowledge/formats kosong — Idea Stage jalan tanpa pasangan format.");
  } catch (err) {
    console.warn(`[format] katalog format tidak bisa dimuat, Idea Stage jalan tanpa pasangan format: ${(err as Error).message}`);
    cache = [];
  }
  return cache;
}

export function formatById(id: string): FormatKatalog | undefined {
  return muatFormat().find((f) => f.id === id);
}

export interface Prior {
  sifat_produk: string;
  format: string;
}

export function muatPrior(): Prior[] {
  try {
    const p = path.join(process.cwd(), "knowledge", "format-prior.json");
    return (JSON.parse(fs.readFileSync(p, "utf8")) as { prior: Prior[] }).prior;
  } catch {
    return [];
  }
}

/**
 * Format yang DILARANG sama sekali.
 *
 * "Couple Sharing At Home" menuntut DUA orang di frame. Itu melanggar aturan
 * satu-orang, dan bukan karena kaku: dua wajah berarti dua identitas yang harus
 * dikunci sekaligus, sementara Seedance saat ini bahkan menolak referensi satu
 * wajah. Risiko AI slop naik tajam untuk keuntungan yang tidak jelas.
 */
export const FORMAT_DILARANG = new Set(["couple_sharing_at_home", "couple_sharing", "couple"]);

/** Sifat produk yang biasanya menuntut tekstur/kebersihan — format tanpa wajah lebih cocok. */
const KATEGORI_TEKSTUR = new Set(["home", "kitchen", "cleaning", "beauty", "skincare"]);

export interface AlasanPasangan {
  boleh: boolean;
  /** Terisi kalau dilarang — siap dibaca manusia. */
  sebab?: string;
  /** true = pasangan ini justru DIUTAMAKAN untuk konteks ini. */
  diutamakan?: boolean;
}

/**
 * Bolehkah mekanik ini dipasangkan dengan format ini?
 *
 * Tiga aturan, dan ketiganya lahir dari batas nyata, bukan selera:
 *
 *   1. Format ber-CGI hanya di level tontonan. Alasan yang sama dengan
 *      penalti nativeness pada mekanik ber-CGI: di jalur produksi kita (satu
 *      talent, satu HP) ia tidak bisa terasa spontan, dan di level normal itu
 *      membaca sebagai iklan, bukan sebagai kejutan.
 *   2. Format yang butuh dua orang dilarang total.
 *   3. Format tanpa wajah DIUTAMAKAN untuk kategori tekstur/kebersihan —
 *      di sana orangnya memang tidak dibutuhkan, dan menghapus wajah menghapus
 *      seluruh masalah konsistensi identitas antar klip.
 */
export function bolehPasangan(input: {
  formatId: string;
  hookLevel?: string;
  productCategory?: string;
}): AlasanPasangan {
  if (FORMAT_DILARANG.has(input.formatId)) {
    return { boleh: false, sebab: `format ${input.formatId} butuh dua orang di frame — melanggar aturan satu-orang` };
  }
  const f = formatById(input.formatId);
  if (!f) return { boleh: true }; // format di luar katalog tidak dilarang, cuma tidak dibimbing

  const level = input.hookLevel ?? "normal";
  const levelTontonan = level === "agak_gila" || level === "gila";
  if (f.butuh_cgi && !levelTontonan) {
    return {
      boleh: false,
      sebab: `format ${f.id} menuntut CGI dan hanya masuk akal di level tontonan (agak_gila/gila), sekarang level ${level}`,
    };
  }

  const tekstur = KATEGORI_TEKSTUR.has(input.productCategory ?? "");
  return { boleh: true, diutamakan: f.no_face_recommended && tekstur };
}

/** Format yang boleh dipakai untuk konteks ini, yang diutamakan lebih dulu. */
export function formatTersedia(input: { hookLevel?: string; productCategory?: string }): FormatKatalog[] {
  const dinilai = muatFormat().map((f) => ({ f, p: bolehPasangan({ formatId: f.id, ...input }) }));
  return dinilai
    .filter((x) => x.p.boleh)
    .sort((a, b) => Number(b.p.diutamakan ?? false) - Number(a.p.diutamakan ?? false))
    .map((x) => x.f);
}

/** Ringkasan satu format untuk prompt Idea Stage — STRUKTUR, bukan contoh kalimat. */
export function ringkasUntukPrompt(f: FormatKatalog): string {
  const beat = f.beat_table.map((b) => `${b.durasi}s ${b.isi}`).join(" | ");
  return [
    `- ${f.id} (${f.nama}): ${f.kekuatan}`,
    `    beats: ${beat}`,
    `    technique: ${f.technique}`,
    `    fails when: ${f.failure_mode}`,
    f.no_face_recommended ? "    no face needed — hands only works and removes the identity problem" : "",
  ].filter(Boolean).join("\n");
}
