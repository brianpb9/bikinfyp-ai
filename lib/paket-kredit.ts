// PAKET & HARGA — satu sumber untuk halaman checkout DAN halaman harga publik.
//
// Sebelum ini daftar paket hidup sebagai konstanta di dalam app/kredit/page.tsx.
// Menyalinnya ke halaman publik berarti dua daftar harga yang harus dijaga
// sama selamanya, dan daftar harga yang hanyut bukan sekadar bug kosmetik:
// yang membaca halaman publik justru reviewer gateway pembayaran (temuan onboarding
// 2026-08-13: "tidak menemukan harga untuk barang/jasa pada website"), dan
// pelanggan yang melihat satu angka lalu ditagih angka lain.
//
// Harga per video ditulis di sini, TIDAK diimpor dari config.ts — config
// mengimpor node:fs, jadi ia server-only dan tidak bisa dipakai komponen klien
// (pola yang sama dengan lib/category-guess.ts).
//
// Supaya salinan ini tidak diam-diam hanyut dari harga yang benar-benar
// ditagih, ada tes yang membandingkannya dengan config.tiers. Kalau salah satu
// diubah tanpa yang lain, tesnya merah.

export interface PaketKredit {
  id: string;
  name: string;
  price: number;
  perVideo: string;
  tag: string | null;
  badge: string;
  voiced: boolean;
  /** Berapa video yang bisa dibuat dari paket ini. */
  jumlahVideo: number;
}

export const PAKET_KREDIT: PaketKredit[] = [
  { id: "hq5", name: "5× AI Bersuara", price: 60_000, perVideo: "Rp12rb/video", tag: null, badge: "🎙️ AI-nya ngomong", voiced: true, jumlahVideo: 5 },
  { id: "hq10", name: "10× AI Bersuara", price: 120_000, perVideo: "Rp12rb/video", tag: "Paling laris", badge: "🎙️ AI-nya ngomong", voiced: true, jumlahVideo: 10 },
  { id: "super5", name: "5× AI Bersuara Pro", price: 400_000, perVideo: "Rp80rb/video", tag: null, badge: "🎙️ presenter ngomong asli, lip-sync sungguhan", voiced: true, jumlahVideo: 5 },
];

export interface TierHarga {
  id: string;
  nama: string;
  hargaIdr: number;
  dapat: string;
}

/** Harga per video, diambil dari config.tiers — bukan diketik ulang. */
/** Tier yang SUDAH TIDAK DIJUAL lagi.
 *
 * Satu sumber kebenaran, dipakai halaman harga DAN API generate. Sebelumnya
 * "silent_caption sudah pensiun" cuma ditulis hardcode di dalam satu route,
 * sementara /harga tetap memajangnya seharga Rp5.000 dan config tetap
 * memberinya harga. Akibatnya halaman publik mengiklankan barang yang
 * mesinnya sendiri tolak dengan pesan "sudah tidak tersedia" — itu bukan copy
 * basi, itu iklan menyesatkan, dan yang membaca halaman publik justru
 * termasuk reviewer gateway pembayaran.
 *
 * config.tiers TETAP memuat harganya: job lama yang dibuat sebelum pensiun
 * masih perlu dihitung biayanya dengan benar. Yang berubah cuma: tidak dijual
 * dan tidak dipajang. */
export const TIER_PENSIUN: readonly string[] = ["silent_caption"];

