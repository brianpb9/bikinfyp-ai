// QC-12 MENOLAK HARGA YANG DIUCAPKAN DENGAN BENAR (job 615855d8, 9 Sep 2026).
//
// Naskah yang dirender, kata demi kata:
//
//   "Harganya cuma sembilan belas ribu sembilan ratus dong, cek keranjang ya."
//
// Harga produk: Rp19.900. VO mengucapkannya persis. QC-12 menolak:
//
//   QC-12 fail: harga Rp19.900 tidak terdengar di VO
//
// Sebabnya satu baris. Versi lama menghitung Math.round(19900 / 1000) = 20,
// lalu mencari "20" di transkrip, atau — kalau tidak ketemu — digit-digitnya
// dieja satu per satu: "dua", lalu "nol". Tidak ada penutur bahasa Indonesia
// yang mengucapkan "dua nol", dan naskahnya sendiri tidak pernah memuat angka
// 20. Gerbang itu menuntut mendengar harga yang tidak pernah diminta diucapkan.
//
// Ini bukan kasus tepi: harga eceran Indonesia hampir selalu berakhir 9.900 /
// 4.900 / 9.500, jadi pembulatannya meleset justru pada bentuk harga yang
// paling umum dipakai penjual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memuatHarga, bentukHargaDiterima } from "../lib/media/qc-suara";
import { terbilang } from "../lib/script-engine/terbilang";

test("kalimat yang benar-benar dirender job 615855d8 diterima", () => {
  const vo = "Harganya cuma sembilan belas ribu sembilan ratus dong, cek keranjang ya.";
  assert.equal(memuatHarga(vo, 19900), true, "harga yang diucapkan benar masih ditolak");
});

test("harga berakhir 900 — bentuk paling umum di ritel Indonesia", () => {
  for (const [harga, vo] of [
    [19900, "harganya sembilan belas ribu sembilan ratus"],
    [89900, "cuma delapan puluh sembilan ribu sembilan ratus aja"],
    [149900, "seratus empat puluh sembilan ribu sembilan ratus"],
    [4900, "empat ribu sembilan ratus doang"],
  ] as [number, string][]) {
    assert.equal(memuatHarga(vo, harga), true, `Rp${harga} ditolak padahal diucapkan benar`);
  }
});

test("VO yang memendekkan ke '...ribu' tetap diterima", () => {
  // Orang bicara memang memendekkan; yang disebut tetap harga yang benar.
  assert.equal(memuatHarga("harganya sembilan belas ribu aja kok", 19900), true);
  assert.equal(memuatHarga("cuma 19 ribu", 19900), true);
});

test("bentuk angka tertulis diterima setelah normalisasi tanda baca", () => {
  // rapikan() membuang titik, jadi "19.900" menjadi "19 900".
  assert.equal(memuatHarga("cuma Rp19.900 loh", 19900), true);
  assert.equal(memuatHarga("harganya 19900", 19900), true);
});

test("harga yang SALAH tetap ditolak — gerbangnya tidak dilemahkan", () => {
  // Ini alasan QC-12 ada: harga salah bukan cacat estetika, itu klaim
  // komersial yang salah, dan penjual yang menanggung akibatnya.
  assert.equal(memuatHarga("harganya dua ratus ribu rupiah", 19900), false);
  assert.equal(memuatHarga("bagus banget deh pokoknya, cek keranjang", 19900), false);
  assert.equal(memuatHarga("cuma sembilan ribu", 89900), false);
});

test("tidak ada pembulatan: yang dituntut selalu harga sebenarnya", () => {
  // Pembulatan adalah cacat aslinya. Bentuk yang diterima untuk 19.900 tidak
  // boleh memuat "20" sebagai kata harga.
  const bentuk = bentukHargaDiterima(19900);
  assert.ok(!bentuk.includes("20 ribu"), `bentuk membulatkan ke 20 ribu: ${bentuk.join(" | ")}`);
  assert.ok(!bentuk.some((b) => b.startsWith("dua puluh")), "bentuk masih membulatkan ke dua puluh");
  // Dan yang dipakai penulis naskah HARUS ada di daftar yang diterima QC.
  assert.ok(bentuk.includes(terbilang(19900)), "bentuk yang ditulis mesin naskah tidak diterima QC");
});

test("QC memakai pengubah angka yang SAMA dengan penulis naskah", () => {
  // Satu sumber: yang kita suruh ucapkan dan yang kita tuntut didengar tidak
  // boleh berasal dari dua tabel berbeda yang bisa hanyut sendiri-sendiri.
  for (const harga of [19900, 35000, 89900, 250000]) {
    assert.equal(memuatHarga(`harganya ${terbilang(harga)} ya`, harga), true, `Rp${harga}`);
  }
});
