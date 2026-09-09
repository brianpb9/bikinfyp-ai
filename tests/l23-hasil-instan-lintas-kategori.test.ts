// L-23 BUTA DI LUAR KECANTIKAN (job 9789aa55, Brian 9 Sep 2026).
//
// L-23 adalah gerbang KERAS terhadap janji hasil instan. Daftar kata hasilnya
// seluruhnya kosakata skincare — putih, bening, cerah, glowing, mulus, kempes,
// kencang — sehingga seluruh kategori lain lolos begitu saja.
//
// Naskah yang lolos dan dirender:
//
//   "Sumpah ampuh sih, semprotin doang, karatnya langsung keangkat deh."
//
// Akibatnya tidak berhenti di teks. Mesin video MENURUTI naskahnya, dan Brian
// melaporkan "transisi tidak realistis, tiba-tiba semprot ke mesin dan menjadi
// bersih". Videonya tidak mengarang keajaiban itu — naskahnya yang memintanya.
//
// Cacatnya sekelas dengan tabel kategori yang diperbaiki hari yang sama:
// aturan ditulis dari satu kategori lalu dipakai untuk semua.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/script-engine/validator.ts", import.meta.url), "utf8");
const blok = src.slice(src.indexOf("const KLAIM_POLA"), src.indexOf("];", src.indexOf("const KLAIM_POLA")));
const POLA: RegExp[] = [...blok.matchAll(/\/(\\b.*?)\/i,/g)].map((m) => new RegExp(m[1], "i"));

function ditahan(t: string): boolean {
  return POLA.some((p) => p.test(t));
}

test("polanya terbaca dari sumber, bukan disalin ke tes", () => {
  assert.ok(POLA.length >= 2, `pola tidak terbaca: ${POLA.length}`);
});

test("kalimat yang benar-benar dirender job 9789aa55 kini ditahan", () => {
  assert.equal(ditahan("Sumpah ampuh sih, semprotin doang, karatnya langsung keangkat deh."), true);
});

test("janji instan di kategori non-kecantikan ikut ditahan", () => {
  for (const t of [
    "semprot dikit langsung kinclong",
    "sekali usap langsung bersih",
    "cukup semprot, kerak langsung terangkat",
    "dijamin bersih cuma sekali pakai",
  ]) {
    assert.equal(ditahan(t), true, `lolos: ${t}`);
  }
});

test("kosakata kecantikan yang lama TIDAK ikut hilang", () => {
  for (const t of ["dalam semalam langsung cerah", "sekali pakai langsung putih", "pasti bening"]) {
    assert.equal(ditahan(t), true, `regresi, lolos: ${t}`);
  }
});

test("deskripsi PROSES yang jujur tetap boleh", () => {
  // Yang dilarang janji seketikanya, bukan menyebut hasilnya. Naskah yang
  // menunjukkan langkah — semprot, tunggu, lap — justru yang kita inginkan,
  // dan aturan ini tidak boleh ikut menahannya.
  for (const t of [
    "gue semprot terus lap pelan-pelan, keraknya ikut keangkat",
    "Mesin lo berkarat? Nah, gue baru nemu yang bisa beresin tuh.",
    "Harganya dua puluh empat ribu sembilan ratus aja, cek keranjang ya!",
  ]) {
    assert.equal(ditahan(t), false, `positif palsu: ${t}`);
  }
});

test("L-23 tetap gerbang KERAS, bukan saran", () => {
  assert.match(src, /"S-04", "S-05", "S-09", "L-23"/, "L-23 keluar dari daftar aturan keras");
});
