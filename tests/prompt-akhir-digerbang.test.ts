// A5 P0: prompt AKHIR yang benar-benar dikirim ke penyedia harus digerbang,
// bukan sekadar dicatat. Reviewer: 3/3 final shot prompt hands_only memicu
// detektor kita sendiri karena frasa "face and body NOT visible" — larangan
// yang kita wajibkan sendiri.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-pf-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-pf-storage-${process.pid}`;
process.env.SCRIPT_LLM = "0";

const { planShots } = await import("../lib/media/shot-planner");
const { periksaPemicu, ringkasPemicu } = await import("../lib/media/pemicu-filter");
const { getCreatorCategory } = await import("../lib/personas");

const segments = [
  { role: "hook" as const, start: 0, end: 4, text: "Nah, jerawat masih bandel juga sih?", visual_direction: "x" },
  { role: "demo" as const, start: 4, end: 10, text: "terus aku pakai ini tiap malam deh, teksturnya ringan banget dan cepat meresap", visual_direction: "x" },
  { role: "cta" as const, start: 10, end: 15, text: "jadi kalau kamu mau coba juga, cek keranjang kuning ya", visual_direction: "x" },
];
const rencana = (format: "hands_only" | "talking_head" | "vo_broll", durationSec = 15) =>
  planShots({
    jobId: "t", durationSec, segments, category: getCreatorCategory("hijaber")!,
    productName: "Scarlett Acne Serum", productCategory: "beauty",
    productVisualDesc: "botol dropper bening", imageRefPath: "/tmp/x.png",
    qualityTier: "high_quality", format,
  });

test("prompt AKHIR tiap shot bersih dari pemicu — semua format, semua durasi", () => {
  for (const format of ["hands_only", "talking_head", "vo_broll"] as const) {
    for (const durasi of [15, 30]) {
      const spec = rencana(format, durasi);
      spec.shots.forEach((sh) => {
        const t = periksaPemicu(sh.prompt);
        assert.deepEqual(t, [], `${format}/${durasi}dtk shot ${sh.index}: ${ringkasPemicu(t)}`);
      });
    }
  }
});

test("NEGATIVE prompt juga bersih — ia ikut dikirim ke penyedia", () => {
  // Field negative artinya sudah "hindari ini"; kata "no" cuma menambah token
  // negasi yang dibaca penyaring, tanpa menambah makna bagi model.
  for (const format of ["hands_only", "talking_head", "vo_broll"] as const) {
    const spec = rencana(format);
    const t = periksaPemicu(spec.negativePrompt);
    assert.deepEqual(t, [], `${format}: ${ringkasPemicu(t)}`);
  }
});

test("larangan wajah tetap ada maknanya, cuma ditulis sebagai batas positif", () => {
  const spec = rencana("hands_only");
  const gabung = spec.shots.map((s) => s.prompt).join(" ") + " " + spec.negativePrompt;
  // Maknanya harus tetap tersampaikan: hanya tangan, dan bingkainya berhenti.
  assert.match(gabung, /hands and forearms only/);
  assert.match(gabung, /below the collarbone|cropped at the wrists/);
  // Tapi TANPA negasi tentang orang di prompt positif.
  assert.ok(!/face and body NOT visible/.test(gabung), "frasa negasi lama tidak boleh kembali");
});

test("worker MEMBLOKIR, bukan mencatat", async () => {
  const fsx = await import("node:fs");
  const src = fsx.readFileSync("lib/postgres/worker.ts", "utf8");
  assert.match(src, /DIHENTIKAN sebelum provider/, "harus menghentikan job");
  // 19 Agu: isi gerbang pindah ke lib/media/gerbang-prompt.ts (satu tempat
  // untuk pemicu + kunci bahasa + kunci ukuran). Yang diuji di sini tinggal
  // KONTRAK worker-nya: memanggil gerbang, dan MELEMPAR bila ada temuan keras.
  assert.match(src, /periksaPromptAkhir\(\{/, "worker harus memanggil gerbang prompt akhir");
  assert.match(src, /throw new Error\(`Prompt akhir tidak lolos gerbang/, "harus melempar, bukan warn");
  assert.match(src, /negativePrompt: spec\.negativePrompt/, "negative prompt ikut diperiksa");
  // Urutan: arsip DULU, gerbang kemudian (reviewer ronde 3) — prompt yang
  // dihentikan justru yang paling perlu dibedah.
  assert.ok(src.indexOf("pgSimpanArsipPrompt") < src.indexOf("DIHENTIKAN sebelum provider"),
    "arsip harus ditulis sebelum gerbang melempar");
  // vo_broll tidak memanggil penyedia video sama sekali — pengecualiannya kini
  // hidup di gerbang (berikut alasannya), diuji perilakunya di
  // tests/prompt-akhir-kunci-bahasa.test.ts.
  const gerbang = fsx.readFileSync("lib/media/gerbang-prompt.ts", "utf8");
  assert.match(gerbang, /if \(input\.format === "vo_broll"\) return \[\]/, "gerbang tidak berlaku untuk vo_broll");
});
