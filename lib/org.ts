// Organisasi (dashboard enterprise/brand — F-ENT-01, 2026-08-11). SQLite dev
// path — pasangan Postgres di lib/postgres/org.ts (production real path,
// lihat smoke-runtime.ts). Lihat lib/schema.sql untuk skema organizations/
// org_members. role di org_members HANYA label, TIDAK PERNAH dicek untuk
// otorisasi — akses dashboard cukup "punya >=1 baris org_members" (MVP).
import { getDb } from "./db";

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
export function getUserOrgs(userId: string): OrgMembership[] {
  return getDb()
    .prepare(
      `SELECT o.id AS org_id, o.name AS org_name, o.slug AS org_slug, o.status AS org_status, m.role
       FROM org_members m JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = ? ORDER BY m.created_at ASC`
    )
    .all(userId) as OrgMembership[];
}

export function getOrgBySlug(slug: string): Organization | undefined {
  return getDb().prepare("SELECT * FROM organizations WHERE slug = ?").get(slug) as Organization | undefined;
}

export function getOrgBalance(orgId: string): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE org_id = ?")
    .get(orgId) as { balance: number };
  return row.balance;
}

export function getOrgLedger(orgId: string, limit = 50) {
  return getDb()
    .prepare("SELECT * FROM credit_ledger WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(orgId, limit);
}
