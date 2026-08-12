import { test } from "node:test";
import assert from "node:assert/strict";
import { RECORDING_STYLES, stylesForFormat, getRecordingStyle } from "../lib/media/recording-styles";
import { planShots } from "../lib/media/shot-planner";
import type { SegmentDraft } from "../lib/script-engine/templates";
import { getCreatorCategory } from "../lib/personas";
import type { QualityTier } from "../lib/providers/types";

const HIJABER = getCreatorCategory("hijaber")!;

// Gaya rekam menimpa framing. Yang paling mudah rusak di sini bukan tampilan,
// tapi PERTENTANGAN INSTRUKSI: menaruh "wajah memenuhi frame" di prompt yang
// juga membawa negative "no face" menghasilkan render rusak yang tetap
// dibayar penuh (Rp8.800-37.000 per video, lihat MODEL_RATES di adapter
// BytePlus). Tes ini menjaga persis itu.

const SEG: SegmentDraft[] = [
  { role: "hook", text: "Coba lihat ini deh", start: 0, end: 3, visual_direction: "tangan mengangkat produk" },
  { role: "demo", text: "Bahannya bagus dan awet dipakai", start: 3, end: 11, visual_direction: "makro tekstur" },
  { role: "cta", text: "Cek keranjang ya", start: 11, end: 15, visual_direction: "produk di tengah frame" },
];

function rencana(format: "hands_only" | "talking_head" | "ads", recordStyle?: string) {
  return planShots({
    jobId: "uji",
    durationSec: 15,
    segments: SEG,
    category: HIJABER,
    productName: "Gamis Katun",
    productCategory: "muslim_fashion",
    imageRefPath: "/tmp/foto.jpg",
    qualityTier: "ai_voice" as QualityTier,
    format,
    recordStyle,
  });
}

test("tanpa gaya rekam, prompt sama persis dengan sebelum fitur ini ada", () => {
  const a = rencana("talking_head");
  const b = rencana("talking_head", "standar");
  assert.deepEqual(
    a.shots.map((s) => s.prompt),
    b.shots.map((s) => s.prompt),
    '"standar" harus identik dengan tanpa gaya — kalau tidak, video lama berubah diam-diam'
  );
});

test("gaya yang dipilih benar-benar masuk ke prompt", () => {
  const p = rencana("talking_head", "cermin").shots[0].prompt;
  assert.match(p, /mirror/i, 'gaya "cermin" tidak terlihat di prompt');
});

// INI YANG PALING PENTING. Penyaringan ada di UI, tapi UI bisa dilewati lewat
// panggilan API langsung — penjagaannya harus ada di mesin juga.
test("gaya yang tidak cocok formatnya DIABAIKAN, bukan dipaksa masuk", () => {
  const dipaksa = rencana("hands_only", "selfie").shots[0].prompt;
  const bawaan = rencana("hands_only").shots[0].prompt;
  assert.equal(dipaksa, bawaan, '"selfie" pada hands_only harus jatuh ke framing bawaan');
});

test("hands_only tetap melarang wajah walau gaya rekam dipakai", () => {
  for (const gaya of ["standar", "meja", "unboxing", "selfie", "cermin"]) {
    // negativePrompt ada di level VisualSpec, bukan per-shot (lib/providers/types.ts).
    const spec = rencana("hands_only", gaya);
    assert.match(spec.negativePrompt, /no face/i, `hands_only + "${gaya}" kehilangan larangan wajah`);
  }
});

test("gaya id ngawur tidak bikin crash, jatuh ke framing bawaan", () => {
  const ngawur = rencana("talking_head", "gaya-yang-tidak-ada").shots[0].prompt;
  const bawaan = rencana("talking_head").shots[0].prompt;
  assert.equal(ngawur, bawaan);
});

test("stylesForFormat tidak pernah menawarkan gaya yang tidak cocok", () => {
  for (const format of ["hands_only", "talking_head", "ads"]) {
    for (const s of stylesForFormat(format)) {
      assert.ok(s.formats.includes(format as never), `"${s.id}" ditawarkan untuk ${format} padahal tidak cocok`);
    }
  }
});

test('"standar" selalu tersedia dan selalu paling depan', () => {
  for (const format of ["hands_only", "talking_head", "ads"]) {
    const daftar = stylesForFormat(format, "muslim_fashion");
    assert.equal(daftar[0]?.id, "standar", `${format}: pilihan aman tidak paling mudah diraih`);
  }
});

test("gaya khusus kategori naik ke depan, tapi tidak menyingkirkan yang lain", () => {
  const fashion = stylesForFormat("talking_head", "muslim_fashion");
  const umum = stylesForFormat("talking_head");
  assert.equal(fashion.length, umum.length, "penyortiran tidak boleh menghilangkan pilihan");
  // Menguji MAKSUDNYA, bukan posisi angka: gaya yang memang untuk kategori ini
  // tidak boleh berada di belakang gaya yang bukan. Versi lama membandingkan
  // indeks terhadap daftar umum, dan itu pecah begitu satu gaya dibuang —
  // padahal perilakunya tidak berubah sama sekali.
  const khusus = fashion.findIndex((s) => s.bestFor?.includes("muslim_fashion"));
  const umumTerakhir = fashion.map((s, i) => (s.id !== "standar" && !s.bestFor?.includes("muslim_fashion") ? i : -1))
    .filter((i) => i >= 0);
  if (khusus >= 0 && umumTerakhir.length > 0) {
    assert.ok(khusus < Math.max(...umumTerakhir), "gaya khusus kategori tidak naik ke depan");
  }
});

test("tiap gaya punya deskripsi 'yang terlihat' yang bisa dibayangkan", () => {
  for (const s of RECORDING_STYLES) {
    assert.ok(s.label.length > 0, `${s.id} tanpa label`);
    assert.ok(s.lihat.length > 25, `${s.id}: deskripsi terlalu pendek untuk membayangkan videonya`);
    assert.ok(s.formats.length > 0, `${s.id} tidak cocok untuk format apa pun — tidak akan pernah muncul`);
  }
});

test("TVC tidak pernah bisa ditimpa gaya rekam", () => {
  for (const s of RECORDING_STYLES) {
    assert.ok(!(s.formats as string[]).includes("tvc"), `${s.id} mengklaim cocok untuk TVC`);
  }
});

test("getRecordingStyle mengembalikan null untuk yang tidak dikenal", () => {
  assert.equal(getRecordingStyle(null), null);
  assert.equal(getRecordingStyle(""), null);
  assert.equal(getRecordingStyle("tidak-ada"), null);
  assert.equal(getRecordingStyle("cermin")?.id, "cermin");
});
