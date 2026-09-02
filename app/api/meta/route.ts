import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config, paymentsConfigured, paymentsEnv, paymentsLive, paymentsProvider } from "@/lib/config";
import { JANJI_WAKTU } from "@/lib/janji-waktu";
import { KANAL_DUITKU } from "@/lib/duitku";
import { tierMasihDijual } from "@/lib/paket-kredit";
import { mesinUntuk } from "@/lib/kualitas-video";
import type { QualityTier } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nama tier berbasis MANFAAT (rename 2026-08-06: tester bingung istilah
// "Senyap" — nama harus menjelaskan hasil, bukan teknologi; id internal tetap).
//
// Yang DITAWARKAN sekarang hanya susunan baru. high_quality dan super_hq tidak
// dihapus dari sistem — skrip dan job yang sudah memakainya tetap jalan, dan
// TIER_DIJUAL masih menerimanya — tapi penjualan baru diarahkan ke nama baru.
// Menawarkan keduanya sekaligus berarti memajang "AI Bersuara" dan "Premium"
// berdampingan dengan harga, mesin, dan model yang persis sama.
const TIER_UI = [
  // ── Susunan baru: Standard · Premium · Ultra ────────────────────────────
  //
  // Standard SENGAJA TIDAK ada di daftar ini selama KIE_API_KEY kosong. Ia
  // dirender kie.ai; menawarkannya tanpa kunci berarti setiap pilihan Standard
  // jatuh ke BytePlus lewat failover — pembeli memilih satu mesin dan menerima
  // mesin lain, dan kita menagihnya dengan biaya yang belum pernah diukur.
  // Lihat tierStandardSiap() di bawah.
  { id: "standard", name: "Standard", note: "Cepat dan hemat — buat uji ide dan konten harian", tag: null },
  { id: "premium", name: "Premium", note: "Gambar lebih rapi, wajah lebih stabil, suara AI", tag: null },
  { id: "ultra", name: "Ultra", note: "Kualitas tertinggi yang kami punya", tag: "Terbaik" },
];

/** Standard baru boleh ditawarkan kalau mesinnya benar-benar bisa dipanggil. */
function tierStandardSiap(): boolean {
  return Boolean(config.kieApiKey) && tierMasihDijual("standard");
}

// GET /api/meta — konfigurasi publik untuk UI (estimasi waktu + harga tier, P6).
export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const isByteplus = config.providerVideo === "byteplus";
    return Response.json({
      provider_video: config.providerVideo,
      estimate_text: isByteplus
        ? `Biasanya ${JANJI_WAKTU.klipTunggal}, tapi bisa lebih lama saat antrean padat. Kamu boleh tutup halaman ini.`
        : `Sekitar ${JANJI_WAKTU.sisaKlip} lagi. Kamu boleh tutup halaman ini.`,
      estimate_min_max_min: isByteplus ? [2, 45] : [1, 2],
      tiers: TIER_UI
        .filter((t) => (t.id === "standard" ? tierStandardSiap() : tierMasihDijual(t.id)))
        .map((t) => ({
          ...t,
          price_idr: config.tiers[t.id]?.priceIdr ?? 0,
          // Resolusi dan mesin dikirim apa adanya, dari config yang benar-benar
          // dipakai saat render — bukan diketik di layar. Klaim "1080p" pernah
          // hidup berbulan-bulan di layar Enterprise untuk tier yang merender
          // 720p justru karena angkanya diketik terpisah dari yang dirender.
          resolution: config.tiers[t.id]?.resolution ?? "",
          engine: mesinUntuk(t.id as QualityTier),
        })),
      promo_price_idr: config.promoPriceIdr,
      // r13 (review produk 2026-08-07): halaman kredit sempat menampilkan
      // "Mode demo: pembayaran berhasil tanpa uang sungguhan" TANPA SYARAT,
      // termasuk ke user production — client butuh tahu status pembayaran
      // sungguhan supaya bisa jujur, bukan menebak dari kegagalan fallback.
      // Sama dengan /api/health (koreksi Brian 20 Agu): sandbox TIDAK PERNAH
      // live. Halaman kredit membaca ini untuk memutuskan boleh-tidaknya
      // tombol beli terbuka.
      payments_provider: paymentsProvider(),
      payments_env: paymentsEnv(),
      payments_live: paymentsLive(),
      // KESIAPAN TEKNIS, BUKAN IZIN UANG SUNGGUHAN — dan keduanya memang beda
      // pertanyaan. payments_live menjawab "boleh mengumumkan checkout aman
      // untuk uang sungguhan?"; ini menjawab "gateway-nya bisa dipakai
      // sekarang?". Sampai 26 Agu halaman kredit cuma punya payments_live,
      // jadi di sandbox tombol belinya MATI TOTAL — dan alur checkout yang
      // tidak bisa dijalankan itulah yang membuat pendaftaran merchant Duitku
      // ditolak: mereka minta melihat checkout sampai pembayaran, di sandbox
      // mereka sendiri.
      payments_configured: paymentsConfigured(),
      // Kanal yang benar-benar kita terima — QRIS dan VA saja.
      //
      // Dikirim DARI SERVER, bukan diketik di klien: daftar yang diketik di
      // layar bisa memuat kanal yang server tolak, dan pembeli baru tahu
      // sesudah menekan. Server juga yang memvalidasinya lagi saat checkout,
      // jadi klien tidak pernah menjadi sumber kebenaran soal ini.
      payment_channels: KANAL_DUITKU.map((k) => ({ code: k.kode, name: k.nama, type: k.jenis })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
