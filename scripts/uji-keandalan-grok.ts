/**
 * BERAPA SERING Grok Imagine lolos gerbang mutu kita? — diukur, bukan ditebak.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KEPUTUSAN YANG BERGANTUNG PADA ANGKA INI
 * ─────────────────────────────────────────────────────────────────────────────
 * Instruksi Brian 3 Sep 2026: "jika nanti grok imagine melalui kie.ai tetap
 * gagal dan tidak sesuai standard tershold, hapus saja package standard".
 *
 * Syaratnya "TETAP gagal" — dan dua sampel pertama justru berlawanan: job
 * produksi 000de02e gagal QC-03 dengan 128,8, sementara render uji 15 detik
 * berikutnya lolos dengan 19,4 (ultra: 19,3). Satu lolos, satu gagal.
 * Menghapus satu paket komersial atas dasar itu sama saja dengan menebak.
 *
 * Yang menentukan bukan lolos-atau-tidak, melainkan SEBERAPA SERING gagal,
 * karena itulah yang menentukan apakah paketnya masih untung:
 *
 *   Standard dijual Rp14.000, biaya render Rp6.750.
 *   Pada tingkat gagal p, biaya efektif per video JADI = 6.750 / (1 - p).
 *     p = 0%   -> Rp6.750   (margin sehat)
 *     p = 33%  -> Rp10.100  (margin tipis)
 *     p = 50%  -> Rp13.500  (praktis impas — paketnya tidak lagi masuk akal)
 *
 * Jadi ambang keputusannya jelas dan bisa dihitung, bukan selera.
 *
 * Tiap putaran memakai prompt dan gerbang yang SAMA dengan produksi.
 *
 *   RENDER_CONFIRM=YA npx tsx scripts/uji-keandalan-grok.ts <kunci-gambar> [n]
 */
import fs from "node:fs";
import path from "node:path";
import { generateVideoWithFailover } from "../lib/providers/registry";
import { qcProductSimilarity, qcHandMorphing } from "../lib/media/qc";
import { mediaStorage } from "../lib/storage";
import { MANDATORY_NEGATIVE_PROMPT } from "../lib/config/compliance";

if (process.env.RENDER_CONFIRM !== "YA") {
  console.error("Ditolak: ini render berbayar. Ulangi dengan RENDER_CONFIRM=YA.");
  process.exit(1);
}
const kunci = process.argv[2];
const putaran = Number(process.argv[3] ?? 5);
if (!kunci) throw new Error("Sebutkan kunci gambar produk.");

const PROMPT =
  "close-up of a young Indonesian woman's hands presenting the product over a clean home table, " +
  "phone camera look, natural daylight, gentle push in, the product label facing camera";

const OUT = "/tmp/uji-keandalan";
fs.mkdirSync(OUT, { recursive: true });
const ref = await mediaStorage().materialize(kunci);
if (!ref) throw new Error(`gambar referensi tidak ada: ${kunci}`);

const hasil: Record<string, unknown>[] = [];
for (let i = 1; i <= putaran; i++) {
  const dir = path.join(OUT, `r${i}`);
  fs.mkdirSync(dir, { recursive: true });
  const spec = {
    jobId: `keandalan-${i}`, width: 720, height: 1280,
    shots: [{ index: 0, durationSec: 15, prompt: PROMPT, imageRefPath: ref }],
    negativePrompt: MANDATORY_NEGATIVE_PROMPT, qualityTier: "standard", generateAudio: true,
  };
  try {
    const r = await generateVideoWithFailover(spec as never, dir);
    const f = r.assets[0].filePath;
    fs.mkdirSync(`${dir}/qc`, { recursive: true });
    const qc03 = await qcProductSimilarity([f], ref, `${dir}/qc`, "talking_head", false);
    const qc02 = await qcHandMorphing(f, `${dir}/qc2`);
    const lolos = qc03.status !== "fail" && qc02.status !== "fail";
    console.log(
      `r${i}: ${lolos ? "LOLOS" : "GAGAL"}  mesin=${r.providerName}  Rp${r.costIdr.toLocaleString("id-ID")}  ` +
        `QC-03=${qc03.status} (${(qc03.detail ?? "").split(" ")[0]})  QC-02=${qc02.status}`,
    );
    hasil.push({ putaran: i, lolos, mesin: r.providerName, biaya: r.costIdr, qc03: qc03.status, qc03_detail: qc03.detail, qc02: qc02.status });
  } catch (e) {
    console.log(`r${i}: ERROR ${(e as Error).message}`);
    hasil.push({ putaran: i, lolos: false, error: (e as Error).message });
  }
}

const lolos = hasil.filter((h) => h.lolos).length;
const gagal = hasil.length - lolos;
const p = gagal / hasil.length;
const biayaEfektif = p < 1 ? Math.round(6750 / (1 - p)) : null;
console.log(`\n=== ${lolos}/${hasil.length} LOLOS · tingkat gagal ${(p * 100).toFixed(0)}% ===`);
console.log(
  biayaEfektif === null
    ? "Semua gagal — biaya efektif tak terhingga."
    : `Biaya efektif per video LOLOS: Rp${biayaEfektif.toLocaleString("id-ID")} (harga jual Rp14.000)`,
);
console.log(JSON.stringify(hasil, null, 2));
