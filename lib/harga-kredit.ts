/**
 * HARGA, COGS, DAN KREDIT — satu sumber, dan sumbernya TAGIHAN.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TARIF INI TERVERIFIKASI. Ia bukan brosur, bukan turunan asumsi.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Sampai 26 Agu 2026 seluruh harga kita berdiri di atas angka yang tidak
 * pernah diperiksa ke luar dirinya sendiri: BRD menetapkan COGS Rp8.802, kode
 * membaliknya jadi tarif/detik, laporan biaya menampilkan Rp8.802 lagi, lalu
 * terlihat "cocok". Melingkar penuh. Sekarang penyebutnya nyata:
 *
 *   TAGIHAN BytePlus Agustus 2026        $1.300        (dari Brian)
 *   TOKEN akun bulan itu                 295.026.776   (arkcli usage stats
 *                                                       --start 2026-08-01
 *                                                       --end 2026-08-26)
 *   TARIF = 1.300 / 295,026776  =        $4,41 per 1M token
 *
 * Rincian 704 task bulan itu (video = 94,7% token akun):
 *   2.0 penuh   429 task   186.755.876 token
 *   2.0-mini    205 task    62.604.900
 *   2.5          49 task    25.155.450
 *   1.5 pro      21 task     4.791.150
 *
 * KETIGA DUGAAN SEBELUMNYA MELESET, dan arahnya berlawanan:
 *   config.ts tersirat   $1,66/1M   KERENDAHAN 2,7x
 *   NYATA                $4,41/1M   <-- ini yang dipakai
 *   publik + video input $6,40/1M   ketinggian 1,5x
 *   publik tanpa input   $10,70/1M  ketinggian 2,4x
 * Kita memang dapat diskon dari brosur — tapi tidak sebesar klaim config.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * BATAS YANG TIDAK BOLEH DIHAPUS SAAT MENGUTIP ANGKA INI
 * ────────────────────────────────────────────────────────────────────────────
 * $4,41 adalah tarif CAMPURAN SELURUH AKUN: video 94,7% token, sisanya gambar
 * dan LLM. Tarif Seedance MURNI bisa sedikit berbeda. Untuk vonis "rugi atau
 * tidak" selisih sekecil itu tidak mengubah apa pun — tier Rp12.000 rugi pada
 * rentang mana pun yang masuk akal. Tapi angka ini TIDAK boleh disebut
 * "tarif Seedance". Ia tarif akun.
 *
 * Kalau split-bill per model diaktifkan di konsol BytePlus, angka per model
 * bisa dipisahkan dan konstanta di bawah bisa dipertajam.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MODUL INI WAJIB BEBAS IMPOR — alasan yang sama dengan lib/tokens.ts.
 * ────────────────────────────────────────────────────────────────────────────
 * Komponen "use client" memakainya untuk menampilkan harga. Begitu file ini
 * mengimpor lib/config.ts, webpack ikut menyeret node:fs ke bundle klien dan
 * build gagal — ketahuan saat build, bukan saat typecheck. Karena itu kurs
 * ditulis ulang di sini sebagai konstanta, dan tests/harga-kredit.test.ts
 * MENJAGA agar ia tidak pernah menyimpang dari config.usdIdr.
 */

/** Sumber tarif. Ditulis di setiap angka supaya tidak ada yang dikutip tanpa asalnya. */
export type AsalTarif = "tagihan-agustus-2026" | "publik" | "turunan-cogs";

/** $ per 1 juta token — TAGIHAN Agustus 2026 dibagi token akun bulan itu. */
export const TARIF_USD_PER_1M_TOKEN = 4.41;

/** Bayangan config.usdIdr. Dijaga sinkron oleh test, bukan oleh kedisiplinan. */
export const KURS_USD_IDR = 16_300;

