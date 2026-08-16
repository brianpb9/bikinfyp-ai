// Aksi demo harus MUNGKIN secara fisik untuk produknya.
//
// Cacat nyata 16 Agu 2026: JJ Glow Gluta Pink BARSOAP keluar sebagai sabun
// CAIR. Sebabnya aksi demo kategori beauty berbunyi "dropping a little of the
// product", dan body_care "pumping a dollop" — dua-duanya mengandaikan produk
// bisa dituang. Untuk sabun batang itu mustahil, jadi model menuruti aksinya
// dan mengarang bentuk produk yang bisa dituang.
//
// PERBAIKAN PERTAMANYA SETENGAH JADI, dan audit putaran ketiga benar soal itu:
// menggabungkan semua benda padat jadi satu label "padat" membuat Serum Stick,
// lipstik, dan compact powder SEMUANYA mendapat aksi sabun — "dibasahi lalu
// digosok sampai berbusa". Penggolongnya benar, promptnya tetap salah. Yang
// perlu diketahui bukan "benda ini padat", melainkan APA YANG DILAKUKAN TANGAN
// terhadapnya. Karena itu bentuknya sekarang spesifik, dan tes ini menjaga
// pemetaan bentuk -> aksi, bukan cuma labelnya.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bentukProduk } from "../lib/media/shot-planner";

test("sabun batang dikenali dan dapat aksi berbusa", () => {
  assert.equal(bentukProduk("JJ Glow Sabun", "JJ Glow Sabun Gluta Pink Barsoap"), "sabun_batang");
  assert.equal(bentukProduk("Sabun Batang Sereh"), "sabun_batang");
  // "shampoo" menyebut isinya, "bar" menyebut bentuknya — bentuk yang menang.
  assert.equal(bentukProduk("Shampoo Bar Rosemary"), "sabun_batang");
});

// "sabun cair" memuat kata "sabun"; kalau urutan pemeriksaan dibalik ia akan
// salah tertangkap sebagai padat dan dapat aksi menggosok batang.
test("cairan tidak salah dikenali sebagai padat", () => {
  assert.equal(bentukProduk("Sabun Cair Lidah Buaya"), "tuang");
  assert.equal(bentukProduk("Serum Wardah"), "tuang");
  assert.equal(bentukProduk("Body Lotion Vanilla"), "tuang");
});

// Kata "liquid"/"cair" adalah KOREKSI SADAR penjual terhadap bentuk yang
// biasanya diasumsikan orang. Koreksi sadar harus menang atas tebakan kita.
test("Liquid Lipstick itu cairan, bukan lipstik putar", () => {
  assert.equal(bentukProduk("Liquid Lipstick Matte"), "tuang");
  assert.equal(bentukProduk("Lip Cream Liquid"), "tuang");
  // Tanpa kata "liquid", lipstik biasa tetap lipstik.
  assert.equal(bentukProduk("Lipstick Velvet Merah"), "lipstik");
});

// Inti temuan audit ketiga: benda padat yang BUKAN sabun tidak boleh berbusa.
test("padat non-sabun tidak diperlakukan seperti sabun", () => {
  assert.equal(bentukProduk("Serum Stick Niacinamide"), "oles_padat");
  assert.equal(bentukProduk("Deodorant Stick"), "oles_padat");
  assert.equal(bentukProduk("Lip Balm Madu"), "oles_padat");
  assert.equal(bentukProduk("Compact Powder Two Way Cake"), "bubuk_padat");
  assert.equal(bentukProduk("Blush On Peach"), "bubuk_padat");
});

// Menebak salah arah sama buruknya dengan tidak menebak.
test("bentuk yang tidak jelas tidak ditebak", () => {
  assert.equal(bentukProduk("Produk Baru"), "tidak diketahui");
  assert.equal(bentukProduk("Paket Hemat"), "tidak diketahui");
  assert.equal(bentukProduk("Kaos Polos Katun"), "tidak diketahui");
});

