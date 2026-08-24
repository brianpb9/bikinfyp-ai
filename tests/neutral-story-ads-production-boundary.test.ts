import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.SCRIPT_LLM = "0";
process.env.DB_PATH = `/tmp/racun-neutral-boundary-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-neutral-boundary-storage-${process.pid}`;

import { CAMPAIGN_TEMPLATES } from "../lib/templates";
import { generateScripts } from "../lib/script-engine";
import { planShots } from "../lib/media/shot-planner";
import { getCreatorCategory } from "../lib/personas";
import { templateIdRenderOtoritatif } from "../lib/dashboard/render-cell";
import { shouldPreserveEmbeddedLipsync } from "../lib/postgres/worker";
import { normalisasiFormatWorker } from "../lib/media/worker-format";
import { planSqliteWorkerShots } from "../lib/worker";
import { buildTaskContent } from "../lib/providers/stubs/byteplus";
import { voiceoverStartSecForSegments } from "../lib/script-engine/story-os-ads";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { evaluateQcPolicy, neutralStoryAdsIdentityChecks, runQc, type QcCheck } from "../lib/media/qc";
import { neutralStoryAdsCoverageViolations, neutralStoryAdsViolations, parseVisionFrameResponse, periksaFrameVision, type TemuanFrame } from "../lib/media/qc-vision";

test("snapshot confirm -> job persisten -> normalisasi worker menjaga kontrak 9 Story Ads", async () => {
  const templates = CAMPAIGN_TEMPLATES.filter((template) => template.group === "ads");
  assert.equal(templates.length, 9);
  let adsFormatCount = 0;
  for (const template of templates) {
    // Simulasi boundary confirm yang nyata: client legacy menghilangkan
    // template_id, tetapi nilai yang dipersist berasal dari snapshot script.
    const persistedTemplateId = templateIdRenderOtoritatif({ templateId: template.id }, null);
    assert.equal(persistedTemplateId, template.id);
    const persistedFormat = normalisasiFormatWorker(template.format);
    assert.equal(persistedFormat, template.format, `${template.id}: format berubah di worker`);
    if (template.format === "ads") adsFormatCount++;

    const product = { id: `boundary-${template.id}`, name: "Kemeja Uji", price_idr: 189000, category: "fashion" };
    const [script] = await generateScripts({
      product, register: "netral", qualityTier: template.tier, durationSec: template.durationSec,
      contentType: "ads", templateId: template.id, count: 1, tanpaLlm: true,
    });
    const spec = planShots({
      jobId: `persisted-${template.id}`, durationSec: template.durationSec, segments: script.segments,
      category: getCreatorCategory("hijaber")!, productName: product.name,
      productCategory: product.category, productPriceIdr: product.price_idr, imageRefPath: "/tmp/authoritative-product.jpg",
      extraImageRefPaths: ["/tmp/extra-product.jpg"], qualityTier: template.tier,
      format: persistedFormat, ugcTemplate: persistedTemplateId,
      shotCountOverride: template.shotCount,
    });
    assert.equal(spec.visualSubjectPolicy, "neutral_story_ads");
    assert.ok(spec.shots.length >= 2, `${template.id}: Story Ads harus punya shot pembuka provider terpisah`);
    assert.match(spec.shots[0].prompt, /No spoken words in this shot/i, `${template.id}: shot provider pertama tidak senyap`);
    assert.doesNotMatch(spec.shots[0].prompt, /Indonesian dialogue, spoken exactly|VOICEOVER (?:speaks|narrates)|presenter speaks/i);
    assert.deepEqual(spec.shots.flatMap((shot) => shot.imageRefPath ? [shot.imageRefPath] : []), []);
    assert.deepEqual(spec.extraReferenceImagePaths ?? [], []);
    for (const shot of spec.shots) {
      assert.equal(buildTaskContent(spec, shot, "dreamina-seedance-2-0-mini-260615")
        .filter((item) => (item as { type?: string }).type === "image_url").length, 0);
    }
    if (template.format === "ads") {
      // Bukti bahwa cabang framing/people/negative-prompt Ads—bukan fallback
      // hands_only—yang benar-benar dipakai oleh input persisten worker.
      assert.equal(spec.referenceOnlyImages, true);
      assert.equal(spec.maxPeople, 1);
      assert.match(spec.negativePrompt, /duplicated limbs|second person/i);
      assert.doesNotMatch(spec.negativePrompt, /no face visible anywhere/i);
    }
  }
  assert.equal(adsFormatCount, 7, "jumlah format ads katalog berubah; audit boundary harus diperbarui");
});

