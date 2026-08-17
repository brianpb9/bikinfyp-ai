// Item 3 (A4, A5, A3): gate keras, bukan peringatan.
//
// Yang diuji KELUARAN NYATA validator terhadap naskah nyata — bukan teks
// sumber. Gagal harus menjatuhkan naskah, bukan menempel sebagai peringatan.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-gate-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-gate-storage-${process.pid}`;

const { validateScript, jendelaKata } = await import("../lib/script-engine/validator");

type Seg = { role: string; text: string; visual_direction?: string };
const nilai = (segs: Seg[], extra: Record<string, unknown> = {}) =>
  validateScript({
    hook_family: "H1", register: "bestie", productName: "Scarlett Acne Serum",
    priceIdr: 75000, qualityTier: "high_quality", durationSec: 15,
    segments: segs, ...extra,
  } as never, "strict");

/** Naskah dasar yang LOLOS semuanya — pembanding, supaya tiap tes hanya
 *  mengubah satu hal dan kegagalannya bisa ditunjuk sebabnya. */
const dasar: Seg[] = [
  { role: "hook", text: "Nah, jerawat kamu masih bandel juga sih?" },
  { role: "demo", text: "aku pakai ini tiap malam deh, ringan banget" },
  { role: "cta", text: "cek keranjang kuning ya" },
];

test("A3: 15 detik dibatasi 22 kata — 1,5 kata/detik", () => {
  const { minWc, maxWc } = jendelaKata({ qualityTier: "high_quality", durationSec: 15, productName: "Scarlett Acne Serum" });
  assert.equal(maxWc, 22, "batas Brian 1,5 kata/detik");
  assert.ok(minWc < maxWc, `jendela tidak boleh terbalik: ${minWc}-${maxWc}`);

  // 24 kata: persis kasus yang lolos sebelum perbaikan (1,60 kata/detik).
  const panjang: Seg[] = [
    { role: "hook", text: "Nah, jerawat kamu masih bandel juga sih setiap hari begini" },
    { role: "demo", text: "aku pakai serum ini tiap malam deh, teksturnya ringan banget dan cepat meresap" },
    { role: "cta", text: "cek keranjang kuning ya sekarang" },
  ];
  const h = nilai(panjang);
  assert.equal(h.passed, false, "24 kata untuk 15 detik harus DITOLAK");
  assert.ok(h.errors.some((e) => e.rule === "L-05"), JSON.stringify(h.errors));
});

test("A4: L-19 menjatuhkan naskah, bukan sekadar memperingatkan", () => {
  // Kalimat benar-benar datar. "Sesuatu baru saja..." TIDAK dipakai lagi:
  // itu perangkat kejutan yang memang harus dikenali sesudah detektor
  // dilengkapi — memakainya sebagai contoh negatif akan menguji hal yang salah.
  const tanpaPerangkat = [{ ...dasar[0], text: "Botol kaca kecil berisi cairan bening di meja" }, dasar[1], dasar[2]];
  const h = nilai(tanpaPerangkat);
  assert.ok(h.errors.some((e) => e.rule === "L-19"), `L-19 harus jadi ERROR: ${JSON.stringify(h)}`);
  assert.equal(h.passed, false);
  assert.ok(!h.warnings.some((e) => e.rule === "L-19"), "tidak boleh lagi muncul sebagai peringatan");
  // Hook yang memakai perangkat tetap lolos — gate ini tidak boleh asal ketat.
  assert.ok(!nilai(dasar).errors.some((e) => e.rule === "L-19"));
});

test("A5: L-21 menjatuhkan naskah — kosakata pemicu DAN negasi tentang orang", () => {
  const kosakata = [dasar[0], { ...dasar[1], visual_direction: "she steps out of the shower holding a towel" }, dasar[2]];
  const a = nilai(kosakata);
  assert.ok(a.errors.some((e) => e.rule === "L-21"), `kosakata pemicu harus ERROR: ${JSON.stringify(a.errors)}`);
  assert.equal(a.passed, false);

  const negasi = [dasar[0], { ...dasar[1], visual_direction: "medium shot, no other residents visible" }, dasar[2]];
  const b = nilai(negasi);
  assert.ok(b.errors.some((e) => e.rule === "L-21"), `negasi-orang harus ERROR: ${JSON.stringify(b.errors)}`);

  // Negative prompt yang sah TIDAK boleh ikut jatuh.
  const aman = [dasar[0], { ...dasar[1], visual_direction: "medium shot, no text on screen, no watermark" }, dasar[2]];
  assert.ok(!nilai(aman).errors.some((e) => e.rule === "L-21"));
});

test("A3/CTA: label keranjang PENUH yang diwajibkan, mengikuti platform", () => {
  // Tiga CTA nyata cuma berkata "cek keranjang" — itu yang ditemukan reviewer.
  const generik = [dasar[0], dasar[1], { role: "cta", text: "cek keranjang ya" }];
  const h = nilai(generik, { cartLabel: "keranjang kuning" });
  assert.ok(h.errors.some((e) => e.rule === "L-03"), `CTA tanpa "keranjang kuning" harus ditolak: ${JSON.stringify(h.errors)}`);
  assert.match(h.errors.find((e) => e.rule === "L-03")!.message_id, /keranjang kuning/);

  // Platform non-TikTok TIDAK boleh dipaksa "kuning" — menyuruh pembeli Shopee
  // mencari keranjang kuning adalah menyuruhnya mencari yang tidak ada.
  assert.ok(!nilai(generik, { cartLabel: "keranjang" }).errors.some((e) => e.rule === "L-03"));
});

test("naskah dasar lolos semua gate — gate tidak boleh mustahil dipenuhi", () => {
  const h = nilai(dasar, { cartLabel: "keranjang kuning" });
  assert.equal(h.passed, true, `naskah sehat harus lolos: ${JSON.stringify(h.errors)}`);
});
