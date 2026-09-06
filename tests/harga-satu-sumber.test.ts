import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PAKET_KREDIT, TIER_HARGA, TIER_PENSIUN, rentangHarga, tierMasihDijual } from "../lib/paket-kredit";
import { config } from "../lib/config";

// Harga muncul di dua tempat yang tidak bisa saling impor: config.ts
// (server-only, dipakai menahan kredit saat job dibuat) dan paket-kredit.ts
// (aman-klien, dipakai halaman harga publik dan checkout).
//
// Daftar harga yang hanyut bukan bug kosmetik. Yang membaca halaman publik
// justru reviewer Midtrans — temuan onboarding 2026-08-13 berbunyi "tidak
// menemukan harga untuk barang/jasa pada website" — dan pelanggan yang
// melihat satu angka lalu ditagih angka lain punya alasan sah untuk komplain.
test("daftar cadangan harga tidak boleh berbeda dari yang ditagih", () => {
  // TIER_HARGA sekarang CADANGAN, bukan sumber utama: /harga membaca harga
  // yang benar-benar berlaku dari database (harga_kredit_video), karena harga
  // itu bisa diubah admin tanpa deploy dan daftar yang diketik di kode dijamin
  // hanyut. Yang tetap dijaga: selama cadangan itu masih bisa tampil, angkanya
  // harus sama dengan yang ditagih config.tiers.
  for (const tier of TIER_HARGA) {
    const asli = config.tiers[tier.id]?.priceIdr;
    assert.equal(tier.hargaIdr, asli, `${tier.id}: cadangan menulis ${tier.hargaIdr}, config menagih ${asli}`);
  }
});

test("/harga membaca harga yang BERLAKU, bukan daftar yang diketik di kode", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const halaman = fs.readFileSync(path.join(process.cwd(), "app/harga/page.tsx"), "utf8");
  // Yang dicegah: halaman publik memajang angka lama sementara pembeli ditagih
  // angka baru — temuan onboarding gateway pembayaran 13 Agu 2026 dalam bentuk
  // yang lebih halus.
  assert.match(halaman, /hargaKredit\(\)/, "halaman harga tidak membaca harga yang berlaku");
  assert.match(halaman, /daftarPaket\(true\)/, "paket langganan tidak dipajang dari sumbernya");
  assert.match(halaman, /force-dynamic/, "halaman harga dibekukan saat build — perubahan admin tidak akan terlihat");
});

// Arah sebaliknya, dan ini yang bobol 16 Agu 2026: /harga memajang "Video Teks"
// seharga Rp5.000 sementara API generate menolaknya dengan pesan "sudah tidak
// tersedia". Halaman publik mengiklankan barang yang mesinnya sendiri tolak.
test("tidak ada tier pensiun yang masih dipajang di halaman harga", () => {
  const dipajang = TIER_HARGA.filter((t) => !tierMasihDijual(t.id)).map((t) => t.id);
  assert.deepEqual(dipajang, [], "tier ini sudah pensiun tapi masih dijual di /harga");
});

test("daftar pensiun tidak kosong dan tidak memakan seluruh katalog", () => {
  assert.ok(TIER_PENSIUN.length >= 1, "silent_caption memang sudah pensiun — daftarnya jangan dikosongkan");
  assert.ok(TIER_HARGA.length >= 2, "halaman harga kehilangan hampir seluruh tier");
});

test("paket kredit konsisten dengan harga per video", () => {
  const perVideo: Record<string, number> = { hq5: 12_000, hq10: 12_000, super5: 80_000 };
  for (const p of PAKET_KREDIT) {
    assert.equal(p.price, p.jumlahVideo * perVideo[p.id],
      `${p.id}: harga paket ${p.price} tidak sama dengan ${p.jumlahVideo} × ${perVideo[p.id]}`);
  }
});

// Tes ini dulu MENGETIK angka yang judulnya sendiri melarang: min 5.000 — harga
// tier yang sudah pensiun. Jadi ia ikut membekukan harga usang, bukan
// menjaganya. Sekarang dibandingkan dengan data, bukan dengan angka hafalan.
test("rentang harga dihitung, bukan diketik", () => {
  const r = rentangHarga();
  const semua = [...TIER_HARGA.map((t) => t.hargaIdr), ...PAKET_KREDIT.map((x) => x.price)];
  assert.equal(r.min, Math.min(...semua));
  assert.equal(r.max, Math.max(...semua));
  // Tier pensiun tidak boleh ikut membentuk rentang yang dipajang publik.
  for (const id of TIER_PENSIUN) {
    const harga = config.tiers[id]?.priceIdr;
    if (harga !== undefined) assert.notEqual(r.min, harga, `rentang publik masih memakai harga tier pensiun ${id}`);
  }
});

// Retail dan enterprise membaca katalog template yang SAMA.
//
// Sampai 2026-08-15 enterprise memakai 33 template yang sudah dirender dan
// lolos dua pemeriksa mutu, sementara retail memakai TIGA preset tanpa video
// contoh. Tidak ada alasan produk untuk beda itu — penjual perorangan justru
// yang paling butuh pilihan yang sudah terbukti, karena mereka tidak punya
// tim kreatif untuk menebak konsep sendiri.
test("template retail diambil dari katalog yang sama, disaring untuk FYP", async () => {
  const { templateUntukRetail, presetRetail } = await import("../lib/template-untuk-retail");
  const { CAMPAIGN_TEMPLATES } = await import("../lib/templates");
  const retail = templateUntukRetail();

  assert.ok(retail.length >= 20, `retail cuma dapat ${retail.length} template — terlalu sedikit`);
  // 16:9 TIDAK boleh ikut: TVC dirender landscape untuk TV, seluruh alur retail
  // 9:16 untuk FYP. Menawarkannya berarti menjual video salah bentuk.
  for (const t of retail) {
    const asli = CAMPAIGN_TEMPLATES.find((x) => x.id === t.id)!;
    assert.notEqual(asli.ratio, "16:9", `${t.id}: rasio TV bocor ke retail`);
    assert.ok(t.durationSec <= 30, `${t.id}: ${t.durationSec} dtk terlalu panjang untuk FYP`);
  }
  // Preset harus cocok dengan template aslinya — bukan salinan yang bisa hanyut.
  for (const t of retail.slice(0, 5)) {
    const p = presetRetail(t.id)!;
    const asli = CAMPAIGN_TEMPLATES.find((x) => x.id === t.id)!;
    assert.equal(p.format, asli.format);
    assert.equal(p.durationSec, asli.durationSec);
  }
});

