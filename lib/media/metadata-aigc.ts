// PENANDA AIGC HARUS SELAMAT DARI SETIAP RE-ENCODE.
//
// Compositor menulis tag racun_aigc / aigc_watermark / comment ke berkas
// (lihat compositor.ts, diverifikasi QC-08). Tapi setiap tahap SESUDAHNYA yang
// menggabung video — endcard, packshot penutup, overlay klaim — memanggil
// ffmpeg lagi, dan ffmpeg TIDAK membawa tag kustom menyeberang secara
// otomatis. Tanpa dua argumen di bawah, tahap terakhir yang menyentuh berkas
// diam-diam menghapus penandanya.
//
// Ditemukan 20 Agu dari QC-08 FAIL pada render video penuh pertama yang
// memakai packshot penutup: watermark_param=true tapi metadata_tag=false.
// Pemeriksaannya sudah benar sejak dulu; yang belum ada adalah tahap yang
// memenuhinya. Bug yang sama sudah lama ada di endcard — hanya tidak terlihat
// karena endcard cuma dipasang untuk job Enterprise yang punya brand kit.
//
// Kenapa ini penting di luar QC: Syarat & Ketentuan menjanjikan setiap video
// membawa penanda AI di dalam berkasnya. Menghapusnya diam-diam mengubah janji
// itu jadi pernyataan yang tidak benar.

/** Argumen ffmpeg yang membawa metadata input pertama ke keluaran. */
export const METADATA_IKUT = [
  "-map_metadata", "0",
  // Tanpa use_metadata_tags, muxer mp4 hanya menulis tag baku (title, comment)
  // dan membuang yang kustom — persis tempat racun_aigc hidup.
  "-movflags", "use_metadata_tags",
] as const;
