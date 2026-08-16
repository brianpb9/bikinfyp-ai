/**
 * Kamus salah ucap TTS bahasa Indonesia.
 *
 * Beberapa kata Indonesia dibacakan salah oleh TTS walau ejaannya benar —
 * "lecet" keluar sebagai "leles", "tumit" jadi "tumut". Cacat ini tidak bisa
 * diperbaiki dengan mengulang generate: tiga percobaan pada kata yang sama
 * terbukti gagal lagi, karena penyebabnya bentuk katanya, bukan lotere.
 * Satu-satunya perbaikan yang bekerja adalah MENGGANTI KATANYA sejak naskah
 * ditulis.
 *
 * PALING BERPENGARUH DI PRESENTER-LIPSYNC (super_hq + talking_head), satu-
 * satunya jalur yang mempertahankan audio bawaan model alih-alih menimpanya
 * dengan Gemini TTS — dan kebetulan produk termahal kita.
 *
 * KENAPA INI TABEL, BUKAN DETEKTOR POLA.
 * Menggoda sekali menulis heuristik "suku kata tertutup = rawan", tetapi itu
 * akan menuduh puluhan kata yang terbukti aman ("masuk", "banget", "cukup",
 * semuanya bersuku kata tertutup dan semuanya lolos). Sumbernya sendiri
 * mencatat temuannya didapat satu per satu dengan telinga manusia dan meminta
 * baris baru ditambahkan setiap kali ditemukan. Jadi yang jujur adalah tabel
 * yang tumbuh, bukan tebakan yang terdengar pintar.
 *
 * Kolom `sebab` bukan hiasan: itu yang membuat tabel ini bisa dipakai menebak
 * kata rawan berikutnya, bukan cuma mengingat yang sudah telanjur terjadi.
 */

export interface SalahUcap {
  /** Kata seperti ditulis di naskah. */
  kata: string;
  /** Bunyi yang benar-benar keluar. */
  terdengar: string;
  /** Pengganti yang sudah lolos uji dengar. */
  ganti: string;
  /** Bentuk kata yang menyebabkannya. */
  sebab: string;
}

export const KAMUS_SALAH_UCAP: SalahUcap[] = [
  { kata: "lecet", terdengar: "leles", ganti: "luka", sebab: "/c/ di tengah kata luruh pada suku kata tertutup" },
  { kata: "tumit", terdengar: "tumut", ganti: "kaki", sebab: "suku kata tertutup -mit, vokal /i/ berubah jadi /u/" },
  { kata: "busanya", terdengar: "busunya", ganti: "lembut banget", sebab: "harmoni vokal — /a/ tertarik mengikuti /u/ di suku kata sebelumnya" },
];

/**
 * Konsonan /d/ yang tergerus akhiran "-nya" tepat di depannya: "detailnya di
 * bawah" keluar sebagai "detailnya ki bawah". Perbaikannya bukan mengganti
 * kata, melainkan menyisipkan kata penyangga supaya konsonannya punya awalan
 * bersih — "detailnya ADA di bawah".
 *
 * Sengaja TIDAK memasukkan "ke". Pada satu-satunya kasus yang terukur, /k/
 * adalah bunyi HASIL kerusakan ("di" -> "ki"), bukan bunyi yang jadi korban.
 * Menambahkannya berarti mengarang perluasan yang tidak pernah diamati.
 */
const TABRAKAN_NYA = /\b(\w+nya)\s+(di|dari|dengan|dan)\b/gi;

/**
 * Kata yang sudah lolos uji dengar dan aman dipakai ulang. Semua suku katanya
 * terbuka, atau vokalnya berulang/berjauhan sehingga tidak saling menarik.
 */
export const KATA_AMAN = [
  "ini", "aku", "pakai", "coba", "suka", "kaki", "luka", "tali", "badan", "gerak",
  "enak", "cukup", "lembut", "ringan", "banget", "masuk", "bawah", "detailnya",
  "ada", "ya", "pagi", "tebal", "manis", "kecil", "tunggu", "olahraga",
] as const;

export interface TemuanUcap {
  kata: string;
  saran: string;
  sebab: string;
  /**
   * "teramati" = kegagalannya benar-benar pernah didengar dan dicatat.
   * "disimpulkan" = bentuk katanya sama persis dengan kasus teramati, tetapi
   * kegagalannya sendiri belum pernah diamati.
   *
   * Pemisahan ini bukan formalitas. Gerbang CI hanya boleh berdiri di atas
   * yang teramati; menolak naskah berdasarkan inferensi berarti mengulang
   * cacat yang sedang diperbaiki — memakai alat ukur yang percaya diri tanpa
   * bukti.
   */
  keyakinan: "teramati" | "disimpulkan";
}

/** Cari kata yang terbukti salah ucap di dalam sebuah naskah. */
export function temuanSalahUcap(teks: string): TemuanUcap[] {
  const temuan: TemuanUcap[] = [];

  for (const entri of KAMUS_SALAH_UCAP) {
    // Batas kata di kedua sisi supaya "lecet" tidak ikut menandai kata lain
    // yang kebetulan memuatnya sebagai potongan.
    if (new RegExp(`\\b${entri.kata}\\b`, "i").test(teks)) {
      temuan.push({
        kata: entri.kata,
        saran: `ganti dengan "${entri.ganti}" — terdengar sebagai "${entri.terdengar}"`,
        sebab: entri.sebab,
        keyakinan: "teramati",
      });
    }
  }

  for (const cocok of teks.matchAll(TABRAKAN_NYA)) {
    // Kata penyangga "ada" hanya gramatikal di depan "di". Untuk "dari",
    // "dengan", dan "dan" tidak ada penyangga tunggal yang selalu benar, jadi
    // yang disarankan adalah menyusun ulang — saran yang salah kaidah lebih
    // buruk daripada tidak menyarankan apa pun.
    const saran =
      cocok[2].toLowerCase() === "di"
        ? `sisipkan kata penyangga: "${cocok[1]} ada ${cocok[2]}"`
        : `susun ulang supaya "${cocok[2]}" tidak langsung mengikuti "${cocok[1]}"`;
    temuan.push({
      kata: `${cocok[1]} ${cocok[2]}`,
      saran,
      // Hanya "-nya di" yang benar-benar pernah terdengar rusak. "dari",
      // "dengan", dan "dan" berbagi lingkungan fonetik yang sama persis,
      // tetapi kegagalannya belum pernah diamati — jadi dilaporkan, bukan
      // digerbangkan.
      sebab: `konsonan /d/ pada "${cocok[2]}" tergerus akhiran "-nya" di depannya`,
      keyakinan: cocok[2].toLowerCase() === "di" ? "teramati" : "disimpulkan",
    });
  }

  return temuan;
}
