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
  status: "pending" | "active" | "suspended";
  created_at: string;
  website_url: string | null;
  business_type: string | null;
  category: string | null;
  audience: string | null;
  elevator_pitch: string | null;
  /** Kategori dalam kosakata internal (bestFor di lib/templates.ts). Kunci
   *  untuk menghitung "Pendekatan konten"; null untuk org yang profilnya
   *  dianalisa sebelum kolom ini ada. */
  product_category: string | null;
}

export interface OrgMembership {
  org_id: string;
  org_name: string;
  org_slug: string;
  org_status: "pending" | "active" | "suspended";
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

export function getOrgById(orgId: string): Organization | undefined {
  return getDb().prepare("SELECT * FROM organizations WHERE id = ?").get(orgId) as Organization | undefined;
}

/** Hasil "analisa bisnis" (M7) — org tanpa profil tetap valid, ini murni tambahan. */
export function updateOrgProfile(orgId: string, profile: {
  websiteUrl: string; businessType: string; category: string; audience: string; elevatorPitch: string;
  productCategory?: string;
}): void {
  getDb()
    .prepare("UPDATE organizations SET website_url=?, business_type=?, category=?, audience=?, elevator_pitch=?, product_category=? WHERE id=?")
    .run(profile.websiteUrl, profile.businessType, profile.category, profile.audience, profile.elevatorPitch, profile.productCategory ?? null, orgId);
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
