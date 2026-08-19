// Slice 1 (audit A1/A4, 19 Agu 2026): dokumen kanonik masuk knowledge/rules DAN
// mode berhenti jadi label bebas.
//
// Sebelum ini: `mode` cuma string metadata (llm.ts: "mode cuma metadata
// tampilan"), planner tidak pernah membacanya, dan 14 mode beserta kontrak
// kamera/talent-nya hidup di luar app. Akibatnya kalimat gerbang di modes.md
// sendiri — "Any segment whose camera contradicts its governing mode fails the
// gate" — tidak pernah bisa berlaku.
//
// Tes ini merah pada kode lama.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-mode-axis-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-mode-axis-storage-${process.pid}`;

const { MODE_KAMERA, modeDikenal, kontrakMode, framingUntukMode } = await import("../lib/media/mode-kamera");
const { planShots } = await import("../lib/media/shot-planner");
const { getCreatorCategory } = await import("../lib/personas");

test("dokumen kanonik ada di knowledge/rules dan terbaca runtime", () => {
  for (const f of [
    "knowledge/rules/modes.md",
    "knowledge/rules/content-types.md",
    "knowledge/rules/formats.md",
    "knowledge/rules/prompt-language.md",
    "knowledge/rules/MASTER-UGC-ADS.md",
    "knowledge/rules/MASTER-UGC-AFFILIATE.md",
    "knowledge/rules/STORY-OS-ADS-v1.md",
  ]) {
    assert.ok(fs.existsSync(f), `${f} belum di-ingest`);
    assert.ok(fs.readFileSync(f, "utf8").length > 500, `${f} kosong/terpotong`);
  }
});

test("14 mode dari modes.md jadi tabel kode, bukan label bebas", () => {
  assert.equal(MODE_KAMERA.length, 14, `harus 14 mode, dapat ${MODE_KAMERA.length}`);
  for (const m of MODE_KAMERA) {
    assert.ok(m.kamera.length > 5, `mode ${m.id} tanpa kontrak kamera`);
    assert.ok(m.talent.length > 5, `mode ${m.id} tanpa kontrak talent`);
    // Beberapa larangan memang satu kata ("CTA" untuk ANGRY_MODE) — yang
    // dijaga keberadaannya, bukan panjangnya.
    assert.ok(m.jangan.length > 0, `mode ${m.id} tanpa larangan`);
  }
  // Beberapa id yang disebut dokumen harus ada persis.
  for (const id of ["GENERAL", "SELFIE", "MIRROR_SELFIE", "ASMR", "CCTV", "SELLING", "CAR_TALKING", "CRYING"]) {
    assert.ok(modeDikenal(id), `mode ${id} hilang dari tabel`);
  }
});

test("mode tak dikenal ditolak — bukan diteruskan diam-diam ke prompt", () => {
  assert.equal(modeDikenal("MODE_KARANGAN"), false);
  assert.equal(kontrakMode("MODE_KARANGAN"), null);
  assert.ok(kontrakMode("selfie"), "pencocokan harus case-insensitive");
});

test("kontrak kamera mode masuk prompt shot", () => {
  const seg = [
    { role: "hook", start: 0, end: 5, text: "Kak, ini beneran ngefek?", visual_direction: "close-up produk", mode: "CCTV" },
    { role: "demo", start: 5, end: 11, text: "Dipakai tiap malam.", visual_direction: "tangan memakai produk", mode: "CCTV" },
    { role: "cta", start: 11, end: 15, text: "Detailnya ada di bawah ya.", visual_direction: "produk hero", mode: "SELLING" },
  ] as never;
  const spec = planShots({
    jobId: "uji-mode", durationSec: 15, segments: seg,
    category: getCreatorCategory("hijaber")!, productName: "Serum Glow Bening", productCategory: "beauty",
    imageRefPath: "/tmp/x.jpg", qualityTier: "super_hq", format: "talking_head",
  } as never) as { shots: { prompt: string }[] };
  const gabung = spec.shots.map((s) => s.prompt).join(" || ");
  const cctv = kontrakMode("CCTV")!;
  assert.ok(
    gabung.includes(cctv.kamera.slice(0, 18)),
    `kontrak kamera CCTV tidak muncul di prompt mana pun:\n${gabung.slice(0, 400)}`
  );
});

test("framingUntukMode mengembalikan kalimat kamera, bukan id", () => {
  const f = framingUntukMode("ASMR");
  assert.ok(f && /close-up|macro/i.test(f), `framing ASMR tidak masuk akal: ${f}`);
  assert.equal(framingUntukMode("TIDAK_ADA"), null);
});

test("MASTER genre disuntik VERBATIM sesuai content_type, bukan diringkas", async () => {
  const { blokMaster } = await import("../lib/script-engine/standar-10-teks");
  const ads = blokMaster("ads");
  const aff = blokMaster("affiliate");
  assert.match(ads, /Apa itu Ads \(dan bukan\)/, "seksi 1 MASTER-ADS tidak masuk");
  assert.match(ads, /Uji kamar/, "uji kamar Ads hilang — itu kalimat pemutusnya");
  assert.match(aff, /Apa itu Affiliate \(dan bukan\)/, "seksi 1 MASTER-AFFILIATE tidak masuk");
  assert.match(aff, /tindakan pribadi/, "uji kamar Affiliate hilang");
  assert.notEqual(ads, aff, "dua genre tidak boleh menerima blok yang sama");
  // Verbatim, bukan parafrase: potongan dokumen harus muncul apa adanya.
  const fsx = await import("node:fs");
  const sumber = fsx.readFileSync("knowledge/rules/MASTER-UGC-ADS.md", "utf8");
  const kalimat = sumber.split("\n").find((b) => b.startsWith("Uji kamar"))!;
  assert.ok(ads.includes(kalimat.trim()), "isi MASTER berubah saat disuntik — harus verbatim");
});

test("penulis & Idea Stage benar-benar memanggil blokMaster per genre", async () => {
  const fsx = await import("node:fs");
  const llm = fsx.readFileSync("lib/script-engine/llm.ts", "utf8");
  assert.match(llm, /blokMaster\(contentType\)/, "writer tidak menyuntik MASTER");
  assert.match(llm, /blokAturan\(r\.contentType\)/, "genre tidak diteruskan ke blok aturan");
  const ide = fsx.readFileSync("lib/script-engine/ide.ts", "utf8");
  assert.match(ide, /blokMaster\(r\.contentType\)/, "Idea Stage tidak menyuntik MASTER");
});

test("image worker menyalin knowledge/ — sumbu mode tidak boleh mati diam-diam di container", async () => {
  const fsx = await import("node:fs");
  const dockerfile = fsx.readFileSync("Dockerfile.worker", "utf8");
  assert.match(
    dockerfile,
    /COPY[^\n]*knowledge \.\/knowledge/,
    "worker menjalankan planShots yang memuat knowledge/rules/modes.md; tanpa COPY ini kontrak kamera hilang di produksi"
  );
});
