import crypto from "node:crypto";
import { config } from "./config";
import { mediaUrlKey } from "./secrets";

// Signed URL untuk file hasil (SRS NF-SEC04): HMAC atas (path, exp), TTL 1 jam.
//
// Kuncinya DITURUNKAN dari AUTH_SECRET lewat HKDF (lib/secrets.ts), bukan
// AUTH_SECRET mentah. Sebelumnya kunci yang sama menandatangani JWT sesi, URL
// media, dan hash OTP sekaligus — jadi kunci itu tidak bisa dirotasi tanpa
// memutus ketiganya. Perubahan ini membatalkan URL yang sudah terlanjur
// dibagikan, dan itu tidak apa-apa: umurnya cuma 1 jam.

function sign(relPath: string, exp: number): string {
  return crypto.createHmac("sha256", mediaUrlKey()).update(`${relPath}:${exp}`).digest("hex");
}

export function createSignedUrl(relPath: string, variant?: "thumb"): string {
  const exp = Math.floor(Date.now() / 1000) + config.signedUrlTtlSec;
  const sig = sign(relPath, exp);
  const suffix = variant === "thumb" ? "&variant=thumb" : "";
  return `/api/files/${relPath}?exp=${exp}&sig=${sig}${suffix}`;
}

export function verifySignedUrl(relPath: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(relPath, exp);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(sig), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
