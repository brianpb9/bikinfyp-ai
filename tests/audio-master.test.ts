import { test } from "node:test";
import assert from "node:assert/strict";
import { embeddedVoiceoverInputFilter } from "../lib/media/compositor";
import { voiceoverStartSecForSegments } from "../lib/script-engine/story-os-ads";
import fs from "node:fs";
import { AUDIO_TARGET, audioEncoderArgs, loudnormFilter, measureLoudness, memenuhiStandar } from "../lib/media/audio-master";

// Diukur 2026-08-13 pada video yang BENAR-BENAR dirender pipeline ini:
// -12,4 LUFS di 32 kHz, sedangkan standar TikTok -14 LUFS di 44,1 kHz.
// Audio tidak pernah sekali pun diperiksa sebelum ini.

test("target audio memakai angka standar siaran, bukan angka karangan", () => {
  assert.equal(AUDIO_TARGET.lufs, -14, "TikTok menormalkan ke -14 LUFS");
  assert.equal(AUDIO_TARGET.truePeak, -1, "-1 dBTP menyisakan ruang untuk encoder platform");
  assert.equal(AUDIO_TARGET.sampleRate, 44100);
  assert.equal(AUDIO_TARGET.channels, 2);
});

test("argumen encoder selalu menyetel sample rate secara eksplisit", () => {
  const a = audioEncoderArgs();
  // 32 kHz yang terukur masuk justru karena tiap pemanggil menulis argumennya
  // sendiri dan tidak ada yang menyebut -ar.
  assert.ok(a.includes("-ar"), "encoder tidak menyetel sample rate — inilah cara 32 kHz masuk");
  assert.equal(a[a.indexOf("-ar") + 1], String(AUDIO_TARGET.sampleRate));
  assert.ok(a.includes("-ac"), "jumlah kanal tidak disetel");
});

test("filter loudnorm selalu membawa ketiga target", () => {
  const f = loudnormFilter(null);
  assert.match(f, /I=-14/); assert.match(f, /TP=-1/); assert.match(f, /LRA=7/);
});

test("VO embedded dapat ditunda melewati HOOK Story Ads yang senyap", () => {
  assert.match(embeddedVoiceoverInputFilter(4, 3), /adelay=delays=3000:all=1/);
  assert.match(embeddedVoiceoverInputFilter(4, 0), /adelay=delays=0:all=1/);
  const safe = [
    { role: "hook", label: "HOOK", start: 0, end: 3, text: "", visual_direction: "blank" },
    { role: "demo", label: "FRICTION", start: 3, end: 6, text: "Untuk Serum Uji, mulai.", bridge_source: "spoken_product_name", visual_direction: "blank" },
    { role: "demo", label: "FRICTION", start: 6, end: 9, text: "Kategorinya beauty.", bridge_source: "spoken_product_category", visual_direction: "blank" },
    { role: "demo", label: "SPIKE", start: 9, end: 12, text: "Sekarang lihat.", visual_direction: "blank" },
    { role: "cta", label: "BUTTON", start: 12, end: 15, text: "Cek detailnya.", visual_direction: "blank" },
  ] as never;
  const adsIdentity = { contentType: "ads" as const, productName: "Serum Uji", productCategory: "beauty", productPriceIdr: 89000 };
  assert.equal(voiceoverStartSecForSegments(safe, adsIdentity), 3);
  const reordered = structuredClone(safe) as unknown as Array<Record<string, unknown>>;
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(() => voiceoverStartSecForSegments(reordered as never, { ...adsIdentity, templateId: "ads-meja-kosong" }), /Story Ads worker/);

  const affiliate = [
    { role: "hook", label: "HOOK", start: 0, end: 4, text: "Eh, ini hook Affiliate.", visual_direction: "produk" },
    { role: "demo", label: "BODY", start: 4, end: 10, text: "Aku coba dulu.", visual_direction: "produk" },
    { role: "cta", label: "CTA", start: 10, end: 15, text: "Cek keranjang.", visual_direction: "produk" },
  ] as never;
  assert.equal(voiceoverStartSecForSegments(affiliate, { contentType: "affiliate" }), 0);
});

test("kedua worker meneruskan identitas genre otoritatif sebelum efek provider", () => {
  for (const rel of ["lib/worker.ts", "lib/postgres/worker.ts"]) {
    const source = fs.readFileSync(rel, "utf8");
    const identity = source.indexOf("const storyIdentity =");
    const preflight = source.indexOf("voiceoverStartSecForSegments(segments, {");
    const providerBoundary = source.indexOf("generateVideoWithFailover", preflight);
    assert.ok(identity >= 0 && preflight > identity, `${rel}: identity tidak diteruskan ke preflight`);
    assert.ok(providerBoundary > preflight, `${rel}: preflight Story Ads terlambat setelah boundary provider/snapshot`);
    assert.match(source, /contentType:\s*storyIdentity\.contentType/);
    assert.match(source, /isNeutralStoryAdsTemplate\(storyIdentity\.templateId\)/);
    assert.match(source, /ugcTemplate:\s*storyIdentity\.templateId/);
    if (rel.includes("postgres")) assert.match(source, /template_id:\s*storyIdentity\.templateId/);
  }
});

test("filter dua-lewatan memakai hasil pengukuran, bukan mengulang target", () => {
  const f = loudnormFilter({ inputI: -12.4, inputTp: -0.2, inputLra: 4.7, inputThresh: -23.1, targetOffset: 0.3 });
  assert.match(f, /measured_I=-12\.4/, "hasil pengukuran tidak ikut — normalisasinya jadi menebak");
  assert.match(f, /linear=true/);
});

test("penilai standar menolak yang terlalu keras", () => {
  // Angka nyata dari video kita sebelum perbaikan.
  const sebelum = memenuhiStandar({ inputI: -12.4, inputTp: -0.2, inputLra: 4.7, inputThresh: -23.1, targetOffset: 0 });
  assert.equal(sebelum.ok, false, "video -12,4 LUFS seharusnya ditolak");
  assert.match(sebelum.alasan.join(" "), /loudness/);
});

test("penilai standar menerima yang sudah pas", () => {
  const sesudah = memenuhiStandar({ inputI: -14.1, inputTp: -1.2, inputLra: 6, inputThresh: -24, targetOffset: 0 });
  assert.equal(sesudah.ok, true, `seharusnya lolos: ${sesudah.alasan.join(", ")}`);
});

test("loudness tidak terbaca = TIDAK lolos, bukan dianggap aman", () => {
  assert.equal(memenuhiStandar(null).ok, false);
});

// Tes integrasi: mengukur berkas sungguhan kalau ada. Dilewati (bukan gagal)
// di lingkungan tanpa hasil render — supaya CI tidak menuntut artefak lokal.
test("pengukuran berjalan pada berkas nyata", async (t) => {
  const f = "../test_output/render_utuh/ads-panas-UTUH.mp4";
  if (!fs.existsSync(f)) return t.skip("tidak ada berkas render lokal");
  const m = await measureLoudness(f);
  assert.ok(m, "loudness tidak terbaca dari berkas nyata");
  assert.ok(Number.isFinite(m!.inputI), "input_i bukan angka");
});
