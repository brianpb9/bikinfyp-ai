import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config, paymentsConfigured, paymentsEnv, paymentsLive, paymentsProvider } from "@/lib/config";
import { JANJI_WAKTU } from "@/lib/janji-waktu";
import { KANAL_DUITKU } from "@/lib/duitku";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nama tier berbasis MANFAAT (rename 2026-08-06: tester bingung istilah
// "Senyap" — nama harus menjelaskan hasil, bukan teknologi; id internal tetap).
const TIER_UI = [
  { id: "high_quality", name: "AI Bersuara", note: "Sama, PLUS AI-nya ngomong pakai suara natural", tag: null },
  { id: "super_hq", name: "AI Bersuara Pro", note: "Suara + kualitas gambar paling tajam", tag: null },
];

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
      tiers: TIER_UI.map((t) => ({
        ...t,
        price_idr: config.tiers[t.id]?.priceIdr ?? 0,
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
