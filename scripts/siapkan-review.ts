// SIAPKAN REVIEW — kumpulkan video terbukti jadi satu folder untuk ditonton
// Brian, plus berkas persetujuan yang tinggal diisi.
//
// Alasannya: "terbukti" di sistem ini berarti LOLOS MESIN — tidak ada orang
// yang menggandakan, tidak ada tangan ketiga, durasinya utuh. Itu syarat
// perlu, bukan syarat cukup. Apakah videonya BAGUS tetap keputusan manusia,
// dan sampai sekarang tidak ada tempat untuk menuliskan keputusan itu.
//
// Jalankan: npx tsx scripts/siapkan-review.ts
// Lalu buka test_output/review/ dan isi persetujuan.json.

import fs from "node:fs";
import path from "node:path";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";

const OUT = path.resolve(process.cwd(), "..", "test_output");
const BUKU = path.join(OUT, "bukti-render.json");
const REVIEW = path.join(OUT, "review");
const SETUJU = path.join(OUT, "persetujuan.json");

type Nilai = "setuju" | "tolak" | null;

function main() {
  const buku = fs.existsSync(BUKU) ? JSON.parse(fs.readFileSync(BUKU, "utf8")) : {};
  const lama: Record<string, Nilai> = fs.existsSync(SETUJU) ? JSON.parse(fs.readFileSync(SETUJU, "utf8")) : {};
  fs.rmSync(REVIEW, { recursive: true, force: true });
  fs.mkdirSync(REVIEW, { recursive: true });

  const baru: Record<string, Nilai> = {};
  let n = 0;
  for (const t of CAMPAIGN_TEMPLATES) {
    const c = buku[t.id];
    if (!c || c.visiLolos !== true || !fs.existsSync(c.berkas)) continue;
    // Nama berkas memuat format dan durasi supaya bisa dinilai berkelompok
    // tanpa membuka daftar template.
    const nama = `${t.format}_${t.durationSec}dtk_${t.id}.mp4`;
    fs.copyFileSync(c.berkas, path.join(REVIEW, nama));
    // Keputusan lama DIPERTAHANKAN — menonton ulang 33 video tiap kali skrip
    // ini jalan adalah cara tercepat membuat orang berhenti memakainya.
    baru[t.id] = lama[t.id] ?? null;
    n++;
  }
  fs.writeFileSync(SETUJU, JSON.stringify(baru, null, 2));
  const belum = Object.values(baru).filter((v) => v === null).length;
  console.log(`${n} video siap ditonton di ${REVIEW}`);
  console.log(`persetujuan.json: ${belum} belum dinilai, ${n - belum} sudah`);
  console.log(`Isi "setuju" / "tolak" / null (belum dinilai).`);
}

main();
