import { randomUUID } from "node:crypto";
import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getPool } from "@/lib/postgres/pool";
import { config } from "@/lib/config";
import { pgAudit } from "@/lib/postgres/smoke-runtime";
import { now } from "@/lib/db";
import { slugBrand } from "@/lib/brand-slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/brands/daftar — pendaftaran mandiri brand.
 *
 * ---------------------------------------------------------------------------
 * DUA KEPUTUSAN BRIAN YANG DIJALANKAN DI SINI (6 Sep 2026)
 * ---------------------------------------------------------------------------
 * 1. STATUS 'pending', BUKAN 'active'. Brand yang mendaftar belum bisa masuk
 *    dashboard sampai admin menyetujui. Yang mendaftar tetap punya jejak
 *    lengkap, jadi menyetujuinya nanti tinggal satu perubahan status — bukan
 *    memasukkan ulang datanya.
 *
 * 2. TOKEN AWAL NOL, dan itu BERBEDA dari retail yang dapat satu video gratis.
 *    Tidak ada satu pun baris ledger ditulis di sini — bukan menulis nol,
 *    melainkan TIDAK MENULIS. Menulis baris bernilai nol membuat riwayat
 *    keuangan memuat kejadian yang tidak pernah terjadi, dan constraint
 *    kredit_video sendiri menolak delta = 0.
 *
 * ---------------------------------------------------------------------------
 * KENAPA HARUS SUDAH LOGIN
 * ---------------------------------------------------------------------------
 * Organisasi butuh pemilik, dan pemilik adalah user. Membuat akun DAN
 * organisasi dalam satu langkah berarti menduplikasi seluruh alur OTP/Google
 * yang sudah berjalan — dan setiap duplikat jalur masuk adalah satu lagi
 * tempat sesi bisa bocor. Jadi: daftar akun dulu (jalur yang sama dengan
 * retail), lalu daftarkan brand-nya.
 */
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();

    const body = (await req.json().catch(() => ({}))) as {
      nama?: unknown;
      website?: unknown;
      kategori?: unknown;
    };
    const nama = typeof body.nama === "string" ? body.nama.trim() : "";
    const website = typeof body.website === "string" ? body.website.trim() : "";
    const kategori = typeof body.kategori === "string" ? body.kategori.trim() : "";

    if (nama.length < 2 || nama.length > 80) {
      throw ERR.BAD_REQUEST("Nama brand-nya diisi dulu ya (2–80 karakter).", "Invalid brand name.");
    }
    const slug = slugBrand(nama);
    if (!slug) throw ERR.BAD_REQUEST("Nama brand-nya perlu memuat huruf atau angka.", "Slug empty.");

    const pool = getPool(config.databaseUrl);

    // SATU ORGANISASI PER ORANG, untuk sekarang.
    //
    // requireOrgContext() memakai keanggotaan AKTIF pertama dan mengasumsikan
    // satu org per user (lihat lib/dashboard-auth.ts). Membiarkan orang yang
    // sama mendaftar dua kali menghasilkan keadaan yang tidak bisa dijawab
    // antarmuka mana pun: dua organisasi, satu yang terlihat.
    const sudah = await pool.query(
      "SELECT o.id, o.name, o.status FROM org_members m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $1 LIMIT 1",
      [user.id],
    );
    if (sudah.rows[0]) {
      const o = sudah.rows[0] as { name: string; status: string };
      throw ERR.BAD_REQUEST(
        o.status === "pending"
          ? `Pendaftaran "${o.name}" sudah masuk dan sedang kami tinjau.`
          : `Akun ini sudah terhubung ke brand "${o.name}".`,
        "User already has an organization.",
      );
    }

    const orgId = randomUUID();
    const waktu = now();
    // Slug WAJIB unik di seluruh sistem. Bentrok diselesaikan dengan menambah
    // potongan id, bukan dengan menolak pendaftarannya: nama brand yang sama
    // memang bisa dipakai dua perusahaan berbeda, dan menyuruh yang kedua
    // mengganti namanya adalah menolak pelanggan karena alasan teknis kita.
    const slugFinal = (await pool.query("SELECT 1 FROM organizations WHERE slug = $1", [slug])).rowCount
      ? `${slug}-${orgId.slice(0, 6)}`
      : slug;

    const klien = await pool.connect();
    try {
      await klien.query("BEGIN");
      await klien.query(
        `INSERT INTO organizations (id, name, slug, status, created_at, website_url, product_category)
         VALUES ($1, $2, $3, 'pending', $4, $5, $6)`,
        [orgId, nama, slugFinal, waktu, website || null, kategori || null],
      );
      await klien.query(
        "INSERT INTO org_members (id, org_id, user_id, role, created_at) VALUES ($1, $2, $3, 'owner', $4)",
        [randomUUID(), orgId, user.id, waktu],
      );
      await klien.query("COMMIT");
    } catch (e) {
      await klien.query("ROLLBACK");
      throw e;
    } finally {
      klien.release();
    }

    await pgAudit(user.id, "org.didaftarkan", "organizations", orgId, { nama, slug: slugFinal, website, kategori });

    return Response.json({
      ok: true,
      org_id: orgId,
      status: "pending",
      pesan: "Pendaftaran diterima. Kami tinjau dulu, lalu kabari lewat email.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
