import { test } from "node:test";
import assert from "node:assert/strict";
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
test("harga per video di halaman = harga yang benar-benar ditagih", () => {
  for (const tier of TIER_HARGA) {
    const asli = config.tiers[tier.id]?.priceIdr;
    assert.equal(tier.hargaIdr, asli, `${tier.id}: halaman menulis ${tier.hargaIdr}, config menagih ${asli}`);
  }
  // Setiap tier AKTIF di config harus punya wajah publiknya. Tier yang dijual
  // tapi tidak pernah dipajang adalah harga tersembunyi.
  //
  // Tier pensiun dikecualikan: config tetap memuat harganya supaya job lama
  // bisa dihitung, tapi ia tidak boleh dipajang lagi.
  for (const id of Object.keys(config.tiers)) {
    if (!tierMasihDijual(id)) continue;
    assert.ok(TIER_HARGA.some((t) => t.id === id), `tier ${id} dijual tapi tidak muncul di halaman harga`);
  }
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
