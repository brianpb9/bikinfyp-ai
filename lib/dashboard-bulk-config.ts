// MVP bulk-generate (F-ENT-01): satu default tetap untuk semua item — tidak
// ada toggle per-produk (format/tier/durasi) di M3, sesuai batas MVP yang
// disetujui ("bangun mvp dulu"). Tangan + VO dipilih karena tidak kena
// pembatasan foto-berwajah yang berlaku untuk Wajah AI, dan tersedia untuk
// semua durasi (Wajah AI dibatasi 15 dtk saja).
export const BULK_FORMAT = "hands_only";
export const BULK_TIER = "high_quality" as const;
export const BULK_DURATION_S = 15;
