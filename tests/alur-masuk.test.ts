// ALUR MASUK — dari landing dan dari /coba, sampai ke form daftar.
//
// Tiga cacat yang ditutup, semuanya dilaporkan Brian setelah memakai situsnya
// sendiri:
//
// 1. TIDAK ADA CTA DAFTAR SAMA SEKALI di landing. Bukan karena kodenya kurang,
//    melainkan karena tabel keputusan CTA mengganti SETIAP tombol utama dengan
//    "Lihat contoh skripnya" begitu JOB_INTAKE_MODE=closed — dan intake memang
//    sedang tertutup. Mendaftar diikat pada izin merender, padahal keduanya
//    hal yang berbeda.
// 2. TIDAK ADA JALAN MASUK untuk pengguna lama. Tidak ada tombol "Masuk" di
//    mana pun.
// 3. DARI /coba, tombol "Render jadi video" mendarat di halaman marketing
//    lagi, bukan di form daftar.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-alur-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-alur-storage-${process.pid}`;

const { ajakan } = await import("../app/_components/kesiapan");
const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

test("SETIAP keadaan sistem tetap menawarkan jalan mendaftar", () => {
  // Inti perbaikannya. Intake tertutup berarti VIDEO belum bisa dirender; ia
  // tidak berarti orang tidak boleh punya akun.
  for (const status of ["memuat", "terbuka", "tertutup", "tidak-sehat"] as const) {
    const c = ajakan(status);
    assert.match(c.href, /\/onboarding/, `keadaan "${status}" tidak mengarah ke pendaftaran (${c.href})`);
    assert.doesNotMatch(c.label, /tanpa daftar/i, `keadaan "${status}" masih menjual jalur tanpa akun sebagai CTA utama`);
  }
});

test("keadaan tertutup TETAP JUJUR, bukan diam-diam mengajak", () => {
  // Mengajak mendaftar tanpa menyebut mesinnya sedang berhenti adalah menjual
  // sesuatu yang belum bisa diberikan.
  const c = ajakan("tertutup");
  assert.match(c.catatan, /ditutup sementara/i, "tidak menyebut bahwa render sedang berhenti");
  const s = ajakan("tidak-sehat");
  assert.ok(s.catatan.length > 0, "keadaan tidak-sehat diam tentang ketidakpastiannya");
});

test('keadaan "memuat" bekerja TANPA JavaScript', () => {
  // Ini yang dirender server. Kalau hidrasi mati — kelas kegagalan yang benar-
  // benar pernah terjadi — inilah satu-satunya tombol yang dilihat pengunjung,
  // jadi ia harus berupa <a href> yang berfungsi sendiri.
  const c = ajakan("memuat");
  assert.equal(c.mulaiDaftar, false, "CTA awal menuntut hidrasi untuk berfungsi");
  assert.match(c.href, /\?daftar=1/, "tautan tanpa-JS tidak menembus ke form");
});

test("?daftar=1 dan #daftar menembus langsung ke form", () => {
  const src = baca("app/onboarding/OnboardingClient.tsx");
  assert.match(src, /p\.get\("daftar"\) === "1" \|\| window\.location\.hash === "#daftar"/);
  assert.match(src, /setStep\(2\)/);
});

test("dari /coba, tombol render menembus ke form — bukan ke hero", () => {
  const src = baca("app/coba/page.tsx");
  assert.match(src, /href="\/onboarding\?daftar=1"/, "masih melempar ke halaman marketing");
});

test("ada jalan MASUK untuk pengguna lama", () => {
  const src = baca("app/onboarding/OnboardingClient.tsx");
  assert.match(src, /Sudah punya akun\?/, "tidak ada tombol masuk di mana pun");
  assert.match(src, /signin_click/, "jalur masuk tidak terlacak, jadi tidak bisa diukur");
});
