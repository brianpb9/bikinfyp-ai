// S-10 — KONTRAK SHOT PEMBUKA, dan kenapa ia hidup di validator.
//
// Cacatnya terlihat di piksel dua kali (render berbayar 20 Agu): aksi hook
// "camera sweeps across the mess, THEN pauses on the serum bottle" membuat
// botol baru masuk frame di detik ~2 dari klip 5 detik. Tambalan pertama
// dipasang di perakit prompt — kalimat batasan diletakkan di depan aksi
// penulis — dan render verifikasi menunjukkan tambalan itu KALAH: dua kalimat
// bersaing di prompt yang sama, dan yang berbentuk koreografi menang.
//
// Karena itu aturannya dipindah ke hulu, ke tata bahasa shot penulis, tempat
// ia tidak punya lawan.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-s10-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-s10-storage-${process.pid}`;

const { validateScript } = await import("../lib/script-engine/validator");
const { blokTugasUntukUji } = await import("../lib/script-engine/llm");

function naskah(produkAwal: "hidden" | "partial", format: string) {
  return {
    hook_family: "problem", register: "bestie",
    productName: "Serum Glow Bright", priceIdr: 85000,
    qualityTier: "super_hq" as const, durationSec: 15,
    format: format as never, contentType: "affiliate" as const,
    segments: [
      { role: "hook", text: "Sumpah meja aku hancur banget.", product_state: produkAwal,
        start_state: "botol serum tergeletak di meja", visual_direction: "meja rias" },
      { role: "demo", text: "Nah, yang ini nggak bisa dititip-titipin deh.", product_state: "partial",
        visual_direction: "lemari" },
      { role: "cta", text: "Langsung cek keranjang kuning ya!", product_state: "hero",
        visual_direction: "produk hero" },
    ],
  };
}

const s10 = (r: { errors: { rule: string }[]; warnings: { rule: string }[] }) =>
  [...r.errors, ...r.warnings].filter((i) => i.rule === "S-10");

test("hands_only: hook 'hidden' DITOLAK sebagai error, bukan peringatan", () => {
  const hasil = validateScript(naskah("hidden", "hands_only") as never, "light");
  const kena = hasil.errors.filter((e) => e.rule === "S-10");
  assert.equal(kena.length, 1, `S-10 tidak menolak hook hidden:\n${JSON.stringify(hasil.errors, null, 2)}`);
  // "light" dipakai seluruh jalur Enterprise — aturan yang cuma keras di
  // "strict" tidak menjaga apa pun di sana.
  assert.equal(hasil.passed, false);
});

test("hands_only: hook 'partial' lolos S-10", () => {
  const hasil = validateScript(naskah("partial", "hands_only") as never, "light");
  assert.deepEqual(s10(hasil), [], "naskah yang benar tidak boleh kena S-10");
});

test("ads/tvc TIDAK dipaksa — hook 'hidden' di sana justru struktur Story OS", () => {
  for (const format of ["ads", "tvc", "talking_head"]) {
    const hasil = validateScript(naskah("hidden", format) as never, "light");
    assert.deepEqual(
      s10(hasil), [],
      `[${format}] S-10 ikut campur ke format yang produknya memang datang belakangan`
    );
  }
});

test("penulis DIBERI TAHU aturannya, bukan cuma ditolak olehnya", () => {
  // Gerbang yang menolak tanpa pernah mengajari cuma membayar percobaan ulang.
  // Persis cacat TVC 18 Agu: penulis disuruh menutup dengan "keranjang", lalu
  // ditolak T-02 karena menyebut keranjang, dua kali, lalu jatuh ke template.
  const hands = blokTugasUntukUji({ contentType: "affiliate", durationSec: 15, format: "hands_only" });
  assert.match(hands, /OPENING SHOT CONTRACT/i, "aturan S-10 tidak pernah sampai ke penulis");
  assert.match(hands, /product_state is 'partial', never 'hidden'/i);
  assert.match(hands, /finding, revealing, or arriving at the product later/i,
    "pola koreografi yang justru menyebabkan cacatnya tidak dilarang secara eksplisit");

  // Dan TIDAK dikirim ke format yang produknya memang datang belakangan —
  // instruksi yang salah kamar sama merusaknya dengan instruksi yang hilang.
  const ads = blokTugasUntukUji({ contentType: "ads", durationSec: 15, format: "ads" });
  assert.ok(!/OPENING SHOT CONTRACT/i.test(ads), "kontrak hands_only bocor ke naskah Ads");
});
