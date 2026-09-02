import { SignJWT, jwtVerify } from "jose";
import { bonusKredit } from "./kredit-video-sqlite";
import type { JenisVideo } from "./kredit-video";
import { config } from "./config";
import { getDb, now, uuid, audit, type UserRow } from "./db";
import { postgresRuntimeEnabled, smokeFindOrCreateUser, smokeGetUser } from "./postgres/smoke-runtime";

// Auth dev: login via nomor HP (OTP stub — tidak ada OTP sungguhan di MVP).
// Token = JWT HS256 (via jose), disimpan di httpOnly cookie.

const COOKIE_NAME = "racun_token";

/** MASA BERLAKU SESI — 24 jam (permintaan Brian 2026-08-12).
 *
 *  SATU SUMBU KEBENARAN. Sebelumnya angkanya ditulis ulang di EMPAT tempat:
 *  masa berlaku JWT di sini, plus Max-Age cookie di verify-otp, dev-login,
 *  dan google/callback. Nilai yang disalin empat kali akan hanyut: cukup satu
 *  yang lupa diperbarui, dan cookie hidup lebih lama daripada tokennya (atau
 *  sebaliknya) — pengguna terlihat masih login padahal setiap panggilan API
 *  ditolak, dan itu terbaca sebagai aplikasi rusak, bukan sesi habis.
 *
 *  Keduanya WAJIB memakai angka ini. */
export const SESSION_MAX_AGE_SEC = 24 * 3600;
const secret = () => new TextEncoder().encode(config.authSecret);

export async function issueToken(userId: string, phone: string): Promise<string> {
  return new SignJWT({ phone })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SEC}s`)
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
  // PAKET GRATIS pendaftar baru: satu JATAH VIDEO, bukan rupiah. Rupiah tidak
  // lagi membeli apa pun, jadi bonus rupiah hanya akan jadi angka yang tidak
  // bisa dibelanjakan — pendaftar melihat "punya saldo" lalu ditolak saat
  // menekan Bikin.
  beriBonusPendaftaran(id);
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
  // PAKET GRATIS pendaftar baru: satu JATAH VIDEO, bukan rupiah. Rupiah tidak
  // lagi membeli apa pun, jadi bonus rupiah hanya akan jadi angka yang tidak
  // bisa dibelanjakan — pendaftar melihat "punya saldo" lalu ditolak saat
  // menekan Bikin.
  beriBonusPendaftaran(id);
  audit(id, "user.created", "users", id, { email: key });
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
}

/**
 * Bonus pendaftaran — satu kali per akun, dan hanya di sini.
 *
 * Kegagalannya TIDAK menggagalkan pendaftaran: akun yang gagal dibuat karena
 * bonus tidak bisa ditulis adalah pertukaran yang buruk. Ia dicatat supaya
 * ketahuan, bukan ditelan diam-diam.
 */
function beriBonusPendaftaran(userId: string): void {
  if (config.signupBonusQty <= 0) return;
  try {
    bonusKredit(userId, config.signupBonusJenis as JenisVideo, config.signupBonusQty, "paket gratis pendaftar baru");
    audit(userId, "user.signup_bonus", "kredit_video", userId, {
      jenis: config.signupBonusJenis, qty: config.signupBonusQty,
    });
  } catch (err) {
    console.error(`[auth] bonus pendaftaran gagal untuk ${userId}:`, err);
  }
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
