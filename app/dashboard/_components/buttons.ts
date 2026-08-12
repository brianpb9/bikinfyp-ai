// Kelas tombol dashboard — SATU tempat, bukan disalin di tiap halaman.
//
// Sebelum ini ada LIMA varian tombol utama yang beredar, berbeda hanya di
// padding: px-6 py-3, px-5 py-2.5, px-4 py-2, px-3 py-2, px-7 py-3.5. Tidak
// satu pun perbedaan itu disengaja — semuanya hasil menyalin dari halaman
// sebelah lalu menyesuaikan sedikit. Akibatnya tombol "Lanjut" di satu layar
// tidak seukuran "Lanjut" di layar berikutnya, dan mata menangkapnya sebagai
// produk yang dirakit terburu-buru walau tidak bisa menyebut alasannya.
//
// Diekspor sebagai STRING, bukan komponen React: pemakaiannya menempel di
// <button>, <Link>, dan <a>, dan membungkus ketiganya jadi satu komponen akan
// menambah lapisan tanpa menyelesaikan masalah yang sebenarnya — yaitu
// nilainya yang berbeda-beda.
//
// Bentuknya mengikuti tombol Higgsfield yang ditunjuk Brian: isi penuh
// kontras tinggi, padding lega, teks tebal. Warnanya tetap amber kita.

const DASAR =
  "inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-40";

/** Aksi utama satu layar. Hanya boleh ada SATU per layar — kalau ada dua,
 *  salah satunya sebenarnya sekunder. */
export const BTN_PRIMARY = `${DASAR} bg-amber-500 px-6 py-3 text-sm text-zinc-950 hover:bg-amber-400`;

/** Aksi utama di dalam kartu atau baris daftar — tempat px-6 terasa terlalu
 *  besar dan merebut perhatian dari isi kartunya sendiri. */
export const BTN_PRIMARY_SM = `${DASAR} bg-amber-500 px-5 py-2.5 text-sm text-zinc-950 hover:bg-amber-400`;

/** Aksi sekunder: mundur, batal, "atur sendiri". Sengaja tidak berwarna —
 *  dua tombol berwarna di satu layar membuat keduanya tidak terlihat utama. */
export const BTN_GHOST = `${DASAR} border border-zinc-300 bg-white px-6 py-3 text-sm text-zinc-700 hover:bg-zinc-50`;

/** Aksi merusak (hapus, keluar). Merah hanya di teks dan garis, tidak di isi:
 *  isi merah penuh menarik jempol ke arah yang justru harus dipikir dulu. */
export const BTN_DANGER = `${DASAR} border border-red-200 bg-white px-5 py-2.5 text-sm text-red-600 hover:bg-red-50`;
