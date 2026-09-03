/**
 * SATU susunan teks prompt untuk SEMUA mesin video.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA INI TIDAK BOLEH DITULIS DUA KALI
 * ────────────────────────────────────────────────────────────────────────────
 * Permintaan Brian, 2 Sep 2026: yang membedakan Standard, Premium, dan Ultra
 * HANYA modelnya. Promptnya wajib sama persis, karena kualitas naskah dan
 * prompt itulah yang sudah disetel ke standarnya — bukan sesuatu yang boleh
 * berubah diam-diam karena mesinnya berbeda.
 *
 * Sebelum ini teksnya disusun di dalam masing-masing provider. Dua salinan
 * dari kalimat yang harus identik akan hanyut — dan hanyutnya tidak terlihat
 * sebagai galat, melainkan sebagai video yang "entah kenapa" beda rasa.
 *
 * Sekarang keduanya memanggil fungsi ini. Ada tes yang membandingkan keluaran
 * kedua provider byte-per-byte; kalau ada yang menyusun teksnya sendiri lagi,
 * tesnya merah.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA BENTUK "Negative: <daftar cacat>" DIBUANG (3 Sep 2026)
 * ────────────────────────────────────────────────────────────────────────────
 * Bentuk lamanya:
 *
 *     "<prompt shot>. Negative: <negativePrompt>"
 *
 * Itu warisan dari zaman ada FIELD negatif tersendiri. Sekarang tidak ada.
 * Dokumentasi kie.ai untuk grok-imagine/image-to-video hanya punya satu field
 * `prompt`, dan menyebutnya "Text prompt describing the desired video motion".
 * BytePlus juga menerimanya sebagai satu item {type:"text"}. Tidak ada satu pun
 * pengurai yang mencari kata "Negative:".
 *
 * Lebih buruk lagi, frasaNegatifBersih() MEMBUANG kata "no" dari tiap butir —
 * benar dulu ketika field negatif berarti "hindari ini", dan menjadi bencana
 * begitu teksnya disambung ke prompt biasa. Yang benar-benar terkirim untuk job
 * 2f95311f (dibaca dari job_prompts di produksi) adalah:
 *
 *     "... extra hands, third hand, duplicated limbs, ... floating parts,
 *      second person, duplicate of the same person, twin, extra people in
 *      frame, disembodied hands"
 *
 * Tanpa satu pun penanda negasi. Kita MEMINTA tangan tambahan dan orang kedua,
 * lalu membayar tiga percobaan render untuk mendapatkannya, lalu gerbang QC
 * kita sendiri menolaknya. Vonis Brian atas hasilnya — "tangan yang tiba-tiba
 * banyak, ada sosok objek banyak, transparan" — adalah daftar itu, kata per
 * kata. Job itu berakhir REFUNDED setelah Rp20.250 keluar tanpa satu video pun.
 *
 * GANTINYA BUKAN "daftar yang sama tapi diberi 'no' lagi". Model video merender
 * apa yang disebut; menyebut cacat lalu menegasikannya tetap menaruh cacat itu
 * di dalam konteks. Repo ini sudah menuliskan pelajaran itu untuk penulis
 * naskah ("'no other residents' is how you get other residents", lib/script-
 * engine/llm.ts) — di sinilah aturan yang sama seharusnya berlaku sejak awal.
 *
 * Jadi yang dikirim sekarang adalah LAWAN POSITIF dari cacat yang paling mahal,
 * ditambah satu kalimat larangan pendek untuk hal yang memang wajib dilarang
 * demi kepatuhan (overlay teks, watermark, logo karangan) — tiga hal yang tidak
 * punya bentuk positif dan memang harus sampai ke model.
 *
 * spec.negativePrompt TIDAK dihapus: ia tetap catatan kepatuhan yang diperiksa
 * assertVisualSpec, dan tetap dipakai mesin yang benar-benar punya field
 * negatif kalau suatu saat kita memakainya lagi. Yang berubah hanya apa yang
 * boleh masuk ke field prompt.
 */

import type { ShotSpec, VisualSpec } from "./types";

/**
 * Lawan POSITIF dari cacat yang benar-benar menjatuhkan render kami.
 *
 * Tiap frasa diturunkan dari kegagalan yang terukur, bukan dari daftar keinginan:
 *
 *   "one person only"        <- QC-11 job 2f95311f: "2 orang jadi subjek utama,
 *                               maksimal 1" di detik 2.3, 5.4, dan 6.5.
 *   "two hands, five fingers"<- QC-02 job 2f95311f: anomali siluet, lembah-jari
 *                               berubah 3 antara frame 002 dan 003.
 *   "solid opaque"           <- vonis Brian: "transparan".
 *   "legible label"          <- QC-10 membaca merek dari label produk; label
 *                               yang berkedip membuatnya gagal.
 */
const MUTU_POSITIF =
  "Single continuous take of exactly one person, both hands with five fingers each, " +
  "natural undistorted face and anatomy, solid opaque objects that stay whole, " +
  "realistic skin texture, product packaging stable and undeformed with its printed label legible throughout";

/**
 * Larangan yang WAJIB tetap sampai ke model — kepatuhan, bukan mutu.
 *
 * Ketiganya tidak punya bentuk positif yang jujur ("bingkai tanpa watermark"
 * tetap sebuah ketiadaan), dan ketiganya adalah janji yang kami buat ke
 * pengguna: tidak ada overlay teks tambahan, tidak ada watermark, tidak ada
 * logo yang dikarang model. Ditulis sebagai satu kalimat perintah, bukan
 * potongan kata benda, supaya model instruction-following membacanya sebagai
 * larangan dan bukan sebagai daftar isi.
 *
 * Larangan tentang ORANG sengaja tidak ada di sini — itu justru yang merusak.
 */
const LARANGAN_KEPATUHAN =
  "Do not add any text overlay, caption bar, subtitle, watermark, or invented logo.";

/**
 * `spec` tetap di tanda tangan meski isinya tidak lagi disalin ke teks.
 *
 * Kepatuhan dijaga SATU gerbang, yaitu assertVisualSpec(), yang berjalan
 * sebelum provider mana pun dipanggil. Versi pertama perbaikan ini memasang
 * pemeriksaan kedua di sini dan langsung menjatuhkan lima tes yang sedang
 * menguji hal lain — dua salinan aturan yang sama adalah persis cacat yang
 * berulang kali dibayar repo ini, dan menambah satu lagi demi rasa aman bukan
 * penebusan yang sah.
 *
 * Parameternya dipertahankan karena mesin berikutnya mungkin punya field
 * negatif sungguhan; saat itu tiba, di sinilah ia dibaca.
 */
export function teksPromptShot(spec: VisualSpec, shot: ShotSpec): string {
  void spec;
  return `${shot.prompt}. ${MUTU_POSITIF}. ${LARANGAN_KEPATUHAN}`;
}
