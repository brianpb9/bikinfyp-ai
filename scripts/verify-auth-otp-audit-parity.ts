import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type Snapshot = {
  signup: { normalizedEmail: string | null; sameUser: boolean; balance: number; signupAudits: number };
  otp: { canRequestBefore: boolean; canRequestAfterThree: boolean; wrong: unknown; right: unknown; locked: unknown; afterLock: unknown; storedHashOnly: boolean };
  audit: { appended: number };
};

const mode = process.argv[2];
if (mode !== "sqlite" && mode !== "postgres") throw new Error("Gunakan sqlite atau postgres.");
const authSecret = "checkpoint-1c-parity-secret";
const baseTime = new Date("2026-08-01T12:00:00.000Z");
const options = { authSecret, otpExpiryMin: 5, otpMaxAttempts: 5, otpRateLimitPer15Min: 3 };

function emit(snapshot: Snapshot) {
  process.stdout.write(`${JSON.stringify(snapshot)}\n`);
}

if (mode === "sqlite") {
  const dbPath = process.env.DB_PATH;
  assert.ok(dbPath, "DB_PATH sementara wajib untuk parity SQLite");
  fs.rmSync(dbPath, { force: true });
  process.env.RACUN_NO_DOTENV = "1";
  process.env.AUTH_SECRET = authSecret;
  const { getDb } = await import("../lib/db");
  const { findOrCreateUserByEmail } = await import("../lib/auth");
  const { canRequestOtp, storeOtp, verifyOtp } = await import("../lib/otp");
  const db = getDb();
  const user = findOrCreateUserByEmail("Baru@Contoh.test");
  const again = findOrCreateUserByEmail("baru@contoh.test");
  const balance = (db.prepare("SELECT COALESCE(SUM(delta),0) AS value FROM credit_ledger WHERE user_id = ?").get(user.id) as { value: number }).value;
  const signupAudits = (db.prepare("SELECT COUNT(*) AS value FROM audit_log WHERE actor = ? AND action IN ('user.signup_bonus','user.created')").get(user.id) as { value: number }).value;
  const email = "otp@contoh.test";
  const canRequestBefore = canRequestOtp(email);
  storeOtp(email, "123456");
  const wrong = verifyOtp(email, "000000");
  const right = verifyOtp(email, "123456");
  const lockEmail = "lock@contoh.test";
  storeOtp(lockEmail, "654321");
  let locked: unknown;
  for (let i = 0; i < 5; i++) locked = verifyOtp(lockEmail, "000000");
  const afterLock = verifyOtp(lockEmail, "654321");
  const rateEmail = "rate@contoh.test";
  for (let i = 0; i < 3; i++) storeOtp(rateEmail, `11111${i}`);
  const canRequestAfterThree = canRequestOtp(rateEmail);
  const stored = db.prepare("SELECT code_hash FROM otp_codes WHERE email = ? LIMIT 1").get(email) as { code_hash: string };
  db.prepare("INSERT INTO audit_log (id, actor, action, entity, entity_id, meta, created_at) VALUES (?,?,?,?,?,?,?)")
    .run("manual-audit", user.id, "parity.append", "users", user.id, JSON.stringify({ source: "sqlite" }), baseTime.toISOString());
  const appended = (db.prepare("SELECT COUNT(*) AS value FROM audit_log WHERE action = 'parity.append'").get() as { value: number }).value;
  emit({ signup: { normalizedEmail: user.email, sameUser: user.id === again.id, balance, signupAudits }, otp: { canRequestBefore, canRequestAfterThree, wrong, right, locked, afterLock, storedHashOnly: /^[a-f0-9]{64}$/.test(stored.code_hash) }, audit: { appended } });
} else {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL database disposable wajib untuk parity PostgreSQL");
  const { PgAuthOtpAuditRepository } = await import("../lib/postgres/auth-otp-audit");
  const repo = new PgAuthOtpAuditRepository(databaseUrl, options);
  try {
    const user = await repo.findOrCreateUserByEmail("Baru@Contoh.test");
    const again = await repo.findOrCreateUserByEmail("baru@contoh.test");
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: databaseUrl });
    const balance = Number((await pool.query<{ value: string }>("SELECT COALESCE(SUM(delta),0) AS value FROM credit_ledger WHERE user_id = $1", [user.id])).rows[0].value);
    const signupAudits = Number((await pool.query<{ value: string }>("SELECT COUNT(*) AS value FROM audit_log WHERE actor = $1 AND action IN ('user.signup_bonus','user.created')", [user.id])).rows[0].value);
    const concurrentUsers = await Promise.all(Array.from({ length: 4 }, () => repo.findOrCreateUserByEmail("race-signup@contoh.test")));
    assert.equal(new Set(concurrentUsers.map((candidate) => candidate.id)).size, 1, "signup paralel harus mengembalikan satu user");
    const raceSignupLedger = Number((await pool.query<{ value: string }>(
      "SELECT COUNT(*) AS value FROM credit_ledger WHERE user_id = $1 AND type = 'bonus'",
      [concurrentUsers[0].id]
    )).rows[0].value);
    assert.equal(raceSignupLedger, 1, "signup paralel tidak boleh menggandakan bonus");
    const email = "otp@contoh.test";
    const canRequestBefore = await repo.canRequestOtp(email, baseTime);
    await repo.storeOtp(email, "123456", baseTime);
    const wrong = await repo.verifyOtp(email, "000000", baseTime);
    const right = await repo.verifyOtp(email, "123456", baseTime);
    const lockEmail = "lock@contoh.test";
    await repo.storeOtp(lockEmail, "654321", baseTime);
    let locked: unknown;
    for (let i = 0; i < 5; i++) locked = await repo.verifyOtp(lockEmail, "000000", baseTime);
    const afterLock = await repo.verifyOtp(lockEmail, "654321", baseTime);
    const rateEmail = "rate@contoh.test";
    for (let i = 0; i < 3; i++) await repo.storeOtp(rateEmail, `11111${i}`, baseTime);
    const canRequestAfterThree = await repo.canRequestOtp(rateEmail, baseTime);
    // This is PostgreSQL-specific proof of the FOR UPDATE guard: eight
    // simultaneous wrong guesses may never increment beyond the five-attempt
    // cap. SQLite parity above proves the user-visible sequential semantics.
    const raceEmail = "race@contoh.test";
    await repo.storeOtp(raceEmail, "999999", baseTime);
    await Promise.all(Array.from({ length: 8 }, () => repo.verifyOtp(raceEmail, "000000", baseTime)));
    const raceAttempts = Number((await pool.query<{ attempts: number }>(
      "SELECT attempts FROM otp_codes WHERE email = $1 ORDER BY created_at DESC, id DESC LIMIT 1",
      [raceEmail]
    )).rows[0].attempts);
    assert.equal(raceAttempts, 5, "FOR UPDATE harus membatasi race OTP ke lima attempts");
    const stored = await pool.query<{ code_hash: string }>("SELECT code_hash FROM otp_codes WHERE email = $1 LIMIT 1", [email]);
    await repo.appendAudit(user.id, "parity.append", "users", user.id, { source: "postgres" });
    const appended = Number((await pool.query<{ value: string }>("SELECT COUNT(*) AS value FROM audit_log WHERE action = 'parity.append'")).rows[0].value);
    await pool.end();
    emit({ signup: { normalizedEmail: user.email, sameUser: user.id === again.id, balance, signupAudits }, otp: { canRequestBefore, canRequestAfterThree, wrong, right, locked, afterLock, storedHashOnly: /^[a-f0-9]{64}$/.test(stored.rows[0].code_hash) }, audit: { appended } });
  } finally {
    await repo.close();
  }
}
