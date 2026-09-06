// STATUS PEMBAYARAN — dan kenapa transaksi bisa "menyangkut".
//
// Dilaporkan Brian 2 Sep: pembayaran SUKSES di Duitku, tapi layar bikinfyp.com
// terus berkata belum masuk. Bukti dari audit produksi:
//
//   18:51:55  payment.checkout         racun-…c63fcb8e-ef1e   status=pending
//   18:52:21  webhook.sandbox_ditolak  racun-…c63fcb8e-ef1e
//
// Duitku MEMANGGIL callback dan tanda tangannya LOLOS. Yang menahan: gerbang
// sandbox menolak mengkredit pemilik non-penguji, lalu keluar lebih awal TANPA
// menyentuh baris payments — jadi ia "pending" selamanya, dan tidak ada cara
// membedakan order yang belum dibayar dari yang sudah dibayar tapi sengaja
// tidak dikreditkan.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-bayar-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-bayar-storage-${process.pid}`;
process.env.ADMIN_EMAILS = "bos@aiugc.test";
process.env.SANDBOX_TESTER_EMAILS = "penguji@aiugc.test, lain@aiugc.test";

const { apakahPengujiSandbox, apakahAdmin } = await import("../lib/admin-auth");
const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

test("gerbang sandbox MENCATAT hasil walau kredit ditahan", () => {
  // Inti perbaikannya. Keluar tanpa menulis status adalah yang membuat order
  // menggantung selamanya.
  const src = baca("app/api/webhooks/duitku/route.ts");
  const blok = src.slice(src.indexOf("paymentsEnv() === \"sandbox\""), src.indexOf("if (resultCode === \"00\") {"));
  assert.match(blok, /tandaiStatus\(payment\.id, "sandbox_paid", payload\)/, "keluar tanpa mencatat status");
  assert.match(blok, /credited: false/, "kredit tidak boleh diberikan di jalur ini");
});

test('"sandbox_paid" BUKAN "paid" — laporan keuangan tidak boleh menghitung uang mainan', () => {
  const src = baca("app/api/webhooks/duitku/route.ts");
  assert.doesNotMatch(
    src.slice(src.indexOf("apakahPengujiSandbox(email)"), src.indexOf("if (resultCode === \"00\") {")),
    /tandaiStatus\([^)]*"paid"/,
    "pembayaran sandbox ditandai lunas seperti uang sungguhan",
  );
  // Dan admin melaporkan pendapatan hanya dari status 'paid'.
  assert.match(baca("app/admin/page.tsx"), /WHERE status = 'paid'/);
});

test("penguji sandbox TERPISAH dari admin", () => {
  // Menjadikan penguji sebagai admin demi mencoba alur beli berarti memberi
  // akses dashboard operator untuk alasan yang tidak berhubungan.
  assert.equal(apakahPengujiSandbox("penguji@aiugc.test"), true);
  assert.equal(apakahAdmin("penguji@aiugc.test"), false, "penguji ikut jadi admin");
  assert.equal(apakahPengujiSandbox("bos@aiugc.test"), true, "admin harus tetap bisa menguji");
  assert.equal(apakahPengujiSandbox("orang.lain@contoh.com"), false);
  assert.equal(apakahPengujiSandbox(null), false);
});

test("daftar penguji dibaca dari config, supaya bisa diganti tanpa restart", () => {
  // Membaca process.env di sini membuat penggantian lewat halaman kredensial
  // tidak berpengaruh — kegagalan diam, karena halamannya tetap bilang
  // "tersimpan".
  const src = baca("lib/admin-auth.ts");
  assert.match(src, /config\.sandboxTesterEmails/);
  assert.doesNotMatch(src, /process\.env\.SANDBOX_TESTER_EMAILS/);
});

test("cek status BENAR-BENAR bertanya ke Duitku saat masih pending", () => {
  // Kalau callback hilang, membaca database sendiri selamanya menjawab
  // "pending" dan satu-satunya yang tahu adalah pembeli yang komplain.
  const src = baca("app/api/orders/[orderId]/route.ts");
  assert.match(src, /duitkuStatusTransaksi\(orderId\)/);
  assert.match(src, /dicek_ke_gateway/, "jawaban tidak menyatakan apakah gateway benar-benar ditanya");
});

test("cek status TIDAK PERNAH menambah kredit", () => {
  // Rute ini dipanggil dari browser. Menjadikannya pemicu penambahan saldo
  // membuka jalur penambahan uang yang tanda tangannya tidak diverifikasi.
  const src = baca("app/api/orders/[orderId]/route.ts");
  assert.doesNotMatch(src, /creditTopup|pgCreditTopup/, "rute browser bisa menambah saldo");
});

test("pembatalan hanya untuk pesanan yang BELUM dibayar", () => {
  const src = baca("app/api/orders/[orderId]/route.ts");
  assert.match(src, /export async function DELETE/);
  assert.match(src, /status = 'cancelled'.*status = 'pending'/s, "pembatalan tidak dibatasi pesanan pending");
  assert.match(src, /tetap berlaku sampai kedaluwarsa/, "tidak menyebut bahwa VA yang terbit masih hidup");
});

test("email dikirim saat order dibuat DAN saat lunas — masing-masing sekali", () => {
  const checkout = baca("app/api/credits/checkout/route.ts");
  assert.match(checkout, /emailOrderDibuat\(/);
  assert.match(checkout, /void emailOrderDibuat/, "email menahan respons checkout yang sudah berhasil");

  const webhook = baca("app/api/webhooks/duitku/route.ts");
  assert.match(webhook, /if \(!result\.duplicated\) \{/, "callback ulangan mengirim email berulang");
  assert.match(webhook, /emailPembayaranLunas\(/);
});

test("kegagalan email tidak pernah membatalkan pembayaran", () => {
  const src = baca("lib/email-pembayaran.ts");
  assert.match(src, /catch \(err\)/);
  assert.doesNotMatch(src, /throw new Error\(`resend/, "email melempar dan bisa menjatuhkan checkout");
});

test("panduan bayar BERBEDA antara VA dan QRIS", () => {
  // Penerima nomor VA butuh tahu ke bank mana; yang memilih QRIS butuh tahu
  // bahwa nomor VA memang tidak ada untuknya. Panduan generik membuat keduanya
  // ragu apakah mereka salah langkah.
  const src = baca("lib/email-pembayaran.ts");
  assert.match(src, /if \(vaNumber\) \{/);
  assert.match(src, /Virtual Account/);
  assert.match(src, /QRIS/);
});
