// Merek platform: satu sumber, dan alamat teknis TIDAK ikut berganti.
//
// ─────────────────────────────────────────────────────────────────────────────
// PERMINTAAN BRIAN, 4 SEP 2026
// ─────────────────────────────────────────────────────────────────────────────
//   "saya ingin megganti brand bikinfyp.com dengan aiugc.id ... termasuk
//    mengganti template email dan lain-lain."
//
// Nama merek sebelumnya diketik ulang di 62 tempat. Nama yang disalin 62 kali
// adalah nama yang tidak akan pernah selesai diganti: satu tertinggal, dan
// pembeli menerima email dari merek yang sudah tidak ada.
//
// ─────────────────────────────────────────────────────────────────────────────
// KENAPA ALAMAT TEKNIS DIBIARKAN
// ─────────────────────────────────────────────────────────────────────────────
// Diperiksa 4 Sep 2026: aiugc.id menunjuk 104.21.0.184 / 172.67.128.48
// (Cloudflare), server ini 187.77.148.89, dan https://aiugc.id belum menjawab.
// Kalau alamat teknis ikut diganti sekarang, yang rusak bukan tampilan:
// kie.ai tidak bisa mengunduh gambar acuan (setiap render Standard gagal),
// callback Duitku menunjuk alamat mati, dan redirect Google OAuth ditolak.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DOMAIN_TAMPIL, NAMA_PLATFORM, NAMA_PLATFORM_PANJANG } from "../lib/identitas-platform";

const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
/** Komentar adalah CATATAN kejadian; nama lama di sana justru yang benar. */
const kodeSaja = (p: string) =>
  baca(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

test("merek baru terpasang", () => {
  assert.equal(NAMA_PLATFORM, "AIUGC.ID");
  assert.equal(NAMA_PLATFORM_PANJANG, "AIUGC.ID");
  assert.equal(DOMAIN_TAMPIL, "aiugc.id");
});

test("tidak ada lagi nama lama di teks yang DILIHAT orang", () => {
  const berkas = [
    "lib/email-otp.ts", "lib/email-pembayaran.ts", "lib/wa-otp.ts",
    "lib/duitku.ts", "lib/midtrans.ts", "lib/kontak.ts",
    "lib/operational-monitor.ts", "app/api/kredit-video/checkout/route.ts",
  ];
  for (const f of berkas) {
    assert.doesNotMatch(kodeSaja(f), /BikinFYP/, `${f} masih memakai nama merek lama`);
  }
  assert.match(baca("public/manifest.json"), /"name": "AIUGC\.ID"/);
});

test("email dan invoice memakai KONSTANTA, bukan nama yang diketik ulang", () => {
  // Ini yang membuat pergantian berikutnya selesai dalam satu baris, bukan 62.
  for (const f of ["lib/email-otp.ts", "lib/email-pembayaran.ts", "lib/duitku.ts"]) {
    assert.match(kodeSaja(f), /NAMA_PLATFORM_PANJANG/, `${f} tidak memakai konstanta merek`);
  }
});

test("ALAMAT TEKNIS masih domain lama — sengaja, sampai DNS pindah", () => {
  // Bukan yang tertinggal. metadataBase dan og:url menjadi alamat kanonik yang
  // dibagikan dan di-crawl; mengarahkannya ke domain yang belum hidup membuat
  // setiap tautan yang dibagikan pembeli menuju halaman mati.
  const layout = baca("app/layout.tsx");
  assert.match(layout, /metadataBase: new URL\("https:\/\/bikinfyp\.com"\)/);
  assert.match(layout, /aiugc\.id menunjuk 104\.21/, "alasannya tidak ditulis — akan terlihat seperti kelalaian");
});

test("kunci provenance AIGC TIDAK ikut diganti", () => {
  // QC-08 mencocokkan KUNCI `racun_aigc`, bukan teks komentarnya. Mengganti
  // kunci akan membuat setiap video lama gagal pemeriksaan provenance-nya.
  for (const f of ["lib/media/compositor.ts", "lib/promo/stitch.ts"]) {
    assert.match(baca(f), /racun_aigc=true/, `${f}: kunci provenance hilang`);
  }
});
