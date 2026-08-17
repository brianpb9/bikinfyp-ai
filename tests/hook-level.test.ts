// Unit test level hook Normal/Berani/Gila (Step 5):
// - pemilihan keluarga: berani/gila pakai BOLD_HOOK_PRIORITY, normal pakai kategori,
// - semua varian level berani/gila tetap lolos validator strict (tanpa template baru),
// - visual: HANYA gila yang menambah pembuka pattern-interrupt di SHOT 1, dengan
//   framing hands-only + identitas produk tetap utuh (product-safe).

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-hooklevel-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-hooklevel-storage-${process.pid}`;

const { pickHookFamilies, generateScripts } = await import("../lib/script-engine");
const { BOLD_HOOK_PRIORITY } = await import("../lib/config/hooks");
const { planShots } = await import("../lib/media/shot-planner");
const { getCreatorCategory } = await import("../lib/personas");

const product = { id: "prod-hl-1", name: "Serum Glow Bright", price_idr: 85000, category: "beauty" };

test("pickHookFamilies: berani/gila memakai keluarga bold, normal memakai prioritas kategori", async () => {
  const normal = pickHookFamilies("beauty", "p1");
  const berani = pickHookFamilies("beauty", "p1", "berani");
  const gila = pickHookFamilies("beauty", "p1", "gila");
  assert.deepEqual(berani, BOLD_HOOK_PRIORITY.slice(0, 3));
  assert.deepEqual(gila, berani, "teks berani dan gila sama — bedanya di visual shot 1");
  assert.notDeepEqual(normal, berani);
});

test("varian level berani lolos validator strict (tanpa template baru)", async () => {
  const variants = await generateScripts({ product, register: "bestie", hookLevel: "berani" });
  assert.equal(variants.length, 3);
  for (const v of variants) {
    assert.ok(BOLD_HOOK_PRIORITY.includes(v.hook_family), v.hook_family);
    assert.ok(v.validation.passed, `${v.hook_family}: ${JSON.stringify(v.validation.errors)}`);
  }
});

const hijaber = getCreatorCategory("hijaber")!;
const segments = [
  { role: "hook" as const, start: 0, end: 3, text: "Say, masa 85 ribu segini sih", visual_direction: "x" },
  { role: "demo" as const, start: 3, end: 10, text: "nah, ini Serum Glow, teksturnya niat, cuma 85 ribu", visual_direction: "x" },
  { role: "cta" as const, start: 10, end: 15, text: "Cek keranjang kuning ya deh", visual_direction: "x" },
];

function spec(hookLevel: "normal" | "berani" | "gila", format: "hands_only" | "talking_head" | "vo_broll" = "hands_only") {
  return planShots({
    jobId: "t-hl",
    durationSec: 15,
    segments,
    category: hijaber,
    productName: "Serum Glow",
    productCategory: "beauty",
    productVisualDesc: null,
    imageRefPath: "/tmp/x.png",
    qualityTier: format === "hands_only" ? "silent_caption" : "high_quality",
    format,
    hookLevel,
  });
}

test("gila: pembuka HIGH-ENERGY hanya di shot 1, shot lain tidak berubah", async () => {
  const s = spec("gila");
  assert.ok(s.shots[0].prompt.includes("HIGH-ENERGY OPENING"), s.shots[0].prompt);
  for (const shot of s.shots.slice(1)) {
    assert.ok(!shot.prompt.includes("HIGH-ENERGY OPENING"), shot.prompt);
  }
});

test("gila tetap product-safe: framing hands-only + identitas produk tidak hilang", async () => {
  const shot1 = spec("gila").shots[0];
  assert.ok(shot1.prompt.includes("hands and forearms only"), "framing hands-only hilang");
  assert.ok(shot1.prompt.includes("identical packaging"), "instruksi identitas produk hilang");
  // Tidak ada adegan bahaya/kacau — energi dari gerakan kamera saja.
  assert.ok(!/fall|roof|crash|explod|jump/i.test(shot1.prompt), shot1.prompt);
});

test("normal & berani: visual TIDAK berubah; vo_broll gila juga tanpa opener", async () => {
  assert.ok(!spec("normal").shots[0].prompt.includes("HIGH-ENERGY OPENING"));
  assert.ok(!spec("berani").shots[0].prompt.includes("HIGH-ENERGY OPENING"));
  assert.ok(!spec("gila", "vo_broll").shots[0].prompt.includes("HIGH-ENERGY OPENING"));
  const th = spec("gila", "talking_head").shots[0];
  assert.ok(th.prompt.includes("HIGH-ENERGY OPENING"), "talking_head gila harus dapat opener");
});
