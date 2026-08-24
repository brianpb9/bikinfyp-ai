import crypto from "node:crypto";
import { runtimeAuthSecret } from "./auth-secret-policy";
export { assertAuthSecretSafe, runtimeAuthSecret, SecretConfigurationError } from "./auth-secret-policy";

// SENGAJA tidak mengimpor ./config. Rahasia runtime dibaca saat dipakai,
// bukan dibekukan ketika modul/config diimpor saat `next build`.

// Higienitas rahasia (masukan tester lewat Brian, 2026-08-11).
//
// MASALAH NYATA YANG DIPERBAIKI DI SINI
//
// 1. AUTH_SECRET punya nilai bawaan ("dev-secret-racun-ai-jangan-dipakai-
//    produksi"). Kalau env produksi lupa menyetelnya, aplikasi tetap menyala
//    dan SEMUA orang bisa memalsukan JWT serta menandatangani URL media —
//    tanpa satu pun pesan error. Gagal diam-diam pada kunci tanda tangan
//    adalah bentuk kegagalan terburuk: tidak ada yang tahu sampai ada yang
//    memanfaatkannya.
//
// 2. Satu kunci yang sama dipakai untuk TIGA fungsi berbeda: tanda tangan
//    JWT sesi, HMAC URL media, dan hash OTP. Artinya kunci itu tidak bisa
//    dirotasi tanpa memutus ketiganya sekaligus.
//
// KEPUTUSAN YANG DISENGAJA soal JWT: kunci JWT TETAP memakai master secret
// apa adanya, TIDAK diturunkan. Menurunkannya akan mengubah tanda tangan
// setiap token yang beredar dan membuat seluruh pengguna ter-logout serentak
// saat deploy. Rotasi JWT butuh dukungan `kid` (dua kunci diterima selama
// masa transisi) — itu pekerjaan tersendiri, bukan efek samping diam-diam
// dari perbaikan ini. Media dan OTP AMAN diturunkan: URL bertanda tangan
// hanya berumur 1 jam dan OTP beberapa menit, jadi paling buruk ada tautan
// yang perlu dimuat ulang.

/** Kunci turunan per fungsi lewat HKDF-SHA256. Satu master di env, kunci
 * berbeda per pemakaian — membocorkan salah satunya tidak membocorkan yang
 * lain, dan tiap fungsi bisa dirotasi sendiri nanti dengan mengubah info-nya. */
function derive(purpose: string, master: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(master, "utf8"), Buffer.alloc(0), Buffer.from(purpose, "utf8"), 32)
  );
}

const cache = new Map<string, { master: string; key: Buffer }>();
function cached(purpose: string): Buffer {
  const master = runtimeAuthSecret();
  const existing = cache.get(purpose);
  if (existing?.master === master) return existing.key;
  const key = derive(purpose, master);
  cache.set(purpose, { master, key });
  return key;
}

/** Kunci HMAC untuk URL media bertanda tangan (lib/signed-url.ts). */
export function mediaUrlKey(): Buffer {
  return cached("bikinfyp/media-url/v1");
}

/** Kunci hash OTP (lib/otp.ts). */
export function otpHashKey(): Buffer {
  return cached("bikinfyp/otp-hash/v1");
}
