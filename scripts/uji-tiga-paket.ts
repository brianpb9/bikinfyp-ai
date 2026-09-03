/**
 * UJI FUNGSIONAL TIGA PAKET — standard, premium, ultra.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERMINTAAN BRIAN, 3 SEP 2026
 * ─────────────────────────────────────────────────────────────────────────────
 *   "lakukan generate test untuk setiap product (gunakan product demo) untuk
 *    kategori video standard, premium dan ultra. pastikan 3 opsi video ini
 *    berfungsi dengan baik."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * YANG DIUJI, DAN YANG TIDAK
 * ─────────────────────────────────────────────────────────────────────────────
 * DIUJI: perutean paket -> mesin, penyusunan prompt, pemanggilan penyedia
 * sungguhan, biaya yang benar-benar ditagih, dan berkas video yang keluar.
 * Dipakai generateVideoWithFailover() — PINTU YANG SAMA dengan yang dipakai
 * worker produksi, bukan provider yang dipanggil langsung. Memanggil provider
 * langsung akan melewati assertVisualSpec, urutan failover, dan pemilihan
 * mesin per tier, yaitu justru bagian yang paling perlu dibuktikan.
 *
 * TIDAK DIUJI DI SINI: pemotongan jatah kredit pengguna dan rantai pembayaran.
 * Keduanya punya bukti sendiri (verify-callback-duitku.ts,
 * verify-checkout-langganan.ts) dan tidak butuh render berbayar untuk diuji.
 *
 * Biayanya SATU klip per paket. Menjalankan video utuh tiga kali hanya untuk
 * menjawab "apakah ketiganya jalan" berarti membayar lima kali lipat untuk
 * jawaban yang sama.
 *
 * Jalankan di dalam kontainer (kredensial ada di sana):
 *   RENDER_CONFIRM=YA npx tsx scripts/uji-tiga-paket.ts <kunci-gambar-produk>
 */
import fs from "node:fs";
import path from "node:path";
import { generateVideoWithFailover } from "../lib/providers/registry";
import { mediaStorage } from "../lib/storage";
import { runFfmpeg } from "../lib/media/ffmpeg";
import { MANDATORY_NEGATIVE_PROMPT } from "../lib/config/compliance";
import type { QualityTier } from "../lib/providers/types";

if (process.env.RENDER_CONFIRM !== "YA") {
  console.error("Ditolak: ini render berbayar. Ulangi dengan RENDER_CONFIRM=YA.");
  process.exit(1);
}
const kunci = process.argv[2];
if (!kunci) {
  console.error("Sebutkan kunci gambar produk, mis. uploads/<id-produk>/0.webp");
  process.exit(1);
}

const OUT = "/tmp/uji-tiga-paket";
const PAKET: QualityTier[] = ["standard", "premium", "ultra"];

// Satu shot, SAMA untuk ketiganya. Yang diuji perbedaan mesin, jadi segala hal
// lain harus identik — termasuk promptnya, sesuai aturan Brian bahwa yang
// membedakan paket hanyalah modelnya.
const PROMPT =
  "close-up of a young Indonesian woman's hands presenting the product over a clean home table, " +
  "phone camera look, natural daylight, gentle push in, the product label facing camera";

// Negatif produksi: cukup memuat penanda kepatuhan yang diperiksa
// assertVisualSpec. Daftar cacat SENGAJA tidak ada di sini — lihat catatan di
// lib/providers/teks-prompt.ts tentang kenapa menyebut cacat justru
// memunculkannya.
const NEGATIF = MANDATORY_NEGATIVE_PROMPT;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const gambar = await mediaStorage().materialize(kunci);
  if (!gambar || !fs.existsSync(gambar)) throw new Error(`gambar tidak ada di penyimpanan: ${kunci}`);
  console.log(`gambar referensi: ${gambar}\n`);

  const ringkas: Record<string, unknown>[] = [];
  for (const tier of PAKET) {
    const dir = path.join(OUT, tier);
    fs.mkdirSync(dir, { recursive: true });
    const spec = {
      jobId: `uji-${tier}`,
      width: 720,
      height: 1280,
      shots: [{ index: 0, durationSec: Number(process.env.UJI_DETIK ?? 6), prompt: PROMPT, imageRefPath: gambar }],
      negativePrompt: NEGATIF,
      qualityTier: tier,
      generateAudio: true,
    };
    const mulai = Date.now();
    try {
      const hasil = await generateVideoWithFailover(spec as never, dir);
      const aset = hasil.assets[0];
      const detik = Math.round((Date.now() - mulai) / 1000);
      // Satu frame di tengah — cukup untuk memeriksa tangan, jumlah orang, dan label.
      const frame = path.join(OUT, `${tier}.png`);
      await runFfmpeg(["-y", "-v", "error", "-ss", "3", "-i", aset.filePath, "-frames:v", "1", "-vf", "scale=360:-1", frame]);
      console.log(
        `${tier.padEnd(9)} OK  mesin=${hasil.providerName.padEnd(10)} ` +
          `biaya=Rp${hasil.costIdr.toLocaleString("id-ID")}  ${detik}s  ${aset.filePath}`,
      );
      ringkas.push({ paket: tier, status: "OK", mesin: hasil.providerName, biaya_idr: hasil.costIdr, detik, video: aset.filePath, frame });
    } catch (err) {
      const pesan = err instanceof Error ? err.message : String(err);
      console.log(`${tier.padEnd(9)} GAGAL  ${pesan}`);
      ringkas.push({ paket: tier, status: "GAGAL", error: pesan });
    }
  }
  console.log(`\n${JSON.stringify(ringkas, null, 2)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
