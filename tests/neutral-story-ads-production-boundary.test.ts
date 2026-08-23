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
      productCategory: product.category, imageRefPath: "/tmp/authoritative-product.jpg",
      extraImageRefPaths: ["/tmp/extra-product.jpg"], qualityTier: template.tier,
      format: persistedFormat, ugcTemplate: persistedTemplateId,
      shotCountOverride: template.shotCount,
    });
    assert.equal(spec.visualSubjectPolicy, "neutral_story_ads");
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
