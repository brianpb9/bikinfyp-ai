import { test } from "node:test";
import assert from "node:assert/strict";
import { PAKET_KREDIT, TIER_HARGA, rentangHarga } from "../lib/paket-kredit";
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
  // Setiap tier di config harus punya wajah publiknya. Tier yang dijual tapi
  // tidak pernah dipajang adalah harga tersembunyi.
  for (const id of Object.keys(config.tiers)) {
    assert.ok(TIER_HARGA.some((t) => t.id === id), `tier ${id} dijual tapi tidak muncul di halaman harga`);
  }
});

test("paket kredit konsisten dengan harga per video", () => {
  const perVideo: Record<string, number> = { hq5: 12_000, hq10: 12_000, super5: 80_000 };
  for (const p of PAKET_KREDIT) {
    assert.equal(p.price, p.jumlahVideo * perVideo[p.id],
      `${p.id}: harga paket ${p.price} tidak sama dengan ${p.jumlahVideo} × ${perVideo[p.id]}`);
  }
});

test("rentang harga dihitung, bukan diketik", () => {
  const r = rentangHarga();
  assert.equal(r.min, 5_000);
  assert.equal(r.max, 400_000);
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
