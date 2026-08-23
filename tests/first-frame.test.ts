import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIAYA_FRAME_IDR, MAKS_FRAME_PER_TIER, harusMenahanProduk, perluFrameBuatan, pilihShotUntukFrame,
} from "../lib/media/first-frame";
import { config } from "../lib/config";
import { planShots } from "../lib/media/shot-planner";
import { getCreatorCategory } from "../lib/personas";
import { getTemplate } from "../lib/templates";
import type { QualityTier } from "../lib/providers/types";
import type { SegmentDraft } from "../lib/script-engine/templates";

// Mode i2v menjadikan gambar yang dikirim sebagai FRAME PERTAMA PERSIS.
// Terukur lewat tiga putaran render 2026-08-13: selama gambarnya foto produk,
// "Atap Jebol" tidak pernah punya atap runtuh dan "Meja Kosong" tidak pernah
// punya meja kosong. Frame buatan yang menyelesaikannya.

const SEG: SegmentDraft[] = [
  { role: "hook", text: "", start: 0, end: 5, visual_direction: "x" },
  { role: "demo", text: "b", start: 5, end: 11, visual_direction: "y" },
  { role: "cta", text: "c", start: 11, end: 15, visual_direction: "z" },
];

function shots(templateId: string) {
  const t = getTemplate(templateId)!;
  return planShots({
    jobId: "t", durationSec: 15, segments: SEG, category: getCreatorCategory("hijaber")!,
    productName: "Botol", productCategory: "beauty", imageRefPath: "/tmp/x.jpg",
    qualityTier: "high_quality" as QualityTier, format: t.format as never,
    ugcTemplate: templateId, shotCountOverride: t.shotCount,
  }).shots;
}

test("pembuka staging Ads tidak lagi menyamar sebagai shot tanpa produk", () => {
  for (const id of ["ads-atap-jebol", "ads-dobrak-pintu", "ads-tembus-dinding", "ads-waktu-berhenti", "ads-panas-ekstrem"]) {
    const p = shots(id)[0];
    assert.match(p.prompt, /stage|staged|theatrical|prop|cardboard|paper|printed|red practical lamp/i, `${id}: staging pembuka hilang`);
    assert.match(p.prompt, /card/i, `${id}: kontinuitas properti kartu hilang dari prompt final`);
    assert.match(p.prompt, /unprinted|no letters|blank/i, `${id}: kartu tidak dikunci blank`);
    assert.doesNotMatch(p.prompt, /readable (?:identity|name|category|price)|printed (?:identity|name|category|price)/i);
    assert.equal(harusMenahanProduk(p), false, `${id}: pembuka netral masih menahan produk`);
    assert.equal(perluFrameBuatan(p), false, `${id}: frame buatan legacy masih diminta`);
  }
});

test("shot biasa TIDAK dibuatkan frame — foto produk asli lebih baik dan gratis", () => {
  const p = shots("kenalin-bisnis")[0];
  assert.equal(perluFrameBuatan(p), false, "shot penjelas seharusnya memakai foto produk asli");
});

// Batas jatah adalah keputusan MARGIN, bukan teknis. Kalau tarif atau harga
// berubah dan angka ini tidak ditinjau, tiap video bersuara bisa kehilangan
// hampir seluruh marginnya tanpa ada yang sadar.
test("jatah frame per tier menjaga biaya di bawah seperempat margin", () => {
  const tiers: Record<string, { priceIdr: number; cogsIdr: number }> = config.tiers as never;
  for (const [tier, maks] of Object.entries(MAKS_FRAME_PER_TIER)) {
    const t = tiers[tier];
    assert.ok(t, `tier "${tier}" tidak ada di config — daftar jatah usang`);
    const margin = t.priceIdr - t.cogsIdr;
    const biaya = maks * BIAYA_FRAME_IDR;
    assert.ok(
      biaya <= margin * 0.25,
      `tier ${tier}: ${maks} frame = Rp${biaya}, lebih dari 25% margin Rp${margin}`
    );
  }
});

test("saat jatah habis, shot yang WAJIB menahan produk didahulukan", () => {
  // Shot 0 wajib menahan produk, shot 2 hanya "perlu" komposisi khusus.
  const p = [
    { prompt: "a quiet room", withholdProduct: true },
    { prompt: "biasa saja, presenter memegang produk" },
    { prompt: "top-down overhead shot of a table" },
  ];
  assert.deepEqual(pilihShotUntukFrame(p, "high_quality"), [0], "yang wajib tidak didahulukan");
});

test("tier mahal boleh lebih banyak frame", () => {
  const p = [{ prompt: "x", withholdProduct: true }, { prompt: "top-down overhead shot" }, { prompt: "POV from INSIDE a box" }];
  assert.equal(pilihShotUntukFrame(p, "super_hq").length, 3);
  assert.equal(pilihShotUntukFrame(p, "high_quality").length, 1);
});

test("tier tidak dikenal jatuh ke jatah paling hemat, bukan tanpa batas", () => {
  const p = [{ prompt: "a", withholdProduct: true }, { prompt: "b", withholdProduct: true }, { prompt: "POV from INSIDE" }];
  assert.equal(pilihShotUntukFrame(p, "tier-ngawur").length, 1);
});

test("tanpa shot yang membutuhkan, tidak ada frame dibuat sama sekali", () => {
  assert.deepEqual(pilihShotUntukFrame([{ prompt: "biasa" }, { prompt: "biasa juga" }], "super_hq"), []);
});
