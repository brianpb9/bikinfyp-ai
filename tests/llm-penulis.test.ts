// Penulis naskah LLM — yang dijaga di sini BUKAN mutu tulisannya (itu butuh
// kunci dan biaya), melainkan tiga hal yang bisa salah tanpa terlihat:
// skemanya menolak keluaran cacat, jatuh-ke-template berisik, dan aturan
// keras ikut terkirim.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SkemaNaskah, blokAturan, keSegmentDraft, llmSiap } from "../lib/script-engine/llm";

const contohSegmen = {
  block: "HOOK", label: "PAIN", start: 0, end: 5,
  text: "Sabun lama bikin tangan aku kesat",
  start_state: "She is already at the sink, hair damp, the new bar still in its box beside her.",
  framing: "arm-length selfie", angle: "eye level", camera: "slight handheld drift",
  action: "She rubs the back of her hand, glances at the old soap, then looks into the lens.",
  product_state: "partial", expression: "mildly fed up", audio_note: "running water",
  why: "setup — establishes the everyday problem", mode: "SELFIE",
};

test("skema menerima naskah yang benar", () => {
  const ok = SkemaNaskah.parse({ segments: [contohSegmen, { ...contohSegmen, block: "BODY", start: 5, end: 10 }, { ...contohSegmen, block: "CTA", start: 10, end: 15, product_state: "hero" }] });
  assert.equal(ok.segments.length, 3);
});

test("skema MENOLAK keluaran cacat, bukan menerimanya diam-diam", () => {
  // product_state karangan
  assert.throws(() => SkemaNaskah.parse({ segments: [{ ...contohSegmen, product_state: "besar" }, contohSegmen, contohSegmen] }));
  // start_state kosong — inilah field yang tanpa isinya model mengarang pembukaan
  assert.throws(() => SkemaNaskah.parse({ segments: [{ ...contohSegmen, start_state: "" }, contohSegmen, contohSegmen] }));
  // 'why' kosong: segmen yang tidak melayani cerita apa pun
  assert.throws(() => SkemaNaskah.parse({ segments: [{ ...contohSegmen, why: "" }, contohSegmen, contohSegmen] }));
  // kurang dari 3 segmen
  assert.throws(() => SkemaNaskah.parse({ segments: [contohSegmen] }));
});

test("aturan keras yang mahal ikut terkirim ke model", () => {
  const a = blokAturan();
  // Kamus salah ucap — kalau ini hilang, TTS mengucapkannya salah dan
  // regenerate tidak pernah memperbaikinya.
  for (const kata of ["lecet", "tumit", "busanya", "detailnya ada di bawah"]) {
    assert.ok(a.includes(kata), `aturan ucap "${kata}" hilang dari prompt`);
  }
  // Busur produk: hook tidak boleh hero.
  assert.match(a, /hook is 'hidden' or 'partial' and NEVER 'hero'/);
  // Arah waktu.
  assert.match(a, /moves TOWARD/);
});

test("jatuh ke template BERISIK, tidak diam-diam", () => {
  const s = fs.readFileSync(path.join(process.cwd(), "lib/script-engine/llm.ts"), "utf8");
  assert.match(s, /console\.error\(/, "jatuh ke template harus console.error, bukan warn");
  assert.match(s, /JATUH KE TEMPLATE/, "pesannya harus bisa dicari di log");
  assert.match(s, /BUKAN tulisan LLM/, "pesannya harus menyatakan apa yang sebenarnya dikirim");
  // Tanpa kunci, llmSiap() false — dan itu memicu jalur berisik di pemanggil.
  assert.equal(typeof llmSiap(), "boolean");
});

test("ulang SEKALI hanya untuk kegagalan parse, bukan galat HTTP", () => {
  const s = fs.readFileSync(path.join(process.cwd(), "lib/script-engine/llm.ts"), "utf8");
  // Galat HTTP nyata (401 kunci salah) tidak sembuh dengan diulang — mengulang
  // cuma menggandakan biaya dan menunda kabar buruknya.
  assert.match(s, /if \(!res\.ok\) \{\s*\n\s*throw new LlmTidakTersedia/,
    "galat HTTP harus langsung dilempar, tidak diulang");
  assert.match(s, /percobaan < 2/, "parse diulang sekali");
});

test("keSegmentDraft memetakan blok ke peran yang dipahami pipeline", () => {
  const d = keSegmentDraft([
    { ...contohSegmen, block: "HOOK" }, { ...contohSegmen, block: "BODY" }, { ...contohSegmen, block: "CTA" },
  ] as never);
  assert.deepEqual(d.map((x) => x.role), ["hook", "demo", "cta"]);
  assert.ok(d[0].visual_direction!.includes("selfie"), "arahan visual disusun dari field terpisah");
});
