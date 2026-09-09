// SUARA MEMBLE KARENA DILARANG BERNAPAS (job 9789aa55, Brian 9 Sep 2026).
//
// "issue bahasa masih ada dimana pelafalannya kurang jelas"
//
// Diukur pada video yang Brian kirim, dengan ffmpeg silencedetect di TIGA
// ambang berbeda:
//
//   -20 dB, -25 dB, -30 dB  ->  NOL jeda >= 0,2 dtk dalam 15,1 detik
//
// Lima belas detik bicara tanpa satu tarikan napas pun.
//
// KATA-KATANYA SENDIRI BENAR. Transkrip Gemini atas audio itu cocok kata demi
// kata dengan naskah (satu-satunya beda: "lo" terdengar "lu", dua-duanya sah).
// Tempo juga bukan sebabnya: 31 kata / 15,1 dtk = 2,05 kata/detik, di BAWAH
// pita haul 3,1-4,2. Yang rusak penyampaiannya, bukan pilihan katanya.
//
// Sebabnya koreksi berlebih. Perbaikan 4 Sep membuang "natural pauses" (kata
// itu membekukan mulut) lalu memasang TIGA perintah yang semuanya melarang
// diam. Panduan Seedance 2.5 dari Brian menyebutnya langsung: "Jangan menulis
// blok PACING yang menuntut 'no pause, no breath' — terbukti membuat kata
// bertabrakan."
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/media/shot-planner.ts", import.meta.url), "utf8");
const kode = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("tidak ada lagi perintah yang melarang berhenti bernapas", () => {
  for (const larangan of [
    "speaking continuously for the whole shot",
    "launches straight into the line",
    "without long empty gaps",
  ]) {
    assert.ok(!kode.includes(larangan), `prompt masih memuat larangan diam: "${larangan}"`);
  }
});

test("napas alami diminta secara positif", () => {
  // "breathing naturally" dipakai, BUKAN "pauses": frasa pertama ada di aturan
  // ekor hidup panduan Seedance dan tidak membekukan mulut; kata "pauses"
  // terbukti membekukannya (diukur 4 Sep: 2,85 dtk sunyi).
  assert.match(kode, /breathing naturally between sentences/);
  assert.ok(!/natural pauses/.test(kode), "kata pembeku mulut kembali masuk");
});

test("penjagaan terhadap udara mati TIDAK ikut dibuang", () => {
  // Membiarkan bernapas tidak boleh berubah jadi membiarkan berhenti bicara.
  // Suaranya tetap dituntut hadir sampai frame terakhir.
  assert.match(kode, /voice still present at the final frame/);
  assert.match(kode, /lips moving on every syllable/, "arahan lipsync hilang");
  assert.match(kode, /enunciating every word completely/, "arahan artikulasi hilang");
});

test("penegasan bahasa per baris tetap utuh", () => {
  const cabang = kode.match(/(narrates|speaks|talks to camera) in [^,]*/g) ?? [];
  assert.ok(cabang.length >= 3);
  for (const c of cabang) assert.match(c, /natural Jakarta Indonesian/, c);
});
