// L-23 — KLAIM HASIL PADA KATEGORI KULIT.
//
// Direproduksi dari naskah yang benar-benar dirender 20 Agu (Rp35.015):
//   "Nah, kulit aku langsung keliatan glowing, loh."
// Kalimat itu LOLOS seluruh gerbang. Polanya sudah ada di KLAIM_POLA, tapi
// sisipannya dibatasi enam huruf sementara "keliatan" delapan — jadi aturannya
// ada, penegaknya ada, dan tetap lolos karena satu angka.
//
// Pelajaran yang layak ditulis: aturan yang "sudah ada" belum tentu menegakkan
// apa pun. Yang membuktikan cuma kalimat nyata yang pernah lolos.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-klaim-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-klaim-storage-${process.pid}`;

const { periksaKataTerlarang, validateScript } = await import("../lib/script-engine/validator");

const l23 = (teks: string, nama = "Serum Glow Bright", kategori = "beauty") =>
  periksaKataTerlarang(teks, nama, kategori).filter((i) => i.rule === "L-23");

// Kalimat yang benar-benar lolos dan benar-benar dirender.
test("kalimat 20 Agu yang lolos sekarang DITOLAK", () => {
  assert.equal(
    l23("Nah, kulit aku langsung keliatan glowing, loh.").length, 1,
    "kalimat yang sudah terbukti lolos masih lolos"
  );
});

test("varian bahasa Indonesia yang diminta ikut tertangkap", () => {
  const contoh = [
    "kulit aku jadi cerahan banget",
    "muka langsung putihan seminggu",
    "jadi mulus seketika",
    "bekasnya hilang dalam semalam",
    "ini glow up parah sih",
    "glow-up banget kulitku",
    "kulit langsung keliatan cerah",
  ];
  for (const c of contoh) {
    assert.ok(l23(c).length >= 1, `TIDAK tertangkap: "${c}"`);
  }
});

test("kalimat sah TIDAK ikut kena — gerbang yang menolak yang benar akan dimatikan orang", () => {
  const aman = [
    "langsung aku pakai tiap malam",          // "langsung" sehari-hari
    "aku langsung ke intinya ya",
    "teksturnya ringan, nggak lengket",
    "aku suka wanginya",
    "botolnya kecil, gampang dibawa",
  ];
  for (const c of aman) {
    assert.deepEqual(l23(c), [], `salah tangkap kalimat sah: "${c}"`);
  }
});

test("nama produk TIDAK dihitung sebagai klaim", () => {
  // SKU boleh bernama "Glow" — itu merek, bukan janji.
  assert.deepEqual(
    l23("Aku pakai Serum Glow Bright tiap malam", "Serum Glow Bright"), [],
    "nama produk sendiri dibaca sebagai klaim"
  );
});

test("kategori NON-kulit tidak dihukum oleh kosakata kulit", () => {
  // "glowing" untuk lampu/dekor bukan klaim hasil.
  assert.deepEqual(
    l23("lampunya glowing banget di kamar", "Lampu Tidur LED", "home"), [],
    "kosakata kulit bocor ke kategori yang tidak punya kulit"
  );
});

test("L-23 KERAS di mode light — jalur Enterprise memakai light", () => {
  const hasil = validateScript({
    hook_family: "problem", register: "bestie",
    productName: "Serum Glow Bright", priceIdr: 85000,
    qualityTier: "super_hq", durationSec: 15,
    format: "hands_only", contentType: "affiliate", productCategory: "beauty",
    segments: [
      { role: "hook", text: "Coba lihat deh.", product_state: "partial", start_state: "botol di meja" },
      { role: "demo", text: "Kulit aku langsung keliatan glowing, loh.", product_state: "partial" },
      { role: "cta", text: "Cek keranjang kuning ya.", product_state: "hero" },
    ],
  } as never, "light");
  assert.ok(
    hasil.errors.some((e) => e.rule === "L-23"),
    `L-23 tidak jadi error di mode light:\n${JSON.stringify(hasil, null, 2).slice(0, 600)}`
  );
});

// Tambahan keputusan Brian 20 Agu.
test("KONTEKS AMAN eksplisit — sapaan komunitas tetap boleh", () => {
  const aman = [
    "Buat tim glowing yang masih urus kusamnya sendirian, lihat ini dulu sih",
    "Khusus kamu yang lagi cari cara glowing, mampir dulu",
    "Glowing itu bukan soal harga sih",
  ];
  for (const c of aman) assert.deepEqual(l23(c), [], `salah tangkap konteks aman: "${c}"`);
});

test("kata hasil SEKALIMAT dengan produk = klaim, walau tanpa kata perubahan", () => {
  const klaim = [
    "Pakai ini tiap malam, glowing",
    "Serumnya dipakai rutin, cerahan",
    "Sabun ini glow up banget",
  ];
  for (const c of klaim) assert.ok(l23(c).length >= 1, `lolos padahal sekalimat dengan produk: "${c}"`);
});

test("kalimat TERPISAH tidak digabung jadi klaim", () => {
  // Dipecah per kalimat: dua pernyataan berbeda bukan satu janji.
  assert.deepEqual(
    l23("Aku pakai ini tiap malam. Temanku tim glowing semua."), [],
    "dua kalimat berbeda digabung jadi klaim"
  );
});
