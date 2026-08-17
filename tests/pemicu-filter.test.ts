// Kata pemicu penyaring konten penyedia (L-21).
//
// Sumbernya penolakan nyata 18 Agu 2026: adegan koridor dengan talent
// BERPAKAIAN LENGKAP ditolak Seedance sebagai NSFW. Yang salah bukan
// adegannya — kosakata promptnya yang bertetangga dengan adegan terlarang.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-pemicu-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-pemicu-storage-${process.pid}`;

const { periksaPemicu } = await import("../lib/media/pemicu-filter");
const { validateScript } = await import("../lib/script-engine/validator");
const { blokAturan } = await import("../lib/script-engine/llm");

test("kosakata bertetangga tertangkap, beserta sarannya", () => {
  for (const kata of ["towel", "bathrobe", "shower", "undressing", "baton"]) {
    const t = periksaPemicu(`she is holding a ${kata} in the corridor`);
    assert.ok(t.length >= 1, `"${kata}" harus tertangkap`);
    assert.ok(t[0].saran.length > 10, "saran harus bisa langsung dipakai");
  }
  assert.ok(periksaPemicu("wet skin glistening").length >= 1);
  assert.ok(periksaPemicu("kulit basah setelah mandi").length >= 1);
});

test("pintu kamar mandi hanya memicu BERSAMA orang kedua", () => {
  // Sendirian bukan masalah — iklan sabun memang punya kamar mandi.
  assert.equal(periksaPemicu("she stands near the bathroom door, alone").some((t) => t.cocok.includes("pintu")), false);
  assert.equal(
    periksaPemicu("she stands at the bathroom door while another person waits").some((t) => t.cocok.includes("pintu")),
    true
  );
});

test("negasi tentang ORANG tertangkap; negative prompt biasa TIDAK", () => {
  for (const kalimat of ["no other residents in the hallway", "her face is never sharp", "she never speaks to anyone", "tanpa orang lain di koridor"]) {
    const t = periksaPemicu(kalimat);
    assert.ok(t.some((x) => x.jenis === "negasi-orang"), `"${kalimat}" harus tertangkap`);
  }
  // Ini yang TIDAK boleh ikut tertangkap — kita memang membutuhkannya.
  for (const aman of ["no text on screen", "no watermark, no border", "no beauty filter", "no music"]) {
    assert.deepEqual(periksaPemicu(aman), [], `"${aman}" adalah negative prompt yang sah`);
  }
});

test("L-21 memeriksa ARAHAN VISUAL, bukan dialog, dan MENJATUHKAN naskah", () => {
  const nilai = (visual: string) => validateScript({
    hook_family: "H1", register: "bestie", productName: "Scarlett Acne Serum", priceIdr: 75000,
    qualityTier: "high_quality", durationSec: 15,
    segments: [
      { role: "hook", text: "Nah, jerawat aku dulu bandel banget sih", visual_direction: visual },
      { role: "demo", text: "aku pakai serum ini tiap malam deh, teksturnya ringan banget dan cepat meresap", visual_direction: "medium shot, hands only" },
      { role: "cta", text: "cek keranjang kuning ya", visual_direction: "static hero" },
    ],
  } as never, "strict");

  const kena = nilai("she walks past the bathroom door while another person waits, no other residents visible");
  const l21 = kena.errors.filter((e) => e.rule === "L-21");
  assert.ok(l21.length >= 2, `harus melaporkan kosakata DAN negasi: ${JSON.stringify(l21)}`);
  assert.equal(kena.passed, false, "L-21 kini gate keras (reviewer A5)");
  assert.equal(l21[0].segment, "hook", "harus menunjuk segmennya");

  // Arahan visual bersih: tidak ada L-21 sama sekali.
  assert.equal(nilai("medium selfie, eye level, static").errors.some((e) => e.rule === "L-21"), false);
});

test("prompt penulis menyebut aturannya, termasuk kenapa negasi dilarang", () => {
  const p = blokAturan();
  assert.match(p, /FILTER SAFETY/);
  assert.match(p, /towel, bathrobe, shower/);
  assert.match(p, /NEVER USE NEGATIONS ABOUT PEOPLE/);
  // Alasannya ikut, bukan cuma larangannya — model menuruti aturan yang masuk akal.
  assert.match(p, /renders what you name/);
  assert.match(p, /Say what IS there/);
});

test("kata ganti tidak boleh menabrak negative prompt yang sah", () => {
  // Arah MUNDUR menangkap "she never speaks"...
  assert.ok(periksaPemicu("she never speaks to anyone").some((t) => t.jenis === "negasi-orang"));
  assert.ok(periksaPemicu("dia tidak pernah menatap kamera").some((t) => t.jenis === "negasi-orang"));
  // ...tapi arah MAJU tidak boleh ikut memakai kata ganti, kalau tidak
  // "no music while she talks" akan tertangkap padahal itu negative prompt
  // yang memang kita butuhkan.
  assert.deepEqual(periksaPemicu("no music while she talks"), []);
  assert.deepEqual(periksaPemicu("no overlay text while they hold the bottle"), []);
});