test("template request berbeda tetap ditolak, omission memakai snapshot", () => {
  assert.equal(templateIdRenderOtoritatif({ templateId: "ads-meja-kosong" }, null), "ads-meja-kosong");
  assert.equal(templateIdRenderOtoritatif(undefined, "review-jujur"), "review-jujur");
});

test("W1: dua talking_head Story Ads memakai narasi eksternal tertunda tanpa duplikasi ucapan provider", async () => {
  for (const templateId of ["ads-unboxing-pov", "ads-panas-ekstrem"]) {
    const template = CAMPAIGN_TEMPLATES.find((item) => item.id === templateId)!;
    const product = { id: `voice-${templateId}`, name: "Serum Uji", price_idr: 189000, category: "beauty" };
    const [script] = await generateScripts({
      product, register: "netral", qualityTier: template.tier, durationSec: template.durationSec,
      contentType: "ads", templateId, count: 1, tanpaLlm: true,
    });
    const identity = { contentType: "ads" as const, templateId, durationSec: template.durationSec };
    assert.equal(shouldPreserveEmbeddedLipsync({
      format: "talking_head", providerName: "seedance-production", storyIdentity: identity,
    }), false, `${templateId}: W1 masih memilih embedded lipsync`);
    assert.equal(voiceoverStartSecForSegments(script.segments, {
      ...identity, productName: product.name, productCategory: product.category, productPriceIdr: product.price_idr,
    }), script.segments[0].end, `${templateId}: narasi tidak ditunda sesudah HOOK`);

    const spoken = script.segments.slice(1).map((segment) => segment.tts_text ?? segment.text).join(" ");
    assert.match(spoken, /Serum Uji/i, `${templateId}: bridge nama produk hilang dari TTS`);
    assert.match(spoken, /beauty/i, `${templateId}: bridge kategori produk hilang dari TTS`);
    assert.doesNotMatch(spoken, /189 ribu|harga|banderol/i, `${templateId}: konsep non-price menyisipkan harga`);
    assert.match(spoken, /detailnya ada di bawah/i, `${templateId}: BUTTON hilang dari TTS`);

    const spec = planShots({
      jobId: `voice-${templateId}`, durationSec: template.durationSec, segments: script.segments,
      category: getCreatorCategory("hijaber")!, productName: product.name,
      productCategory: product.category, productPriceIdr: product.price_idr,
      imageRefPath: "/tmp/product.jpg", qualityTier: template.tier,
      format: template.format, ugcTemplate: template.id, shotCountOverride: template.shotCount,
    });
    for (const shot of spec.shots) {
      assert.match(shot.prompt, /No spoken words in this shot/i);
      assert.doesNotMatch(shot.prompt, /Indonesian dialogue, spoken exactly|presenter speaks|VOICEOVER (?:speaks|narrates)/i,
        `${templateId}: provider dan TTS akan mengucapkan naskah ganda`);
    }
  }
});

