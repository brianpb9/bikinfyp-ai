import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AI_RENDER_BLOCKED_TEMPLATE_IDS, aiRenderBlockMessage } from "../lib/template-render-safety";

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

test("API confirm menegakkan blok server sebelum seluruh side effect render", () => {
  const source = readFileSync(
    new URL("../app/api/dashboard/campaign/confirm/route.ts", import.meta.url),
    "utf8"
  );
  const blockIndex = source.indexOf("aiRenderBlockMessage(templateId)");
  const personaIndex = source.indexOf("pgFindOrCreatePersona(user.id");
  const approvalIndex = source.indexOf("await smokeApproveScript(");
  const poolIndex = source.indexOf("const pool = getPool(");
  const jobIndex = source.indexOf("INSERT INTO jobs");
  const creditIndex = source.indexOf("await creditsRepo.holdCredits(");
  const queueIndex = source.indexOf("await enqueueJob(");
  assert.ok(blockIndex > 0, "confirm route tidak memanggil safety guard");
  assert.ok(personaIndex > blockIndex, "blok harus terjadi sebelum membuat persona");
  assert.ok(approvalIndex > blockIndex, "blok harus terjadi sebelum menyetujui skrip");
  assert.ok(poolIndex > blockIndex, "blok harus terjadi sebelum membuka pool pekerjaan");
  assert.ok(jobIndex > blockIndex, "blok harus terjadi sebelum INSERT job");
  assert.ok(creditIndex > blockIndex, "blok harus terjadi sebelum menahan kredit");
  assert.ok(queueIndex > blockIndex, "blok harus terjadi sebelum memasukkan job ke antrean");
  assert.match(source, /verified original footage required/);
});
