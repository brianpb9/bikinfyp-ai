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
process.env.APP_BASE_URL = "https://aiugc.id";

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

// ATURAN RINCIAN ITEM DUITKU — diverifikasi ke sandbox mereka, bukan ditebak.
//
// 3 Sep 2026: mengirim {price: 14000, quantity: 2} dengan paymentAmount 28000
// ditolak HTTP 409 "Payment amount must be equal to all item price". Mereka
// MENJUMLAHKAN price saja; quantity tidak ikut dikalikan. Aritmetika yang
// terasa benar bagi kita (price x quantity) menghasilkan pesanan yang pasti
// ditolak — dan penolakannya muncul sebagai 500 di layar pembeli.
test("rincian item memakai aturan Duitku: jumlah price = nilai tagihan", () => {
  const src = baca("lib/duitku.ts");
  assert.match(
    src,
    /reduce\(\(n, i\) => n \+ i\.price, 0\)/,
    "pemeriksaan rincian memakai price x quantity — Duitku akan menolaknya 409",
  );
  assert.ok(
    !/n \+ i\.price \* i\.quantity/.test(src),
    "aritmetika lama kembali: Duitku tidak mengalikan quantity",
  );
});

test("checkout kredit video mengirim TOTAL BARIS, bukan harga satuan", () => {
  const rute = baca("app/api/kredit-video/checkout/route.ts");
  // Jumlah barisnya tetap terbaca pembeli lewat NAMA baris, jadi tidak ada
  // informasi yang hilang dari kuitansi.
  assert.match(rute, /price: \(harga\[i\.jenis\] as number\) \* i\.qty/, "price masih harga satuan — pesanan akan ditolak 409");
  assert.match(rute, /quantity: 1/, "quantity harus 1 saat price sudah berisi total baris");
  assert.match(rute, /name: `\$\{i\.qty\}× Video/, "jumlah video hilang dari rincian yang dilihat pembeli");
});

test("penolakan Duitku membawa alasannya, bukan cuma kode HTTP", () => {
  // "HTTP 409 inquiry gagal" tanpa satu pun petunjuk adalah kalimat yang
  // membuang waktu berjam-jam: penolakannya punya alasan, tapi alasannya
  // dibuang sebelum sempat terbaca — res.json() yang gagal menghasilkan objek
  // kosong, dan statusMessage jadi undefined.
  const src = baca("lib/duitku.ts");
  assert.match(src, /const mentah = await res\.text\(\)/, "badan jawaban Duitku masih dibuang sebelum terbaca");
  assert.match(src, /mentah\.slice\(0, 300\)/, "alasan penolakan tidak ikut di pesan galat");
});

// ── PERTAHANAN BAYAR DUA KALI ──────────────────────────────────────────────
//
// Cara paling umum orang membayar dua kali bukan karena serakah, melainkan
// karena ragu: menekan Bayar, tidak menyelesaikannya, lalu kembali dan menekan
// lagi. Tanpa penjagaan, ia mendapat DUA nomor VA yang dua-duanya hidup.

test("checkout melanjutkan pesanan yang sama, bukan membuat invoice kedua", () => {
  const rute = baca("app/api/kredit-video/checkout/route.ts");
  assert.match(rute, /pesananTertundaSama\(user\.id, sidik\)/, "checkout tidak mencari pesanan tertunda yang sama");
  assert.match(rute, /dilanjutkan: true/, "klien tidak diberi tahu bahwa ini pesanan lama");
  // Sidiknya harus menutup ISI pesanan — paket DAN jumlah tiap jenis. Sidik
  // yang cuma melihat paket akan menganggap dua pesanan berbeda sebagai sama.
  assert.match(rute, /function sidikPesanan\(paketId: string \| null, items: ItemTopup\[\]\)/);
  assert.match(rute, /items\.map\(\(i\) => `\$\{i\.jenis\}x\$\{i\.qty\}`\)/, "sidik tidak menutup jumlah tiap jenis");
});

test("pesanan lama hanya dilanjutkan kalau nomornya BENAR-BENAR ada", () => {
  // Pesanan yang gagal di tengah jalan tidak punya nomor VA; mengembalikannya
  // berarti menyerahkan tagihan yang tidak bisa dibayar.
  const rute = baca("app/api/kredit-video/checkout/route.ts");
  assert.match(rute, /jejak\.provider && jejak\.provider\.redirect_url/, "pesanan tanpa jejak gateway ikut dilanjutkan");
  assert.match(rute, /simpanJejakProvider\(orderId, \{/, "jawaban gateway tidak disimpan — pesanan tidak akan bisa dilanjutkan");
});

test("batas 60 menit mengikuti masa berlaku invoice, bukan angka karangan", () => {
  const rute = baca("app/api/kredit-video/checkout/route.ts");
  assert.match(rute, /60 \* 60_000/, "batas pesanan tertunda tidak lagi 60 menit");
  // Angka yang sama dipakai saat memberi tahu Duitku umur invoicenya.
  assert.match(baca("lib/duitku.ts"), /expiryPeriod: 60/, "masa berlaku invoice berubah — samakan batas pesanan tertunda");
});

test("pesanan campuran memberi keduanya, dan tahu dari ISI bukan dari label", () => {
  const webhook = baca("app/api/webhooks/duitku/route.ts");
  // Paket dari paket_id, satuan dari pesanan_item — keduanya diberikan kalau
  // keduanya ada, tanpa menebak dari jenis_pesanan.
  assert.match(webhook, /if \(paketId\) \{/, "webhook tidak memberi paket berdasarkan isinya");
  assert.match(webhook, /const kredit = await kreditkanTopup\(payment\.user_id, orderId\);/, "webhook tidak memberi kredit satuan pada pesanan campuran");
  assert.ok(
    !/jenisPesanan === "topup_video"|jenisPesanan === "langganan"/.test(webhook),
    "webhook kembali bercabang dari label, bukan dari isi pesanan",
  );
});
