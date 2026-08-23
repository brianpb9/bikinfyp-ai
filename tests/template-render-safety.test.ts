import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AI_RENDER_BLOCKED_TEMPLATE_IDS, aiRenderBlockMessage } from "../lib/template-render-safety";
import { templateIdRenderOtoritatif } from "../lib/dashboard/render-cell";

test("legacy before-after serta T05 T08 T10 diblokir dari render AI dengan alasan footage asli", () => {
  assert.deepEqual([...AI_RENDER_BLOCKED_TEMPLATE_IDS], [
    "before-after", "t05-before-after", "t08-day-1-vs-day-7", "t10-bukti-di-lengan",
  ]);
  for (const id of AI_RENDER_BLOCKED_TEMPLATE_IDS) {
    const message = aiRenderBlockMessage(id);
    assert.match(message ?? "", /footage asli yang terverifikasi/i);
    assert.match(message ?? "", /Render AI diblokir/i);
  }
  assert.equal(aiRenderBlockMessage("t06-swatch-shade"), null);
});

test("request tanpa template_id tetap memakai snapshot blocked yang otoritatif", () => {
  for (const id of AI_RENDER_BLOCKED_TEMPLATE_IDS) {
    const authoritative = templateIdRenderOtoritatif({ templateId: id }, null);
    assert.equal(authoritative, id);
    assert.equal(aiRenderBlockMessage(authoritative), aiRenderBlockMessage(id));
  }
});

test("shared renderSatuSel memblokir snapshot sebelum approval/job/kredit/enqueue", () => {
  const source = readFileSync(new URL("../lib/dashboard/render-cell.ts", import.meta.url), "utf8");
  const derive = source.indexOf("templateIdRenderOtoritatif(jejak.admisi, sel.templateId)");
  const block = source.indexOf("aiRenderBlockMessage(templateIdOtoritatif)");
  assert.ok(derive > 0 && block > derive, "shared cell tidak memblokir ID snapshot otoritatif");
  for (const sideEffect of ["await smokeApproveScript(", "INSERT INTO jobs", "await creditsRepo.holdCredits(", "await enqueueJob("]) {
    const index = source.indexOf(sideEffect);
    assert.ok(index > block, `${sideEffect} mendahului real-footage block`);
  }
});

// Empat template bukti (before/after, day 1 vs day 7, bukti di lengan) tidak
// boleh dirender AI sama sekali: bukti sintetis soal efek produk di kulit orang
// adalah bukti palsu. Yang dijaga di sini URUTANNYA — blok harus terjadi
// sebelum satu pun side effect, supaya permintaan yang melewati UI tidak
// meninggalkan persona, skrip tersetujui, job, atau kredit tertahan.
//
// Sejak matriks avatar x skenario dibangun, side effect itu tidak lagi berada
// di dalam route: semuanya pindah ke lib/dashboard/render-cell.ts supaya kedua
// route memakai satu salinan aturan uang. Karena itu urutannya diperiksa
// terhadap PEMANGGILAN sel render, dan tes kedua memastikan side effect-nya
// memang cuma ada di sana — tanpa itu, memindahkan INSERT ke berkas lain akan
// diam-diam membuat penjaga ini lulus tanpa memeriksa apa pun.
const ROUTE_PEMAKAI_SEL = [
  "../app/api/dashboard/campaign/confirm/route.ts",
  "../app/api/dashboard/matrix/route.ts",
];

for (const rel of ROUTE_PEMAKAI_SEL) {
  test(`${rel.split("/").slice(-2)[0]}: blok server ditegakkan sebelum seluruh side effect render`, () => {
    const source = readFileSync(new URL(rel, import.meta.url), "utf8");
    const blockIndex = source.indexOf("aiRenderBlockMessage(templateId)");
    const personaIndex = source.indexOf("pgFindOrCreatePersona(");
    const poolIndex = source.indexOf("const pool = getPool(");
    const selIndex = source.indexOf("renderSatuSel(");
    assert.ok(blockIndex > 0, "route tidak memanggil safety guard");
    assert.ok(personaIndex > blockIndex, "blok harus terjadi sebelum membuat persona");
    assert.ok(poolIndex > blockIndex, "blok harus terjadi sebelum membuka pool pekerjaan");
    assert.ok(selIndex > blockIndex, "blok harus terjadi sebelum satu pun sel dirender");
    assert.match(source, /verified original footage required/);
  });
}

test("side effect render hanya hidup di sel bersama, bukan tersebar di route", () => {
  const sel = readFileSync(new URL("../lib/dashboard/render-cell.ts", import.meta.url), "utf8");
  for (const jejak of ["await smokeApproveScript(", "INSERT INTO jobs", "await creditsRepo.holdCredits(", "await enqueueJob("]) {
    assert.ok(sel.includes(jejak), `${jejak} harus ada di sel render bersama`);
  }
  for (const rel of ROUTE_PEMAKAI_SEL) {
    const source = readFileSync(new URL(rel, import.meta.url), "utf8");
    for (const jejak of ["await smokeApproveScript(", "INSERT INTO jobs", "await creditsRepo.holdCredits(", "await enqueueJob("]) {
      assert.ok(!source.includes(jejak), `${rel} menyalin ulang "${jejak}" — aturan uang harus satu salinan`);
    }
  }
});
