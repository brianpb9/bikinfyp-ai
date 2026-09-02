import { wajibAdminApi } from "@/lib/admin-auth";
import { ERR, errorResponse } from "@/lib/errors";
import { pgAudit, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { audit } from "@/lib/db";
import { daftarPaket, hargaKredit, nonaktifkanPaket, setHargaKredit, simpanPaket } from "@/lib/kredit-video-runtime";
import { jenisDikenal, JENIS_VIDEO, totalVideoPaket } from "@/lib/kredit-video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function catat(actor: string, action: string, entityId: string | null, meta: unknown) {
  if (postgresRuntimeEnabled()) await pgAudit(actor, action, "kredit_video", entityId, meta);
  else audit(actor, action, "kredit_video", entityId, meta);
}

/** GET — harga satuan dan SELURUH paket, termasuk yang sudah dinonaktifkan. */
export async function GET(req: Request) {
  try {
    await wajibAdminApi(req);
    const [harga, paket] = await Promise.all([hargaKredit(), daftarPaket(false)]);
    return Response.json({
      harga: JENIS_VIDEO.map((j) => ({ jenis: j, harga_idr: harga[j] ?? null })),
      paket: paket.map((p) => ({ ...p, total_video: totalVideoPaket(p) })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST — ubah harga satuan atau simpan paket.
 *
 *   { aksi: "harga", jenis, harga_idr }
 *   { aksi: "paket", paket: {...} }
 *   { aksi: "nonaktif", id }
 *
 * Semua angka DIVALIDASI di sini, bukan dipercaya dari layar admin. Layar
 * admin memang dipakai orang yang berwenang, tapi salah ketik satu nol pada
 * harga adalah kejadian biasa — dan harga Rp1.500.000 per video akan terlihat
 * sebagai bug pembayaran, bukan sebagai salah ketik.
 */
export async function POST(req: Request) {
  try {
    const admin = await wajibAdminApi(req);
    const aktor = admin.email ?? admin.id;
    const body = await req.json().catch(() => ({}));
    const aksi = String(body.aksi ?? "");

    if (aksi === "harga") {
      const jenis = String(body.jenis ?? "");
      if (!jenisDikenal(jenis)) throw ERR.BAD_REQUEST("Jenis video tidak dikenal.", `Unknown jenis: ${jenis}`);
      const harga = Number(body.harga_idr);
      if (!Number.isInteger(harga) || harga < 1_000 || harga > 5_000_000) {
        throw ERR.BAD_REQUEST("Harga per video harus antara Rp1.000 dan Rp5.000.000.", "Price out of range.");
      }
      await setHargaKredit(jenis, harga, aktor);
      await catat(aktor, "admin.harga_kredit", jenis, { harga_idr: harga });
      return Response.json({ ok: true, jenis, harga_idr: harga });
    }

    if (aksi === "paket") {
      const p = (body.paket ?? {}) as Record<string, unknown>;
      const id = String(p.id ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
      if (!id) throw ERR.BAD_REQUEST("Paket butuh id.", "Missing package id.");
      const nama = String(p.nama ?? "").trim().slice(0, 60);
      if (!nama) throw ERR.BAD_REQUEST("Paket butuh nama.", "Missing package name.");
      const angka = (v: unknown, min: number, max: number, label: string) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < min || n > max) {
          throw ERR.BAD_REQUEST(`${label} harus bilangan bulat ${min}–${max}.`, `${label} out of range.`);
        }
        return n;
      };
      const paket = {
        id,
        nama,
        keterangan: String(p.keterangan ?? "").slice(0, 200),
        hargaIdr: angka(p.harga_idr, 1_000, 100_000_000, "Harga paket"),
        kuotaStandard: angka(p.kuota_standard ?? 0, 0, 10_000, "Kuota Standard"),
        kuotaPremium: angka(p.kuota_premium ?? 0, 0, 10_000, "Kuota Premium"),
        kuotaUltra: angka(p.kuota_ultra ?? 0, 0, 10_000, "Kuota Ultra"),
        masaHari: angka(p.masa_hari ?? 30, 1, 3650, "Masa berlaku"),
        urutan: angka(p.urutan ?? 0, 0, 999, "Urutan"),
        aktif: p.aktif !== false,
      };
      // Paket tanpa isi apa pun adalah paket yang menagih uang untuk nol video.
      // Ditolak di sini juga, bukan cuma di database: pesan dari CHECK constraint
      // tidak bisa dibaca siapa pun yang sedang mengisi formulir.
      if (paket.kuotaStandard + paket.kuotaPremium + paket.kuotaUltra === 0) {
        throw ERR.BAD_REQUEST("Paket harus berisi minimal satu video.", "Package has no quota.");
      }
      await simpanPaket(paket);
      await catat(aktor, "admin.paket_simpan", id, paket);
      return Response.json({ ok: true, paket });
    }

    if (aksi === "nonaktif") {
      const id = String(body.id ?? "");
      if (!id) throw ERR.BAD_REQUEST("Paket mana yang dinonaktifkan?", "Missing package id.");
      // DINONAKTIFKAN, bukan dihapus: langganan berjalan menyimpan salinan
      // kuotanya sendiri, tapi riwayat pembelian tetap menunjuk id paket ini.
      await nonaktifkanPaket(id);
      await catat(aktor, "admin.paket_nonaktif", id, {});
      return Response.json({ ok: true, id });
    }

    throw ERR.BAD_REQUEST("Aksi tidak dikenal.", `Unknown aksi: ${aksi}`);
  } catch (err) {
    return errorResponse(err);
  }
}
