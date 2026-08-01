// Tooling tes TTS — siap jalan begitu API key ada.
// (a) Sintesis skrip contoh dengan beberapa voice per provider yang key-nya terisi,
// (b) ekstrak audio pembanding dari test_output/clarity_15s_test.mp4,
// (c) tulis semua output + LAPORAN_TTS.md ke test_output/tts_test/.
//
// Mode parsial: hanya provider dengan key terisi yang dites. Tanpa key sama sekali
// -> pesan jelas key mana yang kurang, exit 0 (bukan crash).
//
// PENTING: kami TIDAK menilai kualitas/naturalitas audio — kolom penilaian sengaja
// dikosongkan untuk diisi manusia (Brian) setelah mendengar.
//
// Jalankan: npx tsx scripts/test-tts.ts

import fs from "node:fs";
import path from "node:path";
import { config } from "../lib/config";
import { googleSynthesize, googleCostIdr } from "../lib/providers/stubs/google-tts";
import { azureSynthesize, azureCostIdr } from "../lib/providers/stubs/azure-tts";
import { runFfmpeg, probeDurationSec } from "../lib/media/ffmpeg";

const SAMPLE =
  "Aku udah coba lima serum buat jerawat. <jeda 800ms> Nah, cuma SATU ini yang beneran ngaruh, sumpah. " +
  "Teksturnya gel bening gini loh, nggak lengket. Harganya cuma 85 ribu, cek keranjang kuning ya!";

// Subset voice id-ID Chirp3-HD (dari 30 voice resmi Google)
const GOOGLE_VOICES = [
  "id-ID-Chirp3-HD-Aoede",
  "id-ID-Chirp3-HD-Charon",
  "id-ID-Chirp3-HD-Despina",
  "id-ID-Chirp3-HD-Enceladus",
  "id-ID-Chirp3-HD-Fenrir",
  "id-ID-Chirp3-HD-Kore",
  "id-ID-Chirp3-HD-Gacrux",
  "id-ID-Chirp3-HD-Iapetus",
];
// Voice id-ID Azure (2 voice resmi per Microsoft Learn)
const AZURE_VOICES = ["id-ID-GadisNeural", "id-ID-ArdiNeural"];

const OUT_DIR = path.resolve(process.cwd(), "..", "test_output", "tts_test");
const CLARITY_SRC = path.resolve(process.cwd(), "..", "test_output", "clarity_15s_test.mp4");

interface Row {
  provider: string;
  voice: string;
  file: string;
  durationSec: number | null;
  sizeKb: number | null;
  chars: number;
  costIdr: number | null;
  status: string;
}

const rows: Row[] = [];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Output: ${OUT_DIR}`);

  const hasGoogle = config.googleTtsApiKey !== "";
  const hasAzure = config.azureTtsKey !== "" && config.azureTtsRegion !== "";

  if (!hasGoogle) console.log("LEWATI Google: GOOGLE_TTS_API_KEY belum diisi.");
  if (!hasAzure) console.log("LEWATI Azure: AZURE_TTS_KEY / AZURE_TTS_REGION belum diisi.");

  // (b) audio pembanding dari video clarity
  if (fs.existsSync(CLARITY_SRC)) {
    const out = path.join(OUT_DIR, "pembanding_clarity_15s.wav");
    await runFfmpeg(["-y", "-i", CLARITY_SRC, "-vn", "-ar", "24000", "-ac", "1", out]);
    rows.push({
      provider: "referensi",
      voice: "audio bawaan video (clarity_15s_test.mp4)",
      file: path.basename(out),
      durationSec: await probeDurationSec(out),
      sizeKb: Math.round(fs.statSync(out).size / 1024),
      chars: 0,
      costIdr: null,
      status: "OK",
    });
  } else {
    console.log(`LEWATI pembanding: ${CLARITY_SRC} tidak ada.`);
  }

  // (a) Google Chirp3-HD
  if (hasGoogle) {
    for (const voice of GOOGLE_VOICES) {
      const out = path.join(OUT_DIR, `google_${voice}.wav`);
      try {
        const r = await googleSynthesize({ text: SAMPLE, voice, apiKey: config.googleTtsApiKey, outPath: out });
        rows.push({
          provider: "google", voice, file: path.basename(out),
          durationSec: r.durationSec, sizeKb: Math.round(fs.statSync(out).size / 1024),
          chars: r.chars, costIdr: googleCostIdr(r.chars), status: "OK",
        });
        console.log(`OK google ${voice}`);
      } catch (err) {
        rows.push({ provider: "google", voice, file: "-", durationSec: null, sizeKb: null, chars: SAMPLE.length, costIdr: null, status: `GAGAL: ${err instanceof Error ? err.message : err}` });
        console.log(`GAGAL google ${voice}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // (a) Azure Neural (SSML penuh — marker <jeda 800ms> jadi <break time="800ms"/>)
  if (hasAzure) {
    for (const voice of AZURE_VOICES) {
      const out = path.join(OUT_DIR, `azure_${voice}.wav`);
      try {
        const r = await azureSynthesize({
          text: SAMPLE, voice, key: config.azureTtsKey, region: config.azureTtsRegion, outPath: out,
        });
        rows.push({
          provider: "azure", voice, file: path.basename(out),
          durationSec: r.durationSec, sizeKb: Math.round(fs.statSync(out).size / 1024),
          chars: r.chars, costIdr: azureCostIdr(r.chars), status: "OK",
        });
        console.log(`OK azure ${voice}`);
      } catch (err) {
        rows.push({ provider: "azure", voice, file: "-", durationSec: null, sizeKb: null, chars: SAMPLE.length, costIdr: null, status: `GAGAL: ${err instanceof Error ? err.message : err}` });
        console.log(`GAGAL azure ${voice}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // (c) laporan markdown — kolom penilaian SENGAJA kosong (untuk Brian)
  const lines: string[] = [
    "# LAPORAN TES TTS — BikinFYP.AI",
    "",
    `Tanggal: ${new Date().toISOString()}`,
    "",
    "Skrip contoh:",
    `> ${SAMPLE}`,
    "",
    "Kolom **penilaian natural** sengaja dikosongkan — kualitas audio hanya bisa dinilai",
    "dengan DIDENGAR manusia. Isi setelah mendengarkan file-nya.",
    "",
    "| Provider | Voice | File | Durasi (dtk) | Ukuran (KB) | Karakter | Biaya estimasi | Status | Penilaian natural (manual Brian) |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.provider} | ${r.voice} | ${r.file} | ${r.durationSec?.toFixed(1) ?? "-"} | ${r.sizeKb ?? "-"} | ${r.chars} | ${r.costIdr !== null ? `Rp${r.costIdr}` : "-"} | ${r.status} | |`
    ),
    "",
  ];
  fs.writeFileSync(path.join(OUT_DIR, "LAPORAN_TTS.md"), lines.join("\n"));
  console.log(`\nLaporan: ${path.join(OUT_DIR, "LAPORAN_TTS.md")}`);
  if (!hasGoogle && !hasAzure) {
    console.log("Tidak ada key TTS yang terisi — hanya audio pembanding yang diekstrak (bila ada).");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("test-tts gagal tak terduga:", err);
  process.exit(1);
});
