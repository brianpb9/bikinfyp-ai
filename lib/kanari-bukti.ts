/**
 * P0-B4 — KANARI BUKTI: melihat, tanpa menegakkan apa pun.
 *
 * Kenapa ada, dan kenapa SEBELUM penegakan admission dinyalakan.
 *
 * Worker sudah menolak render yang tidak punya referensi tersetujui. Yang TIDAK
 * ada sampai sekarang adalah cara menghitung seberapa sering itu terjadi dan
 * kenapa. Alasannya cuma tersimpan sebagai KALIMAT di dalam `Error.message`,
 * jadi satu-satunya cara mengetahuinya adalah mencocokkan teks — persis bentuk
 * "kategori diturunkan dari prosa" yang sudah dua kali jadi cacat di gelombang
 * ini. Akibatnya keputusan besar berikutnya (menggerbangi admission atau tidak)
 * harus diambil tanpa satu pun angka.
 *
 * Modul ini TIDAK menegakkan, TIDAK memblokir, TIDAK mengubah satu pun vonis.
 * Ia menambahkan dua hal:
 *
 *   1. KODE, bukan kalimat. `GagalTanpaReferensi` membawa kode alasan sebagai
 *      data, jadi tidak ada yang perlu membaca teks untuk tahu apa yang terjadi.
 *      Pesannya untuk manusia tetap sama persis.
 *   2. SATU BARIS TERSTRUKTUR per penilaian — lolos MAUPUN ditolak. Keduanya
 *      wajib, karena angka yang dibutuhkan adalah RASIO; mencatat kegagalan saja
 *      memberi pembilang tanpa penyebut, dan itu tidak bisa dipakai memutuskan
 *      apa pun.
 *
 * BATASAN YANG TIDAK BOLEH DISALAHPAHAMI: cacah di sini PROSES-LOKAL. Ia hidup
 * di memori proses yang menghitungnya, hilang saat restart, dan tidak terlihat
 * dari proses lain — cacah worker TIDAK muncul di `/api/health` milik web.
 * Permukaan agregasi yang sebenarnya adalah baris lognya. Cacah proses-lokal
 * hanya berguna di dalam proses yang sama, dan dokumen ini menyebutnya begitu
 * supaya tidak ada yang mengutipnya sebagai angka produksi.
 */
import { ALASAN_TOLAK, type AlasanTolak, type HasilResolusiReferensi, type RinciTolak } from "./product-truth";

/** Tag baris log. Stabil, dan sengaja tidak mengandung spasi supaya mudah difilter. */
export const TAG_KANARI = "[kanari-bukti]";

/** Kode kegagalan tingkat atas. Kode, bukan kalimat. */
export const KODE_KANARI = {
  TANPA_REFERENSI: "NO_APPROVED_REFERENCE",
} as const;

/**
 * Render ditolak karena tidak ada referensi tersetujui.
 *
 * Tetap `Error` dengan pesan yang SAMA PERSIS seperti sebelumnya — pemanggil
 * lama, pencatat kegagalan, dan pesan ke pengguna tidak berubah sedikit pun.
 * Yang bertambah hanya kode dan rincian sebagai DATA.
 */
export class GagalTanpaReferensi extends Error {
  readonly kode = KODE_KANARI.TANPA_REFERENSI;
  readonly rincian: { rel: string; alasan: AlasanTolak; rinci?: RinciTolak }[];

  constructor(pesan: string, hasil: HasilResolusiReferensi) {
    super(pesan);
    this.name = "GagalTanpaReferensi";
    this.rincian = hasil.ditolak.map((d) => ({
      rel: d.rel,
      alasan: d.alasan,
      ...(d.rinci ? { rinci: d.rinci } : {}),
    }));
  }
}

