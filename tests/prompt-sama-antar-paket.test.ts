// PROMPT KETIGA PAKET WAJIB IDENTIK — yang berbeda hanya modelnya.
//
// Permintaan Brian, 2 Sep 2026: kualitas naskah dan prompt sudah disetel ke
// standarnya, jadi ia tidak boleh berubah karena mesinnya berbeda. Tes ini
// menjaga janji itu di dua tempat sekaligus: teks yang dikirim ke mesin, dan
// prompt shot yang disusun perencana sebelum mesin mana pun dipanggil.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

process.env.DB_PATH = `/tmp/racun-test-promptsama-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-promptsama-storage-${process.pid}`;

const { buildTaskContent } = await import("../lib/providers/stubs/byteplus");
const { buatBadanTask } = await import("../lib/providers/stubs/kie-grok");
const { teksPromptShot } = await import("../lib/providers/teks-prompt");
const { planShots } = await import("../lib/media/shot-planner");
const { getCreatorCategory } = await import("../lib/personas");
import type { VisualSpec, ShotSpec, QualityTier } from "../lib/providers/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "promptsama-"));
const gambar = path.join(dir, "0.png");
fs.writeFileSync(gambar, Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"));

const shot: ShotSpec = {
  index: 0, durationSec: 8,
  prompt: "a woman holds the bottle at chest height, gentle push in",
  imageRefPath: gambar,
};
const spec = (tier: QualityTier): VisualSpec => ({
  jobId: "j", width: 720, height: 1280, shots: [shot],
  negativePrompt: "no text, no logo, no writing",
  qualityTier: tier, generateAudio: true,
});

test("teks yang dikirim ke kie.ai IDENTIK dengan yang dikirim ke BytePlus", () => {
  const isiByteplus = buildTaskContent(spec("premium"), shot, "dreamina-seedance-2-0-mini-260615");
  const teksByteplus = (isiByteplus.find((c) => (c as { type: string }).type === "text") as { text: string }).text;
  const teksKie = buatBadanTask(spec("standard"), shot, "https://contoh.id/a.png").input.prompt;
  assert.equal(teksKie, teksByteplus, "prompt kedua mesin berbeda — kualitas paket jadi bergantung mesin, bukan naskah");
  assert.equal(teksKie, teksPromptShot(spec("standard"), shot));
});

test("bentuk pemisahnya tidak berubah — teks inilah yang masuk ke model", () => {
  // Dipaku pada bentuk yang sudah berjalan di produksi, titik dan spasinya
  // sekalian. Mengubah pemisah berarti mengubah masukan yang selama ini
  // menghasilkan keluaran yang diterima.
  assert.equal(
    teksPromptShot(spec("ultra"), shot),
    "a woman holds the bottle at chest height, gentle push in. Negative: no text, no logo, no writing",
  );
});

test("tidak ada provider yang menyusun teks promptnya sendiri lagi", () => {
  for (const f of ["lib/providers/stubs/byteplus.ts", "lib/providers/stubs/kie-grok.ts"]) {
    const s = fs.readFileSync(path.join(process.cwd(), f), "utf8");
    assert.match(s, /teksPromptShot\(spec, shot\)/, `${f} tidak memakai susunan bersama`);
    assert.ok(!/Negative:\s*\$\{spec\.negativePrompt\}/.test(s), `${f} menyusun ulang teksnya sendiri — dua salinan pasti hanyut`);
    assert.ok(!/NEGATIVE:/.test(s), `${f} memakai bentuk negative yang berbeda`);
  }
});

// ── Perencana shot: ketiga paket menghasilkan prompt yang sama ──────────────

const masukan = (tier: QualityTier) => ({
  jobId: "j",
  durationSec: 15,
  segments: [
    { role: "hook" as const, text: "Kulit kusam bikin nggak pede ya kak?" },
    { role: "demo" as const, text: "Serum ini cuma 89 ribu, dipakai pagi malam sih" },
    { role: "cta" as const, text: "Cek keranjang kuning ya kak" },
  ],
  category: getCreatorCategory("hijaber")!,
  productName: "Serum Glow",
  productCategory: "skincare",
  productVisualDesc: "botol serum bening 30ml",
  imageRefPath: gambar,
  qualityTier: tier,
  format: "talking_head" as const,
});

test("perencana shot menghasilkan prompt IDENTIK untuk standard, premium, dan ultra", () => {
  const rencana = (["standard", "premium", "ultra"] as const).map((t) => {
    const r = planShots(masukan(t) as Parameters<typeof planShots>[0]);
    return r.shots.map((s) => s.prompt);
  });
  assert.deepEqual(rencana[1], rencana[0], "premium berbeda prompt dari standard");
  assert.deepEqual(rencana[2], rencana[0], "ultra berbeda prompt dari standard");
});

test("dan identik pula dengan tier lama yang bersuara — tidak ada regresi mutu naskah", () => {
  const baru = planShots(masukan("premium") as Parameters<typeof planShots>[0]).shots.map((s) => s.prompt);
  const lama = planShots(masukan("high_quality") as Parameters<typeof planShots>[0]).shots.map((s) => s.prompt);
  assert.deepEqual(baru, lama, "prompt paket baru menyimpang dari yang sudah disetel di sistem lama");
});
