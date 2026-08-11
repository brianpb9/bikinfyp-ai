// Organisasi (dashboard enterprise/brand — F-ENT-01, 2026-08-11). Pasangan
// Postgres dari lib/org.ts (SQLite dev) — production real path. Mengikuti
// pola fungsi-lepas smoke-runtime.ts (satu Pool per panggilan), bukan class
// repository, karena modul ini murni read-path untuk dashboard + provisioning
// CLI (scripts/admin-provision-org.mjs, admin-grant-org-credit.mjs) menulis
// langsung lewat SQL-nya sendiri, bukan lewat modul ini.
//
// role di org_members HANYA label ("siapa dihubungi"), TIDAK PERNAH dicek
// untuk otorisasi di MVP ini — akses dashboard cukup "punya >=1 baris
// org_members" (lihat app/dashboard/layout.tsx). RBAC granular = v2.
import crypto from "node:crypto";
import { Pool } from "pg";
import { config } from "../config";
import { getPool } from "./pool";

function url() {
  if (!/^postgres(?:ql)?:\/\//i.test(config.databaseUrl)) {
    throw new Error("lib/postgres/org.ts memerlukan DATABASE_URL PostgreSQL.");
  }
  return config.databaseUrl;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  created_at: string;
  website_url: string | null;
  business_type: string | null;
  category: string | null;
  audience: string | null;
  elevator_pitch: string | null;
  onboarded_at: string | null;
  brand_logo_key: string | null;
  brand_color: string | null;
  brand_tagline: string | null;
}

export interface OrgMembership {
  org_id: string;
  org_name: string;
  org_slug: string;
  org_status: "active" | "suspended";
  role: "owner" | "member";
}

/** Semua org yang diikuti user ini (biasanya 0 utk retail, 1 utk brand MVP). */
export async function pgGetUserOrgs(userId: string): Promise<OrgMembership[]> {
  const pool = getPool(url());
  try {
    const res = await pool.query<OrgMembership>(
      `SELECT o.id AS org_id, o.name AS org_name, o.slug AS org_slug, o.status AS org_status, m.role
       FROM org_members m JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = $1 ORDER BY m.created_at ASC`,
      [userId]
    );
    return res.rows;
  } finally {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }
}

export async function pgGetOrgBySlug(slug: string): Promise<Organization | null> {
  const pool = getPool(url());
  try {
    return (await pool.query<Organization>("SELECT * FROM organizations WHERE slug=$1", [slug])).rows[0] ?? null;
  } finally {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }
}

export async function pgGetOrgById(orgId: string): Promise<Organization | null> {
  const pool = getPool(url());
  try {
    return (await pool.query<Organization>("SELECT * FROM organizations WHERE id=$1", [orgId])).rows[0] ?? null;
  } finally {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }
}

/** Hasil "analisa bisnis" (M7) — org tanpa profil tetap valid, ini murni tambahan. */
export async function pgUpdateOrgProfile(orgId: string, profile: {
  websiteUrl: string; businessType: string; category: string; audience: string; elevatorPitch: string;
}): Promise<void> {
  const pool = getPool(url());
  try {
    await pool.query(
      "UPDATE organizations SET website_url=$1, business_type=$2, category=$3, audience=$4, elevator_pitch=$5 WHERE id=$6",
      [profile.websiteUrl, profile.businessType, profile.category, profile.audience, profile.elevatorPitch, orgId]
    );
  } finally {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }
}

export async function pgGetOrgBalance(orgId: string): Promise<number> {
  const pool = getPool(url());
  try {
    const res = await pool.query<{ balance: string }>(
      "SELECT COALESCE(SUM(delta),0) AS balance FROM credit_ledger WHERE org_id=$1",
      [orgId]
    );
    return Number(res.rows[0]?.balance ?? 0);
  } finally {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }
}

