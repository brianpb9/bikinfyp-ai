import { test } from "node:test";
import assert from "node:assert/strict";
import { planShots } from "../lib/media/shot-planner";
import { getCreatorCategory } from "../lib/personas";
import { CAMPAIGN_TEMPLATES, TVC_ROUTES } from "../lib/templates";
import type { QualityTier } from "../lib/providers/types";
import type { SegmentDraft } from "../lib/script-engine/templates";

// Dua rute TVC dari produksi Brian sendiri (12 Agustus 2026). Dari enam TVC
// yang dia buat, empat dibuang karena jelek — jadi dua ini bukan "dua contoh",
// tapi dua yang bertahan dari seleksi. Aturan di bawah datang dari catatan
// REVISI di dokumennya: yang dibuang dari versi final justru paling
// informatif, karena itu kesalahan yang sudah terbukti merusak iklannya.

const SEG: SegmentDraft[] = [
  { role: "hook", text: "Hari nggak pernah nunggu kamu siap", start: 0, end: 5, visual_direction: "gerak" },
  { role: "demo", text: "Baju yang tetap rapi saat kamu bergerak", start: 5, end: 22, visual_direction: "kain" },
  { role: "cta", text: "Koleksi baru", start: 22, end: 30, visual_direction: "penutup" },
];

function tvc(route: "fabric" | "intimate" | "reallife", shots = 5) {
  return planShots({
    jobId: `uji-${route}`, durationSec: 30, segments: SEG,
    category: getCreatorCategory("hijaber")!, productName: "Tunik Sage",
    productCategory: "muslim_fashion", imageRefPath: "/tmp/x.jpg",
    qualityTier: "high_quality" as QualityTier, format: "tvc",
    tvcRoute: route, shotCountOverride: shots,
  });
}

test("rute kain dan rute intim menghasilkan shot yang BERBEDA", () => {
  const kain = tvc("fabric").shots.map((s) => s.prompt).join("\n");
  const intim = tvc("intimate").shots.map((s) => s.prompt).join("\n");
  assert.notEqual(kain, intim, "dua rute menghasilkan prompt identik — rutenya tidak berpengaruh");
});

// Aturan Brian yang paling tegas: dia MEMBUANG packshot tunik di hanger dari
// versi final karena "mematikan premis iklan — konsepnya kain yang bergerak,
// tapi penutupnya kain diam tak dipakai siapa pun". Penutup generik kita
// adalah packshot produk diam; menerapkannya di sini mengulang persis
// kesalahan yang sudah dia perbaiki.
test("rute kain TIDAK ditutup packshot diam", () => {
  const penutup = tvc("fabric").shots.at(-1)!.prompt;
  assert.match(penutup, /in motion|walking toward camera/i, "penutup rute kain tidak bergerak");
  assert.match(penutup, /hanger/i, "larangan hanger tidak ikut ke prompt");
});

test("rute lain TETAP ditutup packshot — aturannya khusus rute kain", () => {
  const penutup = tvc("reallife").shots.at(-1)!.prompt;
  assert.match(penutup, /packshot/i, "rute non-kain kehilangan packshot penutupnya");
});

// Tiga aturan keras rute intim, semuanya dari kegagalan nyata:
// wajah bayi tidak pernah tampil; anatomi ditulis POSITIF (versi negatif
// menghasilkan tangan hantu di detik 6); kamera dikunci diam saat menggendong.
test("rute intim melarang wajah bayi tampil", () => {
  const semua = tvc("intimate", 6).shots.map((s) => s.prompt).join("\n");
  assert.match(semua, /never show the infant's face|back of the head/i, "larangan wajah bayi hilang");
});

test("rute intim menulis anatomi secara POSITIF, bukan sebagai larangan", () => {
  const semua = tvc("intimate", 6).shots.map((s) => s.prompt).join("\n");
  assert.match(semua, /exactly two hands/i, "kunci anatomi positif hilang — inilah yang memperbaiki tangan hantu");
});

test("rute intim mengunci kamera diam di shot menggendong", () => {
  const semua = tvc("intimate", 6).shots.map((s) => s.prompt).join("\n");
  assert.match(semua, /static and locked off/i, "kamera tidak dikunci di shot tersulit");
});

test("dua template baru terdaftar dengan rute dan preview yang benar", () => {
  for (const [id, route] of [["tvc-kain-lari", "fabric"], ["tvc-jam-tiga", "intimate"]] as const) {
    const t = CAMPAIGN_TEMPLATES.find((x) => x.id === id);
    assert.ok(t, `${id} tidak ada di katalog`);
    assert.equal(t!.tvcRoute, route);
    assert.ok(t!.preview, `${id} tanpa klip contoh`);
    assert.equal(t!.group, "tvc", `${id} tidak masuk kolom TVC`);
  }
});

test("setiap rute yang dipakai template terdaftar di TVC_ROUTES", () => {
  for (const t of CAMPAIGN_TEMPLATES) {
    if (!t.tvcRoute) continue;
    assert.ok(TVC_ROUTES.includes(t.tvcRoute), `${t.id} memakai rute "${t.tvcRoute}" yang tidak terdaftar`);
  }
});

// Terukur 2026-08-13 lewat render: pembuka rute "fabric" dan "intimate" keluar
// sebagai botol di atas meja, bukan "menuruni tangga" / "kamar gelap jam 3
// pagi". Sebabnya `if (i === 0)` memaksa SEMUA rute memakai hook generik
// "produk masuk ke frame" — rute yang premisnya justru "produk BELUM muncul"
// jadi mustahil dijalankan.
test("rute baru memakai perannya sendiri SEJAK shot pertama", () => {
  assert.match(tvc("fabric").shots[0].prompt, /descending stairs/i, "pembuka rute kain masih hook generik");
  assert.match(tvc("intimate", 6).shots[0].prompt, /stillness first/i, "pembuka rute intim masih hook generik");
});

test("rute lama TIDAK berubah pembukanya", () => {
  assert.match(tvc("reallife").shots[0].prompt, /opening hook/i, "rute lama ikut berubah — perubahan melebar tanpa diminta");
});
