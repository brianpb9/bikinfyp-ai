// BUKTI GAYA REKAM — render sungguhan, bukan tes prompt.
//
// Tujuh gaya rekam ditambahkan 2026-08-12 dan NOL di antaranya pernah
// dirender. Prompt yang tersusun rapi bukan bukti bahwa videonya bagus, dan
// menawarkannya ke brand sebagai setara dengan Standar berarti menjual janji
// yang belum ditepati. Skrip ini yang membuktikannya.
//
// RANCANGAN PERCOBAAN: satu produk, satu skrip, satu avatar, satu durasi —
// yang berbeda HANYA gaya rekamnya. Kalau ada dua variabel yang berubah,
// hasilnya tidak bisa dipakai menyimpulkan apa pun tentang gaya rekam.
//
// BIAYA NYATA. Tiap klip menagih BytePlus. Jumlah render dibatasi keras di
// GAYA di bawah, dan skrip menolak jalan tanpa konfirmasi eksplisit —
// belanja tidak boleh terjadi karena seseorang salah menekan panah atas.
//
// Jalankan:
//   RENDER_CONFIRM=YA npx tsx scripts/render-gaya-rekam-proof.ts

import fs from "node:fs";
import path from "node:path";
import { planShots } from "../lib/media/shot-planner";
import { byteplusVideo } from "../lib/providers/stubs/byteplus";
import { getCreatorCategory } from "../lib/personas";
import { generateScripts, type ProductInput } from "../lib/script-engine";
import { getRecordingStyle } from "../lib/media/recording-styles";

// Tiga gaya, dipilih untuk menjawab tiga pertanyaan berbeda:
//   standar  — apakah yang lama masih baik? (pembanding dasar)
//   cermin   — gaya paling khas & paling menjanjikan untuk fashion
//   jalan    — gaya dengan gerakan kamera paling banyak, paling berisiko rusak
const GAYA = ["standar", "cermin", "jalan"] as const;

const FOTO = process.argv[2] ?? path.resolve(process.cwd(), "..", "test_output", "produk-uji.jpg");
const OUT = path.resolve(process.cwd(), "..", "test_output", "gaya_rekam_proof");

async function main() {
  if (process.env.RENDER_CONFIRM !== "YA") {
    console.error(
      `Ditolak: render ini MEMBELANJAKAN uang sungguhan di BytePlus ` +
      `(${GAYA.length} klip). Jalankan ulang dengan RENDER_CONFIRM=YA kalau memang disengaja.`
    );
    process.exit(1);
  }
  if (!fs.existsSync(FOTO)) throw new Error(`Foto produk tidak ada: ${FOTO}`);
  fs.mkdirSync(OUT, { recursive: true });

  const kategori = getCreatorCategory("hijaber")!;
  // Produk HARUS cocok dengan fotonya. Percobaan pertama memakai potret
  // avatar sebagai foto produk dan ketiganya ditolak BytePlus di submit:
  // "input image may contain real person" — penyedia menolak wajah asli
  // sebagai referensi. Tidak ada biaya keluar karena ditolak sebelum task
  // dibuat, tapi itu 3 percobaan yang terbuang.
  const produk: ProductInput = {
    id: "bukti-gaya", name: "Mosseru Bright Shower Gel", price_idr: 189000,
    category: "beauty", sourceUrl: null,
  };

  // SATU skrip dipakai ketiganya. Kalau tiap gaya memakai skrip sendiri,
  // perbedaan hasilnya bisa berasal dari kalimatnya, bukan dari kameranya.
  const [skrip] = await generateScripts({
    product: produk, register: "bunda", qualityTier: "high_quality",
    durationSec: 15, count: 1, hookLevel: "berani",
  });
  console.log(`Skrip: ${skrip.segments.map((s) => s.text).join(" / ")}\n`);

  const ringkasan: { gaya: string; berkas: string; detik: number; biayaIdr: number }[] = [];

  for (const id of GAYA) {
    const gaya = getRecordingStyle(id)!;
    console.log(`--- ${gaya.label} (${id}) ---`);
    const spec = planShots({
      jobId: `bukti-${id}`, durationSec: 15, segments: skrip.segments,
      category: kategori, productName: produk.name, productCategory: "beauty",
      imageRefPath: FOTO, qualityTier: "high_quality", format: "talking_head",
      hookLevel: "berani", recordStyle: id,
    });
    console.log(`  prompt shot 1: ${spec.shots[0].prompt.slice(0, 130)}...`);
    const perkiraan = byteplusVideo.estimateCost(spec);
    console.log(`  perkiraan biaya: Rp${perkiraan.toLocaleString("id-ID")}`);

    const dir = path.join(OUT, id);
    fs.mkdirSync(dir, { recursive: true });
    const mulai = Date.now();
    try {
      const aset = await byteplusVideo.generate(spec, dir);
      const detik = Math.round((Date.now() - mulai) / 1000);
      for (const a of aset) console.log(`  jadi: ${a.filePath} (${a.durationSec} dtk, Rp${a.costIdr.toLocaleString("id-ID")})`);
      ringkasan.push({ gaya: gaya.label, berkas: aset.map((a) => a.filePath).join(", "), detik, biayaIdr: perkiraan });
    } catch (err) {
      // Kegagalan satu gaya TIDAK boleh menghentikan yang lain — biaya yang
      // sudah keluar untuk gaya sebelumnya jadi sia-sia kalau begitu.
      console.error(`  GAGAL: ${err instanceof Error ? err.message : String(err)}`);
      ringkasan.push({ gaya: gaya.label, berkas: "(gagal)", detik: Math.round((Date.now() - mulai) / 1000), biayaIdr: perkiraan });
    }
  }

  console.log("\n=== RINGKASAN ===");
  for (const r of ringkasan) console.log(` ${r.gaya.padEnd(14)} ${String(r.detik).padStart(4)} dtk  Rp${r.biayaIdr.toLocaleString("id-ID")}  ${r.berkas}`);
  fs.writeFileSync(path.join(OUT, "ringkasan.json"), JSON.stringify(ringkasan, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