test("QC path: dua Story Ads produk fisik tidak direfund oleh QC-03/QC-10 yang berlawanan dengan kontrak neutral", async () => {
  const ref = `/tmp/racun-neutral-qc-ref-${process.pid}.jpg`;
  fs.writeFileSync(ref, "authoritative product photo");
  const sha = createHash("sha256").update(fs.readFileSync(ref)).digest("hex");
  try {
    for (const templateId of ["ads-unboxing-pov", "ads-panas-ekstrem"]) {
      const template = CAMPAIGN_TEMPLATES.find((item) => item.id === templateId)!;
      const [script] = await generateScripts({
        product: { id: `qc-${templateId}`, name: "Serum Uji", category: "beauty", price_idr: 189000 },
        register: "netral", qualityTier: template.tier, durationSec: template.durationSec,
        contentType: "ads", templateId, count: 1, tanpaLlm: true,
      });
      const spec = planShots({
        jobId: `qc-${templateId}`, durationSec: template.durationSec,
        segments: script.segments,
        category: getCreatorCategory("hijaber")!, productName: "Serum Uji",
        productCategory: "beauty", productPriceIdr: 189000, imageRefPath: ref,
        qualityTier: template.tier, format: template.format, ugcTemplate: template.id,
        shotCountOverride: template.shotCount,
      });
      assert.equal(spec.visualSubjectPolicy, "neutral_story_ads");
      const [qc10, qc03] = neutralStoryAdsIdentityChecks({ packshotSidik: sha, refImagePath: ref, productCategory: "beauty" });
      assert.equal(qc10.status, "pass", `${templateId}: provenance packshot harus tetap diverifikasi`);
      assert.equal(qc03.status, "skip", `${templateId}: pixel produk generated harus N/A`);
      const checks: QcCheck[] = [
        { code: "QC-01", name: "voice", status: "skip" },
        { code: "QC-02", name: "morph", status: "pass" }, qc10, qc03,
        { code: "QC-04", name: "audio", status: "pass" },
        { code: "QC-05", name: "duration", status: "pass" },
        { code: "QC-06", name: "overlay", status: "skip" },
        { code: "QC-07", name: "claims", status: "pass" },
        { code: "QC-08", name: "aigc", status: "pass" },
        { code: "QC-11", name: "neutral visual", status: "pass" },
        { code: "QC-12", name: "speech", status: "skip" },
      ];
      assert.equal(evaluateQcPolicy(template.format, checks, spec.visualSubjectPolicy), true,
        `${templateId}: output neutral compliant ditolak/refund oleh policy QC lama`);

      const video = `/tmp/racun-neutral-qc-${templateId}-${process.pid}.mp4`;
      execFileSync("ffmpeg", ["-y", "-v", "error",
        "-f", "lavfi", "-i", `color=c=gray:s=360x640:r=24:d=${template.durationSec}`,
        "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${template.durationSec}`,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        "-metadata", "racun_aigc=true", "-movflags", "use_metadata_tags", video]);
      try {
        const finding: TemuanFrame = {
          detik: 4.2, jumlahOrang: 1, jumlahOrangUtama: 1, jumlahWajah: 1, jumlahTangan: 2,
          teksAcak: false, teksTerlihat: false, neutralFieldsComplete: true,
          anatomiRusak: false, produkTerlihat: false, fisikaJanggal: false, catatan: "blank card",
        };
        const result = await runQc({
          filePath: video, targetDurationSec: template.durationSec, finalTexts: ["aman"],
          hookFamily: "story_ads", register: "netral", productName: "Serum Uji",
          productCategory: "beauty", priceIdr: 189000, renderParams: { watermark: true },
          refImagePath: ref, packshotSidik: sha, format: template.format,
          isMockProvider: true, maxPeople: spec.maxPeople, presenterLipsync: false,
          overlayTextExpectations: [], visualSubjectPolicy: spec.visualSubjectPolicy,
        }, { neutralVisionResults: [finding] });
        assert.equal(result.checks.find((c) => c.code === "QC-03")?.status, "skip");
        assert.equal(result.checks.find((c) => c.code === "QC-10")?.status, "pass");
        assert.equal(result.checks.find((c) => c.code === "QC-11")?.status, "pass");
        assert.equal(result.passed, true, `${templateId}: runQc compliant masih memicu reject/refund: ${JSON.stringify(result.checks)}`);

        const bad = await runQc({
          filePath: video, targetDurationSec: template.durationSec, finalTexts: ["aman"],
          hookFamily: "story_ads", register: "netral", productName: "Serum Uji",
          productCategory: "beauty", priceIdr: 189000, renderParams: { watermark: true },
          refImagePath: ref, packshotSidik: sha, format: template.format,
          isMockProvider: true, maxPeople: spec.maxPeople, presenterLipsync: false,
          overlayTextExpectations: [], visualSubjectPolicy: spec.visualSubjectPolicy,
        }, { neutralVisionResults: [{ ...finding, produkTerlihat: true, teksTerlihat: true }] });
        assert.equal(bad.checks.find((c) => c.code === "QC-11")?.status, "fail");
        assert.equal(bad.passed, false, `${templateId}: pelanggaran neutral lolos runQc`);

        const appendFailed = await runQc({
          filePath: video, targetDurationSec: template.durationSec, finalTexts: ["aman"],
          hookFamily: "story_ads", register: "netral", productName: "Serum Uji",
          productCategory: "beauty", priceIdr: 189000, renderParams: { watermark: true },
          refImagePath: ref, format: template.format, isMockProvider: true,
          maxPeople: spec.maxPeople, presenterLipsync: false, overlayTextExpectations: [],
          visualSubjectPolicy: spec.visualSubjectPolicy,
        }, { neutralVisionResults: [finding] });
        assert.equal(appendFailed.checks.find((c) => c.code === "QC-10")?.status, "fail");
        assert.equal(appendFailed.passed, false, `${templateId}: appendPackshot gagal masih lolos/refund palsu`);
      } finally {
        fs.rmSync(video, { force: true });
      }
    }
  } finally {
    fs.rmSync(ref, { force: true });
  }
});

test("QC path: pelanggaran produk/teks di pixel generated neutral tetap hard-fail", () => {
  const finding: TemuanFrame = {
    detik: 4.2, jumlahOrang: 1, jumlahOrangUtama: 1, jumlahWajah: 1, jumlahTangan: 2,
    teksAcak: false, teksTerlihat: true, neutralFieldsComplete: true,
    anatomiRusak: false, produkTerlihat: true,
    fisikaJanggal: false, catatan: "branded bottle on card",
  };
  const violations = neutralStoryAdsViolations(finding);
  assert.equal(violations.length, 2);
  assert.match(violations.join(" "), /produk\/kemasan/);
  assert.match(violations.join(" "), /tulisan terlihat/);

  const checks: QcCheck[] = [
    { code: "QC-02", name: "morph", status: "pass" },
    { code: "QC-03", name: "identity", status: "skip" },
    { code: "QC-04", name: "audio", status: "pass" },
    { code: "QC-05", name: "duration", status: "pass" },
    { code: "QC-07", name: "claims", status: "pass" },
    { code: "QC-08", name: "aigc", status: "pass" },
    { code: "QC-10", name: "packshot", status: "pass" },
    { code: "QC-11", name: "neutral visual", status: "fail", detail: violations.join("; ") },
  ];
  assert.equal(evaluateQcPolicy("talking_head", checks, "neutral_story_ads"), false);

  const oldSchema = { ...finding, teksTerlihat: false, produkTerlihat: false, neutralFieldsComplete: false };
  assert.match(neutralStoryAdsViolations(oldSchema).join(" "), /tidak terbukti/,
    "respons visi schema lama/malformed tidak boleh diam-diam lulus neutral");
});

test("QC-10 neutral: produk fisik wajib packshot sukses/provenance; jasa saja boleh N/A", () => {
  const missingPhysical = neutralStoryAdsIdentityChecks({ productCategory: "beauty" })[0];
  assert.equal(missingPhysical.status, "fail");
  assert.match(missingPhysical.detail ?? "", /wajib punya packshot/);

  const appendFailure = neutralStoryAdsIdentityChecks({ productCategory: "fashion", refImagePath: "/tmp/ada-tapi-append-gagal.jpg" })[0];
  assert.equal(appendFailure.status, "fail", "appendPackshot gagal tidak boleh berakhir PASS");

  const ref = `/tmp/racun-neutral-qc-mismatch-${process.pid}.jpg`;
  fs.writeFileSync(ref, "foto yang benar");
  try {
    const mismatch = neutralStoryAdsIdentityChecks({
      productCategory: "beauty", refImagePath: ref, packshotSidik: "0".repeat(64),
    })[0];
    assert.equal(mismatch.status, "fail");
    assert.match(mismatch.detail ?? "", /bukan foto produk job/);
  } finally {
    fs.rmSync(ref, { force: true });
  }

  for (const category of ["jasa", "app", "toko"]) {
    const service = neutralStoryAdsIdentityChecks({ productCategory: category })[0];
    assert.equal(service.status, "skip", `${category}: route tanpa produk harus N/A`);
  }
});

test("QC-11 neutral: satu sampel timeout/unparsable menggagalkan runQc", async () => {
  const clean: TemuanFrame = {
    detik: 2, jumlahOrang: 1, jumlahOrangUtama: 1, jumlahWajah: 1, jumlahTangan: 2,
    teksAcak: false, teksTerlihat: false, neutralFieldsComplete: true,
    anatomiRusak: false, produkTerlihat: false, fisikaJanggal: false, catatan: "blank card",
  };
  assert.deepEqual(neutralStoryAdsCoverageViolations([clean, null], [2, 7]), [
    "detik 7: respons visi timeout/tidak dapat diparse",
  ]);

  const video = `/tmp/racun-neutral-qc-coverage-${process.pid}.mp4`;
  execFileSync("ffmpeg", ["-y", "-v", "error",
    "-f", "lavfi", "-i", "color=c=gray:s=360x640:r=24:d=15",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=15",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    "-metadata", "racun_aigc=true", "-movflags", "use_metadata_tags", video]);
  try {
    const result = await runQc({
      filePath: video, targetDurationSec: 15, finalTexts: ["aman"], hookFamily: "story_ads",
      register: "netral", productName: "Jasa Uji", productCategory: "jasa", priceIdr: 0,
      renderParams: { watermark: true }, format: "ads", isMockProvider: true, maxPeople: 1,
      presenterLipsync: false, overlayTextExpectations: [], visualSubjectPolicy: "neutral_story_ads",
    }, { neutralVisionResults: [clean, null] });
    assert.equal(result.checks.find((check) => check.code === "QC-11")?.status, "fail");
    assert.equal(result.passed, false);
  } finally {
    fs.rmSync(video, { force: true });
  }
});

test("parser visi aktual retry lalu menolak schema parsial/coercion/count invalid", async (t) => {
  const frame = `/tmp/racun-qc-vision-wire-${process.pid}.jpg`;
  fs.writeFileSync(frame, "fake jpeg bytes: fetch dimock, decoder tidak dipakai");
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    fs.rmSync(frame, { force: true });
  });
  const valid = {
    jumlahOrang: 1, jumlahOrangUtama: 1, jumlahWajah: 1, jumlahTangan: 2,
    teksAcak: false, teksTerlihat: false, anatomiRusak: false,
    produkTerlihat: false, fisikaJanggal: false, catatan: "blank card",
  };
  const invalid: Array<[string, string]> = [
    ["missing fields", JSON.stringify({ produkTerlihat: false, teksTerlihat: false })],
    ["numeric string", JSON.stringify({ ...valid, jumlahOrang: "1" })],
    ["wrong boolean", JSON.stringify({ ...valid, fisikaJanggal: 0 })],
    ["negative", JSON.stringify({ ...valid, jumlahTangan: -1 })],
    ["fraction", JSON.stringify({ ...valid, jumlahWajah: 0.5 })],
    ["NaN", JSON.stringify(valid).replace('"jumlahOrang":1', '"jumlahOrang":NaN')],
    ["primary exceeds total", JSON.stringify({ ...valid, jumlahOrang: 1, jumlahOrangUtama: 2 })],
    ["faces exceed people", JSON.stringify({ ...valid, jumlahOrang: 0, jumlahWajah: 1 })],
    ["catatan not string", JSON.stringify({ ...valid, catatan: 12 })],
  ];
  for (const [label, wire] of invalid) {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: wire }] } }] }), { status: 200 });
    }) as typeof fetch;
    assert.equal(await periksaFrameVision(frame, 3.5, 0, [0, 0, 0]), null, label);
    assert.equal(calls, 3, `${label}: invalid schema tidak diretry sampai batas`);
  }

  let validCalls = 0;
  globalThis.fetch = (async () => {
    validCalls++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] } }] }), { status: 200 });
  }) as typeof fetch;
  const parsed = await periksaFrameVision(frame, 3.5, 0, [0, 0, 0]);
  assert.deepEqual(parsed, { detik: 3.5, ...valid, neutralFieldsComplete: true });
  assert.equal(validCalls, 1);
  assert.equal(parseVisionFrameResponse({ ...valid, jumlahOrang: Infinity }, 1), null);
});

