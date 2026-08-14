// LATAR PER TEMPLATE — supaya 33 template tidak terlihat seperti satu kampanye.
//
// TEMUAN REVIEW KREATIF 2026-08-14. Setelah 33 template dirender dan ditonton,
// cacat yang paling terasa bukan pada satu video mana pun: SEMUANYA MIRIP.
// Meja putih yang sama, dinding beige yang sama, lampu tumblr yang sama di
// belakang. Brand yang memesan lima template berbeda menerima lima video yang
// terlihat seperti satu shooting — dan justru itu yang mereka bayar untuk
// dihindari.
//
// Sebabnya bukan model yang malas: latar TIDAK PERNAH disebut di prompt, jadi
// model memakai kebiasaannya sendiri, dan kebiasaannya konsisten. Sekali lagi
// pola yang sama dengan lima cacat sebelumnya hari ini — detail yang tidak
// dinyatakan akan diisi model, dan isiannya selalu sama.
//
// ATURAN PENTING: latar ini HANYA dipasang pada template yang beat-nya BELUM
// menentukan tempat. Template dengan tabel peran sendiri (rute TVC, empat
// pattern-interrupt) sudah menyebut ruangannya, dan menambahkan latar kedua di
// sana akan mengulang persis kesalahan yang sudah lima kali diperbaiki:
// menyuruh model melakukan dua hal yang tidak bisa benar bersamaan.

export interface Latar {
  id: string;
  /** Kalimat yang disisipkan ke prompt. Ditulis sebagai TEMPAT, bukan gaya. */
  teks: string;
}

/** Enam latar rumah tangga Indonesia yang benar-benar berbeda satu sama lain —
 *  beda ruangan, beda permukaan, beda arah cahaya, beda warna dominan.
 *
 *  Dipilih yang MASUK AKAL untuk konten UGC penjual: semuanya tempat orang
 *  sungguhan memakai produk, bukan studio. Yang dihindari: latar dramatis atau
 *  mewah yang membuat videonya terasa iklan korporat, karena yang menang di
 *  FYP justru yang terlihat seperti rumah penonton sendiri. */
export const LATAR: Latar[] = [
  {
    id: "dapur-pagi",
    teks: "Setting: a small Indonesian kitchen in the morning, pale wooden counter, kettle and a few jars behind, bright daylight coming in from the side, warm neutral tones",
  },
  {
    id: "meja-rias",
    teks: "Setting: a bedroom vanity corner, soft pink and cream tones, a small mirror and a few skincare bottles beside, gentle diffused light from a window behind the camera",
  },
  {
    id: "kamar-mandi",
    teks: "Setting: a clean modern Indonesian bathroom, pale tile wall, a folded towel and a shelf edge visible, cool even light, fresh blue-grey tones",
  },
  {
    id: "ruang-tamu",
    teks: "Setting: an ordinary Indonesian living room, rattan and fabric textures, a plant and a wall photo softly out of focus behind, warm afternoon light from the left",
  },
  {
    id: "teras-sore",
    teks: "Setting: a home terrace late afternoon, potted plants and a low wall behind, golden low sunlight raking across, warm green and amber tones",
  },
  {
    id: "meja-kerja",
    teks: "Setting: a simple work desk at home, laptop edge and notebook visible, cool white daylight from a window, tidy neutral grey and white tones",
  },
];

/** Pilih latar untuk sebuah template, STABIL dan MENYEBAR.
 *
 *  Stabil: id template yang sama selalu menghasilkan latar yang sama, jadi
 *  bukti render tidak berubah-ubah tanpa sebab dan brand yang memesan ulang
 *  template yang sama menerima tampilan yang sama.
 *
 *  Menyebar: hash sederhana dari id, bukan urutan indeks. Urutan indeks
 *  membuat template bertetangga di galeri selalu mendapat latar berurutan,
 *  dan brand hampir selalu memilih template yang berdekatan di daftar. */
export function latarUntukTemplate(templateId: string): Latar {
  let h = 0;
  for (let i = 0; i < templateId.length; i++) h = (h * 31 + templateId.charCodeAt(i)) >>> 0;
  return LATAR[h % LATAR.length];
}
