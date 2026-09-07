// ALUR PENDAFTARAN BRAND ≠ ALUR RETAIL (laporan Brian 7 Sep 2026).
//
// "alur registrasi brand harusnya berbeda dengan retail. tapi saat ini ketika
//  saya coba signin prosesnya sama"
//
// Ia benar secara harfiah: calon brand dikirim ke /onboarding, KOMPONEN YANG
// SAMA dengan retail, kolom yang sama (email saja). Yang berbeda cuma warna dan
// satu kalimat. Dan bentuknya salah, bukan cuma tampilannya:
//   - dua pendaftaran (akun, lalu organisasi) disajikan sebagai satu,
//   - layar "belum terhubung ke organisasi" terbaca seperti galat padahal itu
//     jalur normal,
//   - data brand baru diminta paling akhir, sesudah orangnya terlanjur
//     membuat akun.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const kode = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");

test("pendaftaran brand punya halamannya SENDIRI, bukan menumpang /onboarding", () => {
  assert.ok(fs.existsSync(path.join(process.cwd(), "app/brands/daftar/page.tsx")), "halaman pendaftaran brand tidak ada");
});

test("data brand diminta SEBELUM verifikasi, bukan sesudah akun jadi", () => {
  const src = kode("app/brands/daftar/page.tsx");
  // Ketiganya harus ada di formulir langkah pertama.
  for (const k of ["nama", "website", "kategori", "email"]) {
    assert.match(src, new RegExp(`isian\\.${k}`), `kolom "${k}" tidak diminta`);
  }
  // Langkah 2 hanya bisa dicapai LEWAT kirimData — dan kirimData baru berjalan
  // sesudah formulirnya diisi. Itu yang membuktikan datanya terkumpul lebih
  // dulu, bukan urutan baris di berkas ini.
  //
  // (Versi pertama tes ini membandingkan indexOf() dua potongan teks — yaitu
  //  urutan SUMBER, bukan urutan alur. Fungsi verifikasi memang dideklarasikan
  //  di atas JSX-nya, jadi tes itu gagal untuk alasan yang salah.)
  const kirim = src.slice(src.indexOf("async function kirimData"), src.indexOf("async function verifikasi"));
  assert.match(kirim, /request-otp/, "kode verifikasi tidak dikirim di langkah pertama");
  assert.match(kirim, /setLangkah\(2\)/, "langkah 2 tidak dicapai lewat pengiriman data");
  // Dan langkah 2 tidak boleh bisa dimasuki dari tempat lain.
  assert.equal((src.match(/setLangkah\(2\)/g) ?? []).length, 1, "ada jalan pintas ke langkah 2");
});

test("akun dan organisasi lahir dari SATU tindakan", () => {
  const src = kode("app/brands/daftar/page.tsx");
  const iVerify = src.indexOf("/api/auth/verify-otp");
  const iOrg = src.indexOf("/api/brands/daftar");
  assert.ok(iVerify > 0 && iOrg > iVerify, "organisasi tidak dibuat tepat sesudah verifikasi");
  // Tidak boleh mampir ke layar "kamu belum punya organisasi".
  assert.match(src, /router\.replace\("\/dashboard\/menunggu"\)/, "tidak langsung ke layar tunggu");
  assert.doesNotMatch(src, /request-access/, "masih melewati layar penolakan");
});

test("isian bertahan kalau tab tertutup di tengah jalan", () => {
  // Celah paling berbahaya: verifikasi berhasil, pembuatan organisasi belum.
  // Tanpa penyimpanan, orang itu kehilangan seluruh isiannya dan mendarat di
  // layar yang bilang ia belum punya organisasi.
  const src = kode("app/brands/daftar/page.tsx");
  assert.match(src, /sessionStorage\.setItem/, "isian tidak disimpan");
  assert.match(src, /sessionStorage\.getItem/, "isian tidak dipulihkan");
  assert.match(src, /sessionStorage\.removeItem/, "isian tidak dibersihkan setelah selesai");
});

test("MENDAFTAR dan MASUK bukan lagi tombol yang sama", () => {
  const src = kode("app/brands/page.tsx");
  // Dua CTA utama mengajak MENDAFTAR.
  assert.equal((src.match(/href="\/brands\/daftar"/g) ?? []).length, 2, "CTA pendaftaran tidak dua");
  // Header tetap untuk yang SUDAH punya akun.
  assert.match(src, /href="\/onboarding\?audience=brand/, "pintu masuk untuk akun lama hilang");
  assert.equal((src.match(/href="\/onboarding\?audience=brand/g) ?? []).length, 1, "pintu masuk lama bocor ke CTA pendaftaran");
});

test("request-access tetap jalur PEMULIHAN, dan tidak menyuruh verifikasi ulang", () => {
  // Halaman itu hanya ditemui orang yang SUDAH login. Mengirimnya ke
  // /brands/daftar memaksa memverifikasi email yang sudah terverifikasi.
  const src = kode("app/dashboard/request-access/page.tsx");
  assert.match(src, /href="\/dashboard\/daftar"/, "pemulihan tidak menunjuk formulir untuk yang sudah login");
  assert.doesNotMatch(src, /href="\/brands\/daftar"/, "pemulihan menyuruh verifikasi ulang");
});
