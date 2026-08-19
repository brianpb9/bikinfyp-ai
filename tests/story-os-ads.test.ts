// Slice 2 (audit B7, 19 Agu 2026): Story OS untuk Ads.
//
// Sebelum ini penulis Ads = HOOK→BODY→CTA polos; satu-satunya hal khas Ads yang
// sampai ke model adalah kalimat CTA. Story OS (knowledge/rules/STORY-OS-ADS-v1.md)
// menuntut bentuk lain: BUTTON ditulis pertama, SPIKE di depan SAKSI, HOOK tanpa
// kata, FRICTION naik dua kali, bridging >= 2.
//
// Gerbang SA1–SA8: SA1/SA2/SA4/SA6/SA8 dapat dicek mesin dari struktur;
// SA3/SA5/SA7 diserahkan ke juri FYP. Pembagian itu HARUS jujur — tes ini
// menguncinya, supaya tidak ada gerbang "kode" yang sebenarnya cuma harapan.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-storyos-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-storyos-storage-${process.pid}`;

const { GERBANG_SA, periksaStoryOsAds, penegakanSA } = await import("../lib/script-engine/story-os-ads");

/** Naskah Ads yang MEMENUHI Story OS — dipakai sebagai kontrol positif. */
const LULUS = {
  segments: [
    {
      block: "HOOK", label: "HOOK", start: 0, end: 4, text: "",
      start_state: "Tangan menutup mulut di depan cermin kecil, produk tergeletak di meja rias",
      action: "kamera diam, tangan turun perlahan", product_state: "partial",
      why: "setup", mode: "CCTV", visual_direction: "meja rias, tanpa wajah",
    },
    {
      block: "BODY", label: "FRICTION", start: 4, end: 8, text: "Ih, jangan sekarang dong.",
      start_state: "Timer di layar HP menyala, waktunya habis",
      action: "tangan naik lagi ke mulut, lalu ditarik", product_state: "partial",
      why: "tension", mode: "SELFIE", visual_direction: "meja rias",
    },
    {
      block: "BODY", label: "FRICTION", start: 8, end: 12, text: "Bentar, bentar.",
      start_state: "Suara petugas memanggil dari luar pintu",
      action: "dia berdiri, menggeser kursi, mengambil produk dan memasukkannya ke saku",
      product_state: "partial", why: "tension", mode: "HANDHELD", visual_direction: "beranjak",
    },
    {
      block: "BODY", label: "SPIKE", start: 12, end: 16, text: "Udah. Masuk aja.",
      start_state: "Petugas berdiri di ambang pintu, suara off camera",
      action: "dia tersenyum lepas di depan petugas", product_state: "partial",
      why: "payoff", mode: "GENERAL", visual_direction: "ruang tunggu",
      saksi: "petugas, off camera",
    },
    {
      block: "CTA", label: "BUTTON", start: 16, end: 20,
      text: "Tadi sikat gigi dulu. Keterima nggak ya? Detailnya ada di bawah ya.",
      start_state: "Produk di tangan, label menghadap kamera",
      action: "diam satu detik di akhir", product_state: "hero",
      why: "payoff", mode: "SELLING", visual_direction: "produk hero",
    },
  ],
} as never;

test("SA yang diklaim 'kode' hanya SA1, SA2, SA4, SA6, SA8 — sisanya 'juri'", () => {
  assert.deepEqual(
    GERBANG_SA.filter((g) => g.penegakan === "kode").map((g) => g.id).sort(),
    ["SA1", "SA2", "SA4", "SA6", "SA8"]
  );
  assert.deepEqual(
    GERBANG_SA.filter((g) => g.penegakan === "juri").map((g) => g.id).sort(),
    ["SA3", "SA5", "SA7"]
  );
  // Tiap gerbang wajib menyebut siapa yang menegakkannya — supaya tidak ada
  // yang membaca daftar ini lalu mengira delapan-duanya dicek mesin.
  for (const g of GERBANG_SA) assert.ok(g.judul.length > 5, `${g.id} tanpa judul`);
  assert.equal(penegakanSA("SA5"), "juri");
  assert.equal(penegakanSA("SA1"), "kode");
});

test("naskah Ads yang memenuhi Story OS: NOL temuan keras", () => {
  const temuan = periksaStoryOsAds(LULUS, { contentType: "ads", durationSec: 20 });
  assert.deepEqual(temuan, [], `naskah sah ditolak: ${JSON.stringify(temuan)}`);
});

test("SA1 — CTA tanpa tanya yang tersisa ditolak", () => {
  const rusak = JSON.parse(JSON.stringify(LULUS));
  rusak.segments[4].text = "Detailnya ada di bawah ya.";
  const t = periksaStoryOsAds(rusak, { contentType: "ads", durationSec: 20 });
  assert.ok(t.some((x) => x.gerbang === "SA1"), `SA1 tidak menangkap button tanpa tanya: ${JSON.stringify(t)}`);
});

