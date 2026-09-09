// PELAFALAN INDONESIA YANG MEMBLE (Brian, 9 Sep 2026).
//
// "saya melihat dialog yang ada masih ada salah pronouncement dan pelafalan
//  dalam bahasa indonesia"
//
// Diperiksa terhadap MASTER PROMPT Seedance 2.5 yang Brian kirim sebagai
// acuan. Tiga hal yang panduan itu tegaskan dan prompt kita langgar:
//
// 1. "Dialog WAJIB dalam kurung kurawal { }". Kita memakai tanda kutip ganda.
//    Tanda kutip tidak memisahkan ucapan dari instruksi — model membaca
//    kalimat di sekitarnya sebagai bagian yang boleh ikut diucapkan.
//
// 2. "Bahasa ditegaskan PER BARIS, bukan sekali di kepala prompt." Kita
//    menulis "in casual Indonesian" sekali per shot, tanpa menyebut logatnya.
//
// 3. "Jangan menulis blok PACING yang menuntut 'no pause, no breath' —
//    terbukti membuat kata bertabrakan." Prompt kita masih memuat "keeping the
//    narration flowing without long empty gaps". Komentar di berkasnya sendiri
//    sudah menyadari kontradiksi ini ("prompt yang memuat dua perintah
//    berlawanan menyerahkan pilihannya ke model") — tapi kalimatnya tidak
//    pernah ikut dibuang.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/media/shot-planner.ts", import.meta.url), "utf8");
const kode = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("dialog dibungkus kurung kurawal, bukan tanda kutip", () => {
  assert.ok(!/"\$\{dialogue\}"/.test(kode), "masih ada dialog dalam tanda kutip ganda");
  assert.ok(/\{\$\{dialogue\}\}/.test(kode), "dialog tidak dibungkus kurung kurawal");
});

test("bahasa ditegaskan per baris ucapan, lengkap dengan logatnya", () => {
  // Setiap cabang yang mengeluarkan ucapan harus menyebutkan bahasanya.
  const cabang = kode.match(/(narrates|speaks|talks to camera) in [^,]*/g) ?? [];
  assert.ok(cabang.length >= 3, `cabang ucapan tidak terbaca: ${cabang.length}`);
  for (const c of cabang) {
    assert.match(c, /natural Jakarta Indonesian/, `cabang tanpa penegasan logat: "${c}"`);
  }
  assert.ok(!/in casual Indonesian/.test(kode), "masih ada penegasan bahasa yang lama dan kabur");
});

test("tidak ada lagi tuntutan anti-jeda yang membuat kata bertabrakan", () => {
  assert.ok(
    !/without long empty gaps/.test(kode),
    "prompt masih menuntut narasi tanpa jeda — panduan Seedance 2.5 menyebutnya penyebab kata bertabrakan",
  );
});

test("yang menjaga kejelasan ucapan TIDAK ikut terbuang", () => {
  // Membuang tuntutan anti-jeda tidak boleh berubah jadi membuang arahan
  // artikulasi. Keduanya berbeda: satu melarang diam, satu meminta tiap kata
  // diucapkan utuh.
  assert.match(kode, /enunciating every word completely/, "arahan artikulasi hilang");
  assert.match(kode, /lips moving on every syllable/, "arahan lipsync presenter hilang");
});

test("blok bahasa memakai rumusan panduan, bukan kalimat sendiri", () => {
  assert.match(kode, /Dialogue language: Indonesian, casual Jakarta vernacular/);
});
