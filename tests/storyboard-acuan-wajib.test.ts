// MEREK HARUS SAMA PERSIS DENGAN YANG DIUNGGAH (Brian, 9 Sep 2026).
//
// "pastikan setiap regenerate image storyboard selalu menggunakan brand yang
//  sama (image sama persis bentuk dan tulisannya) dengan yang diupload
//  pertama kali"
//
// Mekanismenya sudah benar: foto acuan diambil SEKALI per storyboard dari
// kunciFotoProduk lalu diteruskan ke setiap scene, termasuk saat regenerate.
// Yang bocor adalah jalur kegagalannya — kalau berkasnya tidak terbaca dari
// storage, kartu tetap digambar TANPA acuan, dan model mengarang produknya
// dari teks. Cacat itu sudah pernah dibayar (7 Sep: pouch hijau zaitun keluar
// sebagai tas batik cokelat) dan senyap: kartunya jadi, tampak wajar, dan baru
// ketahuan salah sesudah dipakai sebagai frame pertama render.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/postgres/storyboard-worker.ts", import.meta.url), "utf8");
const kode = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("scene yang menampilkan produk GAGAL bila acuannya tidak ada", () => {
  assert.match(
    kode, /if \(!scene\.withhold_product && !fotoProduk\)/,
    "tidak ada penjagaan: kartu masih bisa digambar tanpa acuan produk",
  );
  const blok = kode.slice(kode.indexOf("!scene.withhold_product && !fotoProduk"));
  assert.match(blok.slice(0, 400), /throw new Error/, "acuan hilang tidak melempar — masih degradasi senyap");
});

test("scene yang SENGAJA menahan produk tidak ikut digagalkan", () => {
  // Scene ber-withhold_product memang tidak menerima acuan: menyertakannya di
  // situ justru memunculkan produk di shot yang belum boleh memperlihatkannya.
  // Penjagaan di atas harus mengecualikannya, bukan mematikannya.
  assert.match(kode, /scene\.withhold_product \? null : fotoProduk/, "pengecualian withhold hilang");
});

test("acuan tetap diambil sekali per storyboard dan dipakai semua scene", () => {
  // Inilah yang membuat regenerate memakai gambar yang SAMA PERSIS: satu
  // pengambilan, satu buffer, diteruskan ke tiap scene — bukan diambil ulang
  // per scene, yang membuka pintu bagi dua scene memakai berkas berbeda.
  assert.match(kode, /kunciFotoProduk\(storyboardId\)/);
  assert.match(kode, /gambarSatuScene\(repo, storyboardId, s, fotoProduk\)/);
});
