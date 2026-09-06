import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SESSION_MAX_AGE_SEC, issueToken, verifyToken } from "../lib/auth";

// Masa berlaku sesi 24 jam (permintaan Brian 2026-08-12).
//
// Yang dijaga di sini bukan cuma angkanya, tapi KESERAGAMANNYA. Nilai ini
// dulu ditulis ulang di empat tempat; cukup satu yang lupa diperbarui dan
// cookie hidup lebih lama daripada tokennya — pengguna terlihat masih login
// padahal tiap panggilan API ditolak, dan itu terbaca sebagai aplikasi rusak,
// bukan sesi habis.

test("sesi berlaku tepat 24 jam", () => {
  assert.equal(SESSION_MAX_AGE_SEC, 86400);
});

test("token yang diterbitkan membawa exp 24 jam dari sekarang", async () => {
  const sebelum = Math.floor(Date.now() / 1000);
  const token = await issueToken("user-uji", "uji@aiugc.test");
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  const umur = payload.exp - payload.iat;
  assert.equal(umur, SESSION_MAX_AGE_SEC, `umur token ${umur} detik, seharusnya ${SESSION_MAX_AGE_SEC}`);
  assert.ok(payload.exp >= sebelum + SESSION_MAX_AGE_SEC - 5, "exp terlalu cepat");
});

test("token yang baru diterbitkan masih sah", async () => {
  const token = await issueToken("user-uji", "uji@aiugc.test");
  const hasil = await verifyToken(token);
  assert.equal(hasil?.userId, "user-uji");
});

// Cookie dan token HARUS memakai konstanta yang sama. Diperiksa dari berkas
// sumbernya, bukan dari perilaku — karena yang mau dicegah persis "seseorang
// menulis ulang angkanya di sini nanti".
test("setiap penerbit cookie sesi memakai SESSION_MAX_AGE_SEC, bukan angka sendiri", () => {
  const penerbit = [
    "app/api/auth/verify-otp/route.ts",
    "app/api/auth/dev-login/route.ts",
    "app/api/auth/google/callback/route.ts",
  ];
  for (const f of penerbit) {
    const isi = fs.readFileSync(f, "utf8");
    // Bentuknya berubah saat string cookie disatukan ke lib/cookies.ts: dulu
    // "Max-Age=${SESSION_MAX_AGE_SEC}" di dalam template, sekarang konstanta
    // yang sama dioper sebagai argumen. Yang dijaga tetap sama — dan sekarang
    // lebih kuat, karena penerbitnya juga wajib lewat helper bersama yang
    // memasang Secure/HttpOnly/SameSite.
    assert.match(isi, /cookieSesi\(cookieName\(\), token, SESSION_MAX_AGE_SEC\)/,
      `${f} tidak memakai helper + konstanta bersama`);
  }
});

test("tidak ada sisa masa berlaku 30 hari di mana pun", () => {
  for (const f of [
    "lib/auth.ts",
    "app/api/auth/verify-otp/route.ts",
    "app/api/auth/dev-login/route.ts",
    "app/api/auth/google/callback/route.ts",
  ]) {
    const isi = fs.readFileSync(f, "utf8");
    assert.ok(!isi.includes("30 * 24 * 3600"), `${f} masih memakai 30 hari`);
    assert.ok(!isi.includes('"30d"'), `${f} masih memakai "30d"`);
  }
});

// Tombol keluar wajib ada di kedua chrome — retail DAN dashboard. Sebelum
// 2026-08-12 pengguna retail tidak punya cara keluar sama sekali.
test("tombol keluar terpasang di chrome retail dan dashboard", () => {
  const retail = fs.readFileSync("app/_components/SiteChrome.tsx", "utf8");
  assert.match(retail, /AccountMenu/, "header retail tanpa menu akun");
  const dash = fs.readFileSync("app/dashboard/_components/DashboardChrome.tsx", "utf8");
  assert.match(dash, /SidebarLogout/, "sidebar dashboard tanpa tombol keluar");
});

test("semua tombol keluar memanggil endpoint logout yang sama", () => {
  for (const f of ["app/_components/AccountMenu.tsx", "app/dashboard/_components/ProfileActions.tsx"]) {
    const isi = fs.readFileSync(f, "utf8");
    assert.match(isi, /\/api\/auth\/logout/, `${f} tidak memanggil endpoint logout`);
  }
});
