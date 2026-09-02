// TIGA KUALITAS, DUA MESIN — yang dijaga tes ini bukan "kodenya jalan",
// melainkan janji-janji yang kalau lepas akan menagih orang untuk barang yang
// tidak mereka pilih.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

process.env.DB_PATH = `/tmp/racun-test-kualitas-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-kualitas-storage-${process.pid}`;

const { KUALITAS, URUTAN_KUALITAS, mesinUntuk, modelUntuk, setaraBaru } = await import("../lib/kualitas-video");
const { buatBadanTask, kieGrokVideo, MAKS_DETIK_PER_KLIP } = await import("../lib/providers/stubs/kie-grok");
const { registeredVideoProviders } = await import("../lib/providers/registry");
const { config } = await import("../lib/config");
const { TIER_DIJUAL, TIER_DITERIMA, tierMasihDijual, tierMasihDiterima } = await import("../lib/paket-kredit");
import type { VisualSpec, ShotSpec } from "../lib/providers/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kie-"));
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const gambar = path.join(dir, "0.png");
fs.writeFileSync(gambar, png);

const shot: ShotSpec = { index: 0, durationSec: 8, prompt: "hands presenting product", imageRefPath: gambar };
const spec = (tier: VisualSpec["qualityTier"]): VisualSpec => ({
  jobId: "job-uji", width: 720, height: 1280, shots: [shot],
  negativePrompt: "no text, no logo, no writing",
  qualityTier: tier, generateAudio: true,
});

// ── Peta kualitas -> mesin ───────────────────────────────────────────────────

test("standard dirender kie.ai, premium dan ultra dirender BytePlus", () => {
  assert.equal(mesinUntuk("standard"), "kie-grok");
  assert.equal(mesinUntuk("premium"), "byteplus");
  assert.equal(mesinUntuk("ultra"), "byteplus");
});

test("tier lama TETAP di BytePlus — job yang sudah antre tidak boleh pindah mesin", () => {
  for (const lama of ["silent_caption", "high_quality", "super_hq"] as const) {
    assert.equal(mesinUntuk(lama), "byteplus", `${lama} berpindah mesin — job lama akan dirender mesin yang tidak pernah dipilih untuknya`);
    assert.equal(modelUntuk(lama), null);
  }
});

test("premium dan ultra memakai MODEL yang berbeda — kalau sama, Ultra menjual selisih yang tidak ada", () => {
  assert.notEqual(KUALITAS.premium.model, KUALITAS.ultra.model);
  assert.match(KUALITAS.premium.model, /2-0-mini/);
  assert.match(KUALITAS.ultra.model, /2-5/);
  assert.equal(KUALITAS.standard.model, "grok-imagine/image-to-video");
});

test("urutan kualitas naik, bukan acak", () => {
  assert.deepEqual(URUTAN_KUALITAS, ["standard", "premium", "ultra"]);
});

test("padanan nama lama menunjuk tier yang HARGANYA sama, bukan yang lebih murah", () => {
  assert.equal(setaraBaru("super_hq"), "ultra");
  assert.equal(setaraBaru("high_quality"), "premium");
  assert.equal(config.tiers.super_hq.priceIdr, config.tiers.ultra.priceIdr);
  assert.equal(config.tiers.high_quality.priceIdr, config.tiers.premium.priceIdr);
  // Idempoten: memetakan yang sudah baru tidak boleh menggesernya.
  for (const k of URUTAN_KUALITAS) assert.equal(setaraBaru(k), k);
});

// ── Yang dijual vs yang diterima ─────────────────────────────────────────────

test("standard TIDAK dijual selama tarif kie.ai belum pernah dilihat dari tagihan", () => {
  assert.equal(tierMasihDijual("standard"), false, "standard dijual padahal biayanya belum diketahui");
});

test("nama tier lama masih DITERIMA — naskah yang sedang berjalan tidak boleh terjebak", () => {
  for (const lama of ["high_quality", "super_hq"]) {
    assert.equal(tierMasihDiterima(lama), true, `${lama} ditolak — orang yang sudah bikin naskah akan mentok di langkah terakhir`);
    assert.equal(tierMasihDijual(lama), false, `${lama} masih ditawarkan berdampingan dengan padanan barunya`);
  }
  for (const dijual of TIER_DIJUAL) assert.ok(TIER_DITERIMA.includes(dijual), "yang dijual wajib juga diterima");
});

test("tier yang tidak dikenal ditolak — bawaan sebuah pemeriksaan penagihan adalah TIDAK", () => {
  for (const asing of ["", "gratis", "ULTRA", "premium ", "silent_caption"]) {
    assert.equal(tierMasihDiterima(asing), false, `"${asing}" lolos sebagai tier yang bisa ditagih`);
  }
});

// ── Failover: arahnya sengaja tidak simetris ─────────────────────────────────

test("premium dan ultra TIDAK PERNAH jatuh ke kie.ai — 720p tidak boleh diam-diam jadi 480p", async () => {
  const { videoOrder } = await import("../lib/providers/registry");
  const asalProvider = config.providerVideo;
  (config as { providerVideo: string }).providerVideo = "byteplus";
  try {
    for (const tier of ["premium", "ultra", "high_quality", "super_hq"] as const) {
      const nama = videoOrder(spec(tier)).map((p) => p.name);
      assert.ok(!nama.includes("kie-grok-imagine"), `${tier} bisa dialihkan ke kie-grok — pembeli 720p menerima 480p`);
      assert.equal(nama[0], "byteplus-ark-seedance", `${tier} tidak lagi dirender BytePlus lebih dulu`);
    }
  } finally {
    (config as { providerVideo: string }).providerVideo = asalProvider;
  }
});

