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
import { getAuthUserFromCookies } from "./dashboard-auth";
import type { UserRow } from "./db";

/** Email yang boleh membuka /admin. Dipisah koma di env ADMIN_EMAILS. */
export function daftarAdmin(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
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
