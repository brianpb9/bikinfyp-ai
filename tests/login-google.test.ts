// LOGIN GOOGLE — dan kenapa ia tidak pernah berfungsi.
//
// Kredensialnya TIDAK PERNAH DIPASANG di mana pun: nol penyebutan di
// render.production.yaml, nol di .env.example, nol di server. Jadi
// config.googleOauthClientId selalu "", dan /api/auth/google membalas
// BAD_REQUEST — sebagai JSON MENTAH, di tab browser pengguna, karena jalur itu
// navigasi halaman dan bukan panggilan API.
//
// Tombolnya sendiri selalu ditampilkan. Menawarkan tombol yang pasti gagal
// lebih buruk daripada tidak menawarkannya sama sekali.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-google-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-google-storage-${process.pid}`;

const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

/** Sumber TANPA komentar. Catatan sejarah boleh menyebut markup lama; yang
 *  dilarang adalah markup yang ikut dirender. */
const kode = (p: string) =>
  baca(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")   // komentar JSX, termasuk yang multi-baris
    .replace(/\/\*[\s\S]*?\*\//g, "")        // komentar blok
    .split("\n")
    .filter((b) => !/^\s*\/\//.test(b))       // komentar baris
    .join("\n");

test("jalur berangkat MENGANTAR BALIK, tidak membalas JSON mentah", () => {
  const src = baca("app/api/auth/google/route.ts");
  assert.match(src, /kembaliDenganGalat\("not_configured"\)/);
  assert.match(src, /status: 302/);
  assert.doesNotMatch(
    src,
    /throw ERR\.BAD_REQUEST\("Login Google belum dikonfigurasi/,
    "kembali membalas JSON — pengguna akan melihat objek mentah di layar",
  );
});

test("tombol Google hanya muncul kalau server BILANG kredensialnya ada", () => {
  const src = baca("app/onboarding/page.tsx");
  assert.match(src, /googleLogin === true && \(/, "tombol tidak dijaga bendera");
  assert.match(src, /setGoogleLogin\(Boolean\(d\.google_login\)\)/, "bendera tidak dibaca dari /api/health");
  // "=== true", bukan "!== false": keadaan null (server belum menjawab) harus
  // ikut menyembunyikan, sama seperti gerbang tombol beli di halaman kredit.
  assert.doesNotMatch(src, /googleLogin !== false/, "keadaan null ikut membuka tombol");
});

test("health mengumumkan ADA atau TIDAK, bukan nilainya", () => {
  const src = baca("app/api/health/route.ts");
  assert.match(src, /google_login: Boolean\(config\.googleOauthClientId && config\.googleOauthClientSecret\)/);
  // Rahasianya sendiri tidak boleh ikut keluar.
  assert.doesNotMatch(src, /googleOauthClientSecret[,\s]*\}/, "secret ikut terekspos di payload health");
});

test("variabelnya TERCATAT di tempat orang mencarinya", () => {
  // Akar masalahnya bukan kode, melainkan tidak ada satu berkas pun yang
  // menyebut variabel ini dibutuhkan. Orang tidak memasang apa yang tidak
  // pernah mereka tahu ada.
  for (const berkas of [".env.example", "render.production.yaml"]) {
    const src = baca(berkas);
    assert.match(src, /GOOGLE_OAUTH_CLIENT_ID/, `${berkas} tidak menyebut GOOGLE_OAUTH_CLIENT_ID`);
    assert.match(src, /GOOGLE_OAUTH_CLIENT_SECRET/, `${berkas} tidak menyebut GOOGLE_OAUTH_CLIENT_SECRET`);
    assert.match(src, /api\/auth\/google\/callback/, `${berkas} tidak menyebut redirect URI yang wajib persis`);
  }
});

test("callback tetap menolak email Google yang belum terverifikasi", () => {
  // Penjagaan lama; ikut dijaga supaya perbaikan hari ini tidak melonggarkannya.
  const src = baca("app/api/auth/google/callback/route.ts");
  assert.match(src, /profile\.email_verified/);
  assert.match(src, /loginFailedRedirect\("email_not_verified"/);
});

test("HARGA TRANSPARAN: pil dicabut, janjinya ditepati section dengan angka", () => {
  const src = kode("app/onboarding/page.tsx");
  assert.doesNotMatch(src, /● Harga transparan/, "pil bertitik masih ada di header");
  assert.doesNotMatch(src, /rounded-full bg-emerald-50[^"]*">●/, "markup pilnya masih dirender");
  assert.match(src, /uppercase tracking-\[0\.16em\] text-amber-600">Harga transparan</, "section-nya tidak ada");
  // Satu sumber harga untuk kalkulator DAN section: halaman yang menjanjikan
  // transparansi tidak boleh menyebut dua harga berbeda di dua tempat.
  assert.match(src, /const TIER_LANDING = \[/);
  assert.match(src, /\{TIER_LANDING\.map/);
  assert.equal(
    (src.match(/12_000|12000/g) ?? []).length, 1,
    "harga 12.000 tertulis lebih dari sekali — dua salinan bisa melenceng",
  );
});
