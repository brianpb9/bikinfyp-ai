/**
 * QC-03 pada klip uji — identitas produk konsisten atau tidak.
 *
 * Dipakai pemeriksa produksi yang SAMA dengan yang menolak job standard
 * 000de02e (antar_shot_max=128.8, ambang 60). Menilai dengan mata sendiri lalu
 * menyebutnya bagus adalah kebiasaan yang membuat mutu buruk bertahan.
 */
import fs from "node:fs";
import { qcProductSimilarity } from "../lib/media/qc";
import { mediaStorage } from "../lib/storage";

const kunci = process.argv[2];
const berkas = process.argv.slice(3);
if (!kunci || !berkas.length) throw new Error("Pakai: qc03-identitas.ts <kunci-gambar> <video...>");

const ref = await mediaStorage().materialize(kunci);
if (!ref) throw new Error(`gambar referensi tidak ada: ${kunci}`);

for (const f of berkas) {
  const nama = f.split("/").slice(-2)[0];
  try {
    fs.mkdirSync(`/tmp/qc03-${nama}`, { recursive: true });
    const c = await qcProductSimilarity([f], ref, `/tmp/qc03-${nama}`, "talking_head", false);
    console.log(`${nama.padEnd(10)} ${c.status.toUpperCase().padEnd(5)} ${c.detail ?? ""}`);
  } catch (e) {
    console.log(`${nama.padEnd(10)} ERROR ${(e as Error).message}`);
  }
}
