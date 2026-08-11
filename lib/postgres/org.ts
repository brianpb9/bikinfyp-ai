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
import { Pool } from "pg";
import { config } from "../config";

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
  const pool = new Pool({ connectionString: url() });
  try {
    const res = await pool.query<OrgMembership>(
      `SELECT o.id AS org_id, o.name AS org_name, o.slug AS org_slug, o.status AS org_status, m.role
       FROM org_members m JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = $1 ORDER BY m.created_at ASC`,
      [userId]
    );
    return res.rows;
  } finally {
    await pool.end();
  }
}

export async function pgGetOrgBySlug(slug: string): Promise<Organization | null> {
  const pool = new Pool({ connectionString: url() });
  try {
    return (await pool.query<Organization>("SELECT * FROM organizations WHERE slug=$1", [slug])).rows[0] ?? null;
  } finally {
    await pool.end();
  }
}

export async function pgGetOrgById(orgId: string): Promise<Organization | null> {
  const pool = new Pool({ connectionString: url() });
  try {
    return (await pool.query<Organization>("SELECT * FROM organizations WHERE id=$1", [orgId])).rows[0] ?? null;
  } finally {
    await pool.end();
  }
}

/** Hasil "analisa bisnis" (M7) — org tanpa profil tetap valid, ini murni tambahan. */
export async function pgUpdateOrgProfile(orgId: string, profile: {
  websiteUrl: string; businessType: string; category: string; audience: string; elevatorPitch: string;
}): Promise<void> {
  const pool = new Pool({ connectionString: url() });
  try {
    await pool.query(
      "UPDATE organizations SET website_url=$1, business_type=$2, category=$3, audience=$4, elevator_pitch=$5 WHERE id=$6",
      [profile.websiteUrl, profile.businessType, profile.category, profile.audience, profile.elevatorPitch, orgId]
    );
  } finally {
    await pool.end();
  }
}

export async function pgGetOrgBalance(orgId: string): Promise<number> {
  const pool = new Pool({ connectionString: url() });
  try {
    const res = await pool.query<{ balance: string }>(
      "SELECT COALESCE(SUM(delta),0) AS balance FROM credit_ledger WHERE org_id=$1",
      [orgId]
    );
    return Number(res.rows[0]?.balance ?? 0);
  } finally {
    await pool.end();
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
  review_count: number;
}

/** Bulk run terbaru org ini (M4) — dikelompokkan dari jobs.bulk_run_id,
 * tidak ada tabel bulk_runs terpisah (keputusan MVP di rencana M3). */
export async function pgListRecentBulkRuns(orgId: string, limit = 5): Promise<RecentBulkRun[]> {
  const pool = new Pool({ connectionString: url() });
  try {
    const res = await pool.query<RecentBulkRun & { created_at: string }>(
      // Nama produk & thumbnail diambil lewat sub-query berkorelasi, BUKAN
      // JOIN + GROUP BY: satu kampanye selalu satu produk (model M8), jadi
      // MIN()/MAX() atas nama produk hanya akan mengaburkan maksudnya. Ini juga
      // menghindari menyeret job_shots ke dalam agregat dan menggandakan baris.
      `SELECT j.bulk_run_id, MIN(j.created_at) AS created_at, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE j.state = 'READY')::int AS ready_count,
              COUNT(*) FILTER (WHERE j.state = 'AWAITING_APPROVAL')::int AS review_count,
              (SELECT p.name FROM jobs j2 JOIN products p ON p.id = j2.product_id
                 WHERE j2.bulk_run_id = j.bulk_run_id AND j2.org_id = $1
                 ORDER BY j2.created_at ASC LIMIT 1) AS product_name,
              (SELECT sh.thumb_key FROM jobs j3 JOIN job_shots sh ON sh.job_id = j3.id
                 WHERE j3.bulk_run_id = j.bulk_run_id AND j3.org_id = $1 AND sh.thumb_key IS NOT NULL
                 ORDER BY j3.created_at ASC, sh.idx ASC LIMIT 1) AS thumb_key
       FROM jobs j WHERE j.org_id = $1 AND j.bulk_run_id IS NOT NULL
       GROUP BY j.bulk_run_id ORDER BY MIN(j.created_at) DESC LIMIT $2`,
      [orgId, limit]
    );
    return res.rows;
  } finally {
    await pool.end();
  }
}

export async function pgGetOrgLedger(orgId: string, limit = 50) {
  const pool = new Pool({ connectionString: url() });
  try {
    return (
      await pool.query(
        "SELECT * FROM credit_ledger WHERE org_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2",
        [orgId, limit]
      )
    ).rows;
  } finally {
    await pool.end();
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
  const pool = new Pool({ connectionString: url() });
  try {
    const res = await pool.query<{ total: string; ready: string; awaiting_review: string; spent_idr: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE state='READY')::text AS ready,
              COUNT(*) FILTER (WHERE state='AWAITING_APPROVAL')::text AS awaiting_review,
              COALESCE(SUM(cost_actual_idr),0)::text AS spent_idr
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
    await pool.end();
  }
}
