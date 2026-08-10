/**
 * Production-only manual credit grant — for the founder's own account only,
 * never a general-purpose "add credits" backdoor. Deliberately a local CLI
 * script (like migrate-postgres-production.mjs), not an HTTP route: no admin
 * auth/role system exists yet in this codebase, so exposing this over HTTP
 * would be a real free-credits exploit surface.
 *
 * Uses credit_ledger's existing `bonus` type (already in the CHECK
 * constraint alongside topup/hold/capture/release) — a goodwill/manual
 * grant is a real, distinct thing from a `topup` (which implies a real
 * payments row), not a fabricated payment. Writes an audit_log row too.
 *
 * Sets the account's balance to an exact target (not a relative add) by
 * computing the delta needed, since credit_ledger is append-only.
 *
 * Usage:
 *   RACUN_DEPLOY_ENV=production RACUN_ADMIN_GRANT_CONFIRM=APPLY_ADMIN_GRANT \
 *   DATABASE_URL=... TARGET_EMAIL=brianpb9@gmail.com TARGET_BALANCE_IDR=1000000 \
 *   node scripts/admin-grant-bonus-credit.mjs
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
const targetEmail = process.env.TARGET_EMAIL;
if (!targetEmail) throw new Error("TARGET_EMAIL wajib diisi.");
const targetBalance = Number(process.env.TARGET_BALANCE_IDR);
if (!Number.isFinite(targetBalance) || targetBalance < 0) {
  throw new Error("TARGET_BALANCE_IDR wajib angka >= 0.");
}

function uuid() {
  return randomUUID();
}

const pool = new Pool({ connectionString: databaseUrl });
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userRes = await client.query("SELECT id, email, phone FROM users WHERE email = $1 FOR UPDATE", [targetEmail]);
    const user = userRes.rows[0];
    if (!user) throw new Error(`User dengan email ${targetEmail} tidak ditemukan.`);

    const balRes = await client.query("SELECT COALESCE(SUM(delta),0) AS balance FROM credit_ledger WHERE user_id = $1", [user.id]);
    const currentBalance = Number(balRes.rows[0].balance);
    const delta = targetBalance - currentBalance;

    if (delta === 0) {
      console.log(JSON.stringify({ status: "NOOP", user_id: user.id, email: user.email, balance: currentBalance }));
      await client.query("ROLLBACK");
    } else {
      const now = new Date().toISOString();
      await client.query(
        "INSERT INTO credit_ledger (id, user_id, delta, type, job_id, payment_id, created_at) VALUES ($1,$2,$3,'bonus',NULL,NULL,$4)",
        [uuid(), user.id, delta, now]
      );
      await client.query(
        "INSERT INTO audit_log (id, actor, action, entity, entity_id, meta, created_at) VALUES ($1,$2,'credit.admin_grant','users',$3,$4,$5)",
        [uuid(), "admin:brian-cli", user.id, JSON.stringify({ delta_idr: delta, from_balance_idr: currentBalance, to_balance_idr: targetBalance, reason: "manual balance set requested in chat 2026-08-11" }), now]
      );
      await client.query("COMMIT");
      console.log(JSON.stringify({ status: "GRANTED", user_id: user.id, email: user.email, delta_idr: delta, new_balance_idr: targetBalance }));
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
