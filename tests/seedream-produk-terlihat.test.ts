// PRODUK UTAMA HARUS TERLIHAT JELAS DI KARTU STORYBOARD (Brian, 9 Sep 2026).
//
// "untuk proses rendering image yang menggunakan seedream pastikan juga gambar
//  jelas product utama brand terlihat"
//
// REFERENCE AUTHORITY yang sudah ada mengunci IDENTITAS produk — bentuk, warna,
// bahan, proporsi. Ia tidak pernah menuntut produknya TERLIHAT. Keduanya bisa
// gagal sendiri-sendiri: kartu yang produknya benar tapi kecil, buram,
// terpotong tepi, atau labelnya tertutup tangan tetap gagal sebagai
// storyboard — dan kartu ini dipakai sebagai FRAME PERTAMA render, jadi apa
// yang samar di sini ikut samar sepanjang videonya.
import { test } from "node:test";
import assert from "node:assert/strict";
import { promptGambar } from "../lib/media/seedream";

test("scene dengan acuan produk menuntut produknya terlihat jelas", () => {
  const p = promptGambar({ prompt: "hands wipe the motorcycle fender", adaAcuan: true });
  assert.match(p, /PRODUCT VISIBILITY/);
  // Empat kegagalan yang masing-masing pernah membuat kartu tidak terpakai.
  assert.match(p, /in focus/i, "ketajaman tidak dituntut");
  assert.match(p, /not cropped/i, "terpotong tepi tidak dilarang");
  assert.match(p, /legible/i, "label terbaca tidak dituntut");
  assert.match(p, /must not cover the label/i, "tangan menutup label tidak dilarang");
});

test("identitas DAN keterlihatan dituntut bersama — bukan salah satunya", () => {
  const p = promptGambar({ prompt: "hands hold the bottle", adaAcuan: true });
  assert.match(p, /REFERENCE AUTHORITY/, "penguncian identitas hilang");
  assert.match(p, /PRODUCT VISIBILITY/, "syarat keterlihatan hilang");
});

test("scene TANPA acuan tidak dipaksa menampilkan produk", () => {
  // Scene ber-withhold_product sengaja menyembunyikan produk sebelum reveal;
  // pemanggil menandainya dengan tidak melampirkan foto. Menuntut produk
  // terlihat di situ akan merusak justru bagian yang dibangun untuk menahan.
  const p = promptGambar({ prompt: "hands wipe a dusty fender", adaAcuan: false });
  assert.doesNotMatch(p, /PRODUCT VISIBILITY/);
  assert.doesNotMatch(p, /REFERENCE AUTHORITY/);
});

test("aturan lama tidak hilang karena penambahan ini", () => {
  const p = promptGambar({ prompt: "hands hold the bottle", adaAcuan: true, ratio: "9:16" });
  assert.match(p, /No text, no caption, no watermark/, "larangan teks/watermark hilang");
  assert.match(p, /Vertical 9:16 framing/, "rasio hilang");
});

test("startState tetap menang atas prompt shot", () => {
  // Prompt shot menggambarkan apa yang TERJADI sepanjang klip; gambar diamnya
  // harus menggambarkan keadaan AWAL, bukan gerakannya.
  const p = promptGambar({ prompt: "hands begin wiping", startState: "hands rest on the fender", adaAcuan: true });
  assert.match(p, /hands rest on the fender/);
  assert.doesNotMatch(p, /hands begin wiping/);
});
