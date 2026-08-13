import { test } from "node:test";
import assert from "node:assert/strict";
import { planShots } from "../lib/media/shot-planner";
import { getCreatorCategory } from "../lib/personas";
import { getTemplate } from "../lib/templates";
import type { QualityTier } from "../lib/providers/types";
import type { SegmentDraft } from "../lib/script-engine/templates";

// Ditemukan 2026-08-13 dari render sungguhan: shot PENUTUP TVC 30 detik keluar
// dengan DUA perempuan dan EMPAT tangan mengelilingi produk — hal terakhir
// yang dilihat penonton. Tidak ada satu pun yang menahannya: QC-02 stub,
// tidak ada pemeriksaan jumlah orang, dan format TVC tidak punya larangan
// anatomi sama sekali.

const SEG: SegmentDraft[] = [
  { role: "hook", text: "a", start: 0, end: 5, visual_direction: "x" },
  { role: "demo", text: "b", start: 5, end: 22, visual_direction: "y" },
  { role: "cta", text: "c", start: 22, end: 30, visual_direction: "z" },
];

function spec(o: { format: "talking_head" | "hands_only" | "ads" | "tvc"; tvcRoute?: string; noModel?: boolean; shots?: number }) {
  return planShots({
    jobId: "s", durationSec: 30, segments: SEG, category: getCreatorCategory("hijaber")!,
    productName: "Botol", productCategory: "beauty", imageRefPath: "/tmp/x.jpg",
    qualityTier: "high_quality" as QualityTier, format: o.format,
    tvcRoute: o.tvcRoute as never, noModel: o.noModel, shotCountOverride: o.shots ?? 3,
  });
}

test("TVC mengunci satu orang di SETIAP shot — termasuk penutup", () => {
  const s = spec({ format: "tvc", tvcRoute: "intimate", shots: 6 });
  for (const sh of s.shots) {
    assert.match(sh.prompt, /EXACTLY ONE person/i, `shot ${sh.index}: tanpa kunci subjek tunggal`);
  }
});

test("TVC melarang orang kedua di negative prompt", () => {
  const s = spec({ format: "tvc", tvcRoute: "fabric", shots: 5 });
  assert.match(s.negativePrompt, /no second person/i, "TVC tanpa larangan orang kedua — ini video yang gagal");
  assert.match(s.negativePrompt, /exactly two hands/i, "TVC tanpa larangan tangan berlebih");
});

test("kunci anatomi ditulis POSITIF, bukan cuma sebagai larangan", () => {
  // Dokumen produksi Brian: klip yang sama dibuat TIGA KALI, dan yang
  // menyelesaikan tangan hantu adalah pernyataan positif, bukan larangan.
  assert.match(spec({ format: "tvc", tvcRoute: "intimate" }).shots[0].prompt,
    /exactly two hands, both clearly visible and naturally attached/i);
});

test("format ads ikut terkunci", () => {
  const s = spec({ format: "ads" });
  assert.match(s.shots[0].prompt, /EXACTLY ONE person/i);
  assert.match(s.negativePrompt, /no second person/i);
});

test("talking_head ikut terkunci", () => {
  const s = spec({ format: "talking_head" });
  assert.match(s.shots[0].prompt, /EXACTLY ONE person/i);
  assert.match(s.negativePrompt, /no second person/i);
});

// Rute komedi SENGAJA memakai dua tokoh (tersangka + penuduh). Memaksakan
// satu orang di sana membatalkan leluconnya.
test("rute TVC komedi TIDAK dikunci satu orang", () => {
  const s = spec({ format: "tvc", tvcRoute: "comedy", shots: 6 });
  assert.ok(!/EXACTLY ONE person/i.test(s.shots[0].prompt), "rute komedi ikut terkunci — leluconnya butuh dua orang");
  assert.ok(!/no second person/i.test(s.negativePrompt), "rute komedi dilarang punya orang kedua");
});

test("hands_only tidak dikunci subjek — memang tanpa wajah", () => {
  const s = spec({ format: "hands_only" });
  assert.ok(!/EXACTLY ONE person/i.test(s.shots[0].prompt));
  assert.match(s.negativePrompt, /no face/i, "hands_only kehilangan larangan wajahnya");
});

test("TVC tanpa model tidak dikunci subjek — tidak ada orang sama sekali", () => {
  const s = spec({ format: "tvc", tvcRoute: "luxury", noModel: true });
  assert.ok(!/EXACTLY ONE person/i.test(s.shots[0].prompt));
});
