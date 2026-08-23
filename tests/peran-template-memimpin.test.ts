import { test } from "node:test";
import assert from "node:assert/strict";
import { planShots } from "../lib/media/shot-planner";
import { getCreatorCategory } from "../lib/personas";
import { getTemplate } from "../lib/templates";
import { ugcRolesFor } from "../lib/media/ugc-template-roles";
import type { QualityTier } from "../lib/providers/types";
import type { SegmentDraft } from "../lib/script-engine/templates";

// Diperbaiki setelah RENDER BUKTI GAGAL (2026-08-13). Ketiga UGC Ads baru
// keluar identik sebagai talking-head biasa: "Meja Kosong" tanpa meja kosong,
// "Unboxing dari Dalam Kardus" tanpa kardus sama sekali.
//
// TIGA LAPIS penyebabnya, dan ketiganya harus tetap tertutup:
//   1. template baru tidak punya tabel peran shot sama sekali
//   2. peran template diletakkan SETELAH framing bawaan, jadi prompt
//      membantah dirinya sendiri dan model menuruti kalimat pertama
//   3. format "ads" mengabaikan tabel peran walau tabelnya ada

const SEG: SegmentDraft[] = [
  { role: "hook", text: "a", start: 0, end: 4, visual_direction: "x" },
  { role: "demo", text: "b", start: 4, end: 11, visual_direction: "y" },
  { role: "cta", text: "c", start: 11, end: 15, visual_direction: "z" },
];

function shots(id: string) {
  const t = getTemplate(id)!;
  return planShots({
    jobId: id, durationSec: 15, segments: SEG,
    category: getCreatorCategory("hijaber")!, productName: "Botol", productCategory: "beauty",
    imageRefPath: "/tmp/x.jpg", qualityTier: "high_quality" as QualityTier,
    format: t.format as never, ugcTemplate: id, shotCountOverride: t.shotCount,
  }).shots;
}

const BARU = ["ads-unboxing-pov", "ads-meja-kosong", "ads-panas-ekstrem"];

test("tiga template UGC Ads baru punya tabel peran shot", () => {
  for (const id of BARU) assert.ok(ugcRolesFor(id), `${id} tanpa tabel peran — akan jatuh ke beat generik`);
});

test("format ads TIDAK lagi membuang tabel peran yang sudah ada", () => {
  const p = shots("ads-meja-kosong")[0].prompt;
  assert.match(p, /crowded with production gear|vanishing one by one/i, "peran template ads dibuang lagi");
});

// Inti perbaikannya: peran memimpin, framing bawaan tidak ikut. Kalau framing
// bawaan kembali di depan, prompt akan membantah dirinya sendiri lagi.
test("peran template berada DI DEPAN, bukan sesudah framing bawaan", () => {
  for (const id of BARU) {
    const p = shots(id)[0].prompt;
    assert.ok(
      !/^face and upper body clearly visible/.test(p),
      `${id}: prompt masih dibuka framing bawaan — peran template kalah posisi`
    );
  }
});

test("ketiga template menghasilkan shot pembuka yang BERBEDA", () => {
  const p = BARU.map((id) => shots(id)[0].prompt);
  assert.equal(new Set(p).size, 3, "tiga template ads masih menghasilkan pembuka identik");
});

// Aturan #5 dokumen Brian: MASALAH DULU, BARU PRODUK.
test("template 'masalah dulu' menahan produk di shot pembuka", () => {
  const p = shots("ads-panas-ekstrem")[0].prompt;
  assert.match(p, /must NOT be visible or in use yet/i, "produk tidak ditahan — hook-nya mati");
});

test("unboxing membuka dari DALAM kardus, bukan dari wajah", () => {
  assert.match(shots("ads-unboxing-pov")[0].prompt, /INSIDE a closed cardboard box/i);
});

// Template LAMA tidak boleh ikut berubah perilakunya.
test("template lama yang sudah punya peran tetap berjalan seperti sebelumnya", () => {
  const p = shots("t02-bedah-fitur");
  assert.equal(p.length > 0, true);
  assert.match(p[0].prompt, /OPENING shot/i);
});

test("satu shot talking-head memuat seluruh timeline termasuk dua role story", () => {
  const timeline: SegmentDraft[] = [
    { role: "hook", label: "HOOK", text: "HOOK UNIK membuka masalah.", action: "AKSI HOOK memperlihatkan kartu pertama", start: 0, end: 2, visual_direction: "x" },
    { role: "demo", label: "FRICTION", text: "FRICTION SATU menambah tekanan.", action: "AKSI FRICTION SATU memindahkan kartu", start: 2, end: 6, visual_direction: "y" },
    { role: "story", label: "FRICTION", text: "FRICTION DUA tetap terdengar.", action: "AKSI FRICTION DUA membuka lipatan", start: 6, end: 10, visual_direction: "z" },
    { role: "story", label: "SPIKE", text: "SPIKE UNIK membalik keadaan.", action: "AKSI SPIKE meletakkan nama di meja", start: 10, end: 13, visual_direction: "z" },
    { role: "cta", label: "BUTTON", text: "BUTTON UNIK menutup cerita.", action: "AKSI BUTTON menunjuk nama layanan", start: 13, end: 15, visual_direction: "z" },
  ];
  const prompt = planShots({
    jobId: "story-timeline", durationSec: 15, segments: timeline,
    category: getCreatorCategory("hijaber")!, productName: "Botol", productCategory: "beauty",
    imageRefPath: "/tmp/x.jpg", qualityTier: "high_quality" as QualityTier,
    format: "talking_head",
  }).shots[0].prompt;
  const positions = timeline.map((segment) => prompt.indexOf(segment.text));
  assert.ok(positions.every((position) => position >= 0), `segmen hilang dari prompt: ${positions.join(",")}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "urutan dialog tidak mengikuti timeline");
  const actionPositions = timeline.map((segment) => prompt.indexOf(segment.action!));
  assert.ok(actionPositions.every((position) => position >= 0), `aksi hilang dari prompt: ${actionPositions.join(",")}`);
  assert.deepEqual([...actionPositions].sort((a, b) => a - b), actionPositions, "urutan aksi tidak mengikuti timeline");
  for (const segment of timeline) assert.match(prompt, new RegExp(`${segment.start}-${segment.end} seconds`));

  const tanpaSpike = timeline.map((segment) => segment.label === "SPIKE" ? { ...segment, action: "" } : segment);
  const promptMutasi = planShots({
    jobId: "story-timeline-mutasi", durationSec: 15, segments: tanpaSpike,
    category: getCreatorCategory("hijaber")!, productName: "Botol", productCategory: "beauty",
    imageRefPath: "/tmp/x.jpg", qualityTier: "high_quality" as QualityTier,
    format: "talking_head",
  }).shots[0].prompt;
  assert.doesNotMatch(promptMutasi, /AKSI SPIKE meletakkan nama di meja/, "mutasi aksi SPIKE seharusnya terdeteksi");
});