test("SA2 — spike tanpa saksi ditolak", () => {
  const rusak = JSON.parse(JSON.stringify(LULUS));
  delete rusak.segments[3].saksi;
  rusak.segments[3].start_state = "Dia sendirian di ruangan kosong";
  // action & visual_direction ikut dibersihkan: pemeriksa membaca ketiganya,
  // dan menyebut "petugas" di action memang BERARTI saksinya hadir.
  rusak.segments[3].action = "dia tersenyum lepas ke arah cermin";
  rusak.segments[3].visual_direction = "ruang tunggu kosong";
  const t = periksaStoryOsAds(rusak, { contentType: "ads", durationSec: 20 });
  assert.ok(t.some((x) => x.gerbang === "SA2"), `SA2 tidak menangkap spike tanpa saksi: ${JSON.stringify(t)}`);
});

test("SA4 — friction cuma sekali ditolak", () => {
  const rusak = JSON.parse(JSON.stringify(LULUS));
  rusak.segments[2].label = "BODY";
  const t = periksaStoryOsAds(rusak, { contentType: "ads", durationSec: 20 });
  assert.ok(t.some((x) => x.gerbang === "SA4"), `SA4 tidak menangkap friction tunggal: ${JSON.stringify(t)}`);
});

test("SA6 — bridging kurang dari dua ditolak", () => {
  const rusak = JSON.parse(JSON.stringify(LULUS));
  rusak.segments[0].product_state = "hidden";            // buang jembatan (b)
  rusak.segments[2].action = "dia berdiri dan berjalan keluar"; // buang jembatan (a)
  rusak.segments[4].text = "Keterima nggak ya? Detailnya ada di bawah ya."; // buang (c)
  const t = periksaStoryOsAds(rusak, { contentType: "ads", durationSec: 20 });
  assert.ok(t.some((x) => x.gerbang === "SA6"), `SA6 tidak menangkap bridging <2: ${JSON.stringify(t)}`);
});

test("SA8 — body yang menjelaskan hook/produk ditolak", () => {
  const rusak = JSON.parse(JSON.stringify(LULUS));
  rusak.segments[1].text = "Aslinya sabun ini bikin gigi lebih bersih.";
  const t = periksaStoryOsAds(rusak, { contentType: "ads", durationSec: 20 });
  assert.ok(t.some((x) => x.gerbang === "SA8"), `SA8 tidak menangkap body penjelasan: ${JSON.stringify(t)}`);
});

test("Affiliate TIDAK dikenai Story OS Ads — ia punya bentuknya sendiri", () => {
  const t = periksaStoryOsAds(LULUS, { contentType: "affiliate", durationSec: 15 });
  assert.deepEqual(t, [], "Story OS Ads tidak boleh berlaku untuk Affiliate");
});

test("penulis Ads menerima instruksi Story OS, Affiliate tidak", async () => {
  const { blokTugasUntukUji } = await import("../lib/script-engine/llm");
  const ads = blokTugasUntukUji({ contentType: "ads", durationSec: 20 });
  const aff = blokTugasUntukUji({ contentType: "affiliate", durationSec: 15 });
  for (const kata of ["BUTTON", "SPIKE", "FRICTION", "SAKSI", "bridging"]) {
    assert.ok(new RegExp(kata, "i").test(ads), `instruksi Ads tidak menyebut ${kata}`);
  }
  assert.ok(!/BUTTON-first|SPIKE/i.test(aff), "Affiliate tidak boleh diberi beat Story OS Ads");
});

test("validator menolak naskah Ads yang gagal SA — bukan sekadar mencatat", async () => {
  const { validateScript } = await import("../lib/script-engine/validator");
  const rusak = JSON.parse(JSON.stringify(LULUS));
  rusak.segments[3].start_state = "Dia sendirian di ruangan kosong";
  rusak.segments[3].action = "dia tersenyum lepas ke arah cermin";
  rusak.segments[3].visual_direction = "ruang tunggu kosong";
  delete rusak.segments[3].saksi;
  const hasil = validateScript(
    {
      segments: rusak.segments,
      hookFamily: "H1", register: "netral", productName: "Serum Glow Bening",
      productPriceIdr: 89000, contentType: "ads", durationSec: 20, quality_tier: "super_hq",
    } as never,
    "light"
  );
  assert.ok(
    hasil.errors.some((e) => e.rule.startsWith("SA")),
    `gerbang SA harus jadi ERROR di semua mode: ${JSON.stringify(hasil.errors.concat(hasil.warnings))}`
  );
});
