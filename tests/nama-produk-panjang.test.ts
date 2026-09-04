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
  return (await generateScripts({ tanpaLlm: true,
    product: produk, register: "bunda", qualityTier: t.tier as never,
    durationSec: t.durationSec, count: 3, hookLevel: t.hookLevel, templateId: t.id,
    ...(t.hookFamily ? { hookFamilies: [t.hookFamily as never], lockHookFamily: true } : {}),
    ...(t2.beats ? { beats: t2.beats as never } : {}),
    ...(t2.wordBudget ? { wordBudget: t2.wordBudget as number } : {}),
  }));
}

/** Kegagalan DI LUAR utang copy yang sudah diketahui (L-05 panjang, L-19
 *  perangkat hook, A-01/A-02 penutup Ads yang masih berupa copy afiliasi).
 *  Itu yang masih harus nol — bukan "semua varian lolos", yang berhenti benar
 *  sejak batas 22 kata dipasang. Inventaris lengkapnya di
 *  tests/script-catalog-audit.test.ts. */
// SA* ditambahkan 19 Agu (slice 2): seluruh copy template Ads berbentuk
// HOOK-BODY-CTA afiliasi, jadi tidak satu pun punya beat BUTTON/SPIKE/FRICTION
// atau jembatan produk. Utang COPY yang sama, bukan jenis baru yang menyusup —
// lihat catatan panjang di tests/script-catalog-audit.test.ts.
const UTANG_COPY = new Set([
  "L-05", "L-19", "A-01", "A-02", "S-04", "S-09",
  "SA1", "SA2", "SA4", "SA6", "SA8",
]);
function sebabLain(varian: Awaited<ReturnType<typeof coba>>): string[] {
  return varian.flatMap((v) => v.validation.errors.map((e) => e.rule)).filter((r) => !UTANG_COPY.has(r));
}

// Nama 3 kata adalah kasus Brian, dan mewakili nama produk paling lazim.
test("nama produk 3 kata tidak melahirkan kegagalan JENIS BARU di template mana pun", async () => {
  // Invarian aslinya "setiap template menghasilkan minimal satu varian lolos".
  // Itu berhenti benar sejak batas Brian 1,5 kata/detik dipasang: template
  // dikalibrasi ke jendela lama 25-30 kata, jadi hampir semuanya melanggar
  // L-05. Yang MASIH harus dijaga — dan inilah maksud tes ini sejak awal —
  // adalah panjang nama produk tidak menimbulkan kegagalan jenis lain.
  const lain = (await Promise.all(CAMPAIGN_TEMPLATES.map(async (t) => {
    const r = sebabLain(await coba("JJ Glow Sabun", t));
    return r.length ? `${t.id}: ${[...new Set(r)].join(",")}` : null;
  }))).filter(Boolean);
  assert.deepEqual(lain, [], "nama 3 kata memicu kegagalan di luar utang copy yang diketahui");
});

test("nama produk 6 kata juga tidak melahirkan kegagalan jenis baru", async () => {
  const lain = (await Promise.all(CAMPAIGN_TEMPLATES.map(async (t) => {
    const r = sebabLain(await coba("JJ Glow Sabun Gluta Pink Barsoap", t));
    return r.length ? `${t.id}: ${[...new Set(r)].join(",")}` : null;
  }))).filter(Boolean);
  assert.deepEqual(lain, [], "nama 6 kata memicu kegagalan di luar utang copy yang diketahui");
});

// Kelonggaran hanya di batas BAWAH. Kelebihan kata memotong VO di tengah
// kalimat (r19) — itu cacat terukur, jadi batas atas tetap ketat.
test("kelonggaran hanya menyerap kekurangan kata, bukan kelebihan", async () => {
  const seg = (teks: string) => [
    { role: "hook", text: teks }, { role: "demo", text: "nah" }, { role: "cta", text: "cek keranjang ya" },
  ];
  const kepanjangan = validateScript(
    { hook_family: "H1", register: "bunda", segments: seg("kata ".repeat(100)), productName: "Nama Produk Sangat Panjang Sekali Ya", priceIdr: 24620, qualityTier: "high_quality", durationSec: 15 },
    "strict"
  );
  assert.ok(kepanjangan.errors.some((e) => e.rule === "L-05"), "naskah kepanjangan harus tetap ditolak");
});
