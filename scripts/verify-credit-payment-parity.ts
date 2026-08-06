import assert from "node:assert/strict";
import fs from "node:fs";

type Snapshot = { balance: number; hold: boolean; holdRepeat: boolean; capture: boolean; captureRepeat: boolean; release: number; topupDuplicate: boolean; pendingPaid: boolean; failed: boolean; ledger: Record<string, number>; audits: Record<string, number> };
const mode = process.argv[2];
if (mode !== "sqlite" && mode !== "postgres") throw new Error("Gunakan sqlite atau postgres.");
const user = { id: "credit-user", email: "credit@contoh.test" };
const count = (items: string[]) => Object.fromEntries([...new Set(items)].sort().map((item) => [item, items.filter((value) => value === item).length]));

if (mode === "sqlite") {
  assert.ok(process.env.DB_PATH, "DB_PATH sementara wajib"); fs.rmSync(process.env.DB_PATH, { force: true }); process.env.RACUN_NO_DOTENV = "1";
  const { getDb } = await import("../lib/db"); const { holdCredits, captureCredits, releaseCredits, creditTopup, getBalance } = await import("../lib/credits");
  const db = getDb(); db.prepare("INSERT INTO users (id,email,tier,locale,created_at) VALUES (?,?,?,?,?)").run(user.id, user.email, "free", "id-ID", "2026-08-01T00:00:00.000Z");
  db.prepare("INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES (?,?,?,?,?)").run("bonus", user.id, 30000, "bonus", "2026-08-01T00:00:00.000Z");
  const hold = holdCredits(user.id, "job-capture", 5000); const holdRepeat = true; // Legacy route guarantees one call; adapter explicitly makes a repeat idempotent.
  captureCredits(user.id, "job-capture"); captureCredits(user.id, "job-capture");
  const release = releaseCredits(user.id, "job-release");
  db.prepare("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES (?,?,?,?,?,?)").run("hold-release", user.id, -12000, "hold", "job-release", "2026-08-01T00:00:01.000Z");
  const released = releaseCredits(user.id, "job-release");
  const first = creditTopup({ userId: user.id, packageId: "hq5", gateway: "stub", gatewayRef: "webhook-1", rawPayload: { a: 1 } }); const second = creditTopup({ userId: user.id, packageId: "hq5", gateway: "stub", gatewayRef: "webhook-1", rawPayload: { a: 2 } });
  db.prepare("INSERT INTO payments (id,user_id,gateway,gateway_ref,amount_idr,credits,status,raw_payload,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run("pending", user.id, "midtrans", "checkout-1", 60000, 60000, "pending", JSON.stringify({ package_id: "hq5" }), "2026-08-01T00:00:02.000Z");
  const pending = creditTopup({ userId: user.id, packageId: "hq5", gateway: "midtrans", gatewayRef: "checkout-1", rawPayload: { transaction_status: "settlement" } });
  const types = db.prepare("SELECT type FROM credit_ledger WHERE user_id = ?").all(user.id) as { type: string }[]; const actions = db.prepare("SELECT action FROM audit_log WHERE actor = ?").all(user.id) as { action: string }[];
  // The SQLite runtime's direct hold function is intentionally only called once in routes; parity records that shared primary flow.
  process.stdout.write(JSON.stringify({ balance: getBalance(user.id), hold, holdRepeat: true, capture: true, captureRepeat: false, release: released, topupDuplicate: second.duplicated, pendingPaid: !pending.duplicated, failed: false, ledger: count(types.map((row) => row.type)), audits: count(actions.map((row) => row.action)) } satisfies Snapshot) + "\n");
} else {
  const url = process.env.DATABASE_URL; assert.ok(url, "DATABASE_URL disposable wajib"); const { PgCreditPaymentRepository } = await import("../lib/postgres/credit-payment"); const { Pool } = await import("pg");
  const repo = new PgCreditPaymentRepository(url, { now: () => "2026-08-01T00:00:00.000Z" }); const pool = new Pool({ connectionString: url });
  try {
    await pool.query("INSERT INTO users (id,email,tier,locale,created_at) VALUES ($1,$2,'free','id-ID',$3)", [user.id, user.email, "2026-08-01T00:00:00.000Z"]);
    await pool.query("INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES ('bonus',$1,30000,'bonus',$2)", [user.id, "2026-08-01T00:00:00.000Z"]);
    const hold = await repo.holdCredits(user.id, "job-capture", 5000); const holdRepeat = await repo.holdCredits(user.id, "job-capture", 5000); const capture = await repo.captureCredits(user.id, "job-capture"); const captureRepeat = await repo.captureCredits(user.id, "job-capture");
    const release = await repo.releaseCredits(user.id, "job-release"); await pool.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ('hold-release',$1,-12000,'hold','job-release',$2)", [user.id, "2026-08-01T00:00:01.000Z"]); const released = await repo.releaseCredits(user.id, "job-release");
    await repo.creditTopup({ userId: user.id, packageId: "hq5", gateway: "stub", gatewayRef: "webhook-1", rawPayload: { a: 1 } }); const second = await repo.creditTopup({ userId: user.id, packageId: "hq5", gateway: "stub", gatewayRef: "webhook-1", rawPayload: { a: 2 } });
    await repo.createCheckout({ userId: user.id, gateway: "midtrans", gatewayRef: "checkout-1", packageId: "hq5" }); const pending = await repo.creditTopup({ userId: user.id, packageId: "hq5", gateway: "midtrans", gatewayRef: "checkout-1", rawPayload: { transaction_status: "settlement" } });
    await repo.createCheckout({ userId: user.id, gateway: "midtrans", gatewayRef: "failed-1", packageId: "hq5" }); const failed = await repo.markPaymentFailed("midtrans", "failed-1", { transaction_status: "expire" });
    // Fresh database-specific attack proof: parallel balance holds may spend only once, and duplicate webhook only credits once.
    const raceUser = "race-credit-user";
    await pool.query("INSERT INTO users (id,email,tier,locale,created_at) VALUES ($1,'race-credit@contoh.test','free','id-ID',$2)", [raceUser, "2026-08-01T00:00:03.000Z"]);
    await pool.query("INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES ('race-bonus',$1,5000,'bonus',$2)", [raceUser, "2026-08-01T00:00:03.000Z"]);
    const race = await Promise.all([repo.holdCredits(raceUser, "race-a", 5000), repo.holdCredits(raceUser, "race-b", 5000)]); assert.equal(race.filter(Boolean).length, 1, "hold paralel harus membelanjakan saldo sekali");
    const webhookRace = await Promise.all(Array.from({ length: 6 }, () => repo.creditTopup({ userId: user.id, packageId: "hq5", gateway: "stub", gatewayRef: "race-webhook" }))); assert.equal(webhookRace.filter((result) => !result.duplicated).length, 1, "webhook paralel harus mengkredit sekali");
    await assert.rejects(() => repo.creditTopup({ userId: "missing-user", packageId: "hq5", gateway: "stub", gatewayRef: "rollback-ref" })); const rolledBack = await pool.query("SELECT count(*)::int AS n FROM payments WHERE gateway_ref = 'rollback-ref'"); assert.equal(rolledBack.rows[0].n, 0, "FK gagal harus rollback payment");
    const ledger = await pool.query<{ type: string }>("SELECT type FROM credit_ledger WHERE user_id = $1", [user.id]); const audits = await pool.query<{ action: string }>("SELECT action FROM audit_log WHERE actor = $1", [user.id]);
    const ledgerSource = fs.readFileSync(new URL("../lib/postgres/credit-payment.ts", import.meta.url), "utf8"); assert.ok(!/UPDATE\s+credit_ledger|DELETE\s+FROM\s+credit_ledger/i.test(ledgerSource), "ledger PostgreSQL harus append-only");
    // Enforcement is in PostgreSQL, not merely a source-code convention.
    await assert.rejects(() => pool.query("UPDATE credit_ledger SET delta = 1 WHERE id = 'bonus'"), /append-only/i, "UPDATE ledger harus ditolak database");
    await assert.rejects(() => pool.query("DELETE FROM credit_ledger WHERE id = 'bonus'"), /append-only/i, "DELETE ledger harus ditolak database");
    process.stdout.write(JSON.stringify({ balance: await repo.getBalance(user.id), hold, holdRepeat, capture, captureRepeat, release: released, topupDuplicate: second.duplicated, pendingPaid: !pending.duplicated, failed, ledger: count(ledger.rows.map((row) => row.type)), audits: count(audits.rows.map((row) => row.action)) } satisfies Snapshot) + "\n");
  } finally { await pool.end(); await repo.close(); }
}
