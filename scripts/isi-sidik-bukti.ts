// ISI SIDIK BUKTI — selamatkan render yang sudah dibayar dari aturan waktu.
//
// Masalahnya nyata dan mahal. Aturan kesegaran versi pertama memakai waktu
// commit shot-planner.ts: setiap render yang lebih tua dianggap kedaluwarsa.
// Sementara batch katalog berjalan, perbaikan hands_only masuk — dan di bawah
// aturan waktu itu SELURUH template talking_head/ads/tvc yang sedang dirender
// mendadak jadi "bukti basi", ±Rp280.000 hangus tanpa satu pun promptnya
// berubah.
//
// Aturan sidik prompt sudah menggantikannya, tapi proses render yang sedang
// berjalan memuat kode lama, jadi catatannya lahir tanpa sidik.
//
// Skrip ini mengisi sidik itu — HANYA untuk format yang promptnya memang tidak
// tersentuh. Perubahan hands_only ada di dua tempat dan keduanya eksklusif
// milik format itu:
//   - HANDS_ONLY_HAND_LOCK  (shot-planner)
//   - handsPrompt           (personas; dipakai hanya bila format hands_only)
// Jadi untuk talking_head/ads/tvc, prompt yang direncanakan sekarang identik
// byte-per-byte dengan yang dikirim saat render. Mengisikan sidiknya bukan
// mengarang bukti — mengembalikan bukti yang memang masih berlaku.
//
// hands_only SENGAJA TIDAK diisi: promptnya memang berubah, jadi buktinya
// memang tidak berlaku lagi.
//
// Jalankan: npx tsx scripts/isi-sidik-bukti.ts

import fs from "node:fs";
import path from "node:path";
import { planShots } from "../lib/media/shot-planner";
import { getCreatorCategory } from "../lib/personas";
import { generateScripts, type ProductInput } from "../lib/script-engine";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";
import { sidikPrompt } from "../lib/media/bukti-segar";

const FOTO = path.resolve(process.cwd(), "..", "test_output", "produk-polos.jpg");
const BUKU = path.resolve(process.cwd(), "..", "test_output", "bukti-render.json");

const KATEGORI = getCreatorCategory("hijaber")!;
const PRODUK: ProductInput = {
  id: "katalog", name: "Mosseru Bright Shower Gel", price_idr: 189000,
  category: "beauty", sourceUrl: null,
};

function rencanakan(tpl: (typeof CAMPAIGN_TEMPLATES)[number]) {
  const [skrip] = generateScripts({
    product: PRODUK, register: "bunda", qualityTier: "high_quality",
    durationSec: tpl.durationSec, count: 1, hookLevel: tpl.hookLevel,
    ...(tpl.hookFamily ? { hookFamilies: [tpl.hookFamily as never], lockHookFamily: true } : {}),
    templateId: tpl.id,
  });
  return planShots({
    jobId: tpl.id, durationSec: tpl.durationSec, segments: skrip.segments,
    category: KATEGORI, productName: PRODUK.name, productCategory: "beauty",
    imageRefPath: FOTO, qualityTier: "high_quality", format: tpl.format,
    hookLevel: tpl.hookLevel, ugcTemplate: tpl.id,
    tvcRoute: tpl.tvcRoute, shotCountOverride: tpl.shotCount, ratio: tpl.ratio,
  });
}

function main() {
  const buku: Record<string, { berkas: string; sidik?: string; visiLolos?: boolean | null }> =
    fs.existsSync(BUKU) ? JSON.parse(fs.readFileSync(BUKU, "utf8")) : {};
  let diisi = 0, dilewati = 0;
  for (const tpl of CAMPAIGN_TEMPLATES) {
    const c = buku[tpl.id];
    if (!c || c.sidik) continue;
    // HANYA catatan yang sudah diperiksa QC visi versi sekarang.
    //
    // Versi pertama skrip ini menstempel juga lima catatan lama dari SEBELUM
    // perbaikan penutup TVC — prompt mereka jelas berubah, jadi sidik hari ini
    // bukan sidik yang mereka pakai. Kebetulan semuanya visiLolos null
    // sehingga tidak terhitung terbukti, tapi mengandalkan kebetulan bukan
    // jaminan: begitu seseorang menjalankan ulang QC pada berkas itu, ia akan
    // tampak segar padahal tidak.
    if (c.visiLolos !== true) { console.log(`  lewati ${tpl.id} — belum lolos QC visi versi sekarang`); dilewati++; continue; }
    if (tpl.format === "hands_only") {
      console.log(`  lewati ${tpl.id} — hands_only, promptnya memang berubah`);
      dilewati++;
      continue;
    }
    if (!fs.existsSync(c.berkas)) { console.log(`  lewati ${tpl.id} — berkas hilang`); dilewati++; continue; }
    try {
      c.sidik = sidikPrompt(rencanakan(tpl));
      console.log(`  isi ${tpl.id} -> ${c.sidik}`);
      diisi++;
    } catch (err) {
      console.log(`  gagal ${tpl.id}: ${err instanceof Error ? err.message : String(err)}`);
      dilewati++;
    }
  }
  fs.writeFileSync(BUKU, JSON.stringify(buku, null, 2));
  console.log(`\ndiisi ${diisi}, dilewati ${dilewati}`);
}

main();
