import crypto from "node:crypto";

// SENGAJA tidak mengimpor ./config. config.ts memanggil assertAuthSecretSafe()
// saat modulnya dimuat, jadi impor balik ke config akan membentuk lingkaran
// dan `config` bisa masih undefined saat berkas ini dievaluasi. Membaca
// process.env langsung memutus lingkaran itu dan tidak kehilangan apa pun —
// nilainya sama persis.

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

const DEFAULT_DEV_SECRET = "dev-secret-racun-ai-jangan-dipakai-produksi";
const MIN_SECRET_BYTES = 32;

export class SecretConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretConfigurationError";
  }
}

/** Gagal-tertutup saat boot. Mengikuti pola assertLegacySqliteRuntimeAllowed
 * di lib/database-config.ts: di luar production tidak melakukan apa-apa,
 * di production menolak menyala dengan konfigurasi yang tidak aman. */
export function assertAuthSecretSafe(
  env: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "AUTH_SECRET">> = process.env
): void {
  if (env.NODE_ENV !== "production") return;
  const secret = env.AUTH_SECRET ?? "";
  if (!secret) {
    throw new SecretConfigurationError("AUTH_SECRET wajib diisi di production — tidak ada nilai bawaan yang aman.");
  }
  if (secret === DEFAULT_DEV_SECRET) {
    throw new SecretConfigurationError("AUTH_SECRET masih memakai nilai bawaan pengembangan. Ganti sebelum deploy.");
  }
  // Panjang: sekarang MENOLAK boot.
  //
  // Sebelumnya ini hanya peringatan karena panjang secret produksi tidak bisa
  // saya periksa dari repo — render.yaml hanya mendefinisikan staging.
  // Diverifikasi langsung di Shell Render 2026-08-11: web DAN worker sama-sama
  // 32 karakter, jadi menaikkannya tidak akan mematikan apa pun yang sedang
  // berjalan. Menegakkannya di sini mencegah deploy berikutnya menurunkan
  // standar tanpa ada yang sadar.
  const len = Buffer.byteLength(secret, "utf8");
  if (len < MIN_SECRET_BYTES) {
    throw new SecretConfigurationError(
      `AUTH_SECRET terlalu pendek (${len} byte). Minimal ${MIN_SECRET_BYTES} byte acak.`
    );
  }
}

/** Kunci turunan per fungsi lewat HKDF-SHA256. Satu master di env, kunci
 * berbeda per pemakaian — membocorkan salah satunya tidak membocorkan yang
 * lain, dan tiap fungsi bisa dirotasi sendiri nanti dengan mengubah info-nya. */
function masterSecret(): string {
  return process.env.AUTH_SECRET || DEFAULT_DEV_SECRET;
}

function derive(purpose: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(masterSecret(), "utf8"), Buffer.alloc(0), Buffer.from(purpose, "utf8"), 32)
  );
}

const cache = new Map<string, Buffer>();
function cached(purpose: string): Buffer {
  let k = cache.get(purpose);
  if (!k) { k = derive(purpose); cache.set(purpose, k); }
  return k;
}

/** Kunci HMAC untuk URL media bertanda tangan (lib/signed-url.ts). */
export function mediaUrlKey(): Buffer {
  return cached("bikinfyp/media-url/v1");
}

/** Kunci hash OTP (lib/otp.ts). */
export function otpHashKey(): Buffer {
  return cached("bikinfyp/otp-hash/v1");
}

/** Kunci enkripsi kredensial partner yang tersimpan di database
 *  (lib/kredensial.ts). Diturunkan terpisah dari kunci media dan OTP: bocornya
 *  salah satu tidak membocorkan yang lain, dan tiap kunci bisa dirotasi
 *  sendiri dengan mengganti purpose-nya. */
export function kredensialKey(): Buffer {
  return cached("bikinfyp/kredensial/v1");
}
