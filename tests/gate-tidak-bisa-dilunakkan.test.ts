// P0 reviewer 18 Agu: "hard gate" bisa dilunakkan sebelum render.
//
// L-19/L-21/L-05 dulu hanya keras di mode "strict", sementara TIGA gerbang
// yang menentukan render dan uang memakai mode "light":
//   - approve retail        app/api/scripts/[id]/approve/route.ts
//   - submit render retail  app/api/jobs/route.ts
//   - confirm Enterprise    lib/dashboard/render-cell.ts
//
// Reproduksi reviewer: 3/3 keluaran degraded punya strictPassed=false (L-05)
// tetapi lightPassed=true — jadi bisa disetujui lalu dirender.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-p0-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-p0-storage-${process.pid}`;
process.env.SCRIPT_LLM = "0";

const { validateScript, SELALU_KERAS } = await import("../lib/script-engine/validator");
const { generateScripts } = await import("../lib/script-engine");

const arg = (segments: { role: string; text: string; visual_direction?: string }[]) => ({
  hook_family: "H1", register: "bestie", segments, productName: "Serum Glow",
  priceIdr: 85000, qualityTier: "high_quality" as const, durationSec: 15,
});

test("aturan gerbang keras di KEDUA mode, bukan hanya strict", () => {
  // Kepanjangan (L-05) — kasus persis yang dipakai reviewer.
  const panjang = arg([
    { role: "hook", text: "Say, delapan puluh lima ribu dapet kualitas segini? sumpah sih beneran" },
    { role: "demo", text: "nah, ini Serum Glow, teksturnya niat banget, beneran kerasa bedanya pas dipake tiap hari" },
    { role: "cta", text: "Cek keranjang kuning ya deh, jangan sampai nyesel" },
  ]);
  for (const mode of ["strict", "light"] as const) {
    const r = validateScript(panjang as never, mode);
    assert.equal(r.passed, false, `mode ${mode} harus menolak naskah kepanjangan`);
    assert.ok(r.errors.some((e) => e.rule === "L-05"), `mode ${mode}: ${JSON.stringify(r.errors)}`);
  }
});

test("L-19 dan L-21 juga keras di light", () => {
  const datar = arg([
    { role: "hook", text: "Botol kaca kecil berisi cairan bening" },
    { role: "demo", text: "aku pakai ini tiap malam deh", visual_direction: "no other residents visible" },
    { role: "cta", text: "cek keranjang kuning ya" },
  ]);
  const light = validateScript(datar as never, "light");
  assert.ok(light.errors.some((e) => e.rule === "L-19"), "L-19 harus keras di light");
  assert.ok(light.errors.some((e) => e.rule === "L-21"), "L-21 harus keras di light");
  assert.equal(light.passed, false);
});

test("aturan GAYA tetap lunak di light — light masih punya alasan hidup", () => {
  // BR-03.2: saat pengguna menyunting naskahnya sendiri, aturan selera tidak
  // boleh memblokir. Kalau semua jadi keras, "light" cuma nama lain "strict".
  const kaku = arg([
    { role: "hook", text: "Harga delapan puluh lima ribu, kualitasnya bagus?" },
    { role: "demo", text: "Serum Glow ini saya pakai malam hari" },
    { role: "cta", text: "cek keranjang kuning" },
  ]);
  const light = validateScript(kaku as never, "light");
  const strict = validateScript(kaku as never, "strict");
  const gayaDiStrict = strict.errors.filter((e) => !SELALU_KERAS.has(e.rule));
  assert.ok(gayaDiStrict.length > 0, "harus ada aturan gaya yang gagal, supaya tesnya berarti");
  for (const e of gayaDiStrict) {
    assert.ok(!light.errors.some((x) => x.rule === e.rule), `${e.rule} harusnya cuma peringatan di light`);
  }
});

test("keluaran degraded TIDAK lagi lolos light — reproduksi reviewer dibalik", async () => {
  const variants = await generateScripts({ tanpaLlm: true,
    product: { id: "p", name: "Serum Glow", price_idr: 85000, category: "beauty" },
    register: "bestie", qualityTier: "high_quality",
  });
  assert.ok(variants.length > 0);
  for (const v of variants) {
    const a = arg(v.segments) as never;
    const strict = validateScript(a, "strict");
    const light = validateScript(a, "light");
    if (v.script_source === "degraded") {
      assert.equal(strict.passed, false, "degraded memang gagal strict");
      assert.equal(light.passed, false, "dan sekarang gagal light juga — inilah P0 yang ditutup");
    }
  }
});

test("aturan FAKTA (L-13 urgensi palsu, L-14 angka tanpa data) keras di light", () => {
  // Reviewer 18 Agu: keduanya PASS di light, jadi naskah yang menyebut stok
  // palsu atau harga karangan tetap renderable. Ini bukan wilayah selera
  // pengguna — ini soal apakah videonya jujur.
  const urgensiPalsu = arg([
    { role: "hook", text: "Say, delapan puluh lima ribu segini sih?" },
    { role: "demo", text: "nah, stok terakhir nih, teksturnya niat banget" },
    { role: "cta", text: "cek keranjang kuning ya" },
  ]);
  const a = validateScript(urgensiPalsu as never, "light");
  assert.ok(a.errors.some((e) => e.rule === "L-13"), `L-13 harus keras: ${JSON.stringify(a.errors)}`);

  const angkaKarangan = arg([
    // L-14 memeriksa ANGKA yang tidak ada di data produk — ditulis sebagai
    // angka, karena versi kata ("sembilan puluh") memang bukan sasarannya.
    { role: "hook", text: "Say, dipakai 90 persen orang?" },
    { role: "demo", text: "nah, teksturnya niat banget deh" },
    { role: "cta", text: "cek keranjang kuning ya" },
  ]);
  const b = validateScript(angkaKarangan as never, "light");
  assert.ok(b.errors.some((e) => e.rule === "L-14"), `L-14 harus keras: ${JSON.stringify(b.errors)}`);
});
