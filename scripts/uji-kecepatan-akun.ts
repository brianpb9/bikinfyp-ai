// UJI KECEPATAN AKUN BYTEPLUS — akun lambat, atau layanannya lambat?
//
// 16 Agustus 2026 render katalog merangkak: 1259 detik untuk satu klip 5 detik,
// padahal beberapa jam sebelumnya 90-130 detik dengan KODE YANG SAMA. Polling
// kita paling banter menambah 20 detik, jadi penyebabnya di sisi provider —
// tapi belum diketahui apakah BytePlus global yang sibuk, atau antrean khusus
// akun kita.
//
// Bedanya menentukan tindakan: kalau global, tidak ada yang bisa dilakukan
// selain menunggu. Kalau per-akun, pindah akun langsung menyelesaikannya.
//
// Satu klip 5 detik, ~Rp800-2.800. Murah untuk pertanyaan sebesar itu.
//
// Jalankan:
//   RENDER_CONFIRM=YA npx tsx scripts/uji-kecepatan-akun.ts
// Memakai BYTEPLUS_ARK_API_KEY_ALT dari .env.local bila ada; kalau tidak,
// memakai key yang sekarang (jadi bisa dipakai mengukur keduanya).

import fs from "node:fs";
import path from "node:path";

async function main() {
  if (process.env.RENDER_CONFIRM !== "YA") {
    console.error("Ditolak: ini render berbayar. Ulangi dengan RENDER_CONFIRM=YA.");
    process.exit(1);
  }
  // .env.local dibaca SENDIRI di sini, bukan menunggu lib/config, karena config
  // menyalin key ke objek beku saat diimpor — menimpa process.env sesudahnya
  // tidak berpengaruh sama sekali. Urutannya wajib: baca file -> timpa key ->
  // baru impor provider.
  const envFile = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(envFile)) {
    for (const baris of fs.readFileSync(envFile, "utf8").split("\n")) {
      const m = baris.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !baris.trim().startsWith("#") && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2];
      }
    }
  }
  const alt = process.env.BYTEPLUS_ARK_API_KEY_ALT;
  if (alt) process.env.BYTEPLUS_ARK_API_KEY = alt;
  console.log(alt ? "Memakai key ALTERNATIF" : "Memakai key SEKARANG");

  const { byteplusVideo } = await import("../lib/providers/stubs/byteplus");
  const FOTO = path.resolve(process.cwd(), "..", "test_output", "wardah-asli.png");
  const OUT = path.resolve(process.cwd(), "..", "test_output", "uji-kecepatan");
  fs.mkdirSync(OUT, { recursive: true });

  const spec = {
    jobId: "uji-kecepatan", width: 720, height: 1280,
    shots: [{ index: 0, durationSec: 5, prompt:
      "Slow macro push-in on the product standing alone on a clean surface, soft directional light.",
      imageRefPath: FOTO }],
    negativePrompt: "no added text overlay, no watermark, no borders",
    qualityTier: "high_quality" as const, generateAudio: false, ratio: "9:16",
  };

  const t = Date.now();
  const aset = await byteplusVideo.generate(spec as never, OUT);
  const detik = (Date.now() - t) / 1000;
  console.log(`\nWAKTU: ${detik.toFixed(1)} detik untuk klip 5 dtk (Rp${aset[0].costIdr.toLocaleString("id-ID")})`);
  console.log(detik < 200 ? "-> CEPAT. Akun sekarang yang tersendat, bukan BytePlus global."
                          : "-> LAMBAT juga. Kemungkinan besar BytePlus yang sedang sibuk, bukan akunnya.");
}
main().catch((e) => { console.error(e); process.exit(1); });
