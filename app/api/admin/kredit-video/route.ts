import { wajibAdminApi } from "@/lib/admin-auth";
import { ERR, errorResponse } from "@/lib/errors";
import { pgAudit, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { audit } from "@/lib/db";
import { daftarPaket, hargaKredit, nonaktifkanPaket, setHargaKredit, simpanPaket } from "@/lib/kredit-video-runtime";
import { jenisDikenal, JENIS_VIDEO, totalVideoPaket } from "@/lib/kredit-video";
import { config } from "@/lib/config";
import { getPool } from "@/lib/postgres/pool";
import { KUALITAS, type Kualitas } from "@/lib/kualitas-video";
import { mesinBerlaku, modelBerlaku, muatPemetaan, pemetaanTersimpan, periksaPemetaan } from "@/lib/pemetaan-model";

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
    // Dimuat ulang supaya layar admin menampilkan yang BERLAKU, bukan yang
    // tersimpan di memori proses ini beberapa menit lalu.
    await muatPemetaan();
    const disimpan = new Set(pemetaanTersimpan().map((b) => b.kualitas));
    return Response.json({
      harga: JENIS_VIDEO.map((j) => ({ jenis: j, harga_idr: harga[j] ?? null })),
      paket: paket.map((p) => ({ ...p, total_video: totalVideoPaket(p) })),
      // Pemetaan model per paket. `bawaan` menyatakan apakah nilainya datang
      // dari kode atau dari keputusan admin — tanpa itu, layar tidak bisa
      // membedakan "belum pernah diatur" dari "diatur ke nilai yang sama".
      pemetaan: (Object.keys(KUALITAS) as Kualitas[]).map((k) => ({
        kualitas: k,
        label: KUALITAS[k].label,
        mesin: mesinBerlaku(k),
        model: modelBerlaku(k),
        bawaan: !disimpan.has(k),
        mesin_bawaan: KUALITAS[k].mesin,
        model_bawaan: KUALITAS[k].model,
      })),
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
 *   { aksi: "model", kualitas, mesin, model }   <- pemetaan model per paket
 *   { aksi: "model_bawaan", kualitas }          <- kembalikan ke bawaan kode
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

    // ── PEMETAAN MODEL PER PAKET ────────────────────────────────────────
    //
    // Permintaan Brian 4 Sep 2026: menentukan sendiri mesin & model tiap paket
    // dari /admin, "sehingga memungkinkan ekspansi bisnis model apabila
    // kedepan muncul efisiensi bisnis dengan perubahan model".
    //
    // Divalidasi DI SINI, bukan di ujung render: pemetaan yang salah baru
    // ketahuan saat merender — sesudah naskah ditulis, gambar disiapkan, dan
    // pembeli menunggu.
    if (aksi === "model") {
      const kualitas = String(body.kualitas ?? "");
      const mesin = String(body.mesin ?? "");
      const model = String(body.model ?? "").trim();
      const tolak = periksaPemetaan({ kualitas, mesin, model });
      if (tolak) throw ERR.BAD_REQUEST(tolak, `Invalid model mapping: ${tolak}`);

      const pool = getPool(config.databaseUrl);
      const at = new Date().toISOString();
      await pool.query(
        `INSERT INTO pemetaan_model (kualitas, mesin, model, diperbarui_pada, diperbarui_oleh)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (kualitas) DO UPDATE SET mesin = EXCLUDED.mesin, model = EXCLUDED.model,
           diperbarui_pada = EXCLUDED.diperbarui_pada, diperbarui_oleh = EXCLUDED.diperbarui_oleh`,
        [kualitas, mesin, model, at, aktor],
      );
      // Dimuat ulang SEKARANG supaya jawaban yang dikirim balik sudah
      // mencerminkan keadaan yang berlaku — bukan keadaan 30 detik lalu.
      await muatPemetaan();
      await catat(aktor, "admin.pemetaan_model", kualitas, { mesin, model });
      return Response.json({ ok: true, kualitas, mesin, model });
    }

    // Kembalikan satu paket ke bawaan kode.
    if (aksi === "model_bawaan") {
      const kualitas = String(body.kualitas ?? "");
      if (!(kualitas in KUALITAS)) throw ERR.BAD_REQUEST(`Paket "${kualitas}" tidak dikenal.`, "Unknown quality");
      const pool = getPool(config.databaseUrl);
      await pool.query("DELETE FROM pemetaan_model WHERE kualitas = $1", [kualitas]);
      await muatPemetaan();
      await catat(aktor, "admin.pemetaan_model_bawaan", kualitas, {});
      return Response.json({ ok: true, kualitas, bawaan: true });
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