/**
 * Token per detik NYATA di 720p, diukur dari 704 task (bukan ditaksir).
 *
 * Dua angka, bukan satu, DAN INI INTI TEMUANNYA: biaya ditentukan MODE, bukan
 * model. Render 15 detik menghabiskan 324.900 token tanpa referensi dan
 * 648.900 token dengan reference_video — di tier mana pun, termasuk model
 * termurah. Karena mengunci wajah MENUNTUT reference_video, setiap video
 * berwajah konsisten otomatis dua kali lipat biayanya.
 *
 * 480p dan 1080p sengaja tidak ada: belum diukur per-mode di akun ini, dan
 * menebaknya berarti menaruh angka karangan di jalur yang memutuskan uang.
 */
export const TOKEN_PER_DETIK_720P = {
  /** Tanpa reference_video. */
  standar: 21_660,
  /** Dengan reference_video — wajah dikunci. */
  kunciWajah: 43_260,
} as const;

export type ModeRender = keyof typeof TOKEN_PER_DETIK_720P;

/** COGS rupiah untuk sejumlah token. Dari token, BUKAN dari detik — tagihan
 *  didenominasi token, dan tarif/detik buta terhadap penggandaan mode. */
export function cogsIdrDariToken(totalToken: number): number {
  return Math.round((totalToken / 1_000_000) * TARIF_USD_PER_1M_TOKEN * KURS_USD_IDR);
}

/** COGS rupiah satu video 720p. */
export function cogsIdr(mode: ModeRender, durationSec: number): number {
  return cogsIdrDariToken(TOKEN_PER_DETIK_720P[mode] * durationSec);
}

// ─────────────────────────────────────────────────────────────────────────────
// KREDIT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1 kredit = Rp250. Rp250.000 = 1.000 kredit.
 *
 * Kredit dipakai supaya harga jual tidak lagi terikat rupiah per video, dan
 * supaya kenaikan COGS bisa diserap dengan mengubah SATU angka biaya render
 * alih-alih seluruh daftar harga.
 */
export const IDR_PER_KREDIT = 250;

/**
 * Margin kotor yang dituju pada harga kredit dasar.
 *
 * 65% SEJAK 26 Agu 2026 (dari 50%). Angka ini punya alasan, dan alasannya
 * ditulis di sini supaya tidak digeser tanpa sadar — menaikkannya terlihat
 * gratis dari sisi kita, padahal yang membayar adalah jumlah video yang
 * diterima pelanggan.
 *
 * Yang didapat Starter (1.000 kredit) untuk video standar 8 detik:
 *
 *   margin   harga    video    catatan
 *    50%     100 kr     10
 *    65%     143 kr      6     <-- di sini
 *    70%     167 kr      5     +5 poin margin, pelanggan kehilangan 1 dari 6 (-17%)
 *    75%     200 kr      5     jumlah video TIDAK berubah — kenaikan murni
 *                              rugi di persepsi, pelanggan tidak dapat apa pun
 *
 * Melewati 70% berarti mengambil dari pelanggan tanpa ada yang kembali; 75%
 * bahkan tidak dirasakan sebagai apa pun selain harga naik.
 *
 * 65% JUGA BANTALAN TERHADAP KENAIKAN TARIF. Kalau BytePlus naik 20%:
 *   ditetapkan 65%  ->  margin jatuh ke 58%
 *   ditetapkan 50%  ->  margin jatuh ke 40%
 * Tarif kita baru diketahui dari SATU tagihan (Agustus 2026). Bantalan itu
 * bukan kemewahan.
 *
 * Mengubah angka ini menggagalkan tests/harga-kredit.test.ts, yang memeriksa
 * ulang tabel di atas — bukan sekadar mencocokkan konstanta.
 */
export const MARGIN_TARGET = 0.65;

/**
 * Biaya render dalam kredit.
 *
 * ceil, bukan round: pembulatan ke bawah menjual di bawah COGS pada kasus batas,
 * dan itu persis kesalahan yang baru saja menghabiskan biaya sebulan.
 */
