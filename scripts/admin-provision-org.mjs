/**
 * Production-only organization provisioning — creates an `organizations`
 * row + one `org_members` row (role 'owner') for a pilot brand. Deliberately
 * a local CLI script (like migrate-postgres-production.mjs,
 * admin-grant-bonus-credit.mjs), not an HTTP route: no admin auth/role
 * system exists yet in this codebase, so exposing this over HTTP would be
 * a real "create yourself an org" exploit surface.
 *
 * The owner's TARGET_EMAIL must already exist in `users` — i.e. they've
 * logged in at least once via the normal email-OTP or Google flow. This
 * script never creates a user account, only attaches an existing one to a
 * new org, matching the "one user system, two login paths, now also
 * org-attachable" design (F-ENT-01 plan).
 *
 * Usage:
 *   RACUN_DEPLOY_ENV=production RACUN_ADMIN_GRANT_CONFIRM=APPLY_ADMIN_GRANT \
 *   DATABASE_URL=... ORG_NAME="Contoh Brand" ORG_SLUG=contoh-brand \
 *   OWNER_EMAIL=owner@contohbrand.com \
 *   node scripts/admin-provision-org.mjs
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

if (process.env.RACUN_DEPLOY_ENV !== "production") {
  throw new Error("Provisioning ditolak: RACUN_DEPLOY_ENV harus bernilai production.");
}
if (process.env.RACUN_ADMIN_GRANT_CONFIRM !== "APPLY_ADMIN_GRANT") {
  throw new Error("Provisioning ditolak: butuh RACUN_ADMIN_GRANT_CONFIRM=APPLY_ADMIN_GRANT eksplisit.");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error("Provisioning memerlukan DATABASE_URL PostgreSQL.");
}
const orgName = process.env.ORG_NAME;
if (!orgName) throw new Error("ORG_NAME wajib diisi.");
const orgSlug = process.env.ORG_SLUG;
if (!orgSlug || !/^[a-z0-9-]+$/.test(orgSlug)) throw new Error("ORG_SLUG wajib diisi, huruf kecil/angka/strip saja.");
const ownerEmail = process.env.OWNER_EMAIL;
if (!ownerEmail) throw new Error("OWNER_EMAIL wajib diisi.");

const uuid = () => randomUUID();

const pool = new Pool({ connectionString: databaseUrl });
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userRes = await client.query("SELECT id, email FROM users WHERE email = $1 FOR UPDATE", [ownerEmail]);
    const owner = userRes.rows[0];
    if (!owner) {
      throw new Error(`User dengan email ${ownerEmail} tidak ditemukan — owner harus login (OTP/Google) minimal sekali dulu sebelum di-provision.`);
    }

    const existingOrg = await client.query("SELECT id FROM organizations WHERE slug = $1", [orgSlug]);
    if (existingOrg.rows[0]) {
      throw new Error(`ORG_SLUG "${orgSlug}" sudah dipakai (org_id=${existingOrg.rows[0].id}). Pilih slug lain atau pakai admin-grant-org-credit.mjs kalau org-nya memang sudah ada.`);
    }

    const now = new Date().toISOString();
    const orgId = uuid();
    await client.query(
      "INSERT INTO organizations (id, name, slug, status, created_at) VALUES ($1,$2,$3,'active',$4)",
      [orgId, orgName, orgSlug, now]
    );
    const memberId = uuid();
    await client.query(
      "INSERT INTO org_members (id, org_id, user_id, role, created_at) VALUES ($1,$2,$3,'owner',$4)",
      [memberId, orgId, owner.id, now]
    );
    await client.query(
      "INSERT INTO audit_log (id, actor, action, entity, entity_id, meta, created_at) VALUES ($1,$2,'org.provision','organizations',$3,$4,$5)",
      [uuid(), "admin:brian-cli", orgId, JSON.stringify({ name: orgName, slug: orgSlug, owner_email: ownerEmail, owner_user_id: owner.id }), now]
    );

    await client.query("COMMIT");
    console.log(JSON.stringify({ status: "PROVISIONED", org_id: orgId, org_slug: orgSlug, owner_user_id: owner.id, owner_email: owner.email }));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
