// PAKET & HARGA — satu sumber untuk halaman checkout DAN halaman harga publik.
//
// Sebelum ini daftar paket hidup sebagai konstanta di dalam app/kredit/page.tsx.
// Menyalinnya ke halaman publik berarti dua daftar harga yang harus dijaga
// sama selamanya, dan daftar harga yang hanyut bukan sekadar bug kosmetik:
// yang membaca halaman publik justru reviewer Midtrans (temuan onboarding
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
 * termasuk reviewer Midtrans.
 *
 * config.tiers TETAP memuat harganya: job lama yang dibuat sebelum pensiun
 * masih perlu dihitung biayanya dengan benar. Yang berubah cuma: tidak dijual
 * dan tidak dipajang. */
export const TIER_PENSIUN: readonly string[] = ["silent_caption"];

export function tierMasihDijual(id: string): boolean {
  return !TIER_PENSIUN.includes(id);
}

export const TIER_HARGA: TierHarga[] = [
  {
    id: "high_quality",
    nama: "Video AI Bersuara",
    hargaIdr: 12_000,
    dapat: "Video iklan produk 720p dengan narasi bahasa Indonesia yang menjelaskan produkmu.",
  },
  {
    id: "super_hq",
    nama: "Video AI Bersuara Pro",
    hargaIdr: 80_000,
    dapat: "Video iklan produk 720p, presenter AI bicara langsung ke kamera dengan gerak bibir sinkron.",
  },
];

/** Rentang harga keseluruhan — dipakai halaman harga dan dokumen onboarding
 *  Midtrans. Dihitung, bukan ditulis, supaya tidak pernah salah saat paket
 *  atau tier berubah. */
export function rentangHarga(): { min: number; max: number } {
  const semua = [...TIER_HARGA.map((t) => t.hargaIdr), ...PAKET_KREDIT.map((p) => p.price)];
  return { min: Math.min(...semua), max: Math.max(...semua) };
}
