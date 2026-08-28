/** Ukur sinyal klasifikasi atas fixture nyata — dasar ambang di
 *  lib/media/klasifikasi-gambar.ts. Hanya membaca, tidak berbiaya. */
import path from "node:path";
import fs from "node:fs";
import { klasifikasiGambar } from "../lib/media/klasifikasi-gambar";

const T = path.resolve(process.cwd(), "..", "test_output");
const R = path.join(T, "jjglow", "handover", "refs", "product");
const BERKAS = [
  { f: path.join(R, "01-packshot-bersih-351px.webp"), harap: "product_photo" },
  { f: path.join(T, "canary-glow.jpg"), harap: "product_photo" },
  { f: path.join(R, "03-thumbnail.jpeg"), harap: "product_photo" },
  { f: path.join(T, "jjglow-produk.png"), harap: "?" },
  { f: path.join(R, "04-crop-banner-JANGAN-DIPAKAI.png"), harap: "promotional_graphic" },
  { f: path.join(R, "02-banner-promo-JANGAN-DIPAKAI.jpeg"), harap: "promotional_graphic" },
];

async function main() {
  for (const b of BERKAS) {
    if (!fs.existsSync(b.f)) { console.log(`(tidak ada) ${path.basename(b.f)}`); continue; }
    const h = await klasifikasiGambar(b.f);
    const cocok = b.harap === "?" ? "?" : h.jenis === b.harap ? "OK" : "SALAH";
    console.log(
      `${path.basename(b.f).padEnd(38)} rasio ${h.rasioAreaTeks.toFixed(4)}  kata ${String(h.jumlahKata).padStart(3)}  -> ${h.jenis.padEnd(20)} ${cocok}`
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
