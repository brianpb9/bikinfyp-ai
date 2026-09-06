/**
 * Prioritas antrean render: brand didahulukan atas retail.
 *
 * ---------------------------------------------------------------------------
 * KENAPA
 * ---------------------------------------------------------------------------
 * Permintaan Brian 6 Sep 2026. Alasannya komersial dan masuk akal: brand
 * membayar per token dengan nilai jauh lebih besar per pesanan, dan menunggu
 * di belakang antrean retail membuat produk yang dijual sebagai layanan
 * enterprise terasa seperti antre di loket yang sama.
 *
 * ---------------------------------------------------------------------------
 * KENAPA SEMUA JOB DIBERI ANGKA, TERMASUK RETAIL
 * ---------------------------------------------------------------------------
 * BullMQ menyimpan job berprioritas di himpunan yang BERBEDA dari job tanpa
 * prioritas, dan urutan antar-dua-himpunan itu bergantung versi. Memberi angka
 * hanya pada brand berarti menggantungkan janji "brand duluan" pada detail
 * internal pustaka yang bisa berubah saat upgrade — dan kalau berubah, tidak
 * ada yang gagal, tidak ada log; urutannya saja diam-diam terbalik.
 *
 * Dengan SEMUA job diberi angka, urutannya ditentukan angka itu sendiri.
 * BullMQ menjaga urutan masuk (FIFO) di antara job berprioritas sama, jadi
 * antar-sesama retail tidak ada yang berubah dari sebelumnya.
 *
 * ---------------------------------------------------------------------------
 * YANG TIDAK BERUBAH
 * ---------------------------------------------------------------------------
 * Ini murni URUTAN, bukan jatah. Job retail tidak dibatalkan, tidak ditunda
 * dengan batas waktu, dan tidak kehilangan percobaan ulang — ia hanya diambil
 * sesudah brand yang sedang menunggu. Dengan concurrency 1, artinya paling
 * lama satu render brand (±3–16 menit) di depannya.
 */
export const PRIORITAS = {
  /** Angka LEBIH KECIL = didahulukan (aturan BullMQ). */
  brand: 1,
  retail: 2,
} as const;

export type AsalJob = keyof typeof PRIORITAS;
