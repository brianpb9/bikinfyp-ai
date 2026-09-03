/**
 * GERBANG VIRALITAS — skor FYP minimum sebelum naskah ditawarkan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PERMINTAAN BRIAN, 3 SEP 2026
 * ────────────────────────────────────────────────────────────────────────────
 *   "pastikan anda memiliki pengecekan terhadap setiap quality konten.
 *    pastikan nilai viralitasnya tinggi. apabila kurang lakukan regenerate
 *    ulang scriptnya sehingga memiliki nilai tinggi. lakukan sampai 3 kali
 *    baru tampilkan opsinya. minimum tresholdnya 60."
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA SKORNYA SUDAH ADA TAPI TIDAK MENJAGA APA PUN
 * ────────────────────────────────────────────────────────────────────────────
 * Skor FYP sudah dihitung sejak lama: /api/jobs menyimpannya sebagai snapshot
 * beku, dan layar S4 menampilkannya. Tapi ia tidak pernah MENOLAK apa pun —
 * naskah dengan skor 38 ditawarkan persis sama dengan naskah 97, dan satu-
 * satunya yang membedakan adalah angka kecil yang mungkin tidak dibaca.
 *
 * Diukur dari produksi sebelum gerbang ini: 21 snapshot, median 86, dan satu
 * pencilan di 38. Jadi ambang 60 bukan pagar yang menahan semua orang — ia
 * menahan yang memang pantas ditahan, dan 20 dari 21 lolos tanpa perubahan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA TIDAK MENOLAK KERAS SESUDAH TIGA KALI
 * ────────────────────────────────────────────────────────────────────────────
 * Brian meminta "lakukan sampai 3 kali baru tampilkan opsinya" — batasnya pada
 * JUMLAH PERCOBAAN, bukan pada hak pengguna untuk melihat hasil. Menolak keras
 * di percobaan ketiga akan meninggalkan pembeli tanpa apa-apa sesudah tiga kali
 * panggilan model berbayar, yaitu kerugian di kedua sisi. Yang terbaik dari
 * seluruh percobaan disajikan, dan skornya ikut supaya keputusannya sadar.
 *
 * Yang TIDAK dilonggarkan: gerbang validator. Naskah yang gagal aturan keras
 * tidak pernah masuk ke sini — modul ini hanya mengurutkan yang sudah sah.
 */

import { scoreScriptPlan, type FypQualityTier, type FypVideoFormat } from "../fyp-score";
import type { HookCode } from "../config/hooks";
import type { SegmentDraft } from "./templates";

/** Ambang minimum yang diminta Brian. Satu tempat, bukan angka yang berkeliaran. */
export const AMBANG_VIRAL = 60;

/**
 * Berapa kali naskah ditulis ulang demi skor. TIGA, sesuai permintaan.
 *
 * Tiap percobaan memanggil model berbayar beberapa kali, jadi angkanya bukan
 * selera: ia langsung mengalikan biaya per klik "buat skrip".
 */
export const MAKS_PERCOBAAN_VIRAL = 3;

export interface KonteksSkor {
  qualityTier: FypQualityTier;
  durationSec: number;
  format: FypVideoFormat;
  productName: string;
  priceIdr: number;
}

/** Varian seminimal yang dibutuhkan penilai — sengaja bukan tipe lengkapnya. */
export interface VarianTerskor {
  hook_family: HookCode;
  segments: SegmentDraft[];
}

/**
 * Skor satu varian, atau null kalau tidak bisa diskor.
 *
 * null BUKAN nol. Keluarga hook yang tidak dikenal membuat penilai melempar,
 * dan menganggapnya nol akan membuang naskah yang mungkin bagus hanya karena
 * pengukurnya tidak mengenalinya — persis kesalahan yang sudah dibayar di
 * detektor perangkat hook (POLA_PERANGKAT, positif palsu vs negatif palsu).
 */
export function skorVarian(v: VarianTerskor, ctx: KonteksSkor): number | null {
  try {
    return scoreScriptPlan({
      hookFamily: v.hook_family,
      segments: v.segments,
      qualityTier: ctx.qualityTier,
      durationSec: ctx.durationSec,
      format: ctx.format,
      productName: ctx.productName,
      priceIdr: ctx.priceIdr,
    }).score;
  } catch {
    return null;
  }
}

export interface VarianBerskor<T> {
  varian: T;
  skor: number | null;
}

/**
 * Urutkan varian dari skor tertinggi. Yang tidak terskor ditaruh di BELAKANG,
 * bukan dibuang: ia tetap naskah sah, hanya tidak terukur.
 */
export function urutkanBerdasarSkor<T>(daftar: VarianBerskor<T>[]): VarianBerskor<T>[] {
  return [...daftar].sort((a, b) => (b.skor ?? -1) - (a.skor ?? -1));
}

/** Apakah kumpulan ini sudah memenuhi ambang? Cukup SATU yang mencapainya. */
export function memenuhiAmbang<T>(
  daftar: VarianBerskor<T>[],
  ambang = AMBANG_VIRAL,
  layak: (v: T) => boolean = () => true,
): boolean {
  return daftar.some((d) => layak(d.varian) && (d.skor ?? -1) >= ambang);
}

