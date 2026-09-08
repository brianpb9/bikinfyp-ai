// PWA — aplikasi terpasang dari browser (Brian, 8 Sep 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const baca = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

test("berkas PWA yang wajib ada, ada", () => {
  for (const f of ["public/manifest.json", "public/sw.js", "public/offline.html",
                   "public/icons/icon-192.png", "public/icons/icon-512.png",
                   "public/icons/icon-maskable-512.png"]) {
    assert.ok(existsSync(join(process.cwd(), f)), `${f} tidak ada`);
  }
});

test("manifest memenuhi syarat pemasangan", () => {
  const m = JSON.parse(baca("public/manifest.json")) as Record<string, unknown>;
  assert.equal(m.display, "standalone", "display bukan standalone");
  for (const k of ["name", "short_name", "start_url", "icons", "id", "scope"]) {
    assert.ok(m[k], `manifest tanpa ${k}`);
  }
  const ic = m.icons as { sizes: string; purpose?: string }[];
  // 192 dan 512 adalah syarat keras Chrome; maskable yang membuat ikonnya tidak
  // dipotong jadi lingkaran putih di Android.
  for (const s of ["192x192", "512x512"]) assert.ok(ic.some((i) => i.sizes === s), `ikon ${s} hilang`);
  assert.ok(ic.some((i) => i.purpose === "maskable"), "ikon maskable hilang");
});

test("start_url TIDAK menunjuk alamat yang mengalihkan", () => {
  // "/" menjawab 307 ke /onboarding. Aplikasi terpasang yang membuka start_url
  // akan selalu membayar satu lompatan, dan sebagian browser membaca start_url
  // yang mengalihkan sebagai tanda scope yang salah.
  const m = JSON.parse(baca("public/manifest.json")) as { start_url: string };
  assert.notEqual(m.start_url, "/", "start_url masih menunjuk alamat yang mengalihkan");
});

test("middleware TIDAK mengalihkan /sw.js dan /offline.html", () => {
  // Jebakan yang sudah pernah terjadi pada /previews/*.mp4 dan terulang:
  // middleware menjawab 307 ke /onboarding, pendaftaran service worker gagal,
  // dan aplikasinya tidak pernah bisa dipasang — tanpa satu pesan galat pun.
  const mw = baca("middleware.ts");
  const m = /matcher: \[\s*[\s\S]*?"([^"]+)"/.exec(mw);
  assert.ok(m, "matcher tidak ditemukan");
  // BACKSLASH DI-UNESCAPE DULU. Yang dibaca di sini adalah SUMBER TypeScript,
  // dan di sana "\\." adalah dua karakter yang menjadi satu backslash saat
  // string-nya dievaluasi. Membangun RegExp dari teks mentahnya menghasilkan
  // pola dengan arti BERBEDA dari yang benar-benar dipakai Next — versi pertama
  // tes ini gagal karena itu, bukan karena middleware-nya salah.
  const re = new RegExp(m[1]!.replace(/\\\\/g, "\\"));
  for (const p of ["/sw.js", "/offline.html", "/manifest.json", "/icons/icon-192.png"]) {
    assert.equal(re.test(p), false, `middleware masih menangkap ${p}`);
  }
  // Dan halaman biasa TETAP dijaga — pengecualian tidak boleh membocorkan rute.
  for (const p of ["/dashboard", "/bikin/produk", "/admin"]) {
    assert.equal(re.test(p), true, `middleware tidak lagi menjaga ${p}`);
  }
});

test("service worker TIDAK PERNAH menyentuh /api", () => {
  // Aplikasi menampilkan saldo token, status job, dan harga. Menyajikan versi
  // basi membuat orang menekan Generate dengan keyakinan salah tentang saldonya.
  const sw = baca("public/sw.js");
  assert.match(sw, /pathname\.startsWith\("\/api\/"\)\s*\)\s*return;/,
    "service worker tidak melewatkan /api");
});

test("navigasi JARINGAN DULU, bukan cache dulu", () => {
  // Deploy blue/green sering. HTML yang di-cache menunjuk bundel JS versi lama;
  // sesudah deploy bundel itu hilang dan aplikasinya membuka layar putih tanpa
  // satu pesan pun.
  const sw = baca("public/sw.js");
  const i = sw.indexOf('request.mode === "navigate"');
  assert.ok(i > 0, "cabang navigasi tidak ada");
  const blok = sw.slice(i, i + 400);
  assert.ok(blok.indexOf("fetch(request)") < blok.indexOf("caches.match"),
    "navigasi memakai cache sebelum jaringan");
});

test("halaman offline menyebut nasib job yang sedang jalan", () => {
  // "Tidak ada koneksi" saja membuat orang yang videonya sedang diproses panik
  // mengira prosesnya ikut berhenti.
  const h = baca("public/offline.html");
  assert.match(h, /tetap jalan di server/i);
});