export function biayaKredit(cogs: number): number {
  return Math.ceil(cogs / (IDR_PER_KREDIT * (1 - MARGIN_TARGET)));
}

export type TarifRender = {
  mode: ModeRender;
  durationSec: number;
  label: string;
  cogsIdr: number;
  kredit: number;
};

/** Daftar harga render yang benar-benar dijual. */
export const TARIF_RENDER: readonly TarifRender[] = ([
  { mode: "standar", durationSec: 8, label: "Standar 8 detik" },
  { mode: "standar", durationSec: 15, label: "Standar 15 detik" },
  { mode: "kunciWajah", durationSec: 8, label: "Kunci wajah 8 detik" },
  { mode: "kunciWajah", durationSec: 15, label: "Kunci wajah 15 detik" },
] as ReadonlyArray<{ mode: ModeRender; durationSec: number; label: string }>).map((t) => {
  const cogs = cogsIdr(t.mode, t.durationSec);
  return { ...t, cogsIdr: cogs, kredit: biayaKredit(cogs) };
});

// ─────────────────────────────────────────────────────────────────────────────
// PAKET LANGGANAN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DISKON VOLUME DIBUAT DARI KREDIT BONUS, BUKAN DARI HARGA KREDIT YANG TURUN.
 *
 * Ini keputusan struktur, bukan pemasaran. Kalau harga per kredit turun di
 * paket besar, biaya render harus dihitung ulang PER PAKET — dan begitu itu
 * terjadi, margin bocor di paket besar tanpa ada satu tempat pun yang bisa
 * diperiksa. Dengan bonus, biaya render tetap SATU angka untuk semua orang,
 * dan diskonnya kelihatan sebagai apa adanya: kredit ekstra.
 *
 * Kredit HANGUS tiap bulan (langganan, bukan saldo abadi).
 */
export type PaketLangganan = {
  id: string;
  label: string;
  priceIdr: number;
  /** priceIdr / IDR_PER_KREDIT — dihitung, tidak diketik. */
  kreditDasar: number;
  /** Diskon volume. Satu-satunya tempat diskon boleh hidup. */
  kreditBonus: number;
  kreditTotal: number;
};

const PAKET_MENTAH = [
  { id: "starter", label: "Starter", priceIdr: 250_000, kreditTotal: 1_000 },
  { id: "creator", label: "Creator", priceIdr: 600_000, kreditTotal: 2_600 },
  { id: "studio", label: "Studio", priceIdr: 1_500_000, kreditTotal: 7_000 },
  { id: "agency", label: "Agency", priceIdr: 3_500_000, kreditTotal: 17_000 },
] as const;

export const PAKET_LANGGANAN: readonly PaketLangganan[] = PAKET_MENTAH.map((p) => {
  const kreditDasar = p.priceIdr / IDR_PER_KREDIT;
  return { ...p, kreditDasar, kreditBonus: p.kreditTotal - kreditDasar };
});

/** Rupiah yang masuk ledger untuk sejumlah kredit. Ledger tetap rupiah —
 *  lihat catatan kurs 1:1 di lib/tokens.ts; kredit adalah satuan JUAL, dan
 *  konversinya hidup di satu tempat saja: di sini. */
