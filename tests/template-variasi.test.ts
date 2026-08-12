import { test } from "node:test";
import assert from "node:assert/strict";
import { generateScripts } from "../lib/script-engine";
import { TEMPLATE_COPY } from "../lib/script-engine/template-copy";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";

// Keputusan Brian 2026-08-12 (opsi b): template MENGUNCI keluarga hook —
// kesetiaan yang dia minta 11 Agustus — tapi kalimatnya bervariasi, supaya
// layar "pilih skrip" bukan pilihan palsu antara tiga teks yang identik.

const PRODUK = {
  id: "p-uji", name: "Serum Glow Bright", price_idr: 89000,
  category: "beauty", sourceUrl: null,
} as never;

function skrip(templateId: string | null) {
  return generateScripts({
    product: PRODUK, register: "bunda", qualityTier: "high_quality", durationSec: 15,
    count: 3, hookFamilies: ["H1"], lockHookFamily: true, templateId,
  });
}

test("template dengan variasi menghasilkan tiga kalimat BERBEDA", () => {
  const s = skrip("t01-tempat-susah");
  const teks = s.map((x) => x.segments.map((g) => g.text).join("|"));
  assert.equal(new Set(teks).size, 3, "variannya masih identik — pilihan palsu");
});

test("hook tetap TERKUNCI walau kalimatnya bervariasi", () => {
  for (const x of skrip("t01-tempat-susah")) {
    assert.equal(x.hook_family, "H1", "template berhenti mengunci keluarga hook");
  }
});

test("template tanpa variasi tertulis TIDAK berubah perilakunya", () => {
  const tanpa = skrip(null).map((x) => x.segments.map((g) => g.text).join("|"));
  const belum = skrip("t04-hook-indrawi").map((x) => x.segments.map((g) => g.text).join("|"));
  assert.deepEqual(belum, tanpa, "template yang copy-nya belum ditulis seharusnya persis seperti sebelumnya");
});

test("id template ngawur tidak bikin crash", () => {
  assert.equal(skrip("template-yang-tidak-ada").length, 3);
});

test("setiap template yang punya variasi memang ada di katalog", () => {
  for (const id of Object.keys(TEMPLATE_COPY)) {
    assert.ok(CAMPAIGN_TEMPLATES.some((t) => t.id === id), `${id} punya copy tapi bukan template nyata`);
  }
});

test("tiap variasi punya hook, demo, dan cta yang terisi", () => {
  for (const [id] of Object.entries(TEMPLATE_COPY)) {
    for (const x of skrip(id)) {
      for (const seg of x.segments) {
        assert.ok(seg.text.trim().length > 0, `${id}: ada segmen kosong`);
      }
    }
  }
});
