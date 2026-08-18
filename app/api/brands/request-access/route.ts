import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { getAuthUser } from "@/lib/auth";
import { audit, getDb } from "@/lib/db";
import { pgAudit, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { allowRate } from "@/lib/rate-limit";
import { daftarAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PERMINTAAN AKSES BRAND.
 *
 * ADA DI /api/brands, BUKAN /api/dashboard. Seluruh route di bawah
 * /api/dashboard wajib lewat requireOrgContextApi (dijaga tes), dan itu
 * invarian yang tidak boleh diberi pengecualian — sekali daftar pengecualian
 * ada, ia bertambah. Rute ini memang untuk pengguna yang BELUM punya
 * organisasi, jadi tempatnya bukan di sana.
 *
 * Sebelum ini halamannya berhenti di kalimat "hubungi tim BikinFYP" tanpa satu
 * pun cara menghubungi: tidak ada form, tidak ada nomor, tidak ada jejak. Brand
 * yang sudah login — yang sudah menyerahkan email dan berniat membayar —
 * berakhir di jalan buntu, dan kami tidak pernah tahu ia pernah datang.
 *
 * DISIMPAN DI audit_log, bukan tabel baru: bentuk datanya persis yang sudah
 * dilayani audit_log (aktor, aksi, meta), dan menambah tabel berarti migrasi
 * baru untuk sesuatu yang volumenya beberapa baris per minggu. Kalau nanti
 * permintaannya perlu status/assignment, barulah ia pantas punya tabel sendiri.
 */
const AKSI = "org.access_requested";

function bersih(v: unknown, maks = 200): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, maks);
}

export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    // Form ini mengirim email ke kami; tanpa batas ia jadi corong spam.
    if (!(await allowRate("request-access", user.id, 3, 60 * 60))) {
      throw ERR.BAD_REQUEST("Permintaanmu sudah kami terima. Tunggu balasan kami dulu ya.", "Rate limited.");
    }

    const body = await req.json().catch(() => ({}));
    const data = {
      nama: bersih(body.nama, 80),
      brand: bersih(body.brand, 120),
      situs: bersih(body.situs, 200),
      whatsapp: bersih(body.whatsapp, 40),
      volume: bersih(body.volume, 60),
      email: user.email ?? null,
      user_id: user.id,
    };
    if (!data.nama || !data.brand) {
      throw ERR.BAD_REQUEST("Nama dan nama brand wajib diisi.", "nama and brand are required.");
    }

    if (postgresRuntimeEnabled()) await pgAudit(user.id, AKSI, "organizations", null, data);
    else audit(user.id, AKSI, "organizations", null, data);

    // Notifikasi ke tim. Gagal kirim TIDAK menggagalkan permintaan: yang
    // penting jejaknya sudah tersimpan — email cuma cara kami tahu lebih cepat.
    const tujuan = daftarAdmin()[0] ?? config.resendFromEmail;
    let emailTerkirim = false;
    if (config.resendApiKey && tujuan) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${config.resendApiKey}` },
          body: JSON.stringify({
            from: config.resendFromEmail,
            to: [tujuan],
            subject: `Permintaan akses brand: ${data.brand}`,
            text: [
              `Brand   : ${data.brand}`,
              `Nama    : ${data.nama}`,
              `Email   : ${data.email ?? "-"}`,
              `WhatsApp: ${data.whatsapp || "-"}`,
              `Situs   : ${data.situs || "-"}`,
              `Volume  : ${data.volume || "-"}`,
              `User ID : ${data.user_id}`,
            ].join("\n"),
          }),
          signal: AbortSignal.timeout(8000),
        });
        // STATUSNYA DIPERIKSA (audit ulang SUPPORT-01). fetch yang cuma
        // dibungkus try/catch tetap "berhasil" pada 401/429/500 — dan kita
        // menjanjikan "tim akan menghubungi" padahal timnya tidak pernah tahu.
        emailTerkirim = res.ok;
        if (!res.ok) console.warn(`[request-access] Resend menolak: HTTP ${res.status}`);
      } catch (err) {
        console.warn(`[request-access] email tim gagal dikirim (permintaan tetap tersimpan): ${(err as Error).message}`);
      }
    }

    return Response.json({ ok: true, notified: emailTerkirim, whatsapp: config.supportWhatsapp || null });
  } catch (err) {
    return errorResponse(err);
  }
}