export interface RecentBulkRun {
  bulk_run_id: string;
  created_at: string;
  total: number;
  ready_count: number;
  /** Nama produk kampanye ini — satu kampanye = satu produk (model M8). */
  product_name: string | null;
  /** Kunci thumbnail scene pertama, kalau ada. NULL untuk job yang tidak
   * melewati gerbang review (tidak punya baris job_shots sama sekali). */
  thumb_key: string | null;
  /** Video jadi pertama di run ini — CADANGAN untuk thumb_key.
   *
   * Bug nyata (2026-08-11): kampanye yang sudah selesai pun tampil kotak hitam
   * di beranda, karena satu-satunya sumber gambar adalah job_shots dan job yang
   * tidak melewati gerbang tinjau scene tidak punya baris job_shots sama
   * sekali. Videonya sendiri selalu ada begitu state READY, jadi frame
   * pertamanya dipakai sebagai gambar kartu. */
  video_key: string | null;
  review_count: number;
  /** Format job pertama di run ini. Satu kampanye = satu produk dengan satu
   * konsep, jadi seluruh jobnya berformat sama (dikunci di route confirm). */
  format: string | null;
  /** Job yang belum mencapai state akhir (masih dirender). Dipakai memisahkan
   * proyek "Aktif" dari "Selesai" — proyek dengan 2 siap + 1 gagal TIDAK boleh
   * dianggap masih berjalan hanya karena ready_count < total. */
  pending_count: number;
  failed_count: number;
}

/** Bulk run terbaru org ini (M4) — dikelompokkan dari jobs.bulk_run_id,
 * tidak ada tabel bulk_runs terpisah (keputusan MVP di rencana M3). */
export async function pgListRecentBulkRuns(orgId: string, limit = 5): Promise<RecentBulkRun[]> {
  const pool = getPool(url());
  try {
    const res = await pool.query<RecentBulkRun & { created_at: string }>(
      // Nama produk & thumbnail diambil lewat sub-query berkorelasi, BUKAN
      // JOIN + GROUP BY: satu kampanye selalu satu produk (model M8), jadi
      // MIN()/MAX() atas nama produk hanya akan mengaburkan maksudnya. Ini juga
      // menghindari menyeret job_shots ke dalam agregat dan menggandakan baris.
      `SELECT j.bulk_run_id, MIN(j.created_at) AS created_at, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE j.state = 'READY')::int AS ready_count,
              COUNT(*) FILTER (WHERE j.state = 'AWAITING_APPROVAL')::int AS review_count,
              COUNT(*) FILTER (WHERE j.state NOT IN ('READY','FAILED','REFUNDED'))::int AS pending_count,
              COUNT(*) FILTER (WHERE j.state IN ('FAILED','REFUNDED'))::int AS failed_count,
              (SELECT p.name FROM jobs j2 JOIN products p ON p.id = j2.product_id
                 WHERE j2.bulk_run_id = j.bulk_run_id AND j2.org_id = $1
                 ORDER BY j2.created_at ASC LIMIT 1) AS product_name,
              (SELECT j4.format FROM jobs j4
                 WHERE j4.bulk_run_id = j.bulk_run_id AND j4.org_id = $1
                 ORDER BY j4.created_at ASC LIMIT 1) AS format,
              (SELECT sh.thumb_key FROM jobs j3 JOIN job_shots sh ON sh.job_id = j3.id
                 WHERE j3.bulk_run_id = j.bulk_run_id AND j3.org_id = $1 AND sh.thumb_key IS NOT NULL
                 ORDER BY j3.created_at ASC, sh.idx ASC LIMIT 1) AS thumb_key,
              (SELECT o.video_url FROM jobs j5 JOIN outputs o ON o.job_id = j5.id
                 WHERE j5.bulk_run_id = j.bulk_run_id AND j5.org_id = $1
                   AND j5.state = 'READY' AND o.video_url IS NOT NULL
                 ORDER BY j5.created_at ASC LIMIT 1) AS video_key
       FROM jobs j WHERE j.org_id = $1 AND j.bulk_run_id IS NOT NULL
       GROUP BY j.bulk_run_id ORDER BY MIN(j.created_at) DESC LIMIT $2`,
      [orgId, limit]
    );
    return res.rows;
  } finally {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }
}

export async function pgGetOrgLedger(orgId: string, limit = 50) {
  const pool = getPool(url());
  try {
    return (
      await pool.query(
        "SELECT * FROM credit_ledger WHERE org_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2",
        [orgId, limit]
      )
    ).rows;
  } finally {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }
}

export interface RecentVideo {
  job_id: string;
  product_name: string;
  video_key: string;
  caption: string | null;
  created_at: string;
  /** Ikut dibawa supaya ubin bisa DIBEDAKAN. Isi normalnya beberapa variasi
   *  dari satu produk, jadi nama produk saja membuat semua ubin tertulis sama. */
  format: string;
}

