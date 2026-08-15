// UJI LABEL — apakah sebuah model video bisa merender teks kecil produk?
//
// Petunjuk Brian 2026-08-15: "teks kecil bisa dirender kalau pakai Seedance
// 2.5, ini bisa dipakai untuk zoom produk."
//
// Kalau benar, ini membuka fidelitas merek dari 4 ke jauh lebih tinggi —
// bukan cuma satu shot penutup dari foto asli, tapi label yang benar di SHOT
// MANA PUN yang mendekat ke produk. Itu perbedaan antara "brand menonton 25
// detik label karangan" dan "labelnya benar sepanjang video".
//
// Yang diuji SATU shot makro produk saja. Cukup untuk menjawab pertanyaannya,
// dan biayanya satu klip (~Rp3.000-8.000), bukan satu video.
//
// Jalankan:
//   RENDER_CONFIRM=YA BYTEPLUS_MODEL_HQ=<id-model-seedance-2.5> \
//     npx tsx scripts/uji-label-model.ts
//
// Modelnya diganti lewat BYTEPLUS_MODEL_HQ — env yang MEMANG sudah dibaca
// config untuk tier high_quality. Tidak ada jalur override baru di provider:
// menambah cabang khusus-uji ke jalur yang dipakai produksi adalah cara
// menambah bug ke tempat yang paling mahal.
//
// Lalu buka frame yang dicetak path-nya dan BACA labelnya sendiri. Jangan
// percaya QC untuk ini: QC-10 memeriksa nama merek besar, dan nama merek besar
// memang selalu benar. Yang rusak barisan kecil di bawahnya.

import fs from "node:fs";
import path from "node:path";
import { byteplusVideo } from "../lib/providers/stubs/byteplus";
import { runFfmpeg, probeDurationSec } from "../lib/media/ffmpeg";
import { IDENTITY_INSTRUCTION } from "../lib/media/shot-planner";

// Foto WAJIB foto produk ASLI dengan teks kecil yang benar-benar terbaca.
// Uji pertama memakai produk-polos.jpg — yang ternyata frame HASIL GENERATE
// dengan label sudah ngaco. Hasilnya tidak bisa membedakan "model tidak bisa
// merender teks kecil" dari "model setia menyalin sumber yang memang salah".
const FOTO = process.env.FOTO_UJI ?? path.resolve(process.cwd(), "..", "test_output", "wardah-asli.png");
const OUT = path.resolve(process.cwd(), "..", "test_output", "uji-label");

async function main() {
  if (process.env.RENDER_CONFIRM !== "YA") {
    console.error("Ditolak: ini render berbayar. Ulangi dengan RENDER_CONFIRM=YA.");
    process.exit(1);
  }
  const model = process.env.BYTEPLUS_MODEL_HQ;
  if (!model) {
    console.error("BYTEPLUS_MODEL_HQ wajib diisi dengan id model yang mau diuji.");
    console.error("Contoh: BYTEPLUS_MODEL_HQ=dreamina-seedance-2-5-xxxxx");
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  // Shot makro produk: mendekat pelan, label menghadap kamera, TANPA orang.
  // Sengaja tanpa orang supaya satu-satunya yang dinilai adalah teksnya.
  const prompt =
    "Slow macro push-in on the product standing alone on a clean surface, the label facing camera and " +
    "filling most of the frame, soft directional light, shallow but steady focus on the label itself. " +
    "No people, no hands, no body parts anywhere in the frame. " + IDENTITY_INSTRUCTION;

  const spec = {
    jobId: "uji-label", width: 720, height: 1280,
    shots: [{ index: 0, durationSec: 5, prompt, imageRefPath: FOTO }],
    // JANGAN menulis "no writing" di sini. Uji pertama memakai negative
    // "no text overlay, no writing added on top of the image" — itu secara
    // harfiah menyuruh model menekan tulisan, lalu hasilnya disalahkan karena
    // tulisannya rusak. Yang dilarang seharusnya HANYA overlay tambahan di
    // atas gambar, bukan tulisan yang memang tercetak di produknya.
    negativePrompt: "no added caption overlay, no watermark, no subtitle bar, no borders, no collage",
    qualityTier: "high_quality" as const, generateAudio: false,
    // TANPA ratio: Seedance 2.5 MENOLAK parameter ini untuk mode frame-pertama
    // ("the output ratio follows the first-frame image", HTTP 400). Perbedaan
    // API nyata dari 2.0 — dan kode produksi kita SELALU mengirim ratio, jadi
    // memindahkan produksi ke 2.5 akan menggagalkan setiap job i2v.
  };

  console.log(`Model diuji : ${model}`);
  const aset = await byteplusVideo.generate(spec as never, OUT);
  const f = aset[0].filePath;
  console.log(`Klip        : ${f}  (Rp${aset[0].costIdr.toLocaleString("id-ID")})`);

  // Frame di 80% durasi: push-in sudah paling dekat, label paling besar.
  const d = await probeDurationSec(f);
  const frame = path.join(OUT, `label-${model}.png`);
  await runFfmpeg(["-y", "-v", "error", "-ss", (d * 0.8).toFixed(2), "-i", f, "-frames:v", "1", frame]);
  console.log(`Frame label : ${frame}`);
  console.log("\nBUKA FRAME ITU DAN BACA LABELNYA SENDIRI.");
  console.log("Yang dinilai barisan KECIL di bawah nama merek — nama merek besar");
  console.log("selalu benar bahkan di model sekarang, jadi ia tidak membuktikan apa pun.");
}

main().catch((e) => { console.error(e); process.exit(1); });
