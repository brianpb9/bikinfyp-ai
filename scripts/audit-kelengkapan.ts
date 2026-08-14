// AUDIT KELENGKAPAN BUKTI — video yang kehilangan shot bukan bukti.
//
// Kenapa ada. QC visual memeriksa APA YANG ADA di frame; ia tidak pernah tahu
// apa yang HILANG. Terjadi 2026-08-14: satu shot gagal di provider, videonya
// digabung dari satu klip saja (8,1 dtk dari 15), dan QC-11 melaporkan
// "BERSIH" — karena tiga frame yang disampelnya memang bersih. Buku bukti
// hampir mencatatnya sebagai template yang terbukti.
//
// Durasi adalah cara paling murah dan paling sulit dibantah untuk mengetahui
// sebuah video utuh atau tidak.
//
// Jalankan: npx tsx scripts/audit-kelengkapan.ts
import fs from "node:fs";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";
import { probeDurationSec } from "../lib/media/ffmpeg";
const BUKU = "/Users/hadrava/HDRV/03_UGC_AI_ID/test_output/bukti-render.json";
async function main() {
  const buku = JSON.parse(fs.readFileSync(BUKU, "utf8"));
  let dicabut = 0;
  for (const t of CAMPAIGN_TEMPLATES) {
    const c = buku[t.id];
    if (!c || !fs.existsSync(c.berkas)) continue;
    const d = await probeDurationSec(c.berkas).catch(() => 0);
    // Toleransi 2 dtk: concat bisa meleset sedikit dari target.
    if (d < t.durationSec - 2) {
      console.log(`  ${t.id}: ${d.toFixed(1)} dtk, seharusnya ${t.durationSec} — bukti dicabut`);
      buku[t.id] = { ...c, visiLolos: null, visiMasalah: [`durasi ${d.toFixed(1)} dtk dari ${t.durationSec} — ada shot hilang`] };
      dicabut++;
    }
  }
  fs.writeFileSync(BUKU, JSON.stringify(buku, null, 2));
  console.log(`\nbukti dicabut: ${dicabut}`);
}
main();