/** Video JADI terbaru milik org — untuk deretan hasil di beranda.
 *
 * Beranda sebelumnya cuma memajang ANGKA (token, video siap, perlu ditinjau)
 * dan daftar kampanye. Isi kampanye adalah video, tapi videonya sendiri tidak
 * pernah kelihatan tanpa masuk dua halaman lagi — padahal itu satu-satunya
 * hal yang benar-benar dibeli brand. */
export async function pgListRecentVideos(orgId: string, limit = 6): Promise<RecentVideo[]> {
  const pool = getPool(url());
  try {
    const res = await pool.query<RecentVideo>(
      `SELECT j.id AS job_id, p.name AS product_name, o.video_url AS video_key, o.caption, j.created_at, j.format
       FROM jobs j
       JOIN products p ON p.id = j.product_id
       JOIN outputs o ON o.job_id = j.id
       WHERE j.org_id = $1 AND j.state = 'READY' AND o.video_url IS NOT NULL
       ORDER BY j.created_at DESC LIMIT $2`,
      [orgId, limit]
    );
    return res.rows;
  } finally {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }
}

export interface OrgVideoStats {
  total: number;
  ready: number;
  awaiting_review: number;
  spent_idr: number;
}

/** Ringkasan video org untuk kartu di Beranda & Profil. Dihitung langsung
 * dari `jobs` — tidak ada tabel agregat, dan pada skala pilot (ratusan baris
 * per org) satu COUNT jauh lebih murah daripada menjaga penghitung tersendiri
 * yang bisa melenceng. */
