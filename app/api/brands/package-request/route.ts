import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { pgAudit, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { audit } from "@/lib/db";
import { allowRate } from "@/lib/rate-limit";
import { daftarAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PENGAJUAN PAKET TOKEN.
 *
 * Tombol "Ajukan paket ini" sebelumnya TIDAK melakukan apa pun — tanpa onClick,
 * tanpa request, tanpa jejak. Ia berdiri di titik monetisasi tertinggi produk
 * ini: brand yang sudah memilih paket Rp490 ribu sampai Rp4,9 juta menekannya,
 * lalu tidak terjadi apa-apa dan tidak ada yang tahu ia pernah menekan.
 *
 * HARGA YANG TERLIHAT ikut disimpan, bukan cuma id paketnya. Angka di layar
 * bisa berubah sesudah pengajuan, dan yang harus kita hormati adalah angka yang
 * dilihat brand saat ia menekan tombol.
 *
 * Di /api/brands, bukan /api/dashboard: rute ini memang butuh organisasi, tapi
 * ia soal PENJUALAN, bukan data kampanye. requireOrgContextApi tetap dipanggil.
 */
export async function POST(req: Request) {
  try {
    const { user, membership } = await requireOrgContextApi(req);
    if (!(await allowRate("package-request", membership.org_id, 5, 60 * 60))) {
      throw ERR.BAD_REQUEST("Pengajuanmu sudah kami terima. Tim kami menghubungi ya.", "Rate limited.");
    }

    const body = await req.json().catch(() => ({}));
    const paket = String(body.paket ?? "").trim().slice(0, 60);
    const label = String(body.label ?? "").trim().slice(0, 120);
    const hargaIdr = Number(body.harga_idr);
    const tokenIdr = Number(body.token_idr);
    if (!paket) throw ERR.BAD_REQUEST("Pilih paketnya dulu ya.", "paket is required.");

    const data = {
      paket,
      label,
      // Angka YANG TERLIHAT saat menekan, bukan yang berlaku saat dibaca admin.
      harga_idr_terlihat: Number.isFinite(hargaIdr) ? hargaIdr : null,
      token_idr_terlihat: Number.isFinite(tokenIdr) ? tokenIdr : null,
      org_id: membership.org_id,
      user_id: user.id,
      email: user.email ?? null,
      diminta_pada: new Date().toISOString(),
    };

    if (postgresRuntimeEnabled()) await pgAudit(user.id, "billing.package_requested", "organizations", membership.org_id, data);
    else audit(user.id, "billing.package_requested", "organizations", membership.org_id, data);

    // Notifikasi tim. Statusnya DIPERIKSA (audit ulang SUPPORT-01): fetch yang
    // hanya dibungkus try/catch tetap "berhasil" pada 401/429/500, dan kita
    // memberi tahu pengguna bahwa tim sudah dikabari padahal belum.
    let emailTerkirim = false;
    const tujuan = daftarAdmin()[0] ?? "";
    if (config.resendApiKey && tujuan) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${config.resendApiKey}` },
          body: JSON.stringify({
            from: config.resendFromEmail,
            to: [tujuan],
            subject: `Pengajuan paket ${label || paket}`,
            text: [
              `Paket   : ${label || paket}`,
              `Harga   : ${data.harga_idr_terlihat ?? "-"}`,
              `Token   : ${data.token_idr_terlihat ?? "-"}`,
              `Org     : ${membership.org_id}`,
              `User    : ${user.email ?? user.id}`,
            ].join("\n"),
          }),
          signal: AbortSignal.timeout(8000),
        });
        emailTerkirim = res.ok;
        if (!res.ok) console.warn(`[package-request] Resend menolak: HTTP ${res.status}`);
      } catch (err) {
        console.warn(`[package-request] email tim gagal: ${(err as Error).message}`);
      }
    }

    return Response.json({
      ok: true,
      // Jujur soal jalur mana yang benar-benar jalan: kalau email tim gagal,
      // pengguna berhak tahu bahwa jalur cepatnya WhatsApp.
      notified: emailTerkirim,
      whatsapp: config.supportWhatsapp || null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
