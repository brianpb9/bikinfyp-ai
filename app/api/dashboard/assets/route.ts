import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { createSignedUrl } from "@/lib/signed-url";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getPool } from "@/lib/postgres/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ASSETS — semua foto yang pernah diunggah organisasi ini, di satu tempat.
 *
 * Permintaan Brian 18 Agu: "ada tab assets, semua assets yang sudah di-upload
 * bisa disimpan di sini". Sampai hari ini foto hanya bisa ditemukan lewat
 * produknya: begitu produk lama turun dari daftar, fotonya praktis hilang, dan
 * brand mengunggah ulang berkas yang sudah ada di server kita.
 *
 * TANPA TABEL BARU, dan itu keputusan sadar. Fotonya sudah tersimpan di
 * products.images; yang belum ada cuma CARA MELIHATNYA. Menambah tabel assets
 * berarti migrasi keempat di atas 0030-0032 yang masih tertahan di produksi —
 * risiko rilis yang sedang kita tutup, ditukar dengan tampilan yang bisa
 * dibuat sekarang juga dari data yang sama.
 *
 * Yang MEMANG butuh tabel nanti (dan belum ada di sini, jadi jangan diklaim):
 * dedupe sha256 lintas produk, badge kelayakan referensi dari QC-F1, dan set
 * referensi yang tersimpan per job.
 */
interface Baris {
  product_id: string;
  product_name: string;
  created_at: string;
  images: string;
}

export async function GET(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Assets requires Postgres runtime.");
    const { membership } = await requireOrgContextApi(req);

    const pool = getPool(config.databaseUrl);
    const result = await pool.query<Baris>(
      `SELECT id AS product_id, name AS product_name, created_at, images
         FROM products
        WHERE org_id = $1
        ORDER BY created_at DESC
        LIMIT 300`,
      [membership.org_id]
    );

    // Dedupe per KUNCI PENYIMPANAN. Foto yang sama dipakai dua produk adalah
    // satu aset, bukan dua — dan yang ingin dilihat brand jumlah asetnya,
    // bukan jumlah pemakaiannya.
    const perKunci = new Map<string, { key: string; produk: { id: string; nama: string }[]; created_at: string }>();
    for (const row of result.rows) {
      let daftar: unknown;
      try { daftar = JSON.parse(row.images ?? "[]"); } catch { daftar = []; }
      if (!Array.isArray(daftar)) continue;
      for (const raw of daftar) {
        const key = String(raw ?? "").trim();
        if (!key) continue;
        const ada = perKunci.get(key);
        if (ada) {
          if (!ada.produk.some((p) => p.id === row.product_id)) ada.produk.push({ id: row.product_id, nama: row.product_name });
        } else {
          perKunci.set(key, { key, produk: [{ id: row.product_id, nama: row.product_name }], created_at: row.created_at });
        }
      }
    }

    const assets = [...perKunci.values()]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((a) => ({
        key: a.key,
        url: createSignedUrl(a.key),
        created_at: a.created_at,
        // Nama berkas apa adanya — brand mengenali fotonya dari ini.
        name: a.key.split("/").pop() ?? a.key,
        used_by: a.produk,
      }));

    return Response.json({
      assets,
      counts: { assets: assets.length, products: result.rows.length },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
