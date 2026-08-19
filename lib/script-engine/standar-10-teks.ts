/**
 * Pemuat TEKS standar 10/10 — dipisah dari pemeriksanya karena ia membaca
 * berkas.
 *
 * standar-10.ts ikut ke BUNDEL KLIEN lewat validator (halaman /bikin/skrip
 * memakai gerbang yang sama dengan server), dan webpack tidak bisa memuat
 * node:fs di sana. Pemisahannya bukan kerapian: tanpa itu seluruh build
 * front-end gagal.
 */
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// TEKS STANDAR untuk disuntikkan ke prompt
// ---------------------------------------------------------------------------

let cacheSeksi: Record<string, string> | null = null;

/** Baca seksi dokumen standar (A, B, ...) apa adanya. */
function seksi(): Record<string, string> {
  if (cacheSeksi) return cacheSeksi;
  const out: Record<string, string> = {};
  try {
    const teks = fs.readFileSync(path.join(process.cwd(), "knowledge", "rules", "standard-10.md"), "utf8");
    for (const bagian of teks.split(/\n## /).slice(1)) {
      const huruf = bagian.trim()[0];
      out[huruf] = `## ${bagian.trim()}`;
    }
  } catch (err) {
    // Standar ini lapisan MUTU, bukan syarat hidup: kalau berkasnya tidak ikut
    // ter-deploy, penulis tetap harus bisa menulis — tapi kehilangannya harus
    // TERLIHAT, bukan diam.
    console.warn(`[standar-10] knowledge/rules/standard-10.md tidak terbaca: ${(err as Error).message}`);
  }
  cacheSeksi = out;
  return out;
}

/** Seksi A (Ads vs Affiliate) + B (12 baris), untuk prompt Idea Stage/penulis. */
export function blokStandar(): string {
  const s = seksi();
  const isi = [s.A, s.B].filter(Boolean).join("\n\n");
  return isi ? `PRODUCTION STANDARD (authoritative, Indonesian source text):\n${isi}` : "";
}


// ---------------------------------------------------------------------------
// MASTER per CONTENT TYPE (slice 1, 19 Agu 2026)
// ---------------------------------------------------------------------------
//
// Kontrak Ads vs Affiliate sebelumnya cuma hidup di kepala dan di berkas skill
// di luar app; penulis LLM tidak pernah membacanya, dan satu-satunya perbedaan
// yang benar-benar sampai ke model adalah kalimat CTA. Sejak sekarang seksi
// pembuka MASTER masing-masing ("Apa itu X dan bukan") disuntik VERBATIM sesuai
// content_type — bagian yang menentukan apakah sebuah naskah lahir di kamar
// yang benar.

const CACHE_MASTER = new Map<string, string>();

function masterSeksiSatu(berkas: string): string {
  const sudah = CACHE_MASTER.get(berkas);
  if (sudah !== undefined) return sudah;
  let hasil = "";
  try {
    const teks = fs.readFileSync(path.join(process.cwd(), "knowledge", "rules", berkas), "utf8");
    // Seksi "## 1. ..." sampai sebelum "## 2."
    const m = teks.match(/\n## 1\.[\s\S]*?(?=\n## 2\.)/);
    hasil = m ? m[0].trim() : "";
  } catch (err) {
    console.warn(`[master] knowledge/rules/${berkas} tidak terbaca: ${(err as Error).message}`);
  }
  CACHE_MASTER.set(berkas, hasil);
  return hasil;
}

/**
 * Blok MASTER sesuai genre. Kosong = berkasnya tidak ikut ter-deploy; penulis
 * tetap jalan (lapisan mutu, bukan syarat hidup) tapi peringatannya terlihat.
 */
export function blokMaster(contentType: "affiliate" | "ads"): string {
  const isi = masterSeksiSatu(contentType === "ads" ? "MASTER-UGC-ADS.md" : "MASTER-UGC-AFFILIATE.md");
  if (!isi) return "";
  const judul = contentType === "ads" ? "MASTER — AI UGC ADS" : "MASTER — AI UGC AFFILIATE";
  return `${judul} (authoritative, Indonesian source text):\n${isi}`;
}
