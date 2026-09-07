// KUNCI-MATI BRAND: logo + kata "Brands", dan paletnya milik merek sendiri.
//
// Dua permintaan Brian 7 Sep 2026:
//   "sisakan tulisan brand setelah image supaya terlihat signifikan
//    perbedaannya"
//   "button colour dari aiugcbrand kurang masuk karena warnanya biru"
//
// Keduanya berakar pada hal yang sama: retail dan brand memakai logo yang SAMA
// PERSIS. Yang membedakan haruslah katanya — bukan warna asing yang tidak ada
// di merek itu.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const baca = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const kode = (rel: string) =>
  baca(rel).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");

test("permukaan brand memakai kunci-mati logo + kata, bukan teks polos", () => {
  // SELURUH permukaan brand, bukan cuma halaman depan. Dua di antaranya
  // sempat tertinggal karena polanya berbeda sedikit — dan salah satunya
  // (onboarding organisasi) bahkan masih memakai wording RETAIL "AIUGC.ID AI"
  // di layar yang hanya dilihat brand.
  for (const f of [
    "app/brands/page.tsx",
    "app/dashboard/_components/DashboardChrome.tsx",
    "app/dashboard/request-access/page.tsx",
    "app/dashboard/onboarding/page.tsx",
  ]) {
    const src = kode(f);
    assert.match(src, /<LogoBrands/, `${f} tidak memakai kunci-mati`);
    // Wordmark yang diketik tangan tidak boleh kembali: ia yang dulu tertinggal
    // saat merek berganti.
    assert.doesNotMatch(src, /AIUGC\.ID <span/, `${f} kembali mengetik wordmark sendiri`);
  }
});

test("kata 'Brands' TETAP ada — itu satu-satunya pembeda dari retail", () => {
  // Logonya sama persis dengan retail. Tanpa katanya, tidak ada penanda di layar
  // bahwa ini produk yang berbeda — padahal harga, mata uang, dan alur
  // pendaftarannya berbeda.
  const src = kode("app/_components/Logo.tsx");
  assert.match(src, /export function LogoBrands/);
  assert.match(src, />\s*Brands\s*</, "kata Brands hilang dari kunci-mati");
  // Ukurannya diikat ke tinggi logo supaya tidak timpang saat diperbesar.
  assert.match(src, /tinggi \* 0\.72/, "ukuran kata tidak terikat tinggi logo");
});

test("warna kata bisa diatur pemanggil — dipakai di atas putih DAN gelap", () => {
  const src = kode("app/_components/Logo.tsx");
  assert.match(src, /warnaKata/, "warna kata dipaku, padahal dipakai di dua latar");
  // Sidebar dashboard berlatar gelap; satu warna tetap akan hilang di salah satu.
  assert.match(kode("app/dashboard/_components/DashboardChrome.tsx"), /warnaKata="text-amber-400"/);
});

test("TIDAK ADA indigo di permukaan yang dilihat pelanggan brand", () => {
  // Indigo bukan warna merek ini: /brands memakai zinc-900 untuk tombol utama
  // dan amber-500 untuk aksen. Logo AIUGC.ID oranye — biru bertabrakan dengannya.
  for (const f of [
    "app/onboarding/OnboardingClient.tsx",
    "app/brands/page.tsx",
    "app/dashboard/daftar/page.tsx",
    "app/dashboard/menunggu/page.tsx",
    "app/dashboard/_components/DashboardChrome.tsx",
  ]) {
    assert.doesNotMatch(kode(f), /indigo|#4f46e5/i, `${f} masih memakai indigo`);
  }
});

test("tombol brand memakai zinc-900, warna tombol setara di /brands", () => {
  const src = kode("app/onboarding/OnboardingClient.tsx");
  assert.match(src, /#18181b/, "tombol brand bukan zinc-900");
  // /brands memakai zinc-900 untuk tombol "Masuk" di header, dan halaman ini
  // adalah tujuan tombol itu.
  assert.match(kode("app/brands/page.tsx"), /bg-zinc-900/);
});
