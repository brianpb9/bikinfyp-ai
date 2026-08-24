// OTP login EMAIL (migrasi 31 Jul 2026 — menggantikan OTP WhatsApp sepenuhnya).
// Kode 6 digit, yang disimpan HANYA hash sha256(salt:email:code), expiry 5 menit,
// maks 5 attempts per kode. Rate limit request: maks 3 kirim/email/15 menit.

import crypto from "node:crypto";
import { getDb, now, uuid } from "./db";
import { config } from "./config";
import { otpHashKey } from "./secrets";

// Salt OTP kini kunci turunan (HKDF), bukan AUTH_SECRET + ":otp". Kode OTP
// yang belum terpakai jadi tidak cocok lagi setelah deploy — dampaknya kecil
// karena umurnya 5 menit, dan pengguna cukup minta kode baru.
function salt(): string {
  return otpHashKey().toString("hex");
}

export function hashCode(email: string, code: string): string {
  return crypto.createHash("sha256").update(`${salt()}:${email.toLowerCase()}:${code}`).digest("hex");
}

export function generateCode(): string {
  return String(crypto.randomInt(100000, 1000000)); // 6 digit
}

/** Validasi format email dasar. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

interface OtpRow {
  id: string;
  email: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  created_at: string;
}

/** Rate limit: true bila email ini MASIH boleh minta kode baru. */
export function canRequestOtp(email: string): boolean {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM otp_codes WHERE email = ? AND created_at > ?")
    .get(email.toLowerCase(), since) as { n: number };
  return row.n < config.otpRateLimitPer15Min;
}

export function storeOtp(email: string, code: string): void {
  const expires = new Date(Date.now() + config.otpExpiryMin * 60_000).toISOString();
  getDb()
    .prepare("INSERT INTO otp_codes (id, email, code_hash, expires_at, attempts, created_at) VALUES (?,?,?,?,0,?)")
    .run(uuid(), email.toLowerCase(), hashCode(email, code), expires, now());
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "wrong_code" | "expired" | "too_many_attempts" | "no_code"; attemptsLeft: number };

export function verifyOtp(email: string, code: string): VerifyResult {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM otp_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1")
    .get(email.toLowerCase()) as OtpRow | undefined;
  if (!row) return { ok: false, reason: "no_code", attemptsLeft: 0 };
  if (row.attempts >= config.otpMaxAttempts) return { ok: false, reason: "too_many_attempts", attemptsLeft: 0 };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired", attemptsLeft: 0 };

  const match = row.code_hash === hashCode(email, code);
  db.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?").run(row.id);
  if (!match) {
    const left = config.otpMaxAttempts - (row.attempts + 1);
    return { ok: false, reason: left <= 0 ? "too_many_attempts" : "wrong_code", attemptsLeft: Math.max(0, left) };
  }
  // KODE DIHANGUSKAN saat berhasil. Sebelumnya barisnya dibiarkan hidup, jadi
  // kode sekali-pakai ternyata bisa dipakai berkali-kali sampai kedaluwarsa
  // (temuan audit QA 16 Agu 2026).
  //
  // Hapus BERSYARAT id, lalu periksa changes: kalau 0, proses lain sudah
  // memakainya lebih dulu dan verifikasi ini tidak boleh dianggap berhasil.
  const hapus = db.prepare("DELETE FROM otp_codes WHERE id = ?").run(row.id);
  if (hapus.changes !== 1) return { ok: false, reason: "no_code", attemptsLeft: 0 };
  return { ok: true };
}
