/**
 * DURASI VIDEO — satu sumber untuk daftar yang didukung dan yang jadi bawaan.
 *
 * Sebelum 26 Agu 2026 daftar [15, 30, 45] disalin di DELAPAN tempat: mesin
 * skrip, dua halaman UI, empat rute API, dan test. Menambah satu durasi berarti
 * menemukan kedelapan salinan itu — dan yang terlewat tidak gagal, ia hanya
 * MENOLAK durasi yang di layar terlihat sah. Karena itu daftarnya dipindahkan
 * ke sini sekalian, bukan ditambahi di tempat.
 *
 * Modul ini WAJIB bebas impor: dipakai komponen "use client" (lihat alasan
 * lengkapnya di lib/tokens.ts).
 */

/**
 * 8 DETIK JADI BAWAAN, dan alasannya komersial, bukan teknis.
 *
 * Kredit menyamarkan harga rupiah, tapi ia TIDAK menyamarkan jumlah video —
 * dan di situlah 8 detik mengubah nilai jualnya:
 *   Rp250.000 = 1 video (15 detik, kunci wajah)
 *   Rp250.000 = 6 video (8 detik, standar)
 * 8 detik juga format normal TikTok, dan hook yang bagus selesai di bawah itu.
 *
 * Kunci wajah dijual sebagai TAMBAHAN, bukan bawaan — ia menggandakan token,
 * jadi menjadikannya bawaan berarti membagi dua jumlah video setiap pembeli
 * tanpa mereka meminta. Lihat lib/harga-kredit.ts.
 */
export const DURASI_BAWAAN = 8;

/** Durasi yang boleh dipesan. Urut naik; 8 di depan karena ia bawaannya. */
export const DURASI_DIDUKUNG = [8, 15, 30, 45] as const;

export type DurasiDidukung = (typeof DURASI_DIDUKUNG)[number];

export function durasiDidukung(n: unknown): n is DurasiDidukung {
  return (DURASI_DIDUKUNG as readonly number[]).includes(Number(n));
}

/**
 * TVC TIDAK BOLEH 8 DETIK, dan ini batas teknis yang nyata.
 *
 * Perencana shot memberi TVC minimal 3 beat (modulRapi(durasi, 3)). Pada 8
 * detik tidak ada pembagian bulat: 8/3 = 2,67 detik per shot. Durasi shot
 * berpecahan dibulatkan NAIK oleh BytePlus, jadi video 8 detik diam-diam
 * keluar 9 detik — cacat yang sama yang sudah pernah membuat pesanan 45 detik
 * jadi 48. Ditolak di depan, bukan dibiarkan lolos lalu terlihat setelah
 * dibayar.
 */
export function durasiSahUntukFormat(format: string, durasi: number): boolean {
  if (!durasiDidukung(durasi)) return false;
  if (format === "tvc" && durasi < 15) return false;
  return true;
}

/** Durasi bawaan per format — TVC punya bawaannya sendiri karena 8 tidak sah. */
export function durasiBawaanUntukFormat(format: string): DurasiDidukung {
  return format === "tvc" ? 30 : DURASI_BAWAAN;
}
