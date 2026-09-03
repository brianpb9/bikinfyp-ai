// Skrip uji A/B menyalin teks produksi — jadi salinannya harus dijaga.
//
// scripts/uji-teks-negatif-grok.mjs berdiri sendiri dengan alasan yang nyata:
// kredensial kie.ai hanya ada di server, dan kontainer produksi memuat hasil
// build, bukan sumber TypeScript. Skrip yang mengimpor lib/ tidak bisa
// dijalankan di satu-satunya tempat yang bisa menjalankannya.
//
// Harganya sebuah salinan, dan salinan pasti hanyut. Tes ini yang menahannya:
// ekor teks varian B harus SAMA PERSIS dengan yang disusun teksPromptShot().
// Kalau tidak, uji A/B akan membandingkan sesuatu yang tidak pernah dikirim ke
// pengguna — yaitu bukti palsu, yang lebih buruk daripada tidak ada bukti.

import { test } from "node:test";
import assert from "node:assert/strict";
import { teksPromptShot } from "../lib/providers/teks-prompt";
import type { ShotSpec, VisualSpec } from "../lib/providers/types";
import { EKOR } from "../scripts/uji-teks-negatif-grok.mjs";

test("ekor teks di skrip uji A/B identik dengan yang disusun kode produksi", () => {
  const shot = { prompt: "SHOT" } as ShotSpec;
  const spec = { negativePrompt: "no added text overlay" } as VisualSpec;
  const ekorProduksi = teksPromptShot(spec, shot).slice("SHOT".length);
  assert.equal(
    EKOR.BARU,
    ekorProduksi,
    "skrip uji memakai teks yang BUKAN teks produksi — hasil ujinya tidak mewakili apa pun",
  );
});

test("ekor LAMA tetap memuat kosakata cacat yang dulu benar-benar dikirim", () => {
  // Varian A adalah kontrolnya. Kalau seseorang "merapikan" daftar ini, ujinya
  // berhenti menguji apa pun.
  for (const cacat of ["extra hands", "second person", "floating parts", "disembodied hands"]) {
    assert.ok(EKOR.LAMA.includes(cacat), `kontrol A kehilangan "${cacat}" — ia tidak lagi mereproduksi kegagalannya`);
  }
});
