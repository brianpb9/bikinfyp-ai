// P0 reviewer 18 Agu: approve/submit meloloskan naskah tidak sah karena
// konteks validasinya tidak lengkap, dan Enterprise justru MENOLAK TVC yang
// sah karena alasan yang berkebalikan.
//
// Dua reproduksi persis dari laporan:
//   (a) naskah 30 detik berisi ~18 kata -> lolos, karena tanpa durationSec
//       validator memakai basis 15 detik;
//   (b) CTA TikTok cuma "keranjang" -> lolos, karena tanpa cartLabel yang
//       diperiksa hanya kata generiknya.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-adm-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-adm-storage-${process.pid}`;

const { periksaAdmisi, konteksAdmisi, durasiDariSegmen } = await import("../lib/script-engine/admisi");
const { validateScript } = await import("../lib/script-engine/validator");

/** Naskah 30 detik, ~18 kata — jauh di bawah jendela 30 detik (32-44). */
const naskah30 = [
  { role: "hook", start: 0, end: 6, text: "Nah, jerawat masih bandel juga sih?", visual_direction: "x" },
  { role: "demo", start: 6, end: 20, text: "aku pakai ini tiap malam deh", visual_direction: "x" },
  { role: "cta", start: 20, end: 30, text: "cek keranjang kuning ya", visual_direction: "x" },
] as never[];

test("durasi diturunkan dari SEGMEN, bukan ditebak 15 detik", () => {
  assert.equal(durasiDariSegmen(naskah30), 30);
  assert.equal(durasiDariSegmen([{ end: 15 }] as never[]), 15);
  assert.equal(durasiDariSegmen([{ end: 45 }] as never[]), 45);
  // Nilai aneh tidak dikarang jadi 15 diam-diam.
  assert.equal(durasiDariSegmen([{ end: 22 }] as never[]), 22);
});

test("(a) naskah 30 detik yang kependekan DITOLAK — dulu lolos", () => {
  const hasil = periksaAdmisi({
    segments: naskah30, hookFamily: "H1", register: "bestie",
    productName: "Serum Glow", productPriceIdr: 85000,
    productSourceUrl: "https://www.tiktok.com/@x/video/1", qualityTier: "high_quality",
  });
  assert.equal(hasil.passed, false, "naskah 18 kata untuk 30 detik harus ditolak");
  assert.ok(hasil.errors.some((e) => e.rule === "L-05"), JSON.stringify(hasil.errors));

  // Bukti bahwa konteks lamalah sebabnya: tanpa durationSec, naskah yang sama lolos.
  const konteksLama = validateScript({
    hook_family: "H1", register: "bestie", segments: naskah30,
    productName: "Serum Glow", priceIdr: 85000, qualityTier: "high_quality",
  } as never, "light");
  assert.equal(konteksLama.errors.some((e) => e.rule === "L-05"), false,
    "tanpa durationSec memang tidak ketahuan — itulah lubangnya");
});

test("(b) CTA TikTok tanpa 'keranjang kuning' DITOLAK — dulu lolos", () => {
  const generik = [
    naskah30[0], naskah30[1],
    { role: "cta", start: 20, end: 30, text: "cek keranjang ya", visual_direction: "x" },
  ] as never[];
  const tiktok = periksaAdmisi({
    segments: generik, hookFamily: "H1", register: "bestie",
    productName: "Serum Glow", productPriceIdr: 85000,
    productSourceUrl: "https://www.tiktok.com/@x/video/1", qualityTier: "high_quality",
  });
  assert.ok(tiktok.errors.some((e) => e.rule === "L-03"), JSON.stringify(tiktok.errors));

  // Dan platform lain TIDAK dipaksa "kuning" — itu branding TikTok.
  const shopee = periksaAdmisi({
    segments: generik, hookFamily: "H1", register: "bestie",
    productName: "Serum Glow", productPriceIdr: 85000,
    productSourceUrl: "https://shopee.co.id/product/1/2", qualityTier: "high_quality",
  });
  assert.equal(shopee.errors.some((e) => e.rule === "L-03"), false,
    "menyuruh pembeli Shopee mencari keranjang kuning = menyuruh mencari yang tidak ada");
});

test("(c) TVC memakai aturannya sendiri — tidak dipaksa aturan afiliasi", () => {
  const tvc = [
    { role: "hook", start: 0, end: 5, text: "Kulit terasa lebih tenang sejak malam pertama", visual_direction: "x" },
    { role: "demo", start: 5, end: 11, text: "Rangkaian perawatan yang lembut setiap hari", visual_direction: "x" },
    { role: "cta", start: 11, end: 15, text: "Serum Glow, dari Rana", visual_direction: "x" },
  ] as never[];
  const k = konteksAdmisi({
    segments: tvc, hookFamily: "H1", register: "netral",
    productName: "Serum Glow", productPriceIdr: 85000, qualityTier: "super_hq",
    durationSec: 15, format: "tvc",
  });
  assert.equal((k as { format?: string }).format, "tvc", "format harus ikut, kalau tidak T-01..T-03 tak pernah jalan");
  const hasil = validateScript(k as never, "light");
  // Aturan lisan afiliasi TIDAK boleh dipakai menolak TVC.
  for (const aturan of ["L-03", "L-19"]) {
    assert.ok(!hasil.errors.some((e) => e.rule === aturan), `${aturan} tidak berlaku untuk TVC: ${JSON.stringify(hasil.errors)}`);
  }
});

test("konteks selalu membawa tujuh hal yang menentukan", () => {
  const k = konteksAdmisi({
    segments: naskah30, hookFamily: "H1", register: "bestie",
    productName: "Serum Glow", productPriceIdr: 85000,
    productSourceUrl: "https://www.tiktok.com/@x/video/1",
    promoPriceBeforeIdr: 120000, qualityTier: "high_quality", templateId: null,
  }) as Record<string, unknown>;
  for (const kunci of ["qualityTier", "durationSec", "cartLabel", "promoPriceBeforeIdr", "requirePriceMention"]) {
    assert.ok(kunci in k, `konteks kehilangan ${kunci}`);
  }
  assert.equal(k.cartLabel, "keranjang kuning");
  assert.equal(k.durationSec, 30);
});
