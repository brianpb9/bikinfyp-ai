import test from "node:test";
import assert from "node:assert/strict";
import { terbilang, hargaTerbilang } from "../lib/script-engine/terbilang";

test("terbilang: angka dasar", () => {
  assert.equal(terbilang(299000), "dua ratus sembilan puluh sembilan ribu");
  assert.equal(terbilang(85000), "delapan puluh lima ribu");
  assert.equal(terbilang(1_499_000), "satu juta empat ratus sembilan puluh sembilan ribu");
  assert.equal(terbilang(159000), "seratus lima puluh sembilan ribu");
  assert.equal(terbilang(12000), "dua belas ribu");
  assert.equal(terbilang(1000), "seribu");
});

test("hargaTerbilang: pola harga dikonversi, kode produk TIDAK", () => {
  assert.equal(hargaTerbilang("Cuma Rp299.000 aja"), "Cuma dua ratus sembilan puluh sembilan ribu rupiah aja");
  assert.equal(hargaTerbilang("cuma 85rb loh"), "cuma delapan puluh lima ribu loh");
  assert.equal(hargaTerbilang("harga 85 ribu"), "harga delapan puluh lima ribu");
  assert.equal(hargaTerbilang("Rp 1.499.000"), "satu juta empat ratus sembilan puluh sembilan ribu rupiah");
  assert.equal(hargaTerbilang("diskon dari 299.000"), "diskon dari dua ratus sembilan puluh sembilan ribu");
  // Kode produk dan angka polos tidak disentuh
  assert.equal(hargaTerbilang("SKIN1004 Centella"), "SKIN1004 Centella");
  assert.equal(hargaTerbilang("Rexus EZ4 dipakai 7 hari"), "Rexus EZ4 dipakai 7 hari");
  assert.equal(hargaTerbilang("Rp2jt"), "dua juta rupiah");
});
