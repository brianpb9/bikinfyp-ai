// KANAL PEMBAYARAN DUITKU — QRIS dan Virtual Account.
//
// Kode kanal di sini BUKAN dari dokumentasi maupun ingatan. Diambil dari
// getPaymentMethod milik merchant DS34363 pada 2 Sep 2026, dan kontrak
// transaksinya diverifikasi terhadap sandbox nyata:
//
//   I1 (BNI VA)     -> vaNumber 8869001900442769
//   NQ (QRIS Nobu)  -> qrString 00020101021226670016COM.NOBUBANK...
//   signature       = md5(merchantCode + merchantOrderId + amount + apiKey)
//
// Kanal yang aktif BERBEDA PER MERCHANT, jadi daftar dari sumber lain bisa
// memuat kanal yang akun ini tidak punya — dan itu baru ketahuan saat pembeli
// menekannya.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-kanal-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-kanal-storage-${process.pid}`;
process.env.PAYMENT_GATEWAY = "duitku";
process.env.DUITKU_MERCHANT_CODE = "DS34363";
process.env.DUITKU_API_KEY = "kunci-uji";
process.env.DUITKU_IS_PRODUCTION = "false";
process.env.APP_BASE_URL = "https://bikinfyp.com";

const D = await import("../lib/duitku");
const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

test("hanya QRIS dan VA yang ditawarkan", () => {
  assert.ok(D.KANAL_DUITKU.length > 0);
  for (const k of D.KANAL_DUITKU) {
    assert.ok(["qris", "va"].includes(k.jenis), `${k.kode} bukan QRIS/VA`);
    assert.match(k.kode, /^[A-Z0-9]{2}$/, `kode kanal ${k.kode} tidak berbentuk kode Duitku`);
  }
  assert.ok(D.KANAL_DUITKU.some((k) => k.jenis === "qris"), "QRIS tidak ditawarkan");
  assert.ok(D.KANAL_DUITKU.some((k) => k.jenis === "va"), "VA tidak ditawarkan");
});

test("BCA VA (BC) TIDAK ditawarkan — satu-satunya kanal berbiaya", () => {
  // totalFee Rp5.000 saat semua kanal lain nol. Memasukkannya tanpa keputusan
  // sadar menyusutkan margin diam-diam di setiap pembelian lewat BCA.
  assert.ok(!D.kanalSah("BC"), "BCA VA masuk daftar — margin bocor Rp5.000/transaksi");
});

test("kanal di luar daftar DITOLAK", () => {
  for (const kode of ["VC", "DN", "IR", "SP", "", "qris", "I1 "]) {
    assert.equal(D.kanalSah(kode), false, `"${kode}" lolos padahal tidak ditawarkan`);
  }
  assert.equal(D.kanalSah("NQ"), true);
  assert.equal(D.kanalSah("I1"), true);
});

test("HOST v2 berbeda dari host POP — dan itu bukan salah ketik", () => {
  // createInvoice hidup di api-sandbox/api-prod; v2 inquiry di
  // sandbox.duitku.com/webapi. Host yang salah menjawab 404, bukan galat yang
  // menjelaskan dirinya.
  assert.notEqual(D.duitkuBaseV2(), D.duitkuBase());
  assert.match(D.duitkuBaseV2(), /webapi$/);
});

test("kanal DIVALIDASI DI SERVER, bukan dipercaya dari klien", () => {
  const route = baca("app/api/credits/checkout/route.ts");
  assert.match(route, /kanalSah\(method\)/, "server tidak memvalidasi kanal kiriman klien");
  const meta = baca("app/api/meta/route.ts");
  assert.match(meta, /payment_channels: KANAL_DUITKU\.map/, "daftar kanal tidak berasal dari server");
  const page = baca("app/kredit/page.tsx");
  assert.match(page, /setKanal\(Array\.isArray\(m\.payment_channels\)/, "halaman tidak membaca daftar dari server");
});

test("tanda tangan v2 memakai formula yang diverifikasi ke sandbox", () => {
  const src = baca("lib/duitku.ts");
  const v2 = src.slice(src.indexOf("createDuitkuTransaction"));
  assert.match(v2, /createHash\("md5"\)/);
  // Nilai tagihan tidak lagi selalu berasal dari daftar paket rupiah: kredit
  // per jenis video jumlahnya disusun pembeli, jadi ia datang sebagai
  // `tagihan.amountIdr`. URUTAN komponennya yang dijaga tes ini, dan itu tidak
  // berubah — merchantCode, orderId, nilai, apiKey.
  assert.match(
    v2,
    /config\.duitkuMerchantCode \+ opts\.orderId \+ String\(tagihan\.amountIdr\) \+ config\.duitkuApiKey/,
    "urutan komponen tanda tangan berubah — Duitku akan menolak seluruh transaksi",
  );
  // Dan nilai yang DITANDATANGANI wajib nilai yang sama dengan yang dikirim di
  // badan permintaan. Keduanya kini datang dari satu objek; kalau suatu saat
  // dipisah lagi, tagihan yang ditandatangani bisa berbeda dari yang ditagih.
  assert.match(v2, /paymentAmount: tagihan\.amountIdr/, "nilai yang ditandatangani dan yang dikirim harus satu sumber");
});