export interface HasilGerbang<T> {
  /** Varian terbaik lintas SELURUH percobaan, terurut dari skor tertinggi. */
  terpilih: VarianBerskor<T>[];
  /** Berapa kali naskah benar-benar ditulis. 1 berarti langsung lolos. */
  percobaan: number;
  /** Skor tertinggi yang dicapai, atau null kalau tidak ada yang terskor. */
  skorTertinggi: number | null;
  /** True kalau ambang tercapai. False = disajikan apa adanya, di bawah ambang. */
  lolosAmbang: boolean;
}

/**
 * Tulis ulang naskah sampai ada yang mencapai ambang, maksimal tiga kali.
 *
 * `tulis` dipanggil ulang PERSIS seperti panggilan pertama — bukan "perbaiki
 * yang tadi". Yang dicari keberuntungan bentuk lain, dan penulis sudah punya
 * lingkar perbaikannya sendiri terhadap keluhan validator di dalam sana.
 *
 * Seluruh varian sah dari SEMUA percobaan dikumpulkan, lalu yang terbaik yang
 * disajikan. Membuang hasil percobaan pertama begitu percobaan kedua berjalan
 * berarti membayar dua kali lalu memakai satu.
 */
export async function lewatiGerbangViral<T extends VarianTerskor>(
  tulis: (percobaanKe: number) => Promise<T[]>,
  ctx: KonteksSkor,
  opsi: {
    ambang?: number;
    maks?: number;
    catat?: (pesan: string) => void;
    /**
     * Varian mana yang BOLEH memuaskan ambang.
     *
     * Wajib ada gunanya: tanpa ini, varian yang gagal gerbang validator ikut
     * dihitung "sudah mencapai 60" lalu dibuang oleh penyaring di hilir —
     * gerbang berhenti bekerja justru pada kasus yang paling perlu dijaga.
     */
    layak?: (v: T) => boolean;
    /**
     * Penilai yang dipakai. Bawaannya skorVarian() dengan konteks di atas.
     *
     * Sambungan ini ada supaya perilaku LINGKARNYA — berapa kali menulis
     * ulang, kapan berhenti, mana yang disajikan — bisa diuji tanpa
     * menjalankan model FYP, dan supaya pemanggil yang tahu formatnya lebih
     * pasti bisa menilai dengan format itu.
     */
    nilai?: (v: T) => number | null;
  } = {},
): Promise<HasilGerbang<T>> {
  const ambang = opsi.ambang ?? AMBANG_VIRAL;
  const maks = opsi.maks ?? MAKS_PERCOBAAN_VIRAL;
  const catat = opsi.catat ?? (() => {});
  const layak = opsi.layak ?? (() => true);
  const nilai = opsi.nilai ?? ((v: T) => skorVarian(v, ctx));
  const kumpulan: VarianBerskor<T>[] = [];
  let percobaan = 0;

  for (let i = 1; i <= maks; i++) {
    percobaan = i;
    const varian = await tulis(i);
    for (const v of varian) kumpulan.push({ varian: v, skor: nilai(v) });
    // BERHENTI kalau percobaan ini tidak menghasilkan satu pun varian layak.
    //
    // Kalau tidak ada naskah yang lolos validator, menulis ulang demi SKOR
    // sia-sia: yang menahannya bukan skor. Jalur itu sudah punya penanganannya
    // sendiri di hilir (dan cobaDenganNamaPendek sudah mencoba tangga nama),
    // jadi melanjutkan hanya melipatgandakan biaya model tanpa mengubah hasil.
    if (!varian.some(layak)) {
      catat(`percobaan ${i}/${maks} tidak menghasilkan naskah yang lolos validator — gerbang berhenti`);
      break;
    }
    const tertinggi = kumpulan.reduce<number | null>(
      (t, d) => (layak(d.varian) && d.skor !== null ? (t === null ? d.skor : Math.max(t, d.skor)) : t),
      null,
    );
    if (memenuhiAmbang(kumpulan, ambang, layak)) {
      catat(`skor viral ${tertinggi} >= ${ambang} pada percobaan ${i}/${maks}`);
      break;
    }
    catat(
      i < maks
        ? `skor viral tertinggi ${tertinggi ?? "(tak terukur)"} < ${ambang} — naskah ditulis ulang (${i}/${maks})`
        : `skor viral tertinggi ${tertinggi ?? "(tak terukur)"} < ${ambang} sesudah ${maks} percobaan — disajikan apa adanya`,
    );
  }

  const terpilih = urutkanBerdasarSkor(kumpulan);
  const layakTerurut = terpilih.filter((d) => layak(d.varian));
  return {
    terpilih,
    percobaan,
    skorTertinggi: layakTerurut.length ? layakTerurut[0].skor : null,
    lolosAmbang: memenuhiAmbang(kumpulan, ambang, layak),
  };
}
