/**
 * Production-only manual ORG credit grant — literal generalization of
 * admin-grant-bonus-credit.mjs (per-user) to an organization's pooled
 * wallet. Deliberately a local CLI script, not an HTTP route: no admin
 * auth/role system exists yet, so exposing this over HTTP would be a real
 * free-credits exploit surface. Enterprise MVP explicitly has no self-serve
 * subscription billing (F-ENT-01 plan) — this script IS the billing system
 * for now, same as it is for the founder's own retail account.
 *
 * Uses credit_ledger's existing `bonus` type. Writes user_id = the org's
 * `owner` member (credit_ledger.user_id stays NOT NULL — it's always the
 * audit trail of who the grant is attributed to) and org_id = the pooled
 * wallet. Sets the org's balance to an exact target (not a relative add) by
 * computing the delta needed, since credit_ledger is append-only.
 *
 * Usage:
 *   RACUN_DEPLOY_ENV=production RACUN_ADMIN_GRANT_CONFIRM=APPLY_ADMIN_GRANT \
 *   DATABASE_URL=... TARGET_ORG_SLUG=contoh-brand TARGET_BALANCE_IDR=5000000 \
 *   node scripts/admin-grant-org-credit.mjs
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

if (process.env.RACUN_DEPLOY_ENV !== "production") {
  throw new Error("Grant ditolak: RACUN_DEPLOY_ENV harus bernilai production.");
}
if (process.env.RACUN_ADMIN_GRANT_CONFIRM !== "APPLY_ADMIN_GRANT") {
  throw new Error("Grant ditolak: butuh RACUN_ADMIN_GRANT_CONFIRM=APPLY_ADMIN_GRANT eksplisit.");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error("Grant memerlukan DATABASE_URL PostgreSQL.");
}
const targetOrgSlug = process.env.TARGET_ORG_SLUG;
if (!targetOrgSlug) throw new Error("TARGET_ORG_SLUG wajib diisi.");
const targetBalance = Number(process.env.TARGET_BALANCE_IDR);
if (!Number.isFinite(targetBalance) || targetBalance < 0) {
  throw new Error("TARGET_BALANCE_IDR wajib angka >= 0.");
}

const uuid = () => randomUUID();

const pool = new Pool({ connectionString: databaseUrl });
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orgRes = await client.query("SELECT id, name, slug FROM organizations WHERE slug = $1 FOR UPDATE", [targetOrgSlug]);
    const org = orgRes.rows[0];
    if (!org) throw new Error(`Organisasi dengan slug "${targetOrgSlug}" tidak ditemukan.`);

    const ownerRes = await client.query("SELECT user_id FROM org_members WHERE org_id = $1 AND role = 'owner' ORDER BY created_at ASC LIMIT 1", [org.id]);
    const owner = ownerRes.rows[0];
    if (!owner) throw new Error(`Organisasi "${targetOrgSlug}" belum punya owner member — provision dulu lewat admin-provision-org.mjs.`);

    const balRes = await client.query("SELECT COALESCE(SUM(delta),0) AS balance FROM credit_ledger WHERE org_id = $1", [org.id]);
    const currentBalance = Number(balRes.rows[0].balance);
    const delta = targetBalance - currentBalance;

    if (delta === 0) {
      console.log(JSON.stringify({ status: "NOOP", org_id: org.id, org_slug: org.slug, balance: currentBalance }));
      await client.query("ROLLBACK");
    } else {
      const now = new Date().toISOString();
      await client.query(
        "INSERT INTO credit_ledger (id, user_id, org_id, delta, type, job_id, payment_id, created_at) VALUES ($1,$2,$3,$4,'bonus',NULL,NULL,$5)",
        [uuid(), owner.user_id, org.id, delta, now]
      );
      await client.query(
        "INSERT INTO audit_log (id, actor, action, entity, entity_id, meta, created_at) VALUES ($1,$2,'credit.org_admin_grant','organizations',$3,$4,$5)",
        [uuid(), "admin:brian-cli", org.id, JSON.stringify({ delta_idr: delta, from_balance_idr: currentBalance, to_balance_idr: targetBalance, attributed_owner_user_id: owner.user_id }), now]
      );
      await client.query("COMMIT");
      console.log(JSON.stringify({ status: "GRANTED", org_id: org.id, org_slug: org.slug, delta_idr: delta, new_balance_idr: targetBalance }));
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
