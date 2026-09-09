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
 * MEMOTONG DULU, MENAMBAL BELAKANGAN (9 Sep 2026 — keputusan Brian: opsi C)
 * ────────────────────────────────────────────────────────────────────────────
 * Isian buram dipilih dulu supaya tidak ada TEPI TAJAM yang bisa dibaca model
 * sebagai benda — alasan yang masih benar. Yang tidak diantisipasi: model
 * meniru KOMPOSISI berpitanya juga.
 *
 * Terukur pada dua job produksi:
 *   2a040ce1  potongan produk 646x488 mendatar -> 57% frame jadi pita blur,
 *             dan pita itu muncul di SETIAP frame video hasilnya
 *   9789aa55  foto tegak -> pita kiri-kanan, dan frame pertama video menjadi
 *             foto katalog yang lalu dipotong keras ke adegan di detik 1
 *
 * Akibatnya berlapis: produk mengecil (label sulit dibaca, QC-10 membaca
 * "azza" bukan "fazza"), pita menggandakan konten kulit sehingga QC-02 salah
 * menuduh, dan pembukaan videonya menyentak.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA HANYA MEMOTONG TEGAK, TIDAK PERNAH MENDATAR
 * ────────────────────────────────────────────────────────────────────────────
 * Foto yang LEBIH TEGAK dari 9:16 bisa dipotong atas-bawah: lebar produknya
 * utuh, dan label ada di lebarnya. Itu aman, dan itu bentuk foto yang paling
 * sering dikirim penjual (foto ponsel).
 *
 * Foto yang LEBIH MENDATAR dari 9:16 hanya bisa dipadatkan dengan membuang
 * SISI — dan sisi adalah tempat label berada. Membuang label untuk menghindari
 * pita berarti menukar cacat yang terlihat dengan cacat yang membatalkan
 * seluruh gunanya foto acuan. Untuk bentuk itu, pita buram tetap dipakai dan
 * itu disengaja.
 *
 * Jalur terbaik tetap TIDAK MELEWATI berkas ini sama sekali: kartu storyboard
 * digambar Seedream langsung 9:16 sebagai adegan. Lihat framePertamaDariStoryboard().
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

    const RASIO_TARGET = LEBAR / TINGGI;
    const rasio = lebar / tinggi;

    // LEBIH TEGAK DARI 9:16 -> dipotong atas-bawah. Lebar produk utuh, jadi
    // labelnya utuh; yang dibuang cuma langit-langit dan lantai. Tidak ada
    // pita sama sekali, dan frame pertamanya penuh.
    if (rasio <= RASIO_TARGET) {
      await sharp(berkas)
        // "attention" memilih wilayah paling berisi, bukan titik tengah buta:
        // produk yang duduk di sepertiga bawah tidak ikut terpotong.
        .resize(LEBAR, TINGGI, { fit: "cover", position: "attention" })
        .png().toFile(keluar);
      console.log(`[acuan] ${lebar}x${tinggi} -> ${LEBAR}x${TINGGI} DIPOTONG tegak (tanpa pita): ${keluar}`);
      return keluar;
    }

    // LEBIH MENDATAR DARI 9:16 -> memadatkan berarti membuang SISI, dan sisi
    // adalah tempat label. Di sini pita buram tetap dipakai, dan itu disengaja.
    const latar = await sharp(berkas)
      .resize(LEBAR, TINGGI, { fit: "cover", position: "center" })
      .blur(40)
      .modulate({ brightness: 0.92 })
      .toBuffer();
    const depan = await sharp(berkas)
      .resize(LEBAR, TINGGI, { fit: "inside", withoutEnlargement: false })
      .toBuffer();
    await sharp(latar).composite([{ input: depan, gravity: "center" }]).png().toFile(keluar);
    console.log(`[acuan] ${lebar}x${tinggi} -> ${LEBAR}x${TINGGI} ditambal pita (foto mendatar, label di sisi): ${keluar}`);
    return keluar;
  } catch (err) {
    console.error(`[acuan] gagal menegakkan ${berkas}, dipakai apa adanya:`, (err as Error).message);
    return berkas;
  }
}
