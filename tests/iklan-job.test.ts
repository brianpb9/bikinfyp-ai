// BETA IKLAN SINEMATIK DI ALUR JOB — yang bisa diuji tanpa membayar render.
//
// Yang dijaga di sini bukan mutu videonya (itu pekerjaan gerbang dan reviewer),
// melainkan janji-janji yang membuat beta ini aman dipasang di aplikasi yang
// sudah menerima uang: jalur retail tidak ikut berubah, merek tidak pernah
// ditebak, dan job beta tidak pernah menyentuh kredit siapa pun.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-iklanjob-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-iklanjob-storage-${process.pid}`;

const fs = await import("node:fs");
const path = await import("node:path");
const { FORMAT_IKLAN, DURASI_IKLAN_DTK } = await import("../lib/iklan/format");
const { mesinUntukTier, produkUntukIklan } = await import("../lib/postgres/worker-iklan");
type BarisIklan = import("../lib/postgres/worker-iklan").BarisIklan;

const AKAR = path.resolve(import.meta.dirname, "..");
const baca = (p: string) => fs.readFileSync(path.join(AKAR, p), "utf8");

function baris(ubah: Partial<BarisIklan> = {}): BarisIklan {
  return {
    id: "job-1", user_id: "u-1", quality_tier: "standard",
    product_name: "Faza Hand Sanitizer", product_category: "kesehatan",
    product_visual_desc: "botol putih label hijau", product_claims: "alkohol 70%",
    product_images: JSON.stringify(["products/u-1/a.webp"]), product_price_idr: 25000,
    product_raw_meta: null, brand_brief: null, ...ubah,
  };
}

test("hanya tier premium yang memanggil mesin Ultra", () => {
  assert.equal(mesinUntukTier("premium"), "ultra");
  for (const t of ["standard", "silent_caption", "ultra", "high_quality", null, undefined]) {
    assert.equal(mesinUntukTier(t), "standard", `tier ${t} tidak boleh diam-diam jadi Ultra`);
  }
});

test("merek hanya dari raw_meta.brand, tidak pernah ditebak dari nama produk", () => {
  assert.equal(produkUntukIklan(baris()).merek, null);
  assert.equal(produkUntukIklan(baris({ product_raw_meta: '{"brand":"Faza"}' })).merek, "Faza");
  // raw_meta rusak tidak boleh menggagalkan render yang sudah dibayar biayanya.
  assert.equal(produkUntukIklan(baris({ product_raw_meta: "{bukan json" })).merek, null);
  assert.equal(produkUntukIklan(baris({ product_raw_meta: '{"brand":42}' })).merek, null);
});

test("brand_brief menang atas deskripsi visual sebagai bahan naskah", () => {
  const p = produkUntukIklan(baris({ brand_brief: "produk keluarga, nada hangat" }));
  assert.equal(p.deskripsi, "produk keluarga, nada hangat");
  assert.equal(p.visual, "botol putih label hijau");
});

test("worker bercabang ke pipeline iklan sebelum jalur provider retail", () => {
  const src = baca("lib/postgres/worker.ts");
  const iIklan = src.indexOf("FORMAT_IKLAN");
  const iRetail = src.indexOf("runProviderPipeline(row, jobs, pool)");
  assert.ok(iIklan > 0 && iRetail > iIklan, "cabang iklan harus diperiksa sebelum jalur retail dijalankan");
  // Cabang iklan keluar lebih dulu: kalau tidak, captureCredits akan dipanggil
  // untuk job yang tidak pernah menahan kredit.
  const cabang = src.slice(iIklan, iRetail);
  assert.match(cabang, /return;/, "cabang iklan harus return sebelum blok capture kredit");
});

test("rute pembuatan job iklan khusus admin dan tidak menahan kredit", () => {
  const src = baca("app/api/admin/iklan/route.ts");
  assert.match(src, /wajibAdminApi/);
  assert.doesNotMatch(src, /pakaiKredit|tahanKredit|holdCredits|captureCredits/,
    "beta gratis: rute ini tidak boleh menyentuh kredit sama sekali");
  // Kunci tanda tangan tidak boleh sampai ke browser.
  assert.match(src, /createSignedUrl/);
});

test("render beta mengantre di belakang semua job berbayar", async () => {
  const { PRIORITAS } = await import("../lib/prioritas-antrean");
  assert.ok(PRIORITAS.beta > PRIORITAS.retail && PRIORITAS.beta > PRIORITAS.brand,
    "beta tidak boleh mendahului job yang dibayar");
  assert.match(baca("app/api/admin/iklan/route.ts"), /enqueueJob\(jobId, "beta"\)/);
});

test("format iklan tidak bocor ke katalog format retail", () => {
  const src = baca("app/api/jobs/route.ts");
  assert.doesNotMatch(src, new RegExp(FORMAT_IKLAN));
  assert.match(src, /\["hands_only", "talking_head"\]\.includes\(format\)/);
});

test("durasi baris job cocok dengan sasaran naskah iklan", async () => {
  const { BATAS } = await import("../lib/iklan/naskah");
  assert.ok(DURASI_IKLAN_DTK >= BATAS.totalMin && DURASI_IKLAN_DTK <= BATAS.totalMaks,
    `durasi job ${DURASI_IKLAN_DTK}s harus di dalam ${BATAS.totalMin}–${BATAS.totalMaks}s`);
});

test("pipeline dipakai bersama oleh CLI uji dan worker", () => {
  assert.match(baca("scripts/iklan-uji.ts"), /lib\/iklan\//);
  assert.match(baca("lib/postgres/worker-iklan.ts"), /from "\.\.\/iklan\/pipeline"/);
});