export async function pgGetOrgVideoStats(orgId: string): Promise<OrgVideoStats> {
  const pool = getPool(url());
  try {
    const res = await pool.query<{ total: string; ready: string; awaiting_review: string; spent_idr: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE state='READY')::text AS ready,
              COUNT(*) FILTER (WHERE state='AWAITING_APPROVAL')::text AS awaiting_review,
              -- Job yang GAGAL/REFUNDED tidak dihitung: tokennya sudah
              -- dikembalikan otomatis ke saldo org, jadi bagi brand render itu
              -- TIDAK memakan token sama sekali. cost_actual_idr sendiri terus
              -- bertambah selama pipeline berjalan (lihat addCost), jadi job
              -- yang gagal di tengah jalan tetap menyimpan angka bukan nol —
              -- menjumlahkannya membuat "token terpakai" lebih besar daripada
              -- yang benar-benar hilang dari saldo.
              COALESCE(SUM(cost_actual_idr) FILTER (WHERE state NOT IN ('FAILED','REFUNDED')),0)::text AS spent_idr
       FROM jobs WHERE org_id=$1`,
      [orgId]
    );
    const r = res.rows[0];
    return {
      total: Number(r?.total ?? 0),
      ready: Number(r?.ready ?? 0),
      awaiting_review: Number(r?.awaiting_review ?? 0),
      spent_idr: Number(r?.spent_idr ?? 0),
    };
  } finally {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }
}

export interface OrgMemberRow {
  user_id: string;
  role: "owner" | "member";
  email: string | null;
  phone: string | null;
  name: string | null;
  created_at: string;
}

export async function pgListOrgMembers(orgId: string): Promise<OrgMemberRow[]> {
  const pool = getPool(url());
  try {
    return (
      await pool.query<OrgMemberRow>(
        `SELECT m.user_id, m.role, u.email, u.phone, u.name, m.created_at
         FROM org_members m JOIN users u ON u.id = m.user_id
         WHERE m.org_id = $1 ORDER BY (m.role = 'owner') DESC, m.created_at ASC`,
        [orgId]
      )
    ).rows;
  } finally {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }
}

/** Tambahkan anggota lewat email.
 *
 * Kalau emailnya belum pernah login, barisnya dibuat SEKARANG supaya undangan
 * langsung berlaku — begitu orang itu masuk dengan email tersebut (OTP atau
 * Google), dia sudah menjadi anggota. Alternatifnya adalah tabel undangan
 * tertunda dengan token dan kedaluwarsa; itu berlebihan selama satu-satunya
 * cara masuk memang lewat email yang sama.
 *
 * Mengembalikan "exists" kalau orangnya sudah anggota — pemanggil boleh
 * menganggapnya sukses, bukan error, supaya menekan tombol dua kali tidak
 * memunculkan pesan merah yang membingungkan.
 */
export async function pgAddOrgMemberByEmail(
  orgId: string,
  email: string
): Promise<{ status: "added" | "exists"; userId: string }> {
  const pool = getPool(url());
  try {
    const found = await pool.query<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
    let userId = found.rows[0]?.id ?? null;
    if (!userId) {
      userId = crypto.randomUUID();
      await pool.query(
        "INSERT INTO users (id, email, tier, locale, created_at) VALUES ($1,$2,'free','id',$3)",
        [userId, email, new Date().toISOString()]
      );
    }
    const already = await pool.query("SELECT 1 FROM org_members WHERE org_id=$1 AND user_id=$2", [orgId, userId]);
    if (already.rowCount) return { status: "exists", userId };
    await pool.query(
      "INSERT INTO org_members (id, org_id, user_id, role, created_at) VALUES ($1,$2,$3,'member',$4)",
      [crypto.randomUUID(), orgId, userId, new Date().toISOString()]
    );
    return { status: "added", userId };
  } finally {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }
}

/** Keluarkan anggota. Pemilik TIDAK bisa dikeluarkan lewat jalur ini —
 * organisasi tanpa pemilik tidak punya siapa pun yang berhak mengundang lagi,
 * dan itu hanya bisa diperbaiki lewat akses database. */
export async function pgRemoveOrgMember(orgId: string, userId: string): Promise<boolean> {
  const pool = getPool(url());
  try {
    const res = await pool.query("DELETE FROM org_members WHERE org_id=$1 AND user_id=$2 AND role <> 'owner'", [orgId, userId]);
    return (res.rowCount ?? 0) > 0;
  } finally {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }
}

/** Simpan hasil onboarding sekaligus menandainya selesai.
 *
 * Nama org ikut diperbarui karena brand sering didaftarkan tim kami dengan
 * nama sementara ("Toko Bu Ani") sebelum pemiliknya sendiri masuk. Nama kosong
 * diabaikan, BUKAN ditimpa jadi kosong — organisasi tanpa nama tidak bisa
 * dikenali di mana pun di dashboard.
 */
export async function pgSaveOnboarding(orgId: string, input: {
  name?: string | null;
  websiteUrl?: string | null;
  businessType?: string | null;
  category?: string | null;
  audience?: string | null;
  elevatorPitch?: string | null;
}): Promise<void> {
  const pool = getPool(url());
  try {
    // Dua pernyataan, bukan satu, DENGAN SENGAJA.
    //
    // Kolom profil sudah ada sejak migrasi 0014; onboarded_at baru ada di
    // 0018. Kalau keduanya digabung dan 0018 belum diterapkan, seluruh
    // penyimpanan gagal dan brand mentok di langkah terakhir tanpa jalan
    // keluar — persis yang menimpa Brian di produksi 2026-08-11. Memisahkannya
    // berarti jawaban yang sudah dia isi TETAP tersimpan; yang hilang hanya
    // penandanya, dan itu cuma berarti perkenalannya muncul sekali lagi.
    await pool.query(
      `UPDATE organizations SET
         name = COALESCE(NULLIF($2, ''), name),
         website_url = COALESCE(NULLIF($3, ''), website_url),
         business_type = COALESCE(NULLIF($4, ''), business_type),
         category = COALESCE(NULLIF($5, ''), category),
         audience = COALESCE(NULLIF($6, ''), audience),
         elevator_pitch = COALESCE(NULLIF($7, ''), elevator_pitch)
       WHERE id = $1`,
      [orgId, input.name ?? "", input.websiteUrl ?? "", input.businessType ?? "",
       input.category ?? "", input.audience ?? "", input.elevatorPitch ?? ""]
    );
    try {
      await pool.query("UPDATE organizations SET onboarded_at = $2 WHERE id = $1",
        [orgId, new Date().toISOString()]);
    } catch (err) {
      // 42703 = undefined_column. Hanya itu yang boleh dimaafkan di sini —
      // kegagalan lain (koneksi putus, hak akses) tetap dilempar.
      if ((err as { code?: string }).code !== "42703") throw err;
      console.error("[onboarding] kolom onboarded_at belum ada — migrasi 0018 belum diterapkan");
    }
  } finally {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }
}
