/**
 * SATU JANJI WAKTU RENDER — dipakai landing, wizard, halaman hasil, dan FAQ.
 *
 * Board review 19 Agu (§3.2): landing menjanjikan "2–3 menit" sementara
 * dashboard berkata "3–8 menit, bisa 45 menit" — dua janji untuk satu mesin,
 * dan yang dilihat calon pengguna adalah yang paling optimis. Angka di sini
 * dari data, bukan aspirasi: canary 12 klip (19 Agu) mengukur SATU klip
 * 112–194 detik; satu video = 2–4 klip yang dirender berbarengan + QC +
 * penggabungan, dan job produksi nyata jatuh di kisaran 3–8 menit dengan ekor
 * antrean sampai 45 menit.
 *
 * Kalau angka ini mau berubah, ubah DI SINI dengan data baru — jangan pernah
 * menulis angka menit langsung di halaman.
 */
export const JANJI_WAKTU = {
  /** Kisaran normal satu video, ujung-ke-ujung. */
  kisaran: "3–8 menit",
  /** Ekor jujur saat antrean AI padat. */
  ekor: "45 menit",
  /** Versi label pendek untuk statistik/badge. */
  singkat: "±3–8 menit",
  /** Alur retail /bikin & /promo merender SATU klip (MAX_CLIPS promo = 1):
   * canary mengukur 112–194 dtk per klip + penggabungan. */
  klipTunggal: "2–5 menit",
  /** Estimasi sisa saat fase akhir alur satu-klip. */
  sisaKlip: "1–2 menit",
  /** NASKAH, bukan render — lapisan tunggu di /bikin/gaya.
   *
   *  Dua angka karena memang ada dua mesin. Diukur di audit produksi 9 Sep
   *  2026: standard 49 detik (1 percobaan), premium 147 detik (1 percobaan) /
   *  177 detik (3 percobaan). Selisihnya Idea Stage, yang hanya dijalankan
   *  premium ke atas.
   *
   *  Sampai hari itu satu-satunya janji adalah "20–40 detik" untuk semua
   *  orang — jadi penantian premium yang NORMAL terbaca sebagai kerusakan. */
  naskahCepat: "40–60 detik",
  naskahIde: "2–3 menit",
  /** BUKAN waktu render: jeda settlement pembayaran Duitku. Ditaruh di sini
   * hanya supaya SEMUA janji menit punya satu rumah yang dijaga tes. */
  tungguPembayaran: "1–2 menit",
} as const;