test("standard dirender kie.ai LEBIH DULU, dengan BytePlus sebagai cadangan", async () => {
  const { videoOrder } = await import("../lib/providers/registry");
  const asalProvider = config.providerVideo;
  (config as { providerVideo: string }).providerVideo = "byteplus";
  try {
    const nama = videoOrder(spec("standard")).map((p) => p.name);
    assert.equal(nama[0], "kie-grok-imagine", "standard tidak dirender mesin yang dipilih untuknya");
    // Cadangannya mesin yang LEBIH mahal: kerugiannya di pihak kita, bukan pembeli.
    assert.ok(nama.includes("byteplus-ark-seedance"), "standard tidak punya cadangan — satu gangguan kie.ai mematikan tier ini");
  } finally {
    (config as { providerVideo: string }).providerVideo = asalProvider;
  }
});

test("daftar provider yang terdaftar tetap memenuhi SR-ABS-01 (minimal dua)", () => {
  assert.ok(registeredVideoProviders().length >= 2);
});

// ── Badan permintaan ke kie.ai ───────────────────────────────────────────────

test("badan permintaan memuat bentuk yang diberikan penyedia, bukan karangan", () => {
  const b = buatBadanTask(spec("standard"), shot, "https://contoh.id/a.png");
  assert.deepEqual(Object.keys(b.input).sort(), [
    "aspect_ratio", "duration", "image_urls", "index", "mode", "nsfw_checker", "prompt", "resolution",
  ]);
  assert.deepEqual(b.input.image_urls, ["https://contoh.id/a.png"]);
  assert.equal(b.input.duration, 8);
  assert.equal(b.input.aspect_ratio, "9:16");
  assert.equal(b.input.resolution, config.tiers.standard.resolution);
  assert.equal(b.model, config.kieGrokModel);
});

test("negative prompt IKUT terkirim — aturan keras repo tidak boleh bolong di satu tier", () => {
  const b = buatBadanTask(spec("standard"), shot, "https://contoh.id/a.png");
  assert.match(b.input.prompt, /no text, no logo, no writing/);
  assert.match(b.input.prompt, /hands presenting product/);
});

test("klip melebihi batas Grok ditolak SEBELUM dikirim, bukan sesudah dibayar", () => {
  const panjang = { ...shot, durationSec: MAKS_DETIK_PER_KLIP + 1 };
  assert.throws(() => buatBadanTask(spec("standard"), panjang, "https://contoh.id/a.png"), /melebihi batas/);
  assert.doesNotThrow(() => buatBadanTask(spec("standard"), { ...shot, durationSec: MAKS_DETIK_PER_KLIP }, "https://contoh.id/a.png"));
});

test("tanpa KIE_API_KEY provider menolak jalan, bukan gagal separuh jalan", async () => {
  const asal = config.kieApiKey;
  (config as { kieApiKey: string }).kieApiKey = "";
  try {
    assert.equal(await kieGrokVideo.healthCheck(), false);
    await assert.rejects(() => kieGrokVideo.generate(spec("standard"), dir), /belum dikonfigurasi/);
  } finally {
    (config as { kieApiKey: string }).kieApiKey = asal;
  }
});

test("biaya kie.ai dilaporkan 0 DENGAN peringatan selama tarifnya belum diisi", () => {
  const asal = process.env.KIE_COST_PER_VIDEO_IDR;
  delete process.env.KIE_COST_PER_VIDEO_IDR;
  const pesan: string[] = [];
  const asliWarn = console.warn;
  console.warn = (m: unknown) => { pesan.push(String(m)); };
  const nol = kieGrokVideo.estimateCost(spec("standard"));
  console.warn = asliWarn;
  assert.equal(nol, 0);
  assert.ok(pesan.some((p) => p.includes("KIE_COST_PER_VIDEO_IDR")), "biaya 0 dilaporkan diam-diam — margin palsu tidak akan ketahuan");

  process.env.KIE_COST_PER_VIDEO_IDR = "3500";
  assert.equal(kieGrokVideo.estimateCost(spec("standard")), 3500);
  if (asal === undefined) delete process.env.KIE_COST_PER_VIDEO_IDR;
  else process.env.KIE_COST_PER_VIDEO_IDR = asal;
});

// ── Permukaan jual ───────────────────────────────────────────────────────────

test("setiap tier yang ditawarkan punya harga dan resolusi di config", () => {
  for (const id of [...TIER_DITERIMA, ...URUTAN_KUALITAS]) {
    const t = config.tiers[id as keyof typeof config.tiers];
    assert.ok(t, `tier ${id} tidak punya baris di config.tiers`);
    assert.ok(t.priceIdr > 0, `tier ${id} berharga ${t.priceIdr}`);
    assert.ok(t.resolution, `tier ${id} tanpa resolusi`);
  }
});

test("/api/meta menyaring Standard dengan KIE_API_KEY, bukan memajangnya begitu saja", async () => {
  const fs = await import("node:fs");
  const s = fs.readFileSync(new URL("../app/api/meta/route.ts", import.meta.url), "utf8");
  assert.match(s, /config\.kieApiKey/, "Standard bisa dipilih tanpa mesinnya terpasang");
  assert.match(s, /tierStandardSiap\(\)/, "penyaringnya tidak dipakai saat menyusun daftar");
});

test("harga yang dikirim ke layar diambil dari config, bukan diketik di route", async () => {
  const fs = await import("node:fs");
  const s = fs.readFileSync(new URL("../app/api/meta/route.ts", import.meta.url), "utf8");
  assert.match(s, /config\.tiers\[t\.id\]\?\.resolution/, "resolusi diketik terpisah dari yang dirender — persis cara klaim 1080p bertahan berbulan-bulan");
  assert.ok(!/12_?000|80_?000/.test(s), "angka harga diketik ulang di route meta");
});