/**
 * Tier yang DITAWARKAN hari ini. Daftar putih, bukan daftar hitam.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * "DITAWARKAN" DAN "DITERIMA" ADALAH DUA PERTANYAAN BERBEDA
 * ────────────────────────────────────────────────────────────────────────────
 * Susunan baru (standard/premium/ultra) menggantikan penamaan lama di semua
 * permukaan jual: /harga, pemilih kualitas, dan wizard Enterprise. premium
 * berjalan di model dan harga yang persis sama dengan high_quality, dan ultra
 * sama dengan super_hq pada versi model yang lebih baru — jadi memajang
 * keduanya berdampingan berarti menawarkan dua kartu dengan harga, mesin, dan
 * hasil yang sama.
 *
 * Tapi nama lama TIDAK boleh langsung ditolak: naskah yang dibuat sebelum
 * perubahan ini menyimpan quality_tier lamanya, dan /api/jobs menuntut tier
 * job sama dengan tier naskahnya. Menolak nama lama berarti setiap orang yang
 * sedang di tengah alur — sudah bikin naskah, belum menekan Bikin — menabrak
 * "tier tidak dikenal" tepat pada langkah terakhir.
 *
 * Karena itu dua daftar, bukan satu.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * STANDARD MASUK SETELAH MESINNYA DIBUKTIKAN, BUKAN SEBELUMNYA
 * ────────────────────────────────────────────────────────────────────────────
 * Standard sempat ditahan di luar daftar ini karena kie.ai belum pernah kami
 * panggil. Itu berubah 2 Sep 2026: kuncinya dipasang dan satu render berbayar
 * sungguhan berhasil — 6 detik, 480p, 14,4 kredit kie.ai, keluar h264 + audio
 * dalam 20 detik.
 *
 * SATU ANGKA MASIH KOSONG: nilai rupiah per kredit kie.ai. Ia ada di tagihan
 * pembelian kredit, bukan di API, jadi tidak bisa diambil dari mana pun di
 * sini. Selama KIE_IDR_PER_CREDIT belum diisi, biaya render Standard
 * dilaporkan 0 DENGAN peringatan (lihat lib/providers/stubs/kie-grok.ts):
 * harga jualnya aman diatur admin, tapi angka MARGIN untuk Standard belum
 * boleh dipercaya.
 */
export const TIER_DIJUAL: readonly string[] = ["standard", "premium", "ultra"];

/**
 * Tier yang masih DITERIMA untuk job dan naskah baru — superset dari yang
 * ditawarkan. Nama lama ada di sini supaya alur yang sedang berjalan selesai.
 */
export const TIER_DITERIMA: readonly string[] = [...TIER_DIJUAL, "high_quality", "super_hq"];

/**
 * Daftar PUTIH, dan bedanya bukan gaya penulisan.
 *
 * Versi sebelumnya cuma menolak yang ada di TIER_PENSIUN, jadi id apa pun yang
 * belum dikenal — salah ketik, tier eksperimen yang bocor dari cabang lain,
 * nilai karangan dari klien — dijawab "masih dijual". Untuk pemeriksaan yang
 * menentukan apakah sesuatu boleh ditagih, bawaan yang benar adalah TIDAK,
 * bukan YA.
 */
export function tierMasihDijual(id: string): boolean {
  return TIER_DIJUAL.includes(id) && !TIER_PENSIUN.includes(id);
}

/** Boleh dipakai job/naskah baru — termasuk nama lama yang masih beredar. */
export function tierMasihDiterima(id: string): boolean {
  return TIER_DITERIMA.includes(id) && !TIER_PENSIUN.includes(id);
}

export const TIER_HARGA: TierHarga[] = [
  // CADANGAN halaman harga, dipakai hanya saat harga_kredit_video masih kosong.
  // Angkanya wajib sama dengan config.tiers — ada tes yang menjaganya. Harga
  // yang benar-benar ditagih diatur admin di /admin/paket.
  {
    id: "standard",
    nama: "Video Standard",
    hargaIdr: 14_000,
    dapat: "Video iklan produk 720p bersuara, 15 detik — cepat dan hemat untuk konten harian.",
  },
  {
    id: "premium",
    nama: "Video Premium",
    hargaIdr: 44_000,
    dapat: "Video iklan produk 720p 15 detik dengan narasi bahasa Indonesia yang menjelaskan produkmu.",
  },
  {
    id: "ultra",
    nama: "Video Ultra",
    hargaIdr: 53_000,
    dapat: "Video iklan produk 720p 15 detik kualitas tertinggi, presenter AI bicara dengan gerak bibir sinkron.",
  },
];

/** Rentang harga keseluruhan — dipakai halaman harga dan dokumen onboarding
 *  Duitku. Dihitung, bukan ditulis, supaya tidak pernah salah saat paket
 *  atau tier berubah. */
export function rentangHarga(): { min: number; max: number } {
  const semua = [...TIER_HARGA.map((t) => t.hargaIdr), ...PAKET_KREDIT.map((p) => p.price)];
  return { min: Math.min(...semua), max: Math.max(...semua) };
}
