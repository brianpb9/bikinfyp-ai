// GERBANG ADMIN.
//
// Sampai 2026-08-16 sistem ini TIDAK PUNYA konsep peran sama sekali — tidak
// ada kolom role, tidak ada tabel izin. Semua tugas operator dikerjakan lewat
// skrip CLI dari laptop founder, dan itu memang paling aman selama operatornya
// satu orang: skrip di laptop tidak bisa diserang dari internet.
//
// Yang berubah: produk sudah live, dan operator yang harus membuka terminal
// untuk melihat job gagal bukan sedang mengoperasikan, ia sedang memberi
// pertolongan pertama.
//
// KENAPA DAFTAR EMAIL DI ENV, BUKAN KOLOM DI DATABASE.
//
// Kolom `is_admin` di tabel users terdengar lebih rapi, dan memang lebih rapi
// — begitu ada lebih dari beberapa admin. Sebelum itu, ia menambah satu jalur
// baru yang bisa salah: siapa pun yang bisa menulis ke tabel users (bug SQL
// injection, skrip admin yang keliru, migrasi yang salah) bisa mengangkat
// dirinya sendiri jadi admin.
//
// Daftar di env tidak bisa diubah dari dalam aplikasi. Untuk menambah admin,
// seseorang harus punya akses ke dashboard Render — dan kalau penyerang sudah
// sampai di sana, halaman admin bukan lagi masalah terbesarmu.
//
// Konsekuensi yang harus diterima: menambah admin butuh deploy ulang. Itu
// harga yang pantas selama jumlahnya masih bisa dihitung dengan jari.

import { redirect } from "next/navigation";
import { config } from "./config";
import { ERR } from "./errors";
import { getAuthUserFromCookies } from "./dashboard-auth";
import type { UserRow } from "./db";

/** Email yang boleh membuka /admin. Dipisah koma di env ADMIN_EMAILS. */
export function daftarAdmin(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Boleh dikreditkan oleh callback SANDBOX?
 *
 * Admin selalu boleh; selain itu harus terdaftar di SANDBOX_TESTER_EMAILS.
 * Dipisah dari apakahAdmin() supaya menguji pembayaran tidak menuntut akses
 * dashboard operator — dua kewenangan yang tidak ada hubungannya.
 */
export function apakahPengujiSandbox(email: string | null | undefined): boolean {
  if (!email) return false;
  if (apakahAdmin(email)) return true;
  // DIBACA DARI config, BUKAN process.env. Halaman kredensial menulis ke
  // config saat nilainya diganti tanpa restart; membaca process.env di sini
  // membuat penggantian dari dashboard tidak berpengaruh sama sekali —
  // kegagalan diam yang paling membingungkan, karena halamannya bilang
  // "tersimpan".
  const daftar = (config.sandboxTesterEmails ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return daftar.includes(email.toLowerCase());
}

export function apakahAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const daftar = daftarAdmin();
  // Daftar KOSONG berarti tidak ada admin — bukan berarti semua orang admin.
  // Gerbang yang membuka sendiri saat konfigurasinya hilang adalah cara paling
  // umum sebuah halaman internal bocor ke publik.
  if (daftar.length === 0) return false;
  return daftar.includes(email.toLowerCase());
}

/** Untuk Server Component. Redirect kalau bukan admin — dan sengaja redirect
 *  ke halaman biasa, bukan ke halaman "akses ditolak": halaman penolakan
 *  memberi tahu penebak bahwa alamatnya benar. */
export async function wajibAdmin(): Promise<UserRow> {
  const user = await getAuthUserFromCookies();
  if (!user) redirect("/onboarding");
  if (!apakahAdmin(user.email)) redirect("/");
  return user;
}

/**
 * Gerbang admin untuk RUTE API.
 *
 * Terpisah dari wajibAdmin() karena bentuk penolakannya berbeda: Server
 * Component me-redirect ke halaman, rute API harus MELEMPAR supaya klien
 * menerima kode galat — redirect di rute API menghasilkan HTML di tempat JSON
 * diharapkan, dan itu terbaca sebagai kerusakan, bukan penolakan.
 *
 * Sengaja menjawab 403 saat sudah login tapi bukan admin, dan 401 saat belum
 * login sama sekali: keduanya masalah yang berbeda bagi orang yang membacanya.
 */
export async function wajibAdminApi(req: Request): Promise<UserRow> {
  const { getAuthUser } = await import("./auth");
  const user = await getAuthUser(req);
  if (!user) throw ERR.UNAUTHORIZED();
  if (!apakahAdmin(user.email)) throw ERR.FORBIDDEN("Halaman ini khusus admin.", "Admin only.");
  return user;
}
