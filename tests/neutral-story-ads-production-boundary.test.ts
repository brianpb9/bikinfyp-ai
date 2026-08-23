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
import { normalisasiFormatWorker } from "../lib/postgres/worker";
import { buildTaskContent } from "../lib/providers/stubs/byteplus";

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
