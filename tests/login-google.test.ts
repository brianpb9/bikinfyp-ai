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
  const src = baca("app/onboarding/OnboardingClient.tsx");
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
  const src = kode("app/onboarding/OnboardingClient.tsx");
  assert.doesNotMatch(src, /● Harga transparan/, "pil bertitik masih ada di header");
  assert.doesNotMatch(src, /rounded-full bg-emerald-50[^"]*">●/, "markup pilnya masih dirender");
  assert.match(src, /uppercase tracking-\[0\.16em\] text-amber-600">Harga transparan</, "section-nya tidak ada");
  // Satu sumber harga untuk kalkulator DAN section: halaman yang menjanjikan
  // transparansi tidak boleh menyebut dua harga berbeda di dua tempat.
  //
  // SUMBERNYA PINDAH 6 Sep 2026. Dulu satu sumber itu berupa daftar TIER_LANDING
  // yang diketik di berkas ini — satu sumber, tapi sumber yang salah: ia masih
  // memajang "AI Bersuara Rp12.000" berbulan-bulan sesudah paket itu pensiun.
  // Sekarang sumbernya /api/harga-publik, jadi angka di layar promosi tidak bisa
  // lagi tertinggal dari angka yang benar-benar ditagihkan.
  assert.match(src, /fetch\("\/api\/harga-publik"\)/, "harga tidak diambil dari server");
  assert.equal(
    (src.match(/paket\.map/g) ?? []).length, 2,
    "kalkulator dan section harga harus sama-sama dirender dari daftar yang sama",
  );
  assert.doesNotMatch(src, /12_000|80_000/, "harga paket kembali diketik di halaman");
});

test("bendera kemampuan SELAMAT walau health gagal", () => {
  // Jebakan yang ditutup: jawaban 503 dulu hanya {ok, code}, jadi semua bendera
  // hilang begitu ada masalah konfigurasi yang TIDAK berhubungan — misalnya
  // STORAGE_MODE belum r2. Akibatnya memasang kredensial Google tidak akan
  // memunculkan tombolnya, dan orang mengira kredensialnya yang salah.
  const src = kode("app/api/health/route.ts");
  // Dipotong dari blok catch, BUKAN dari nama kodenya: `ok: false` berada
  // sebelum baris itu, jadi memotong di sana melewatkan justru asersi yang
  // menjaga jalur gagal tidak mengaku sehat.
  const gagal = src.slice(src.indexOf("catch (error)"));
  assert.match(gagal, /google_login: Boolean\(/, "bendera google hilang di jalur gagal");
  assert.match(gagal, /payments_live: paymentsLive\(\)/, "bendera pembayaran hilang di jalur gagal");
  assert.match(gagal, /ok: false/, "jalur gagal tidak boleh mengaku sehat");
  assert.match(gagal, /status: 503/, "status 503 tidak boleh dilunakkan");
});

test("OTP email: kunci kosong menjawab KEADAAN, bukan 'gangguan'", () => {
  // Ditemukan dari laporan Brian, bukan dari membaca kode: minta OTP di server
  // baru menjawab 500 "Ada gangguan di sisi kami. Coba lagi sebentar lagi ya."
  // Kalimat itu salah dua kali — ini bukan gangguan, dan mencoba lagi tidak
  // akan pernah berhasil selama RESEND_API_KEY kosong.
  const src = kode("app/api/auth/request-otp/route.ts");
  assert.match(src, /EMAIL_LOGIN_NOT_CONFIGURED/);
  assert.match(src, /status: 503/);
  assert.match(src, /retryable: false/, "menyuruh pengguna mencoba lagi sesuatu yang mustahil");

  // Penjagaan harus MENDAHULUI pengiriman; kalau di belakang, ia tidak pernah
  // tercapai karena sendOtpEmail sudah melempar lebih dulu.
  assert.ok(
    src.indexOf("EMAIL_LOGIN_NOT_CONFIGURED") < src.indexOf("await sendOtpEmail"),
    "penjagaan berada SESUDAH sendOtpEmail — tidak akan pernah dieksekusi",
  );
});
