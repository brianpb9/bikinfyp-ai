// Nama jenis kampanye untuk kartu (permintaan Brian 2026-08-11: "baiknya ada
// tulisan ini campaign apa tvc / ugc affiliate dll").
//
// Yang tersimpan di jobs cuma `format`; "jenis" (affiliate/ads/tvc) hanya ada
// di UI wizard dan tidak pernah masuk database. Menurunkannya di sini jauh
// lebih murah daripada menambah kolom + migrasi untuk sesuatu yang sudah bisa
// disimpulkan tanpa kehilangan informasi.
export function campaignKindLabel(format: string | null | undefined): string {
  return format === "tvc" ? "AI TVC" : format === "ads" ? "UGC Ads" : "UGC Affiliate";
}

export function campaignFormatLabel(format: string | null | undefined): string | null {
  switch (format) {
    case "talking_head": return "Wajah AI";
    case "hands_only": return "Tangan + VO";
    case "vo_broll": return "Foto + VO";
    case "tvc": return "Sinematik";
    case "ads": return "Iklan";
    default: return null;
  }
}
