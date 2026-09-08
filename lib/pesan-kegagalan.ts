/**
 * Pesan kegagalan job yang MENYEBUT SEBABNYA.
 *
 * ---------------------------------------------------------------------------
 * KENAPA
 * ---------------------------------------------------------------------------
 * Sampai 8 Sep 2026 setiap job FAILED/REFUNDED menjawab dengan kalimat yang
 * sama: "Hasilnya belum bagus, jadi kredit kamu sudah kami balikin. Coba ganti
 * fotonya ya."
 *
 * Kalimat itu benar hanya untuk SATU sebab dari beberapa. Brian menerimanya
 * pada job b95da10d, yang gagal karena mesin video menolak gambar acuan —
 * fotonya tidak salah, dan tidak ada satu klip pun yang pernah dibuat. Ia
 * disuruh memperbaiki sesuatu yang tidak rusak.
 *
 * Menyuruh pengguna mengganti foto saat penyebabnya bug kita adalah cara
 * tercepat membuat orang berhenti percaya pada pesan galat — dan sesudah itu
 * mereka berhenti melaporkannya.
 *
 * Sebabnya sudah tersimpan: failJob() menulis `reason` ke audit_log. Modul ini
 * cuma menerjemahkannya, dan sengaja MURNI supaya bisa diuji tanpa database.
 */

export type SebabGagal =
  /** Mesin video menolak gambar acuan (moderasi). Bukan salah pengguna. */
  | "moderasi_acuan"
  /** Pemrosesan kita sendiri yang gagal (ffmpeg, storage, dsb). */
  | "teknis_kami"
  /** Mesin video/suara tidak menjawab atau menolak permintaannya. */
  | "penyedia"
  /** Hasilnya jadi, tapi tidak lolos pemeriksaan mutu. */
  | "mutu"
  /** Tidak diketahui — sebab tidak tercatat atau tidak dikenali. */
  | "tidak_diketahui";

/**
 * Klasifikasi dari teks `reason` yang ditulis worker.
 *
 * Urutannya penting dan tidak boleh diacak: pesan penolakan moderasi DATANG
 * DARI penyedia, jadi mencocokkan "penyedia" lebih dulu akan menelan seluruh
 * kasus moderasi dan pengguna kembali menerima pesan yang salah.
 */
export function sebabDariAlasan(alasan: string | null | undefined): SebabGagal {
  const t = (alasan ?? "").toLowerCase();
  if (!t) return "tidak_diketahui";

  // Moderasi lebih dulu — lihat catatan urutan di atas.
  if (/sensitive information|may contain|real person|moderation|content policy/.test(t)) return "moderasi_acuan";
  if (/ffmpeg|concat|do not match|storage|enospc|sharp/.test(t)) return "teknis_kami";
  if (/qc|quality|gagal pemeriksaan|checks? failed/.test(t)) return "mutu";
  if (/provider|byteplus|kie-grok|seedance|http \d{3}|timeout|gagal:/.test(t)) return "penyedia";
  return "tidak_diketahui";
}

/**
 * Kalimat untuk pengguna. Tiga hal yang dijaga setiap varian:
 *   1. menyebut apakah ini bisa ia perbaiki atau tidak,
 *   2. tidak menyuruh memperbaiki yang tidak rusak,
 *   3. menyatakan kreditnya kembali — itu yang paling ingin ia ketahui.
 */
export function pesanKegagalan(sebab: SebabGagal): string {
  switch (sebab) {
    case "moderasi_acuan":
      return "Mesin videonya menolak foto acuan karena filter otomatis mereka — ini bukan karena fotomu jelek. "
        + "Kredit kamu sudah kembali. Coba lagi, atau pakai foto produk tanpa orang di dalamnya.";
    case "teknis_kami":
      return "Ada gangguan teknis di sisi kami saat menyusun videonya. Kredit kamu sudah kembali, "
        + "dan ini bukan karena fotomu. Coba lagi sebentar lagi ya.";
    case "penyedia":
      return "Mesin videonya sedang bermasalah dan tidak menyelesaikan permintaan kita. Kredit kamu sudah kembali. "
        + "Coba lagi sebentar lagi ya.";
    case "mutu":
      return "Hasilnya belum memenuhi standar kami, jadi kredit kamu sudah kami balikin. "
        + "Coba ganti fotonya dengan yang lebih jelas ya.";
    case "tidak_diketahui":
      return "Videonya belum berhasil dibuat dan kredit kamu sudah kami balikin. Coba lagi ya.";
  }
}
