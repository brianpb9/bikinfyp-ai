/**
 * Jadikan foto acuan TEGAK 9:16 sebelum dikirim ke mesin video.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA PERLU
 * ────────────────────────────────────────────────────────────────────────────
 * Job be16d8f3 mengirim `aspect_ratio: "9:16"` ke kie.ai dan menerima video
 * 960x960 PERSEGI. Sebabnya bukan bug kami: Grok Imagine mengikuti rasio gambar
 * acuannya, dan parameter rasio diabaikan — perilaku yang juga dicatat
 * LAYER2 §2.2 ("Rasio: tidak ada param — hanya seed tegak").
 *
 * Foto produk marketplace hampir selalu persegi. Jadi selama acuannya persegi,
 * videonya akan persegi, berapa kali pun kami menuliskan 9:16 di badan
 * permintaan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA ISIAN BURAM, BUKAN BILAH HITAM
 * ────────────────────────────────────────────────────────────────────────────
 * Menambal jadi 9:16 dengan bilah hitam atau putih memasukkan DUA GARIS LURUS
 * ke frame pertama — dan model video memperlakukan frame pertama sebagai
 * adegan, jadi bilah itu ikut dirender dan bertahan sepanjang video. Kami
 * pernah membayar cacat sejenis: foto referensi yang dibaca sebagai objek
 * adegan lalu ditempel jadi bidang depan raksasa.
 *
 * Isian buram dari fotonya sendiri tidak punya tepi tajam, jadi tidak ada yang
 * bisa dibaca model sebagai benda. Ini juga cara baku aplikasi video menambal
 * rasio, jadi hasilnya terlihat wajar.
 *
 * Produknya sendiri TIDAK dipotong: ia diciutkan utuh ke dalam bingkai tegak.
 * Memotong berarti membuang bagian produk yang mungkin justru labelnya.
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { perluDitegakkan } from "./foto-produk";

/** Tinggi acuan yang dihasilkan. 1280 = pasangan 720x1280 yang dipakai render. */
const TINGGI = 1280;
const LEBAR = 720;

/**
 * Kembalikan path foto acuan yang sudah 9:16.
 *
 * Kalau fotonya SUDAH mendekati 9:16, path aslinya dikembalikan apa adanya —
 * memproses ulang gambar yang sudah benar hanya menambah langkah yang bisa
 * gagal.
 *
 * Kegagalan TIDAK menjatuhkan render: kalau penegakan gagal, foto asli dipakai
 * dan videonya mungkin persegi. Video persegi jauh lebih baik daripada tidak
 * ada video, dan kegagalannya dicatat supaya tetap terlihat.
 */
export async function acuanTegak(berkas: string, dirKerja: string): Promise<string> {
  try {
    const meta = await sharp(berkas).metadata();
    const lebar = meta.width ?? 0;
    const tinggi = meta.height ?? 0;
    if (!lebar || !tinggi) return berkas;
    if (!perluDitegakkan(lebar, tinggi)) return berkas;

    fs.mkdirSync(dirKerja, { recursive: true });
    const keluar = path.join(dirKerja, `acuan-tegak-${path.basename(berkas).replace(/\.\w+$/, "")}.png`);

    // Latar: foto yang sama, dibesarkan menutup bingkai lalu diburamkan kuat.
    const latar = await sharp(berkas)
      .resize(LEBAR, TINGGI, { fit: "cover", position: "center" })
      .blur(40)
      .modulate({ brightness: 0.92 })
      .toBuffer();

    // Depan: produk UTUH, diciutkan sampai muat tanpa dipotong.
    const depan = await sharp(berkas)
      .resize(LEBAR, TINGGI, { fit: "inside", withoutEnlargement: false })
      .toBuffer();

    await sharp(latar).composite([{ input: depan, gravity: "center" }]).png().toFile(keluar);
    console.log(`[acuan] ${lebar}x${tinggi} -> ${LEBAR}x${TINGGI} tegak: ${keluar}`);
    return keluar;
  } catch (err) {
    console.error(`[acuan] gagal menegakkan ${berkas}, dipakai apa adanya:`, (err as Error).message);
    return berkas;
  }
}