// Penjaga terhadap kemunduran yang paling mungkin: seseorang menyatukan lagi
// semua bentuk padat ke satu aksi karena "toh sama-sama padat".
test("tiap bentuk padat punya aksi tangan yang berbeda", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "lib/media/shot-planner.ts"), "utf8");
  const blok = src.slice(src.indexOf("const AKSI_PER_BENTUK"), src.indexOf("const AKSI_NETRAL"));
  for (const bentuk of ["sabun_batang", "oles_padat", "bubuk_padat", "lipstik"]) {
    assert.ok(blok.includes(`${bentuk}:`), `aksi untuk ${bentuk} hilang`);
  }
  // Hanya sabun yang boleh menyebut busa. Kalau kata ini bocor ke bentuk lain,
  // kita kembali ke cacat yang sama.
  const menyebutBusa = blok.split("\n").filter((b) => /lather|foam/i.test(b));
  assert.equal(menyebutBusa.length, 1, "hanya aksi sabun batang yang boleh menyebut busa");
  assert.match(menyebutBusa[0], /wetting the solid bar/, "busa harus melekat pada aksi sabun batang");
});

// ---- Prompt AKHIR, bukan cuma labelnya ----
//
// Audit putaran keempat benar: memeriksa nilai balik bentukProduk() tidak
// membuktikan apa pun soal video yang keluar. Yang sampai ke model adalah
// PROMPT, dan di situlah cacat sabun-untuk-segalanya hidup. Tes di bawah
// menjalankan planShots() sungguhan lalu membaca prompt yang dihasilkannya.
import { planShots } from "../lib/media/shot-planner";
import { getCreatorCategory } from "../lib/personas";

function promptUntuk(nama: string, kategoriProduk = "beauty"): string {
  const kategori = getCreatorCategory("lokal")!;
  const spec = planShots({
    jobId: "uji", durationSec: 15,
    segments: [
      { start: 0, end: 3, text: "Hook", role: "hook" },
      { start: 3, end: 10, text: "Demo produknya", role: "demo" },
      { start: 10, end: 15, text: "Cek keranjang", role: "cta" },
    ] as never,
    category: kategori, productName: nama, productCategory: kategoriProduk,
    imageRefPath: "/tmp/uji.jpg", qualityTier: "high_quality", format: "hands_only",
  });
  return spec.shots.map((s) => s.prompt).join("\n");
}

test("prompt sabun batang menyuruh berbusa", () => {
  assert.match(promptUntuk("JJ Glow Sabun Gluta Pink Barsoap"), /lather|foam/i);
});

test("prompt padat non-sabun TIDAK PERNAH menyuruh berbusa", () => {
  // Inilah cacat yang lolos putaran lalu: labelnya sudah benar, promptnya belum.
  for (const nama of [
    "Serum Stick Niacinamide", "Lotion Bar Shea", "Deodorant Stick",
    "Roll On Deodorant Fresh", "Cushion Foundation Glow",
    "Compact Powder Two Way Cake", "Lipstick Velvet",
  ]) {
    const p = promptUntuk(nama);
    assert.ok(!/lather|foam|soap bar|solid bar/i.test(p),
      `${nama} tidak boleh disuruh berbusa. Prompt: ${p.slice(0, 200)}`);
  }
});

test("tiap bentuk memberi gerakan tangan yang benar-benar berbeda", () => {
  assert.match(promptUntuk("Roll On Deodorant Fresh"), /rolling its ball/i);
  // "twisting" (gerund = instruksi), BUKAN "twist" polos: aksi roll-on memuat
  // LARANGAN "the ball never twisted", dan asersi yang terlalu tumpul akan
  // menganggap larangan itu sebagai pelanggaran.
  assert.ok(!/twisting/i.test(promptUntuk("Roll On Deodorant Fresh")),
    "roll-on tidak boleh DISURUH memutar batang naik");
  assert.match(promptUntuk("Serum Stick Niacinamide"), /twisting its base/i,
    "stick justru harus diputar naik — pembanding yang membuktikan asersi di atas bukan hampa");
  assert.match(promptUntuk("Cushion Foundation Glow"), /liquid foundation/i);
  assert.ok(!/powder/i.test(promptUntuk("Cushion Foundation Glow")),
    "cushion berisi alas bedak cair, bukan bedak");
  assert.match(promptUntuk("Compact Powder Two Way Cake"), /powder/i);
  assert.match(promptUntuk("Lipstick Velvet"), /bullet/i);
});

test("cairan tetap dituang, bukan digosok", () => {
  const p = promptUntuk("Serum Vitamin C");
  assert.ok(!/solid bar|twisting|rolling its ball/i.test(p), `serum tidak boleh diperlakukan padat: ${p.slice(0, 200)}`);
});
