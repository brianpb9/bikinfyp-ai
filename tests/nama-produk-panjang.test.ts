// Panjang NAMA PRODUK tidak boleh menentukan apakah sebuah template bisa dipakai.
//
// Blokir nyata 16 Agu 2026: Brian memasukkan produknya ("JJ Glow Sabun", 3 kata)
// dan tidak bisa membuat video sama sekali. Terukur: 10 dari 33 template gagal
// TOTAL tergantung panjang nama, dan 33 dari 36 kegagalan itu karena naskah
// KEKURANGAN 1-4 kata.
//
// Pesan errornya justru menyuruh MEMENDEKKAN nama — yang mengurangi kata lagi
// dan memperburuk. Mengikuti saran sistem membuat keadaannya makin buruk.
//
// Sebabnya struktural: nama produk ikut diucapkan sehingga menggeser total kata,
// tapi panjangnya ditentukan pengguna, bukan penulis naskah. Jendela L-05 untuk
// 15 detik bersuara cuma [25,30] — selebar 6 kata — sementara nama wajar
// bervariasi 1-6 kata. Variansinya hampir selebar jendelanya sendiri.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateScripts } from "../lib/script-engine";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";
import { validateScript } from "../lib/script-engine/validator";

async function coba(nama: string, t: (typeof CAMPAIGN_TEMPLATES)[number]) {
  const produk = {
    id: "uji", name: nama, category: "beauty", price_idr: 24_620,
    images: ["a.jpg"], sourceUrl: null, product_visual_desc: null, brand_brief: null,
  } as unknown as Parameters<typeof generateScripts>[0]["product"];
  const t2 = t as unknown as Record<string, unknown>;
  return (await generateScripts({
    product: produk, register: "bunda", qualityTier: t.tier as never,
    durationSec: t.durationSec, count: 3, hookLevel: t.hookLevel, templateId: t.id,
    ...(t.hookFamily ? { hookFamilies: [t.hookFamily as never], lockHookFamily: true } : {}),
    ...(t2.beats ? { beats: t2.beats as never } : {}),
    ...(t2.wordBudget ? { wordBudget: t2.wordBudget as number } : {}),
  })).filter((v) => v.validation.passed).length;
}

// Nama 3 kata adalah kasus Brian, dan mewakili nama produk paling lazim.
test("nama produk 3 kata bisa dipakai di SETIAP template", async () => {
  const gagal = (await Promise.all(CAMPAIGN_TEMPLATES.map(async (t) => ((await coba("JJ Glow Sabun", t)) === 0 ? t.id : null)))).filter(Boolean);
  assert.deepEqual(gagal, [], "template ini tidak bisa dipakai untuk nama produk 3 kata");
});

test("nama produk 6 kata juga bisa dipakai di setiap template", async () => {
  const gagal = (await Promise.all(CAMPAIGN_TEMPLATES.map(async (t) => ((await coba("JJ Glow Sabun Gluta Pink Barsoap", t)) === 0 ? t.id : null)))).filter(Boolean);
  assert.deepEqual(gagal, [], "template ini gagal untuk nama produk panjang");
});

// Kelonggaran hanya di batas BAWAH. Kelebihan kata memotong VO di tengah
// kalimat (r19) — itu cacat terukur, jadi batas atas tetap ketat.
test("kelonggaran hanya menyerap kekurangan kata, bukan kelebihan", async () => {
  const seg = (teks: string) => [
    { role: "hook", text: teks }, { role: "demo", text: "nah" }, { role: "cta", text: "cek keranjang ya" },
  ];
  const kepanjangan = validateScript(
    { hook_family: "H1", register: "bunda", segments: seg("kata ".repeat(60)), productName: "Nama Produk Sangat Panjang Sekali Ya", priceIdr: 24620, qualityTier: "high_quality", durationSec: 15 },
    "strict"
  );
  assert.ok(kepanjangan.errors.some((e) => e.rule === "L-05"), "naskah kepanjangan harus tetap ditolak");
});
