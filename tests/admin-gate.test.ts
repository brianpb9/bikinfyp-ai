import { test } from "node:test";
import assert from "node:assert/strict";
import { apakahAdmin, daftarAdmin } from "../lib/admin-auth";

// Gerbang admin. Sistem ini belum punya konsep peran sama sekali, jadi satu-
// satunya yang memisahkan halaman admin dari publik adalah fungsi ini.
test("daftar kosong berarti TIDAK ADA admin, bukan semua orang admin", () => {
  const asli = process.env.ADMIN_EMAILS;
  try {
    delete process.env.ADMIN_EMAILS;
    assert.equal(apakahAdmin("siapa@pun.com"), false, "env hilang tidak boleh membuka gerbang");
    process.env.ADMIN_EMAILS = "";
    assert.equal(apakahAdmin("siapa@pun.com"), false, "env kosong tidak boleh membuka gerbang");
  } finally {
    if (asli === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = asli;
  }
});

test("hanya email yang terdaftar, tidak peduli huruf besar-kecil", () => {
  const asli = process.env.ADMIN_EMAILS;
  try {
    process.env.ADMIN_EMAILS = "Founder@Bikinfyp.com, ops@bikinfyp.com";
    assert.equal(daftarAdmin().length, 2);
    assert.equal(apakahAdmin("FOUNDER@bikinfyp.com"), true);
    assert.equal(apakahAdmin("ops@bikinfyp.com"), true);
    assert.equal(apakahAdmin("orang@lain.com"), false);
    // Yang paling berbahaya: nilai kosong/null diperlakukan sebagai admin.
    assert.equal(apakahAdmin(null), false);
    assert.equal(apakahAdmin(""), false);
    assert.equal(apakahAdmin(undefined), false);
  } finally {
    if (asli === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = asli;
  }
});
