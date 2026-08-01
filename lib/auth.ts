import { SignJWT, jwtVerify } from "jose";
import { config } from "./config";
import { getDb, now, uuid, audit, type UserRow } from "./db";
import { postgresRuntimeEnabled, smokeFindOrCreateUser, smokeGetUser } from "./postgres/smoke-runtime";

// Auth dev: login via nomor HP (OTP stub — tidak ada OTP sungguhan di MVP).
// Token = JWT HS256 (via jose), disimpan di httpOnly cookie.

const COOKIE_NAME = "racun_token";
const secret = () => new TextEncoder().encode(config.authSecret);

export async function issueToken(userId: string, phone: string): Promise<string> {
  return new SignJWT({ phone })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifyToken(token: string): Promise<{ userId: string; phone: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return { userId: payload.sub, phone: String(payload.phone ?? "") };
  } catch {
    return null;
  }
}

export function cookieName() {
  return COOKIE_NAME;
}

export function findOrCreateUserByPhone(phone: string): UserRow {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone) as UserRow | undefined;
  if (existing) return existing;
  const id = uuid();
  db.prepare("INSERT INTO users (id, phone, tier, locale, created_at) VALUES (?,?,?,?,?)").run(
    id, phone, "free", "id-ID", now()
  );
  // Bonus onboarding: Rp5.000 untuk pengguna baru — cukup 1 video Senyap+Teks (F-12)
  db.prepare(
    "INSERT INTO credit_ledger (id, user_id, delta, type, job_id, payment_id, created_at) VALUES (?,?,?,?,NULL,NULL,?)"
  ).run(uuid(), id, 5000, "bonus", now());
  audit(id, "user.signup_bonus", "credit_ledger", id, { delta_idr: 5000 });
  audit(id, "user.created", "users", id, { phone });
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
}

export function findOrCreateUserByEmail(email: string): UserRow {
  const db = getDb();
  const key = email.toLowerCase().trim();
  const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(key) as UserRow | undefined;
  if (existing) return existing;
  const id = uuid();
  db.prepare("INSERT INTO users (id, phone, email, tier, locale, created_at) VALUES (?,NULL,?,?,?,?)").run(
    id, key, "free", "id-ID", now()
  );
  // Bonus onboarding: Rp5.000 untuk pengguna baru — cukup 1 video Senyap+Teks (F-12)
  db.prepare(
    "INSERT INTO credit_ledger (id, user_id, delta, type, job_id, payment_id, created_at) VALUES (?,?,?,?,NULL,NULL,?)"
  ).run(uuid(), id, 5000, "bonus", now());
  audit(id, "user.signup_bonus", "credit_ledger", id, { delta_idr: 5000 });
  audit(id, "user.created", "users", id, { email: key });
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
}

/** Ambil user dari cookie request; null bila tidak valid. */
export async function getAuthUser(req: Request): Promise<UserRow | null> {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!m) return null;
  const parsed = await verifyToken(decodeURIComponent(m[1]));
  if (!parsed) return null;
  if (postgresRuntimeEnabled()) return smokeGetUser(parsed.userId);
  const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(parsed.userId) as UserRow | undefined;
  return user ?? null;
}