export function kreditKeIdr(kredit: number): number {
  return kredit * IDR_PER_KREDIT;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER YANG DIJUAL DI BAWAH BIAYA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Daftar tier yang SADAR dijual rugi, beserta alasan dan tanggalnya.
 *
 * Ada supaya kerugian tidak bisa lolos diam-diam. tests/harga-kredit.test.ts
 * menegakkan dua arah sekaligus:
 *   - tier rugi yang TIDAK terdaftar di sini membuat suite GAGAL;
 *   - tier terdaftar yang ternyata sudah untung juga membuat suite GAGAL,
 *     supaya daftar ini tidak menumpuk jadi arsip mati.
 *
 * Jadi satu-satunya cara menghapus baris di bawah adalah benar-benar
 * memperbaiki harganya — bukan melupakannya.
 */
export type TierRugiDisadari = {
  tier: string;
  sejak: string;
  alasan: string;
  /**
   * Diisi hanya kalau kerugiannya BENAR-BENAR ditutup.
   *
   * Test menegakkannya sebagai klaim, bukan label: baris yang bertanda selesai
   * TAPI tiernya masih dijual di bawah COGS akan menggagalkan suite. Jadi
   * "selesai" tidak bisa dipakai untuk menenangkan daftar ini.
   */
  selesai?: { tanggal: string; alasan: string };
};

export const TIER_RUGI_DISADARI: readonly TierRugiDisadari[] = [
  {
    tier: "high_quality",
    sejak: "2026-08-26",
    alasan:
      "Tagihan Agustus 2026 membuka COGS nyata Rp23.355 (mode standar 15 dtk) " +
      "terhadap harga jual Rp12.000 — rugi Rp11.355/video, dan Rp34.645 bila " +
      "wajah dikunci. Bukan margin tipis, melainkan menjual di bawah biaya. " +
      "MENUNGGU KEPUTUSAN BRIAN: naikkan harga, ganti mesin, atau matikan tier.",
    selesai: {
      tanggal: "2026-08-26",
      alasan:
        "Penjualan pindah ke KREDIT: 15 detik standar = 267 kredit (margin " +
        "65%), dan itulah harga yang benar-benar ditawarkan. Rp12.000 berhenti " +
        "menjadi harga jual. SISANYA BELUM NOL: jalur rupiah lama masih " +
        "memakai angka Rp12.000 untuk menahan saldo — dicatat terbuka di " +
        "HARGA_RUPIAH_BELUM_IKUT_KREDIT, bukan ikut ditandai selesai.",
    },
  },
];

/** "2.600" — satuannya ditulis terpisah di UI supaya bisa dirangkai bebas. */
export function formatKredit(kredit: number): string {
  return Math.round(kredit).toLocaleString("id-ID");
}

/** "2.600 kredit" */
export function kredit(n: number): string {
  return `${formatKredit(n)} kredit`;
}

/**
 * Berapa video yang bisa dibuat dengan sejumlah kredit.
 *
 * Dipakai UI untuk menjawab pertanyaan yang benar-benar ditanyakan pembeli.
 * Kredit menyamarkan harga rupiah, tapi ia TIDAK menyamarkan jumlah video —
 * dan justru itu kekuatan jualnya pada 8 detik:
 *   Rp250.000 =  1 video (15 dtk kunci wajah)
 *   Rp250.000 =  6 video (8 dtk standar)
 */
export function jumlahVideo(kreditTersedia: number, mode: ModeRender, durationSec: number): number {
  return Math.floor(kreditTersedia / biayaKredit(cogsIdr(mode, durationSec)));
}

/**
 * SISA YANG BELUM IKUT PINDAH KE KREDIT.
 *
 * Penjualan sudah memakai kredit, tapi `config.tiers[].priceIdr` masih dipakai
 * tierPriceIdr() untuk menahan saldo di jalur rupiah lama. Untuk high_quality
 * angka itu Rp12.000 terhadap COGS Rp23.355 — jadi kalau jalur itu terpakai,
 * ia masih menjual di bawah biaya.
 *
 * KENAPA TIDAK LANGSUNG DINAIKKAN SAJA. Harga kreditnya setara Rp66.750, jadi
 * menyamakannya berarti (1) menaikkan harga eceran 5,5x dan (2) mematikan
 * bonus pendaftaran Rp12.000 yang selama ini pas untuk tepat satu video. Dua
 * keputusan produk, dan keduanya milik Brian — bukan efek samping dari
 * mengubah target margin.
 *
 * Daftar ini membuat sisa itu tidak bisa hilang di antara dua sistem harga.
 * Test mematok angkanya, jadi perubahan diam-diam ikut ketahuan.
 */
export const HARGA_RUPIAH_BELUM_IKUT_KREDIT: readonly { tier: string; priceIdr: number; catatan: string }[] = [
  {
    tier: "high_quality",
    priceIdr: 12_000,
    catatan:
      "Setara kredit: 267 kr = Rp66.750. Menunggu keputusan Brian — samakan " +
      "dengan harga kredit (dan atur ulang bonus pendaftaran), atau pensiunkan " +
      "jalur rupiahnya lewat TIER_PENSIUN di lib/paket-kredit.ts.",
  },
];

/**
 * Tier yang harganya MASIH di bawah target margin.
 *
 * Bukan kerugian — mereka untung — tapi begitu ada target margin tertulis,
 * tier yang tidak memenuhinya menjadi ketidakcocokan yang diam. Daftar ini
 * memakai disiplin yang sama dengan TIER_RUGI_DISADARI dan dijaga dua arah:
 * tier di bawah target yang tidak terdaftar menggagalkan suite, dan tier
 * terdaftar yang ternyata sudah memenuhi target juga menggagalkannya.
 */
export type TierDiBawahTarget = { tier: string; sejak: string; alasan: string };

export const TIER_DI_BAWAH_TARGET_MARGIN: readonly TierDiBawahTarget[] = [
  {
    tier: "super_hq",
    sejak: "2026-08-26",
    alasan:
      "Harga rupiah Rp80.000 dipertahankan saat target margin naik ke 65%; " +
      "dengan COGS kunci wajah Rp46.645 marginnya 41,7%. Harga kreditnya " +
      "sendiri (534 kredit = Rp133.500) SUDAH memenuhi target — yang " +
      "tertinggal hanya harga rupiah warisan. Menaikkannya 67% adalah " +
      "keputusan harga, dan Brian belum memutuskannya.",
  },
  {
    tier: "silent_caption",
    sejak: "2026-08-26",
    alasan:
      "Rp5.000 terhadap COGS Rp2.445 = 51%, di bawah target 65%. TAPI COGS " +
      "itu sendiri BELUM TERVERIFIKASI: tier ini berjalan di 480p, dan 480p " +
      "belum pernah diukur per-mode di akun kami. Angka marginnya bisa " +
      "bergerak ke dua arah begitu 480p diukur, jadi menaikkan harga " +
      "sekarang berarti bereaksi pada angka yang belum ada dasarnya.",
  },
];

/**
 * PELUANG, BUKAN RENCANA: Grok Imagine.
 *
 * Tarif BROSUR Grok $0,050/detik = Rp6.520 untuk 8 detik, kira-kira SEPARUH
 * COGS BytePlus (Rp12.456). Kalau itu terverifikasi dari console.x.ai, margin
 * pada harga yang SAMA (143 kredit) naik dari 65% ke 82%.
 *
 * ANGKA ITU BELUM BOLEH DIPAKAI MEMUTUSKAN APA PUN. Ia brosur — kelas sumber
 * yang persis baru saja terbantah tagihan: brosur Seedance menyebut $6,40 dan
 * $10,70/1M token, tarif nyata kami $4,41. Brosur meleset ke dua arah, dan
 * kali ini arahnya menguntungkan, yang justru membuatnya lebih mudah dipercaya
 * tanpa diperiksa.
 *
 * Jadi jangan ganti mesin sebelum tagihan Grok dilihat. Adapter-nya sudah ada
 * dan teruji di lib/providers/stubs/xai-grok.ts, di belakang PROVIDER_VIDEO=xai,
 * dan sengaja BUKAN bawaan.
 */
export const PELUANG_GROK = {
  tarifBrosurUsdPerDetik: 0.05,
  cogsIdr8Detik: 6_520,
  marginDiHargaSama: 0.82,
  status: "BELUM TERVERIFIKASI — butuh tagihan console.x.ai",
} as const;