test("W2 actual planner mempertahankan format ads dan perilaku format lain", async () => {
  const template = CAMPAIGN_TEMPLATES.find((item) => item.id === "ads-meja-kosong")!;
  const product = { id: "w2-ads", name: "Serum Uji", category: "beauty", price_idr: 189000 };
  const [script] = await generateScripts({
    product, register: "netral", qualityTier: template.tier, durationSec: template.durationSec,
    contentType: "ads", templateId: template.id, count: 1, tanpaLlm: true,
  });
  const common = {
    jobId: "w2-ads", durationSec: template.durationSec, segments: script.segments,
    category: getCreatorCategory("hijaber")!, productName: product.name,
    productCategory: product.category, productPriceIdr: product.price_idr,
    imageRefPath: "/tmp/service.jpg", qualityTier: template.tier,
    contentType: "ads" as const, ugcTemplate: template.id,
  };
  const ads = planSqliteWorkerShots({ ...common, persistedFormat: "ads" });
  assert.equal(ads.visualSubjectPolicy, "neutral_story_ads");
  assert.equal(ads.maxPeople, 1);
  assert.equal(ads.referenceOnlyImages, true);
  assert.doesNotMatch(ads.negativePrompt, /no face visible anywhere/i);

  assert.equal(normalisasiFormatWorker("talking_head"), "talking_head");
  assert.equal(normalisasiFormatWorker("vo_broll"), "vo_broll");
  assert.equal(normalisasiFormatWorker("tvc"), "tvc");
  assert.equal(normalisasiFormatWorker("unknown"), "hands_only");
});

