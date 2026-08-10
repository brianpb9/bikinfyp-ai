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
