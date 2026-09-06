// PENDAFTARAN MANDIRI BRAND (keputusan Brian 6 Sep 2026).
//
// Tiga aturan yang tidak boleh longgar:
//   1. Organisasi baru berstatus 'pending', bukan 'active'.
//   2. Token awal NOL — berbeda dari retail yang dapat satu video percobaan.
//   3. "Menunggu ditinjau" DIBEDAKAN dari "ditangguhkan".

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { slugBrand } from "../lib/brand-slug";

const kode = (rel: string) =>
  fs
    .readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((b) => !/^\s*\/\//.test(b))
    .join("\n");

test("organisasi baru dibuat 'pending', tidak pernah langsung aktif", () => {
  const src = kode("app/api/brands/daftar/route.ts");
  assert.match(src, /VALUES \(\$1, \$2, \$3, 'pending'/, "status awal bukan pending");
  assert.doesNotMatch(src, /'active'/, "jalur pendaftaran tidak boleh menulis 'active'");
});

test("TOKEN AWAL NOL: pendaftaran tidak menulis SATU PUN baris ledger", () => {
  const src = kode("app/api/brands/daftar/route.ts");
  // Bukan "menulis nol" — memang tidak menulis. Baris bernilai nol membuat
  // riwayat keuangan memuat kejadian yang tidak pernah terjadi, dan constraint
  // kredit_video sendiri menolak delta = 0.
  for (const tabel of ["kredit_video", "credit_ledger"]) {
    assert.doesNotMatch(src, new RegExp(`INSERT INTO ${tabel}`), `pendaftaran menulis ke ${tabel}`);
  }
  assert.doesNotMatch(src, /signupBonus|bonus/i, "jatah bonus retail bocor ke jalur brand");
});

test("menyetujui organisasi TIDAK ikut memberi token", () => {
  const src = kode("app/api/admin/org-status/route.ts");
  assert.doesNotMatch(src, /INSERT INTO (kredit_video|credit_ledger)/, "setujui diam-diam jadi keputusan keuangan");
  assert.match(src, /UPDATE organizations SET status/, "tidak mengubah status");
});

test("menunggu tinjauan DIBEDAKAN dari ditangguhkan", () => {
  const src = kode("lib/dashboard-auth.ts");
  assert.match(src, /menungguPersetujuan/, "tidak ada pembeda status menunggu");
  assert.match(src, /redirect\("\/dashboard\/menunggu"\)/, "tidak ada halaman tunggu tersendiri");
  // Urutannya penting: yang pending harus ditangkap SEBELUM cek tertangguh,
  // kalau tidak ia ikut dikirim ke halaman "hubungi kami untuk mengaktifkan
  // lagi" — kalimat yang salah untuk orang yang baru mendaftar.
  assert.ok(
    src.indexOf('redirect("/dashboard/menunggu")') < src.indexOf('redirect("/dashboard/suspended")'),
    "cek pending harus mendahului cek suspended",
  );
  assert.ok(fs.existsSync(path.join(process.cwd(), "app/dashboard/menunggu/page.tsx")), "halaman tunggu tidak ada");
});

test("tertangguh hanya berarti SEMUA keanggotaan suspended", () => {
  // Versi lama memakai !some(active), sehingga organisasi 'pending' pun
  // dianggap tertangguh.
  assert.match(kode("lib/dashboard-auth.ts"), /every\(\(m\) => m\.org_status === "suspended"\)/);
});

test("satu orang tidak bisa mendaftar dua organisasi", () => {
  const src = kode("app/api/brands/daftar/route.ts");
  assert.match(src, /FROM org_members m JOIN organizations o[\s\S]*?WHERE m\.user_id = \$1/, "tidak memeriksa keanggotaan yang sudah ada");
});

test("slug brand aman dipakai sebagai bagian URL", () => {
  assert.equal(slugBrand("Kopi Kenangan"), "kopi-kenangan");
  assert.equal(slugBrand("  PT. Maju   Jaya!!  "), "pt-maju-jaya");
  assert.equal(slugBrand("Brand/../etc"), "brand-etc");
  assert.equal(slugBrand("###"), "");
  assert.ok(slugBrand("x".repeat(200)).length <= 48);
  for (const n of ["Kopi Kenangan", "PT. Maju Jaya", "Toko 123"]) {
    assert.match(slugBrand(n), /^[a-z0-9-]*$/, `slug "${slugBrand(n)}" memuat karakter di luar [a-z0-9-]`);
  }
});

test("migrasi menambah 'pending' TANPA membuang status lama", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "migrations/postgres/0039_organisasi_pending.sql"), "utf8");
  for (const s of ["pending", "active", "suspended"]) {
    assert.match(sql, new RegExp(`'${s}'`), `status "${s}" hilang dari constraint`);
  }
  // Organisasi lama tidak boleh ikut berubah statusnya.
  assert.doesNotMatch(sql, /UPDATE organizations/, "migrasi mengubah data organisasi yang sudah ada");
});
