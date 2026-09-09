// GALAT BERLAPIS DIURAI (Brian 9 Sep 2026: "saya lihat sekarang tercampur").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { uraikanGalat, golonganGalat } from "../lib/urai-galat";

// Teks PERSIS dari layar admin yang Brian tunjukkan.
const NYATA = "Worker gagal setelah 3 percobaan: Semua provider video gagal: "
  + "byteplus-ark-seedance: byteplus: HTTP 400: The request failed because the input image "
  + "'content[3]' may contain sensitive information. Request id: 0217888417788834";

test("inti galat terangkat ke depan, pembungkus dipisah", () => {
  // Dipotong 180 karakter seperti sebelumnya, kalimat penjelasnya terpotong
  // tepat di tengah ("may contain sensiti") dan yang tersisa di layar cuma
  // pembungkus kita sendiri — sebab sebenarnya hilang.
  const u = uraikanGalat(NYATA)!;
  assert.match(u.inti, /^The request failed because/, "inti tidak terangkat");
  assert.match(u.inti, /may contain sensitive information/, "kalimat penjelas terpotong");
  assert.deepEqual(u.lapisan, [
    "Worker gagal setelah 3 percobaan",
    "Semua provider video gagal",
    "byteplus-ark-seedance",
    "byteplus",
    "HTTP 400",
  ]);
  assert.equal(u.httpStatus, 400);
});

test("titik dua DI DALAM pesan provider tidak ikut dipecah", () => {
  // "Request id: 0217888..." adalah bagian kalimat provider, bukan pembungkus.
  // Memecahnya di sana membuang bagian yang justru dipakai menelusuri.
  const u = uraikanGalat(NYATA)!;
  assert.match(u.inti, /Request id: 0217888417788834/, "request id ikut terbuang");
});

test("golongan menyebut TINDAKANNYA, bukan nama teknis", () => {
  // "ganti foto" dan "tunggu" menuntut orang berbeda untuk bertindak.
  assert.equal(golonganGalat("The request failed because the input image may contain sensitive information"), "moderasi foto");
  assert.equal(golonganGalat("task abc melebihi batas tunggu 12 mnt"), "kehabisan waktu");
  assert.equal(golonganGalat("QC-01:skip, QC-12:fail"), "gagal QC");
  assert.equal(golonganGalat("HTTP 429 too many requests"), "kena batas laju");
  assert.equal(golonganGalat("/usr/bin/ffmpeg gagal: do not match"), "gagal rakit");
  assert.equal(golonganGalat("sesuatu yang belum pernah terjadi"), "lainnya");
});

test("galat tanpa pembungkus dibiarkan utuh", () => {
  const u = uraikanGalat("Foto produk tidak ditemukan di storage.")!;
  assert.equal(u.inti, "Foto produk tidak ditemukan di storage.");
  assert.deepEqual(u.lapisan, []);
  assert.equal(u.httpStatus, null);
});

test("kosong tetap kosong, tidak mengarang", () => {
  assert.equal(uraikanGalat(null), null);
  assert.equal(uraikanGalat(""), null);
  assert.equal(uraikanGalat("   "), null);
});

test("admin menampilkan golongan, inti, DAN teks utuhnya", () => {
  const adm = readFileSync(join(process.cwd(), "app/admin/page.tsx"), "utf8");
  assert.match(adm, /golonganGalat\(u\.inti\)/, "golongan tidak ditampilkan");
  assert.match(adm, /u\.inti\.slice\(0, 260\)/, "inti tidak ditampilkan");
  // Teks mentahnya HARUS tetap bisa dibaca — yang mau menelusuri butuh
  // kalimat aslinya, bukan ringkasan kita.
  assert.match(adm, /\{mentah\}/, "teks utuh tidak pernah ditampilkan");
  assert.match(adm, /u\.lapisan\.join/, "rantai pembungkus hilang");
});

test("admin boleh membuka berkas milik siapa pun, dan itu DICATAT", () => {
  // Dasbor yang menampilkan tombol pratinjau lalu menolak tombolnya sendiri
  // lebih buruk daripada tidak punya tombol. Tapi ini pelonggaran keamanan
  // nyata: kewenangan tanpa jejak adalah kewenangan yang tidak bisa ditinjau.
  const f = readFileSync(join(process.cwd(), "app/api/files/[...path]/route.ts"), "utf8");
  assert.match(f, /apakahAdmin\(user\?\.email\)/, "admin tidak dikecualikan");
  assert.match(f, /admin\.buka_berkas/, "tidak ada pencatat pembukaan");

  // FUNGSINYA ADA TIDAK CUKUP — ia harus DIPANGGIL.
  //
  // Versi pertama tes ini cuma mencari string "admin.buka_berkas", yang hidup
  // di dalam definisi fungsinya. Mutasi yang menghapus PANGGILANNYA lolos:
  // definisinya tetap ada, jejak auditnya tidak pernah ditulis, dan admin
  // membuka berkas pelanggan tanpa satu baris catatan pun.
  assert.match(f, /void catatAksesAdmin\(user\.id, relPath\);/, "pencatat tidak dipanggil");
  // Dan dipanggil DI CABANG ADMIN, bukan di tempat lain.
  const i = f.indexOf("apakahAdmin(user?.email)");
  assert.ok(f.indexOf("catatAksesAdmin(user.id", i) - i < 400, "pencatatan tidak menempel pada cabang admin");
  // Dan bukan admin TETAP dijaga kepemilikan.
  assert.match(f, /else if \(!user \|\| !\(await fileBelongsToUser/, "penjaga kepemilikan hilang");
});