test("kedua worker meneruskan visualSubjectPolicy planner ke runQc", () => {
  for (const file of ["lib/postgres/worker.ts", "lib/worker.ts"]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /(?:runQc|sqliteQcRunner|postgresQcRunner)\(\{[\s\S]*?visualSubjectPolicy:\s*spec\.visualSubjectPolicy/,
      `${file}: policy neutral hilang sebelum QC`);
  }
});

test("framing/camera LLM neutral tidak dapat menyuntik merchandise, termasuk sinonim di luar blacklist", async () => {
  const template = CAMPAIGN_TEMPLATES.find((item) => item.id === "ads-unboxing-pov")!;
  const product = { id: "composition", name: "Serum Uji", price_idr: 189000, category: "beauty" };
  const [script] = await generateScripts({
    product, register: "netral", qualityTier: template.tier, durationSec: template.durationSec,
    contentType: "ads", templateId: template.id, count: 1, tanpaLlm: true,
  });
  const base = {
    jobId: "composition", durationSec: template.durationSec,
    category: getCreatorCategory("hijaber")!, productName: product.name,
    productCategory: product.category, productPriceIdr: product.price_idr,
    imageRefPath: "/tmp/product.jpg", qualityTier: template.tier,
    format: template.format, ugcTemplate: template.id, shotCountOverride: template.shotCount,
  } as const;
  const safeSegments = structuredClone(script.segments);
  Object.assign(safeSegments[1], {
    action: "talent membuka kartu blank di depan meja",
    framing: "medium staged view", angle: "eye level", camera: "static camera",
  });
  const safe = planShots({ ...base, segments: safeSegments });
  const safePayload = safe.shots.flatMap((shot) => buildTaskContent(safe, shot, "dreamina-seedance-2-0-mini-260615"));

  for (const [field, injection] of [
    ["framing", "macro shot of an unbranded serum jar beside a blank colour card"],
    ["camera", "slow orbit around a cosmetic tube"],
    ["camera", "push toward a skincare box"],
    ["framing", "wide beauty merchandise shelf"],
  ] as const) {
    const segments = structuredClone(safeSegments);
    (segments[1] as unknown as Record<string, string>)[field] = injection;
    assert.throws(() => planShots({ ...base, segments }), /Kontrak field/, `${field}: ${injection}`);
  }

  // Sinonim sengaja tidak ada di blacklist. Ia boleh lolos parser, tetapi
  // wajib dibuang total: payload provider harus byte-for-byte identik.
  const synonymSegments = structuredClone(safeSegments);
  synonymSegments[1].framing = "macro vial beside a compact applicator packet";
  synonymSegments[1].camera = "slow orbit around a canister";
  const synonym = planShots({ ...base, segments: synonymSegments });
  const synonymPayload = synonym.shots.flatMap((shot) => buildTaskContent(
    synonym, shot, "dreamina-seedance-2-0-mini-260615"
  ));
  assert.deepEqual(synonymPayload, safePayload, "komposisi LLM neutral masih memengaruhi provider payload");
  assert.doesNotMatch(JSON.stringify(synonymPayload), /vial|compact applicator|packet|canister/i);
});

test("neutral Story Ads selalu memakai descriptor persona terkurasi, custom avatar tidak mencapai BytePlus", async () => {
  const template = CAMPAIGN_TEMPLATES.find((item) => item.id === "ads-meja-kosong")!;
  const product = { id: "custom-neutral", name: "Jasa Uji", price_idr: 189000, category: "jasa" };
  const [script] = await generateScripts({
    product, register: "netral", qualityTier: template.tier, durationSec: template.durationSec,
    contentType: "ads", templateId: template.id, count: 1, tanpaLlm: true,
  });
  const curated = getCreatorCategory("hijaber")!;
  for (const injection of [
    "woman holding a bottle marked ACME beside a blank card",
    "creator presenting branded serum packaging next to an unprinted swatch",
    "presenter beside a readable ACME identifier and a plain colour card",
  ]) {
    const injectedCategory = { ...curated, promptSeed: injection, handsPrompt: injection };
    const neutral = planShots({
      jobId: "neutral-custom", durationSec: 15, segments: script.segments,
      category: injectedCategory, productName: product.name, productCategory: product.category, productPriceIdr: product.price_idr,
      imageRefPath: "/tmp/product.jpg", qualityTier: template.tier,
      format: template.format, ugcTemplate: template.id, shotCountOverride: template.shotCount,
    });
    const providerText = neutral.shots.flatMap((shot) => buildTaskContent(
      neutral, shot, "dreamina-seedance-2-0-mini-260615"
    )).map((item) => JSON.stringify(item)).join(" ");
    assert.doesNotMatch(providerText, /ACME|bottle|serum packaging|branded|readable identifier/i);

    // Non-neutral tetap mempertahankan kontrak avatar custom yang sudah ada.
    const nonNeutral = planShots({
      jobId: "non-neutral-custom", durationSec: 15, segments: script.segments,
      category: injectedCategory, productName: product.name, productCategory: product.category,
      imageRefPath: "/tmp/product.jpg", qualityTier: template.tier,
      format: "talking_head", ugcTemplate: null,
    });
    assert.ok(nonNeutral.shots.some((shot) => shot.prompt.includes(injection)));
  }
});

test("scaffold angka hanya menerima nilai exact planner; disguise field gagal sebelum provider", async () => {
  const template = CAMPAIGN_TEMPLATES.find((item) => item.id === "ads-meja-kosong")!;
  const product = { id: "scaffold", name: "Jasa Uji", price_idr: 189000, category: "jasa" };
  const [script] = await generateScripts({
    product, register: "netral", qualityTier: template.tier, durationSec: 15,
    contentType: "ads", templateId: template.id, count: 1, tanpaLlm: true,
  });
  const base = {
    jobId: "scaffold", durationSec: 15, category: getCreatorCategory("hijaber")!,
    productName: product.name, productCategory: product.category, productPriceIdr: product.price_idr,
    imageRefPath: "/tmp/product.jpg", qualityTier: template.tier,
    format: template.format, ugcTemplate: template.id, shotCountOverride: template.shotCount,
  } as const;
  const safe = planShots({ ...base, segments: script.segments });
  assert.ok(safe.shots.every((shot) => shot.trustedNumericScaffolds?.length));
  assert.ok(safe.shots.flatMap((shot) => buildTaskContent(safe, shot, "dreamina-seedance-2-0-mini-260615")).length > 0);
  const safeProviderPayload = safe.shots.flatMap((shot) => buildTaskContent(
    safe, shot, "dreamina-seedance-2-0-mini-260615"
  ));

  const reordered = structuredClone(script.segments);
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(() => planShots({ ...base, segments: reordered }), /SA3/);
  const duplicate = structuredClone(script.segments);
  duplicate.splice(1, 0, structuredClone(duplicate[0]));
  assert.throws(() => planShots({ ...base, segments: duplicate }), /SA3/);
  const missing = structuredClone(script.segments);
  missing[0].role = "demo";
  missing[0].label = "FRICTION";
  assert.throws(() => planShots({ ...base, segments: missing }), /SA3/);

  let providerCalls = 0;
  for (const length of [0, 1, 2]) {
    assert.throws(() => {
      const spec = planShots({ ...base, contentType: "ads", segments: structuredClone(script.segments).slice(0, length) });
      providerCalls++;
      return buildTaskContent(spec, spec.shots[0], "dreamina-seedance-2-0-mini-260615");
    }, /Story Ads.*(?:5 beat|SA3)/, `${length}: payload pendek mencapai seam provider`);
  }
  assert.equal(providerCalls, 0, "Ads pendek mencapai provider");

  const affiliateSegments = [
    { role: "hook", label: "HOOK", start: 0, end: 4, text: "Eh, hook Affiliate bersuara.", visual_direction: "produk" },
    { role: "demo", label: "BODY", start: 4, end: 10, text: "Aku cek produknya.", visual_direction: "produk" },
    { role: "cta", label: "CTA", start: 10, end: 15, text: "Cek keranjang.", visual_direction: "produk" },
  ] as never;
  assert.doesNotThrow(() => planShots({
    ...base, segments: affiliateSegments, contentType: "affiliate", ugcTemplate: null,
    format: "talking_head", shotCountOverride: 1,
  }), "Affiliate berlabel HOOK tidak boleh dianggap Story Ads");

  for (const disguised of [
    "189000-second offer", "Shot 189000 of 1 offer", "at 189000-189001 seconds offer",
    "15-second", "Shot 1 of 4", "at 3-6 seconds",
  ]) {
    // Kanal lisan memang boleh memuat identitas/nominal yang terbukti, tetapi
    // tidak pernah diteruskan ke model visual neutral Story Ads.
    for (const field of ["text"] as const) {
      const segments = structuredClone(script.segments);
      (segments[1] as unknown as Record<string, string>)[field] = disguised;
      const spec = planShots({ ...base, segments });
      const payload = spec.shots.flatMap((shot) => buildTaskContent(
        spec, shot, "dreamina-seedance-2-0-mini-260615"
      ));
      assert.deepEqual(payload, safeProviderPayload, `${field}: mutasi ucapan mengubah payload visual`);
    }
    for (const field of ["tts_text", "role", "label", "mode", "saksi", "action", "visual_direction", "start_state", "framing", "angle", "camera", "expression"] as const) {
      const segments = structuredClone(script.segments);
      (segments[1] as unknown as Record<string, string>)[field] = field === "action"
        ? `talent membuka kartu blank ${disguised} di meja`
        : disguised;
      assert.throws(() => planShots({ ...base, segments }), /Kontrak/, `${field}: ${disguised}`);
    }
  }
});
