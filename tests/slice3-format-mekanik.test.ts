// Slice 3 (audit A3/A5, 20 Agu 2026): audio_shift + 5 format baru dengan
// dukungan planner.
//
// Audit menemukan: bank mekanik 12 tanpa audio_shift, dan lima format yang
// disebut rencana (day_vlog, live_replay, make_and_taste, micro_cut_shift,
// storyboard_panels) NOL kemunculan di repo. Lebih dari itu — delapan format
// knowledge yang sudah ada pun hanya mewarnai prompt Idea Stage dan tidak
// pernah sampai ke perencana shot.
//
// Tes ini merah pada kode lama.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-slice3-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-slice3-storage-${process.pid}`;

const { MEKANIK_IDE, MEKANIK_BY_ID } = await import("../lib/script-engine/idea-mechanics");
const { muatFormat, formatById, bolehPasangan } = await import("../lib/script-engine/format-katalog");
const { planShots } = await import("../lib/media/shot-planner");
const { getCreatorCategory } = await import("../lib/personas");

const BARU = ["day_vlog", "live_replay", "make_and_taste", "micro_cut_shift", "storyboard_panels"];

test("audio_shift masuk bank mekanik — 13, bukan 12", () => {
  assert.equal(MEKANIK_IDE.length, 13, `harus 13 mekanik, dapat ${MEKANIK_IDE.length}`);
  const m = MEKANIK_BY_ID["audio_shift"];  // record, bukan Map
  assert.ok(m, "audio_shift hilang");
  assert.match(m.mekanik, /suara/i, "deskripsinya harus tentang SUARA yang berubah");
  assert.ok(m.contoh.length > 15, "contoh satu kalimat wajib ada");
});

test("5 format baru ada di knowledge/formats dan terbaca runtime", () => {
  const ids = muatFormat().map((f) => f.id);
  for (const id of BARU) assert.ok(ids.includes(id), `format ${id} belum ada di katalog`);
  for (const id of BARU) {
    const f = formatById(id)!;
    assert.ok(f.beat_table?.length >= 3, `${id}: beat_table kurang dari 3 beat`);
    assert.ok(f.technique?.length > 40, `${id}: technique terlalu tipis untuk membimbing model`);
    assert.ok(f.failure_mode?.length > 30, `${id}: failure_mode kosong — format tanpa cara gagal belum dipahami`);
  }
});

test("live_replay HANYA untuk Affiliate — Ads menolaknya", () => {
  const utkAffiliate = bolehPasangan({ formatId: "live_replay", contentType: "affiliate" } as never);
  assert.equal(utkAffiliate.boleh, true, `live_replay harus sah untuk Affiliate: ${utkAffiliate.sebab ?? ""}`);
  const utkAds = bolehPasangan({ formatId: "live_replay", contentType: "ads" } as never);
  assert.equal(utkAds.boleh, false, "live_replay tidak boleh dipakai Ads");
  assert.match(String(utkAds.sebab), /affiliate/i);
});

test("format lain tetap sah untuk kedua genre", () => {
  for (const id of ["day_vlog", "make_and_taste", "micro_cut_shift", "storyboard_panels"]) {
    for (const contentType of ["affiliate", "ads"] as const) {
      const p = bolehPasangan({ formatId: id, contentType, hookLevel: "gila" } as never);
      assert.equal(p.boleh, true, `${id} ditolak untuk ${contentType}: ${p.sebab ?? ""}`);
    }
  }
});

test("planner MENGERTI format ide — bukan cuma prompt Idea Stage", () => {
  const seg = [
    { role: "hook", start: 0, end: 5, text: "", visual_direction: "close-up produk", mode: "ASMR" },
    { role: "demo", start: 5, end: 11, text: "Enak banget rasanya.", visual_direction: "tangan menuang", mode: "ASMR" },
    { role: "cta", start: 11, end: 15, text: "Detailnya ada di bawah ya.", visual_direction: "produk hero", mode: "SELLING" },
  ] as never;
  const buat = (ideaFormat?: string) => planShots({
    jobId: "uji-slice3", durationSec: 15, segments: seg,
    category: getCreatorCategory("hijaber")!, productName: "Keripik Pedas", productCategory: "food",
    imageRefPath: "/tmp/x.jpg", qualityTier: "super_hq", format: "hands_only",
    ...(ideaFormat ? { ideaFormat } : {}),
  } as never) as { shots: { prompt: string }[] };

  const polos = buat().shots[0].prompt;
  const makeTaste = buat("make_and_taste").shots[0].prompt;
  assert.notEqual(polos, makeTaste, "format ide harus MENGUBAH prompt, bukan sekadar tercatat");

  const microCut = buat("micro_cut_shift").shots[0].prompt;
  assert.match(microCut, /cut|potong|shift/i, "micro_cut_shift harus membawa instruksi potongannya sendiri");

  const storyboard = buat("storyboard_panels").shots[0].prompt;
  assert.notEqual(storyboard, microCut, "tiap format harus punya perlakuan berbeda di planner");
});

test("format ide yang tidak dikenal DIABAIKAN, bukan diteruskan mentah ke model", () => {
  const seg = [
    { role: "hook", start: 0, end: 7, text: "", visual_direction: "x" },
    { role: "cta", start: 7, end: 15, text: "Detailnya ada di bawah ya.", visual_direction: "y" },
  ] as never;
  const spec = planShots({
    jobId: "uji-format-karangan", durationSec: 15, segments: seg,
    category: getCreatorCategory("hijaber")!, productName: "Keripik Pedas", productCategory: "food",
    imageRefPath: "/tmp/x.jpg", qualityTier: "super_hq", format: "hands_only",
    ideaFormat: "format_karangan_yang_tidak_ada",
  } as never) as { shots: { prompt: string }[] };
  assert.ok(!spec.shots.some((s) => /format_karangan/i.test(s.prompt)), "id asing tidak boleh bocor ke prompt");
});

test("format ide menyeberang dari snapshot admisi ke perencana shot", async () => {
  const { bacaJejakIde } = await import("../lib/postgres/worker");
  const { amplopValidasi } = await import("../lib/script-engine/admisi");
  const amplop = amplopValidasi(
    { passed: true, errors: [], warnings: [], checked_at: new Date().toISOString() },
    { script_source: "llm", admisi: { contentType: "affiliate", ideaFormat: "make_and_taste", ideSkor: 81 } as never }
  );
  assert.equal(bacaJejakIde(JSON.stringify(amplop)).ideaFormat, "make_and_taste");
  assert.equal(bacaJejakIde(null).ideaFormat, null);

  const fs = await import("node:fs");
  const src = fs.readFileSync("lib/postgres/worker.ts", "utf8");
  assert.match(src, /ideaFormat: bacaJejakIde\(row\.script_validation_result\)\.ideaFormat/,
    "worker harus meneruskan format ide ke planShots");
});