export interface RingkasanKanari {
  /** Berapa kali resolusi dinilai — penyebut rasio. */
  dinilai: number;
  /** Punya sekurang-kurangnya satu referensi tersetujui. */
  lolos: number;
  /** Nol referensi tersetujui: render ini akan ditolak. */
  ditolak: number;
  /** Cacah per alasan tingkat atas, dihitung PER FOTO. */
  perAlasan: Record<string, number>;
  /** Cacah per sub-kategori EVIDENCE_INVALID, dihitung PER FOTO. */
  perRinci: Record<string, number>;
  /** Produk yang ditolak DAN seluruh fotonya `belum_diperiksa`. */
  ditolakSemuaBelumDiperiksa: number;
}

function kosong(): RingkasanKanari {
  return { dinilai: 0, lolos: 0, ditolak: 0, perAlasan: {}, perRinci: {}, ditolakSemuaBelumDiperiksa: 0 };
}

let cacah = kosong();

/** Salinan cacah proses-lokal. Salinan, supaya pemanggil tidak bisa mengubahnya. */
export function ringkasanKanari(): RingkasanKanari {
  return { ...cacah, perAlasan: { ...cacah.perAlasan }, perRinci: { ...cacah.perRinci } };
}

export function resetKanariUntukTest(): void {
  cacah = kosong();
}

/**
 * Mencatat SATU penilaian referensi. Lolos maupun ditolak.
 *
 * TIDAK PERNAH MELEMPAR. Kanari yang bisa menjatuhkan render adalah kanari yang
 * lebih berbahaya daripada ketiadaan kanari: ia mengubah alat ukur jadi sumber
 * kegagalan baru, di jalur yang sudah dibayar pengguna.
 */
export function catatKanariReferensi(
  hasil: HasilResolusiReferensi,
  konteks: { jobId?: string; produkId?: string; runtime: string },
  tulis: (baris: string) => void = console.log
): void {
  try {
    const lolos = Boolean(hasil.utama);
    cacah.dinilai += 1;
    if (lolos) cacah.lolos += 1;
    else cacah.ditolak += 1;

    const perAlasan: Record<string, number> = {};
    const perRinci: Record<string, number> = {};
    for (const d of hasil.ditolak) {
      perAlasan[d.alasan] = (perAlasan[d.alasan] ?? 0) + 1;
      cacah.perAlasan[d.alasan] = (cacah.perAlasan[d.alasan] ?? 0) + 1;
      if (d.rinci) {
        perRinci[d.rinci] = (perRinci[d.rinci] ?? 0) + 1;
        cacah.perRinci[d.rinci] = (cacah.perRinci[d.rinci] ?? 0) + 1;
      }
    }

    // Keadaan yang MENENTUKAN keputusan T43, jadi ia dihitung sendiri: produk
    // yang ditolak dan SELURUH fotonya `belum_diperiksa`. Itu bukan foto yang
    // buruk — itu foto yang tidak pernah bisa diperiksa karena runtime-nya tidak
    // punya binernya. Menggabungkannya dengan penolakan biasa menyembunyikan
    // satu-satunya angka yang membedakan "produknya memang tidak layak" dari
    // "kita yang tidak bisa memeriksanya".
    const semuaBelumDiperiksa =
      !lolos &&
      hasil.ditolak.length > 0 &&
      hasil.ditolak.every((d) => d.alasan === ALASAN_TOLAK.BELUM_DIPERIKSA);
    if (semuaBelumDiperiksa) cacah.ditolakSemuaBelumDiperiksa += 1;

    tulis(
      `${TAG_KANARI} ${JSON.stringify({
        v: 1,
        runtime: konteks.runtime,
        jobId: konteks.jobId ?? null,
        produkId: konteks.produkId ?? null,
        lolos,
        foto: hasil.tersetujui.length + hasil.ditolak.length,
        tersetujui: hasil.tersetujui.length,
        perAlasan,
        perRinci,
        semuaBelumDiperiksa,
      })}`
    );
  } catch {
    // Sengaja bisu. Alat ukur yang berisik saat gagal mengukur akan menutupi
    // kegagalan yang sedang diukurnya.
  }
}
