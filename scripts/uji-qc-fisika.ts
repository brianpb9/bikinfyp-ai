// Apakah QC fisika produk benar-benar bisa menangkap sesuatu?
//
// Penjaga yang tidak pernah menangkap apa pun tidak bisa dibedakan dari penjaga
// yang tidak ada. QC-11 fisikaJanggal sudah dibangun dan MEMBLOKIR, tapi belum
// pernah sekali pun terbukti menyala. Skrip ini menjalankannya pada video yang
// Brian tolak sendiri — termasuk keluhannya "cairan ga keluar dari ujung botol".
//
// Memakai Gemini vision (murah), bukan BytePlus — tidak ada render baru.
import fs from "node:fs";
import path from "node:path";
import { qcVision } from "../lib/media/qc-vision";

async function main() {
  const akar = path.resolve(process.cwd(), "..");
  const bukti = JSON.parse(fs.readFileSync(path.join(akar, "test_output/bukti-render.json"), "utf8"));
  const vonis = JSON.parse(fs.readFileSync(path.join(akar, "test_output/persetujuan.json"), "utf8"));
  const batas = Number(process.env.UJI_BATAS ?? 6);
  const ditolak = Object.keys(vonis).filter((k) => vonis[k] === "tolak" && bukti[k] && fs.existsSync(bukti[k].berkas));

  let menyala = 0;
  for (const id of ditolak.slice(0, batas)) {
    const berkas = bukti[id].berkas;
    try {
      // maksOrang longgar: yang diuji di sini fisika produk, bukan jumlah orang.
      const h = await qcVision({ videoPath: berkas, maksOrang: 9 });
      const fisika = h.masalah.filter((m: string) => /fisika produk/i.test(m));
      const lain = h.peringatan;
      console.log(`\n${id}`);
      console.log(`  fisika  : ${fisika.length ? fisika.join(" | ") : "bersih"}`);
      if (lain.length) console.log(`  lainnya : ${lain.slice(0, 3).join(" | ")}`);
      if (fisika.length) menyala++;
    } catch (e) {
      console.log(`\n${id}\n  GAGAL: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  console.log(`\n=== ${menyala} dari ${Math.min(batas, ditolak.length)} video menyalakan QC fisika ===`);
}
main().catch((e) => { console.error(e); process.exit(1); });
