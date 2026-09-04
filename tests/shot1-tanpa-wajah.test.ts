// STANDAR-10 §E sebagai GATE MESIN, bukan konvensi.
//
// Data 9 render nyata (18 Agu, JJ Glow): SEMUA yang lolos NSFW membuka tanpa
// wajah; SEMUA yang wajahnya tampil di shot 1 ditolak. Standarnya menulis:
// "Jadikan ini default, bukan pilihan." Tes ini menjaga defaultnya tidak
// tergeser diam-diam — dan menjaga PENGECUALIANNYA tetap pengecualian sadar.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-shot1-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-shot1-storage-${process.pid}`;
process.env.SCRIPT_LLM = "0";

const { planShots } = await import("../lib/media/shot-planner");
const { getCreatorCategory } = await import("../lib/personas");

const segments = [
  { role: "hook" as const, start: 0, end: 8, text: "Nah, jerawat masih bandel juga sih?", visual_direction: "x" },
  { role: "demo" as const, start: 8, end: 20, text: "terus aku pakai ini tiap malam deh, teksturnya ringan banget dan cepat meresap", visual_direction: "x" },
  { role: "cta" as const, start: 20, end: 30, text: "jadi kalau kamu mau coba juga, cek keranjang kuning ya", visual_direction: "x" },
];

function rencana(o: Partial<Record<string, unknown>> = {}) {
  return planShots({
    jobId: "t", durationSec: 30, segments,
    category: getCreatorCategory("hijaber")!,
    productName: "Scarlett Acne Serum", productCategory: "beauty",
    productVisualDesc: "botol dropper bening", imageRefPath: "/tmp/x.png",
    qualityTier: "super_hq" as never,
    format: "talking_head" as never,
    ...o,
  } as Parameters<typeof planShots>[0]);
}

// Frasa yang menandai WAJAH TAMPIL di prompt shot.
const FRASA_WAJAH = /presenter holding|face and upper body clearly visible|speaks casually to camera/i;
const FRASA_TANPA_WAJAH = /hands and forearms only/i;

test("talking_head multi-shot: shot 1 tanpa wajah, shot 2+ tetap presenter", () => {
  for (const durationSec of [30, 45]) {
    const spec = rencana({ durationSec });
    assert.ok(spec.shots.length >= 2, `durasi ${durationSec} harus multi-shot`);
    const shot1 = spec.shots[0].prompt;
    assert.match(shot1, FRASA_TANPA_WAJAH, `shot 1 (${durationSec}s) harus framing tangan-saja:\n${shot1}`);
    assert.doesNotMatch(shot1, FRASA_WAJAH, `shot 1 (${durationSec}s) masih memanggil wajah:\n${shot1}`);
    // Preseden job a1192101: "presenter speaks to camera" menggambar wajah.
    assert.match(shot1, /VOICEOVER/i, `dialog shot 1 harus VO off-screen:\n${shot1}`);
    const shot2 = spec.shots[1].prompt;
    assert.match(shot2, /presenter/i, `shot 2 (${durationSec}s) harus tetap presenter:\n${shot2}`);
  }
});

test("pengecualian sadar #1: talking_head 15 dtk (satu shot) tetap berwajah", () => {
  const spec = rencana({ durationSec: 15, segments: [
    { role: "hook", start: 0, end: 4, text: "Nah, jerawat masih bandel juga sih?", visual_direction: "x" },
    { role: "demo", start: 4, end: 10, text: "terus aku pakai ini tiap malam deh, teksturnya ringan banget dan cepat meresap", visual_direction: "x" },
    { role: "cta", start: 10, end: 15, text: "jadi kalau kamu mau coba juga, cek keranjang kuning ya", visual_direction: "x" },
  ] });
  assert.equal(spec.shots.length, 1, "talking_head 15 dtk sengaja satu shot (kontinuitas wajah)");
  assert.doesNotMatch(spec.shots[0].prompt, FRASA_TANPA_WAJAH, "satu-shot tidak boleh kehilangan wajah — ia bukan talking_head lagi");
});

test("pengecualian sadar #2: fashion full-body tetap tampil utuh sejak shot 1", () => {
  const spec = rencana({ productCategory: "fashion", productName: "Gamis Basic Daily" });
  assert.match(spec.shots[0].prompt, /full body visible head to toe/i, spec.shots[0].prompt);
});

test("hands_only tidak berubah — sudah tanpa wajah sejak dulu", () => {
  const spec = rencana({ format: "hands_only", qualityTier: "high_quality" });
  assert.match(spec.shots[0].prompt, FRASA_TANPA_WAJAH);
});
