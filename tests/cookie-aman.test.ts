// Cookie sesi WAJIB Secure di produksi, dan atribut pasang/hapus wajib identik.
//
// Sebelum ini string cookie diketik ulang di enam tempat dan TIDAK SATU PUN
// memakai Secure — token sesi boleh dikirim browser lewat HTTP polos. HSTS
// tidak menolong pada kunjungan pertama, sebelum headernya pernah diterima.
//
// Masalah kedua yang lahir dari penyalinan itu: cookie hanya bisa DIHAPUS
// dengan atribut yang sama persis seperti saat dipasang. Satu atribut berbeda
// dan browser menyimpan cookie lama — logout yang tampak berhasil padahal
// sesinya masih hidup.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.APP_BASE_URL = "https://bikinfyp.com";
const { cookieSesi, cookieHapus, cookieState, cookieAnon, cookieAman } = await import("../lib/cookies");

test("produksi HTTPS menandai cookie Secure", () => {
  assert.equal(cookieAman(), true);
  const c = cookieSesi("racun_token", "tok.en", 3600);
  assert.match(c, /; Secure$/, "cookie sesi wajib Secure");
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Path=\//);
});

test("penghapus memakai atribut yang sama persis dengan pemasang", () => {
  const atribut = (s: string) => s.split("; ").slice(1).filter((b) => !b.startsWith("Max-Age=")).sort().join("|");
  assert.equal(
    atribut(cookieHapus("racun_token")),
    atribut(cookieSesi("racun_token", "x", 3600)),
    "atribut berbeda = browser menyimpan cookie lama = logout palsu"
  );
  assert.match(cookieHapus("racun_token"), /Max-Age=0/);
});

test("cookie state OAuth dan anon ikut Secure", () => {
  assert.match(cookieState("g_state", "abc", 600), /; Secure$/);
  assert.match(cookieAnon("racun_anon", "abc", 100), /; Secure$/);
  // Anon TIDAK HttpOnly-nya bukan kelalaian — ia tidak membawa kewenangan.
  assert.ok(!/HttpOnly/.test(cookieAnon("racun_anon", "abc", 100)));
});

test("tidak ada route yang merakit string cookie sendiri lagi", () => {
  const bocor: string[] = [];
  const telusuri = (d: string) => {
    for (const nama of fs.readdirSync(d)) {
      const f = path.join(d, nama);
      if (fs.statSync(f).isDirectory()) { telusuri(f); continue; }
      if (!f.endsWith(".ts")) continue;
      const isi = fs.readFileSync(f, "utf8");
      // Pola "=...; Path=/" di dalam template string = cookie yang dirakit tangan.
      if (/`[^`]*=\$\{[^`]*\}; Path=\//.test(isi)) bocor.push(path.relative(process.cwd(), f));
    }
  };
  telusuri(path.join(process.cwd(), "app"));
  assert.deepEqual(bocor, [], "route ini merakit cookie sendiri — Secure akan terlewat lagi");
});

test("CSP terpasang dengan arahan yang benar-benar menutup eksfiltrasi", () => {
  const cfg = fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
  // Yang paling penting untuk aplikasi berisi saldo dan token: data tidak bisa
  // dikirim ke server penyerang.
  for (const arahan of ["form-action 'self'", "connect-src 'self'", "base-uri 'self'",
                        "object-src 'none'", "frame-ancestors 'none'", "default-src 'self'"]) {
    assert.ok(cfg.includes(arahan), `arahan CSP hilang: ${arahan}`);
  }
  // Batasnya harus tertulis, bukan disembunyikan: script-src masih
  // 'unsafe-inline', jadi CSP ini TIDAK menutup XSS inline.
  assert.match(cfg, /TIDAK menghentikan XSS/, "batas CSP harus dinyatakan di kode");
});
