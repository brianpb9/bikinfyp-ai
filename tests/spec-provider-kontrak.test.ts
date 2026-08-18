// P0 reviewer ronde 5: SETIAP render berbasis planShots() melempar di gerbang
// provider.
//
// Sebabnya dua aturan yang benar sendiri-sendiri dan bertabrakan begitu
// disambung: frasaNegatifBersih() membuang kata "no" dari negative prompt
// (karena "Negative: no face" = hindari ketiadaan wajah), sementara
// assertVisualSpec() masih menuntut literal "no added text overlay".
//
// Tidak ada satu pun tes yang menjalankan keduanya BERURUTAN, jadi keduanya
// hijau sementara produksi mati total. Itu yang ditutup di sini: kontraknya
// diuji sebagai satu rantai, persis seperti worker menjalankannya.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-spec-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-spec-storage-${process.pid}`;
process.env.SCRIPT_LLM = "0";

const { planShots } = await import("../lib/media/shot-planner");
const { assertVisualSpec } = await import("../lib/providers/types");
const { getCreatorCategory } = await import("../lib/personas");
const { TVC_ROUTES } = await import("../lib/templates");

const segments = [
  { role: "hook" as const, start: 0, end: 4, text: "Nah, jerawat masih bandel juga sih?", visual_direction: "x" },
  { role: "demo" as const, start: 4, end: 10, text: "aku pakai ini tiap malam deh", visual_direction: "x" },
  { role: "cta" as const, start: 10, end: 15, text: "cek keranjang kuning ya", visual_direction: "x" },
];

function rencana(o: { format: string; tier?: string; durationSec?: number; tvcRoute?: string; noModel?: boolean }) {
  return planShots({
    jobId: "t", durationSec: o.durationSec ?? 15, segments,
    category: getCreatorCategory("hijaber")!,
    productName: "Scarlett Acne Serum", productCategory: "beauty",
    productVisualDesc: "botol dropper bening", imageRefPath: "/tmp/x.png",
    qualityTier: (o.tier ?? "high_quality") as never,
    format: o.format as never,
    ...(o.tvcRoute ? { tvcRoute: o.tvcRoute as never } : {}),
    ...(o.noModel ? { noModel: true } : {}),
  });
}

test("spec dari planShots LOLOS gerbang provider — semua format, tier, rute", () => {
  const gagal: string[] = [];
  let diuji = 0;
  for (const format of ["hands_only", "talking_head", "vo_broll", "tvc", "ads"]) {
    for (const tier of ["silent_caption", "high_quality", "super_hq"]) {
      for (const durationSec of [15, 30]) {
        for (const rute of format === "tvc" ? [...TVC_ROUTES] : [undefined]) {
          diuji++;
          try {
            assertVisualSpec(rencana({ format, tier, durationSec, tvcRoute: rute }));
          } catch (err) {
            gagal.push(`${format}/${tier}/${durationSec}${rute ? "/" + rute : ""}: ${(err as Error).message}`);
          }
        }
      }
    }
  }
  assert.ok(diuji >= 50, `matriksnya terlalu kecil: ${diuji}`);
  assert.deepEqual(gagal.slice(0, 5), [], `${gagal.length}/${diuji} kombinasi ditolak gerbang provider`);
});

test("gerbangnya tetap menggigit — spec tanpa larangan overlay ditolak", () => {
  const spec = rencana({ format: "hands_only" });
  assert.throws(
    () => assertVisualSpec({ ...spec, negativePrompt: "blurry, watermark" }),
    /added text overlay/,
    "assertion yang tidak pernah menolak apa pun bukan gerbang"
  );
  // Dan aturan audio-vs-tier tetap ditegakkan.
  assert.throws(() => assertVisualSpec({ ...spec, generateAudio: !spec.generateAudio }), /generateAudio/);
});
