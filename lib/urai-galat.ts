/**
 * Uraikan pesan galat berlapis jadi bagian yang bisa dibaca.
 *
 * ---------------------------------------------------------------------------
 * MASALAHNYA
 * ---------------------------------------------------------------------------
 * Brian 9 Sep 2026: "saya lihat sekarang tercampur".
 *
 * Pesan yang sampai ke dasbor memang satu baris panjang berisi tiga lapis
 * pembungkus, dan yang penting justru ada di ujung:
 *
 *   Worker gagal setelah 3 percobaan: Semua provider video gagal:
 *   byteplus-ark-seedance: byteplus: HTTP 400: The request failed because the
 *   input image 'content[3]' may contain sensitive information.
 *
 * Dipotong 180 karakter seperti sebelumnya, kalimat yang menjelaskan sebabnya
 * terpotong tepat di tengah — "may contain sensiti". Jadi yang tersisa di layar
 * hanya pembungkus kita sendiri, dan sebab sebenarnya hilang.
 *
 * ---------------------------------------------------------------------------
 * YANG DIKERJAKAN
 * ---------------------------------------------------------------------------
 * Lapisan dipisah pada ": " yang menjadi batas pembungkus, lalu lapisan
 * TERDALAM diangkat ke depan — itulah yang menjawab "kenapa". Sisanya tetap
 * tersedia sebagai rantai, bukan dibuang: berapa kali dicoba ulang dan di
 * tahap mana ia gagal tetap keterangan yang dipakai saat menelusuri.
 */

/** Pembungkus yang kita tulis sendiri. Dikenali supaya bisa dipisah dari pesan
 *  provider, yang tidak boleh diutak-atik. */
const PEMBUNGKUS = [
  /^Worker gagal setelah \d+ percobaan$/i,
  /^Worker gagal \(stalled\/attempts habis\)$/i,
  /^Semua provider video gagal$/i,
  /^QC gagal setelah retry$/i,
  /^[a-z0-9-]+$/i, // nama provider polos: "byteplus-ark-seedance", "byteplus"
];

export interface GalatTerurai {
  /** Lapisan terdalam — kalimat yang benar-benar menjelaskan sebabnya. */
  inti: string;
  /** Pembungkus dari luar ke dalam, tanpa inti. */
  lapisan: string[];
  /** Kode HTTP bila pesannya menyebutkannya. */
  httpStatus: number | null;
}

export function uraikanGalat(pesan: string | null | undefined): GalatTerurai | null {
  const teks = (pesan ?? "").trim();
  if (!teks) return null;

  // Dipecah pada ": " tapi TIDAK di dalam pesan provider yang memuat titik dua
  // sebagai bagian kalimatnya. Batasnya: potongan yang cocok dengan pola
  // pembungkus di atas, atau "HTTP <kode>".
  const potong = teks.split(": ");
  const lapisan: string[] = [];
  let i = 0;
  while (i < potong.length - 1) {
    const bagian = potong[i]!.trim();
    const pembungkus = PEMBUNGKUS.some((r) => r.test(bagian));
    const http = /^HTTP \d{3}$/i.test(bagian);
    if (!pembungkus && !http) break;
    lapisan.push(bagian);
    i += 1;
  }

  const inti = potong.slice(i).join(": ").trim() || teks;
  const http = /HTTP (\d{3})/i.exec(teks);

  return {
    inti,
    lapisan,
    httpStatus: http ? Number(http[1]) : null,
  };
}

/**
 * Satu kalimat yang menyebut TINDAKANNYA, dari inti galat.
 *
 * Dipakai dasbor admin supaya baris yang gagal bisa dipilah tanpa membaca
 * seluruh pesannya. Sengaja memakai kata kerja: "ganti foto" dan "tunggu"
 * menuntut orang yang berbeda untuk bertindak.
 */
export function golonganGalat(inti: string): string {
  const t = inti.toLowerCase();
  if (/sensitive information|may contain|real person|moderation|content policy/.test(t)) return "moderasi foto";
  if (/invalidparameter|invalid.*param|bad request/.test(t)) return "parameter salah";
  if (/timeout|melebihi batas|melewati batas|etimedout|econnreset/.test(t)) return "kehabisan waktu";
  if (/rate|429|quota|too many/.test(t)) return "kena batas laju";
  if (/qc-\d+|qc gagal/.test(t)) return "gagal QC";
  if (/ffmpeg|concat|do not match/.test(t)) return "gagal rakit";
  if (/insufficient|kredit|jatah/.test(t)) return "kredit kurang";
  return "lainnya";
}
