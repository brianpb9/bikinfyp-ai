// Label promo dalam kurung di judul marketplace.
//
// Bug yang memblokir Brian 16 Agu 2026: judul "[ SPECIAL MEGA LIVE ] JJ Glow
// Sabun Gluta Pink Barsoap ..." dipendekkan menjadi "[ SPECIAL MEGA LIVE ]" —
// label promonya disimpan, nama produknya dibuang. Sebabnya pemotongan
// mengambil enam kata PERTAMA, dan enam kata pertama judul itu adalah labelnya.
//
// Akibatnya seluruh varian skrip gagal validasi dan dia tidak bisa membuat
// video sama sekali, sementara pesan errornya cuma menebak-nebak sebabnya.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanProductName } from "../lib/extract";

test("label promo dalam kurung dibuang, nama produk dipertahankan", () => {
  const kasus: [string, string][] = [
    ["[ SPECIAL MEGA LIVE ] JJ Glow Sabun Gluta Pink Barsoap Gluta Pink Soap With 10X Brightening", "JJ Glow Sabun Gluta Pink Barsoap"],
    ["(FLASH SALE) Serum Vitamin C 30ml Original BPOM", "Serum Vitamin C Original BPOM"],
    ["【BARU】Hijab Voal Premium Motif Bunga", "Hijab Voal Premium Motif Bunga"],
  ];
  for (const [masuk, harap] of kasus) {
    assert.equal(cleanProductName(masuk), harap, `judul: ${masuk.slice(0, 40)}`);
  }
});

test("nama yang sudah pendek tidak dirusak", () => {
  for (const n of ["Wardah Perfect Bright Cleanser", "Serum Wardah", "Sabun Gluta Pink"]) {
    assert.equal(cleanProductName(n), n);
  }
});

// Kalau SELURUH judul ada di dalam kurung, membuangnya menyisakan string kosong.
// Lebih baik pulangkan judulnya daripada nama produk kosong.
test("judul yang seluruhnya di dalam kurung tidak dikosongkan", () => {
  const hasil = cleanProductName("[ SEMUA JUDUL DI DALAM KURUNG ]");
  assert.ok(hasil.length >= 3, `tidak boleh kosong, dapat: ${JSON.stringify(hasil)}`);
  assert.match(hasil, /JUDUL/);
});
