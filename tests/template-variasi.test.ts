import { test } from "node:test";
import assert from "node:assert/strict";
import { generateScripts, TEMPLATE_COPY_CAPACITY } from "../lib/script-engine";
import { TEMPLATE_COPY } from "../lib/script-engine/template-copy";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";

// Keputusan Brian 2026-08-12 (opsi b): template MENGUNCI keluarga hook —
// kesetiaan yang dia minta 11 Agustus — tapi kalimatnya bervariasi, supaya
// layar "pilih skrip" bukan pilihan palsu antara tiga teks yang identik.

const PRODUK = {
  id: "p-uji", name: "Serum Glow Bright", price_idr: 89000,
  category: "beauty", sourceUrl: null,
} as never;

async function skrip(templateId: string | null) {
  return await generateScripts({ tanpaLlm: true,
    product: PRODUK, register: "bunda", qualityTier: "high_quality", durationSec: 15,
    count: 3, hookFamilies: ["H1"], lockHookFamily: true, templateId,
  });
}

async function skripDenganCount(templateId: string | null, count: number) {
  return await generateScripts({ tanpaLlm: true,
    product: PRODUK, register: "bunda", qualityTier: "high_quality", durationSec: 15,
    count, hookFamilies: ["H1"], lockHookFamily: true, templateId,
  });
}

test("kapasitas template dikunci ke empat varian unik", async () => {
  assert.equal(TEMPLATE_COPY_CAPACITY, 4);
  const output = await skripDenganCount("t01-tempat-susah", TEMPLATE_COPY_CAPACITY);
  const teks = output.map((variant) => variant.segments.map((segment) => segment.text).join("|"));
  assert.equal(output.length, 4);
  assert.equal(new Set(teks).size, 4);
});

test("count=5 pada template ditolak, bukan modulo-repeat", async () => {
  // rejects, bukan throws: generateScripts sekarang async, jadi RangeError-nya
  // datang lewat Promise yang ditolak, bukan lemparan sinkron.
  await assert.rejects(
    () => skripDenganCount("t01-tempat-susah", 5),
    /maksimal 4 variasi unik.*count=5 ditolak/i
  );
});

test("tanpa template count=5 tetap didukung", async () => {
  assert.equal((await skripDenganCount(null, 5)).length, 5);
});

test("template dengan variasi menghasilkan tiga kalimat BERBEDA", async () => {
  const s = await skrip("t01-tempat-susah");
  const teks = s.map((x) => x.segments.map((g) => g.text).join("|"));
  assert.equal(new Set(teks).size, 3, "variannya masih identik — pilihan palsu");
});

test("hook tetap TERKUNCI walau kalimatnya bervariasi", async () => {
  for (const x of await skrip("t01-tempat-susah")) {
    assert.equal(x.hook_family, "H1", "template berhenti mengunci keluarga hook");
  }
});

test("T04 sekarang punya tiga variasi copy khusus", async () => {
  const teks = (await skrip("t04-hook-indrawi")).map((x) => x.segments.map((g) => g.text).join("|"));
  assert.equal(new Set(teks).size, 3, "T04 kembali memakai pilihan copy yang identik");
});

test("template null dan id tidak dikenal tetap memakai fallback aman", async () => {
  const tanpa = (await skrip(null)).map((x) => x.segments.map((g) => g.text).join("|"));
  const tidakDikenal = (await skrip("template-yang-tidak-ada")).map((x) => x.segments.map((g) => g.text).join("|"));
  assert.equal(tidakDikenal.length, 3);
  assert.deepEqual(tidakDikenal, tanpa, "id tidak dikenal tidak memakai fallback generik yang sama dengan null");
});

test("setiap template yang punya variasi memang ada di katalog", async () => {
  for (const id of Object.keys(TEMPLATE_COPY)) {
    assert.ok(CAMPAIGN_TEMPLATES.some((t) => t.id === id), `${id} punya copy tapi bukan template nyata`);
  }
});

test("tiap variasi punya hook, demo, dan cta yang terisi", async () => {
  for (const [id] of Object.entries(TEMPLATE_COPY)) {
    for (const x of await skrip(id)) {
      for (const seg of x.segments) {
        assert.ok(seg.text.trim().length > 0, `${id}: ada segmen kosong`);
      }
    }
  }
});
