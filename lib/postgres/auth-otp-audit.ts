/**
 * PostgreSQL parity adapter for checkpoint 1C.
 *
 * This module is deliberately not imported by application routes yet: SQLite
 * remains the runtime primary database until every domain has passed parity.
 */
import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { config } from "../config";
import type { UserRow } from "../db";
import { getPool } from "./pool";

export interface PgAuthOtpAuditOptions {
  authSecret: string;
  otpExpiryMin: number;
  otpMaxAttempts: number;
  otpRateLimitPer15Min: number;
  now?: () => string;
  uuid?: () => string;
}

export type PgVerifyResult =
  | { ok: true }
  | { ok: false; reason: "wrong_code" | "expired" | "too_many_attempts" | "no_code"; attemptsLeft: number };

interface OtpRow {
  id: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
}

const defaultNow = () => new Date().toISOString();
const defaultUuid = () => crypto.randomUUID();
const normalizeEmail = (email: string) => email.toLowerCase().trim();

function hashCode(authSecret: string, email: string, code: string): string {
  return crypto.createHash("sha256").update(`${authSecret}:otp:${email.toLowerCase()}:${code}`).digest("hex");
}

function assertPostgresUrl(databaseUrl: string): void {
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    throw new Error("PgAuthOtpAuditRepository membutuhkan DATABASE_URL PostgreSQL.");
  }
}

export class PgAuthOtpAuditRepository {
  private readonly pool: Pool;
  private readonly now: () => string;
  private readonly uuid: () => string;

  constructor(databaseUrl: string, private readonly options: PgAuthOtpAuditOptions) {
    assertPostgresUrl(databaseUrl);
    this.pool = getPool(databaseUrl);
    this.now = options.now ?? defaultNow;
    this.uuid = options.uuid ?? defaultUuid;
  }

  async close(): Promise<void> {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }

  async findOrCreateUserByEmail(email: string): Promise<UserRow> {
    const key = normalizeEmail(email);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<UserRow>("SELECT * FROM users WHERE email = $1", [key]);
      if (existing.rowCount) {
        await client.query("COMMIT");
        return existing.rows[0];
      }
      const id = this.uuid();
      const createdAt = this.now();
      const inserted = await client.query(
        "INSERT INTO users (id, phone, email, tier, locale, created_at) VALUES ($1,NULL,$2,$3,$4,$5) ON CONFLICT (email) DO NOTHING RETURNING id",
        [id, key, "free", "id-ID", createdAt]
      );
      if (!inserted.rowCount) {
        // A concurrent signup won the email UNIQUE race. ON CONFLICT keeps
        // this transaction usable, so no duplicate bonus can be appended.
        const raced = await client.query<UserRow>("SELECT * FROM users WHERE email = $1", [key]);
        if (!raced.rowCount) throw new Error("User email conflict tanpa baris yang dapat dibaca.");
        await client.query("COMMIT");
        return raced.rows[0];
      }
      await this.insertSignupSideEffects(client, id, { email: key }, createdAt);
      const user = await client.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
      await client.query("COMMIT");
      return user.rows[0];
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async findOrCreateUserByPhone(phone: string): Promise<UserRow> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<UserRow>("SELECT * FROM users WHERE phone = $1", [phone]);
      if (existing.rowCount) {
        await client.query("COMMIT");
        return existing.rows[0];
      }
      const id = this.uuid();
      const createdAt = this.now();
      await client.query(
        "INSERT INTO users (id, phone, tier, locale, created_at) VALUES ($1,$2,$3,$4,$5)",
        [id, phone, "free", "id-ID", createdAt]
      );
      await this.insertSignupSideEffects(client, id, { phone }, createdAt);
      const user = await client.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
      await client.query("COMMIT");
      return user.rows[0];
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async appendAudit(actor: string, action: string, entity: string, entityId: string | null, meta?: unknown): Promise<void> {
    await this.pool.query(
      "INSERT INTO audit_log (id, actor, action, entity, entity_id, meta, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [this.uuid(), actor, action, entity, entityId, meta === undefined ? null : JSON.stringify(meta), this.now()]
    );
  }

  async canRequestOtp(email: string, referenceNow = new Date()): Promise<boolean> {
    const since = new Date(referenceNow.getTime() - 15 * 60_000).toISOString();
    const result = await this.pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM otp_codes WHERE email = $1 AND created_at > $2",
      [normalizeEmail(email), since]
    );
    return result.rows[0].n < this.options.otpRateLimitPer15Min;
  }

  async storeOtp(email: string, code: string, referenceNow = new Date()): Promise<void> {
    const key = normalizeEmail(email);
    const createdAt = referenceNow.toISOString();
    const expiresAt = new Date(referenceNow.getTime() + this.options.otpExpiryMin * 60_000).toISOString();
    await this.pool.query(
      "INSERT INTO otp_codes (id, email, code_hash, expires_at, attempts, created_at) VALUES ($1,$2,$3,$4,0,$5)",
      [this.uuid(), key, hashCode(this.options.authSecret, key, code), expiresAt, createdAt]
    );
  }

  /** Locks the newest OTP row so concurrent guesses cannot bypass attempt caps. */
  async verifyOtp(email: string, code: string, referenceNow = new Date()): Promise<PgVerifyResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await client.query<OtpRow>(
        "SELECT id, code_hash, expires_at, attempts FROM otp_codes WHERE email = $1 ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE",
        [normalizeEmail(email)]
      );
      const otp = row.rows[0];
      if (!otp) return await this.commitResult(client, { ok: false, reason: "no_code", attemptsLeft: 0 });
      if (otp.attempts >= this.options.otpMaxAttempts) {
        return await this.commitResult(client, { ok: false, reason: "too_many_attempts", attemptsLeft: 0 });
      }
      if (new Date(otp.expires_at).getTime() < referenceNow.getTime()) {
        return await this.commitResult(client, { ok: false, reason: "expired", attemptsLeft: 0 });
      }
      const match = otp.code_hash === hashCode(this.options.authSecret, normalizeEmail(email), code);
      await client.query("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1", [otp.id]);
      if (match) return await this.commitResult(client, { ok: true });
      const attemptsLeft = Math.max(0, this.options.otpMaxAttempts - (otp.attempts + 1));
      return await this.commitResult(client, {
        ok: false,
        reason: attemptsLeft === 0 ? "too_many_attempts" : "wrong_code",
        attemptsLeft,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async commitResult<T>(client: PoolClient, result: T): Promise<T> {
    await client.query("COMMIT");
    return result;
  }

  private async insertSignupSideEffects(client: PoolClient, userId: string, identity: { email?: string; phone?: string }, createdAt: string): Promise<void> {
    await client.query(
      "INSERT INTO credit_ledger (id, user_id, delta, type, job_id, payment_id, created_at) VALUES ($1,$2,$3,$4,NULL,NULL,$5)",
      [this.uuid(), userId, config.signupBonusIdr, "bonus", createdAt]
    );
    await this.insertAudit(client, userId, "user.signup_bonus", "credit_ledger", userId, { delta_idr: config.signupBonusIdr }, createdAt);
    await this.insertAudit(client, userId, "user.created", "users", userId, identity, createdAt);
  }

  private async insertAudit(client: PoolClient, actor: string, action: string, entity: string, entityId: string | null, meta: unknown, createdAt: string): Promise<void> {
    await client.query(
      "INSERT INTO audit_log (id, actor, action, entity, entity_id, meta, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [this.uuid(), actor, action, entity, entityId, JSON.stringify(meta), createdAt]
    );
  }
}
