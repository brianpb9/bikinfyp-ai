// Segmen yang ditulis LLM sebagai "produk belum tampil" harus BENAR-BENAR
// menahan produk di frame pertamanya.
//
// Cacat aslinya (jalankan STEP 2, 17 Agu, segmen 0): LLM menulis
// product_state="hidden" untuk hook, lalu shot-nya tetap berangkat dari foto
// produk — model diberi barang yang diperintahkan disembunyikan, dan detik
// pertamanya kembali jadi pack shot. Sinyalnya hilang di keSegmentDraft, yang
// hanya menyalin role/start/end/text/visual_direction.
//
// Rantainya diuji utuh: LLM -> SegmentDraft -> planShots -> pilihan frame.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-hidden-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-hidden-storage-${process.pid}`;

const { planShots } = await import("../lib/media/shot-planner");
const { keSegmentDraft } = await import("../lib/script-engine/llm");
const { perluFrameBuatan, harusMenahanProduk, pilihShotUntukFrame } = await import("../lib/media/first-frame");
const { getCreatorCategory } = await import("../lib/personas");

const segmenLlm = [
  {
    block: "HOOK" as const, label: "PAIN", start: 0, end: 4,
    text: "Jerawat udah hilang, bekasnya masih bandel?",
    start_state: "she is already touching her cheek, no product anywhere in frame",
    framing: "medium selfie", angle: "eye level", camera: "handheld drift",
    action: "she leans in, then points at her cheek",
    product_state: "hidden" as const, expression: "frustrated",
    audio_note: "", why: "setup — names the pain before anything is sold", mode: "SELFIE",
  },
  {
    block: "BODY" as const, label: "DEMO", start: 4, end: 10,
    text: "Ini serum yang aku pakai tiap malam, teksturnya ringan banget.",
    start_state: "the bottle is already in her hand at chest height",
    framing: "medium", angle: "eye level", camera: "slow push in",
    action: "she turns the bottle, then tilts the label to camera",
    product_state: "partial" as const, expression: "warm",
    audio_note: "", why: "tension — shows the fix without proving it yet", mode: "SELLING",
  },
  {
    block: "CTA" as const, label: "REVEAL", start: 10, end: 15,
    text: "Cuma tujuh puluh lima ribu, cek di keranjang kuning ya!",
    start_state: "the bottle is already raised beside her face, label facing camera",
    framing: "tight", angle: "eye level", camera: "static",
    action: "she holds it steady, then points down",
    product_state: "hero" as const, expression: "bright",
    audio_note: "", why: "payoff — the label is finally readable", mode: "SELLING",
  },
];

test("keSegmentDraft membawa product_state, tidak membuangnya", () => {
  const d = keSegmentDraft(segmenLlm);
  assert.deepEqual(d.map((s) => s.product_state), ["hidden", "partial", "hero"]);
});

function rencana(format: "hands_only" | "talking_head") {
  return planShots({
    jobId: `hidden-${format}`,
    durationSec: 15,
    segments: keSegmentDraft(segmenLlm),
    category: getCreatorCategory("hijaber")!,
    productName: "Scarlett Acne Serum",
    productCategory: "beauty",
    productVisualDesc: "botol dropper bening 20ml, label putih-ungu",
    imageRefPath: "/tmp/x.png",
    qualityTier: "high_quality",
    format,
  });
}

test("format multi-shot: hanya shot pemilik segmen hidden yang menahan produk", () => {
  const shots = rencana("hands_only").shots;
  assert.ok(shots.length >= 3, `butuh >=3 shot, dapat ${shots.length}`);
  assert.equal(harusMenahanProduk(shots[0]), true, "hook ditulis hidden, harus menahan produk");
  for (const s of shots.slice(1)) {
    assert.equal(harusMenahanProduk(s), false, `shot ${s.index} tidak ditulis hidden`);
  }
});

test("shot hidden dapat jatah frame buatan lebih dulu, walau jatah tier cuma satu", () => {
  const shots = rencana("hands_only").shots;
  assert.equal(perluFrameBuatan(shots[0]), true);
  // high_quality = 1 frame. Yang wajib menahan produk harus yang kebagian —
  // tanpa frame buatan, shot itu MUSTAHIL benar karena foto produk akan jadi
  // frame pertamanya.
  assert.deepEqual(pilihShotUntukFrame(shots, "high_quality"), [0]);
});

test("satu shot memuat hook+CTA: yang dibaca segmen PALING AWAL, bukan 'ada yang hidden'", () => {
  // talking_head 15 dtk sengaja tidak dipecah — wajahnya bergeser antar klip.
  // Jadi hook (hidden) dan CTA (hero) berada di klip yang sama.
  const shots = rencana("talking_head").shots;
  assert.equal(shots.length, 1, "talking_head 15 dtk harus tetap satu klip");
  // Frame pertamanya mengikuti hook, jadi produk ditahan di frame pertama...
  assert.equal(harusMenahanProduk(shots[0]), true);
  // ...tapi produknya WAJIB tetap muncul di klip itu, karena CTA-nya hero.
  // Kalau tidak, aturan ini diam-diam menghapus produk dari seluruh video.
  assert.match(shots[0].prompt, /Scarlett Acne Serum|the product/i,
    "produk harus tetap disebut di prompt klip yang memuat CTA hero");
});

test("naskah template lama tidak ikut berubah — tanpa product_state, perilakunya sama", () => {
  const lama = [
    { role: "hook" as const, start: 0, end: 4, text: "a", visual_direction: "x" },
    { role: "demo" as const, start: 4, end: 10, text: "b", visual_direction: "x" },
    { role: "cta" as const, start: 10, end: 15, text: "c", visual_direction: "x" },
  ];
  const shots = planShots({
    jobId: "hidden-2", durationSec: 15, segments: lama,
    category: getCreatorCategory("hijaber")!,
    productName: "Scarlett Acne Serum", productCategory: "beauty",
    productVisualDesc: "botol dropper bening 20ml", imageRefPath: "/tmp/x.png",
    qualityTier: "high_quality", format: "talking_head",
  }).shots;
  for (const s of shots) assert.equal(harusMenahanProduk(s), false);
});

test("talking_head tidak bisa dipaksa multi-klip selama wajah belum bisa dikunci", () => {
  // shotCountOverride adalah lubang terakhir: ia melewati aturan ceil(durasi/15)
  // dan bisa memaksa satu video berwajah jadi 4 generate terpisah — yaitu 4
  // orang berbeda (insiden 7 Agu, terulang di jalankan STEP 2 17 Agu).
  const buat = (format: "talking_head" | "hands_only") =>
    planShots({
      jobId: `override-${format}`, durationSec: 15, segments: keSegmentDraft(segmenLlm),
      category: getCreatorCategory("hijaber")!, productName: "Scarlett Acne Serum",
      productCategory: "beauty", productVisualDesc: "botol dropper bening 20ml",
      imageRefPath: "/tmp/x.png", qualityTier: "high_quality", format,
      shotCountOverride: 4,
    }).shots.length;
  assert.equal(buat("talking_head"), 1, "override harus DIABAIKAN untuk format berwajah");
  // Format tanpa wajah tidak punya masalah itu, jadi overridenya tetap
  // dihormati — sebatas jepitan durasi yang sudah ada: 15 dtk / minimal 4 dtk
  // per shot = 3, bukan 4. Yang diuji di sini adalah "tidak diabaikan",
  // bukan angkanya persis sama dengan yang diminta.
  assert.equal(buat("hands_only"), 3);
});