// ── Layar promosi berhenti mengarang harga ──────────────────────────────────
//
// Angka di layar promosi adalah angka yang paling lama tidak ada yang
// memperbaiki: "Rp12.000 per video" masih terpampang sesudah harganya berubah,
// dan "bonus Rp12.000" masih terpampang sesudah bonusnya berhenti berupa
// rupiah. Keduanya klaim ke publik, bukan detail internal.

test("halaman promosi tidak menuliskan harga sendiri", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  for (const halaman of ["app/onboarding/page.tsx", "app/coba/page.tsx", "app/mulai/page.tsx", "app/layout.tsx"]) {
    const src = baca(halaman);
    // Baris komentar boleh menyebut angka lama sebagai catatan sejarah; yang
    // dilarang adalah angka yang benar-benar dirender ke layar.
    const terlihat = src
      .split("\n")
      .filter((b) => !b.trim().startsWith("//") && !b.trim().startsWith("*"))
      .join("\n");
    assert.ok(
      !/Rp\s?12[.,]000|Rp\s?5[.,]000|Rp\s?80[.,]000/.test(terlihat),
      `${halaman} masih menuliskan harga sendiri — ia akan hanyut dari yang ditagih`,
    );
  }

  // Dan sumber publiknya benar-benar ada, tanpa login.
  const rute = baca("app/api/harga-publik/route.ts");
  assert.match(rute, /hargaKredit\(\)/, "rute publik tidak membaca harga yang berlaku");
  assert.ok(!/getAuthUser/.test(rute), "rute harga publik menuntut login — halaman promosi tidak bisa memakainya");
  assert.match(baca("app/onboarding/page.tsx"), /\/api\/harga-publik/, "onboarding tidak membaca harga dari server");
});

const bacaSumber = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

/**
 * Sumber TANPA komentar.
 *
 * Dua kali dalam satu hari (admin & halaman ini) tes yang memeriksa isi berkas
 * lulus atau jatuh karena KOMENTAR, bukan karena kodenya: komentar yang
 * menjelaskan "dulu di sini tertulis X" membuat pencarian X tetap ketemu.
 * Komentar dibuang lebih dulu supaya yang diperiksa benar-benar kodenya.
 */
const kodeSaja = (rel: string) =>
  bacaSumber(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((b) => !/^\s*\/\//.test(b))
    .join("\n");

// ── LAYAR PROMOSI TIDAK BOLEH MENYIMPAN HARGA SENDIRI (6 Sep 2026) ──────────
//
// Dilaporkan Brian: kalkulator hemat biaya dan section "Harga transparan" di
// /onboarding masih memajang "AI Bersuara Rp12.000" dan "Bersuara Pro
// Rp80.000" — dua paket yang pensiun 2 Sep 2026 saat susunan
// standard/premium/ultra berlaku. Angka DAN nama layanannya sama-sama basi,
// karena dua-duanya diketik di berkas halaman.

test("kalkulator & section harga di /onboarding dibaca dari server, bukan diketik", () => {
  const src = kodeSaja("app/onboarding/page.tsx");
  // Paket yang sudah pensiun tidak boleh muncul lagi di layar promosi.
  for (const pensiun of ["AI Bersuara", "Bersuara Pro"]) {
    assert.doesNotMatch(src, new RegExp(pensiun), `paket pensiun "${pensiun}" masih dipajang`);
  }
  // Harga paket TIDAK boleh berupa literal di halaman ini.
  assert.doesNotMatch(src, /12_000|80_000/, "harga paket diketik sebagai literal");
  assert.match(src, /fetch\("\/api\/harga-publik"\)/, "harga harus diambil dari /api/harga-publik");
  assert.match(src, /paket\.map/, "daftar paket harus dirender dari data server");
});

test("angka pembanding kalkulator punya SATU tempat dan sumbernya disebut", () => {
  const src = kodeSaja("app/onboarding/page.tsx");
  assert.match(src, /BIAYA_MANUSIA_PER_VIDEO = 125_000/, "pembanding harus satu konstanta bernama");
  // Sumbernya wajib ikut tampil. Kalkulator yang membandingkan dengan angka
  // tanpa sumber bukan kalkulator — itu iklan yang menyamar jadi hitungan.
  assert.match(src, /Fastwork/, "sumber angka pembanding harus disebut di halaman");
  // Hanya boleh muncul sekali sebagai literal: di deklarasi konstantanya.
  assert.equal((src.match(/125_000/g) ?? []).length, 1, "angka pembanding diketik lebih dari sekali");
});

test("API harga publik mengirim penjelasan paket, supaya halaman tidak menuliskannya", () => {
  assert.match(kodeSaja("app/api/harga-publik/route.ts"), /jelas: KUALITAS\[j\]\.jelas/);
});
