import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DELIVERY_TAGS } from "../lib/script-engine/delivery-tags";
import {
  SCRIPT_CATALOG_AUDIT_FIXTURE,
  auditProductForTemplate,
  bannedHookBoilerplateStarter,
  danglingFragmentReasons,
  generateCatalogScriptAudit,
  intraHookSemanticEchoReasons,
  mechanicalSpokenPhraseReasons,
  normalizeBestForCategory,
  normalizeAuditText,
  normalizedHookPrefixes,
  proofPriceSkeleton,
  riskyEvidenceClaims,
  spokenCreativeAnalysis,
  spokenProductionJargon,
  unsupportedFactualClaims,
} from "../lib/script-engine/catalog-audit";
import { CAMPAIGN_TEMPLATES, KATALOG_BUTUH_COPY } from "../lib/templates";
import { generateScripts } from "../lib/script-engine";
import { periksaStoryOsAds } from "../lib/script-engine/story-os-ads";
import { COMPACTED_TEMPLATE_IDS } from "../lib/script-engine/template-copy";

const audit = await generateCatalogScriptAudit();
const { summary } = audit;

const AUTHORED_COPY_SNAPSHOT: Record<string, string[]> = {
  "racun-checkout": ["6484cfddc459a814", "c5575d9c9c7d8826", "0fe6dbb747c30d72", "74d613b890569213"],
  "review-jujur": ["8bb47f4b1d3ca292", "6651f93e708e30bc", "2cb54d26ff7c7dea", "237c288bdda522f3"],
  unboxing: ["ce7cdd0391284281", "834e793b77b0d5b9", "5d7729e2367f35b1", "f7430ed8a77e8fa9"],
  "before-after": ["c6cdd1da4a2e87ca", "fe79d6a1e8304fab", "2096d8d004de8b41", "0764caf6653fd7a2"],
  "diskon-gede": ["53ef2a4a896b18a5", "fb7af64ecce4c417", "e7d29fab73fe4550", "43ce1482a5ad74bb"],
  "buat-kamu-yang": ["1551320b1675031b", "4fccecc08d34ce1b", "d24cead7ad8eff8b", "86211dbbce35ed8e"],
  "spill-rahasia": ["21134b501bc3ecd2", "cee27d1267678075", "c9e6ba1cc252189c", "0ecce1b36a001035"],
  "t01-tempat-susah": ["0f25a3f507eee336", "eae08e283012cb29", "289149dbb08865bf", "e1f9e79239191ed0"],
  "t02-bedah-fitur": ["d2df54ab86f1cdb0", "fce5dbe724309a96", "26a5b21296ceff46", "1b98ce981ffed5fd"],
  "t03-liputan-event": ["a79c517906d545b2", "34210aa3fead3651", "8ef5a2ea59013dbb", "bd1257a959c97d0c"],
  "t04-hook-indrawi": ["66dbcb984e12f2ad", "c97ad8a822e81e42", "fee794df6c5bba7e", "f8ca6d2a7a9dc78d"],
  "t07-checklist-berjalan": ["153f4f05d5290914", "2c95c172c992736d", "802906857346f818", "c8ca64d35c9f8d83"],
  "t09-bahan-aktif": ["f7b8d72e75bdb6ac", "0c89d79923fe6c9c", "0ff1d991acffd261", "9f1d03aee94a2b08"],
  "t10-bukti-di-lengan": ["e65ffdc01c65a363", "50d19844639acac3", "c60161149ea263f0", "3a90e1c223b74c16"],
  "t12-vox-pop": ["6d1c531a760cf89b", "3c76a0c73ef9af6b", "2f40edb84997bff2", "94c1aaa2f32668c5"],
  "kenalin-bisnis": ["94a72e8790ffe713", "b09eb6ed71232038", "cbbedd50c3a68066", "a48fa5f3061179e4"],
  "promo-terbatas": ["8527ef44f7259489", "b73df90d6301bb2e", "15f03ee6edaec8f7", "d9de026b6fe8ba0c"],
  "tvc-the-drop": ["5700da534b4af017", "e3f10a687ebf3c15", "8aa3c5cbcc216dcc", "3089925d4e852d55"],
  "tvc-tersangka": ["20e7f08886154547", "f0526370752aa98d", "6846ae0dc194b4ba", "12386f1a152e7b6f"],
  "tvc-seharian": ["c5e8c022d6d7e21d", "3a1ad1a56b06ea5d", "69c9605b347382a0", "6b6aca290aae4aa0"],
  "tvc-kain-lari": ["89cf1d36bfa3183e", "713bcd021d5d3daa", "1d8bf33a00ed55ab", "f72e9ad89c652c37"],
  "tvc-jam-tiga": ["6e0bd949c961447d", "ff64ef322319728b", "b1726eafe3cda348", "54a502183e7d551b"],
};

test("snapshot seluruh copy authored mengunci 22 template x 4 varian tanpa pemotongan token", () => {
  assert.deepEqual([...COMPACTED_TEMPLATE_IDS].sort(), Object.keys(AUTHORED_COPY_SNAPSHOT).sort());
  const actual = Object.fromEntries(audit.templates
    .filter((template) => COMPACTED_TEMPLATE_IDS.has(template.templateId))
    .map((template) => [template.templateId, template.variants.map((variant) => createHash("sha256")
      .update(variant.segments.map((segment) => `${segment.role}:${segment.text}`).join("|"))
      .digest("hex").slice(0, 16))]));
  assert.deepEqual(actual, AUTHORED_COPY_SNAPSHOT);
});

test("copy authored selalu berupa kalimat utuh dan delivery tag tidak bocor ke spoken text", () => {
  for (const template of audit.templates.filter((item) => COMPACTED_TEMPLATE_IDS.has(item.templateId))) {
    for (const variant of template.variants) for (const segment of variant.segments) {
      assert.deepEqual(danglingFragmentReasons(segment.text), [], `${template.templateId}#${variant.variantIndex}: ${segment.text}`);
      assert.doesNotMatch(segment.text, /\[[^\]]+\]/, `${template.templateId}#${variant.variantIndex}: delivery tag bocor`);
      if (segment.role !== "cta") {
        assert.match(segment.text, /[.!?]$/, `${template.templateId}#${variant.variantIndex}: kalimat tidak selesai`);
      }
    }
  }
});

test("whitelist delivery Gemini terkunci ke tag yang disepakati", async () => {
  assert.deepEqual([...DELIVERY_TAGS], [
    "[short pause]",
    "[medium pause]",
    "[long pause]",
    "[giggles]",
    "[laughs]",
    "[slow]",
    "[fast]",
    "[whispers]",
    "[excited]",
    "[serious]",
  ]);
});

test("normalisasi menetralkan nama produk dan bentuk harga fixture", async () => {
  const angka = normalizeAuditText("Mosseru Bright Shower Gel cuma Rp 189.000!");
  const kata = normalizeAuditText("MOSseru bright shower gel cuma 189 ribu");
  assert.equal(angka, kata);
  assert.equal(angka, "placeholder produk cuma placeholder harga");
});

test("normalisasi uniqueness membuang delivery tag Gemini", async () => {
  assert.equal(
    normalizeAuditText("Nah, [short pause] ini baru beda. [giggles] Serius."),
    normalizeAuditText("Nah, ini baru beda. Serius.")
  );
});

test("fixture audit mencakup tepat 33 template katalog aktif", async () => {
  assert.equal(summary.templateCount, SCRIPT_CATALOG_AUDIT_FIXTURE.expectedTemplateCount);
});

test("fixture tiap template mengikuti kategori bestFor yang dinormalisasi", async () => {
  assert.deepEqual(summary.incompatibleFixtureTemplateIds, []);
  for (const template of CAMPAIGN_TEMPLATES) {
    assert.equal(
      auditProductForTemplate(template).category,
      normalizeBestForCategory(template.bestFor[0] ?? "default"),
      template.id
    );
  }
});

test("guard bahasa mengenali jargon produksi, klaim tanpa data, dan fragmen menggantung", async () => {
  assert.deepEqual(spokenProductionJargon("Kunci framing kameranya lalu edit hasilnya"), ["kameranya", "framing", "edit"]);
  assert.ok(unsupportedFactualClaims("Setelah Serum Uji Katalog dipakai, ruang terasa beda").length > 0);
  assert.deepEqual(danglingFragmentReasons("Cek produknya karena"), ["ends with connector"]);
  assert.deepEqual(danglingFragmentReasons("Cek detail produknya dulu ya"), []);
  assert.ok(unsupportedFactualClaims("Aku suka kelebihannya, segelnya terbuka mulus dan terasa ringkas").length >= 3);
  assert.deepEqual(spokenCreativeAnalysis("Pembukanya memberi kejutan dan efek dramatis"), ["kejutan", "pembukanya", "efek dramatis"]);
  assert.ok(riskyEvidenceClaims("t05-before-after", "Setelah dipakai, hasil akhirnya berubah").length > 0);
  assert.ok(riskyEvidenceClaims("t08-day-1-vs-day-7", "Hari ketujuh menunjukkan hasil setelah rutinitas").length > 0);
  assert.ok(riskyEvidenceClaims("t10-bukti-di-lengan", "Dua lengan menunjukkan hasil yang beda").length > 0);
  assert.deepEqual(riskyEvidenceClaims("t05-before-after", "Lihat dua sisi dan nilai atributnya"), []);
  assert.ok(proofPriceSkeleton("Teksturnya terlihat, harganya 189 ribu")?.includes("placeholder_bukti"));
  assert.deepEqual(bannedHookBoilerplateStarter("[fast] Di harga 189 ribu, lihat ini"), ["di harga"]);
  assert.deepEqual(normalizedHookPrefixes("[fast] Di harga 189 ribu, lihat ini").slice(0, 2), [
    "di harga", "di harga placeholder",
  ]);
  assert.ok(spokenCreativeAnalysis("Jangan mengarang keramaian atau menjanjikan pengalaman orang lain").length >= 2);
  assert.ok(spokenCreativeAnalysis("Rincian manfaat tidak tersedia; tidak perlu dibuat seolah diketahui").length >= 2);
  assert.deepEqual(unsupportedFactualClaims("Kualitasnya cocok buat semua orang").sort(), ["cocok buat", "kualitasnya cocok"]);
  assert.ok(unsupportedFactualClaims("Produknya jatuh keras, tetapi masih utuh").includes("jatuh keras, tetapi masih utuh"));
  assert.ok(unsupportedFactualClaims("Masih utuh setelah terbentur meja").includes("masih utuh setelah terbentur"));
  assert.ok(intraHookSemanticEchoReasons("Nah, lihat detailnya, eh detail itu perlu diperhatikan").length > 0);
  assert.deepEqual(intraHookSemanticEchoReasons("Nah, dengarkan bunyinya, eh sekarang cek bahannya"), []);
  assert.ok(mechanicalSpokenPhraseReasons("Cek berkas produk di keranjang ya", "cta").includes("berkas produk"));
  assert.ok(mechanicalSpokenPhraseReasons("Cek detail, buka rincian, lalu lihat keranjang ya", "cta").includes("stacked mechanical CTA actions"));
  for (const phrase of [
    "Ini tidak menjelaskan fungsi",
    "Pisahkan kesan visual dari manfaat",
    "Ini bukan bukti dan bukan janji",
    "Jika manfaat tidak tertulis, jangan disebut",
  ]) {
    assert.ok(spokenCreativeAnalysis(phrase).length > 0, `meta-policy lolos: ${phrase}`);
  }
});

test("33/33 template mempunyai copy khusus", async () => {
  assert.equal(
    summary.templatesWithCopy,
    SCRIPT_CATALOG_AUDIT_FIXTURE.expectedTemplateCount,
    `template tanpa copy: ${summary.templatesMissingCopy.join(", ")}`
  );
});

test("33/33 fixed hook unik setelah normalisasi", async () => {
  assert.equal(summary.fixedHookCount, SCRIPT_CATALOG_AUDIT_FIXTURE.expectedFixedHookCount);
  assert.equal(
    summary.uniqueFixedHookCount,
    SCRIPT_CATALOG_AUDIT_FIXTURE.expectedFixedHookCount,
    `fixed hook unik hanya ${summary.uniqueFixedHookCount}/${summary.fixedHookCount}`
  );
});

test("132/132 hook count=4 unik setelah normalisasi", async () => {
  assert.equal(summary.totalHookCount, SCRIPT_CATALOG_AUDIT_FIXTURE.expectedTotalHookCount);
  assert.equal(
    summary.uniqueTotalHookCount,
    SCRIPT_CATALOG_AUDIT_FIXTURE.expectedTotalHookCount,
    `hook unik hanya ${summary.uniqueTotalHookCount}/${summary.totalHookCount}`
  );
});

test("harga render maksimal muncul di 33/132 hook dan 8/33 fixed hook", async () => {
  assert.ok(
    summary.hooksMentioningPriceCount <= SCRIPT_CATALOG_AUDIT_FIXTURE.maximumHookPriceMentions,
    `hook menyebut harga ${summary.hooksMentioningPriceCount}/${summary.totalHookCount}; batas ${SCRIPT_CATALOG_AUDIT_FIXTURE.maximumHookPriceMentions}`
  );
  assert.ok(
    summary.fixedHooksMentioningPriceCount <= SCRIPT_CATALOG_AUDIT_FIXTURE.maximumFixedHookPriceMentions,
    `fixed hook menyebut harga ${summary.fixedHooksMentioningPriceCount}/${summary.fixedHookCount}; batas ${SCRIPT_CATALOG_AUDIT_FIXTURE.maximumFixedHookPriceMentions}`
  );
});

test("hook bebas starter harga boilerplate dan prefix bersama di atas cap", async () => {
  assert.deepEqual(
    summary.bannedBoilerplateHookRefs,
    [],
    `starter boilerplate: ${summary.bannedBoilerplateHookRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
  assert.deepEqual(
    summary.sharedHookPrefixes,
    [],
    `prefix dipakai >${SCRIPT_CATALOG_AUDIT_FIXTURE.maximumTemplatesPerSharedHookPrefix} template: ${summary.sharedHookPrefixes.map((item) => `${item.prefix} => ${item.templateIds.join("/")}`).join("; ")}`
  );
});

test("hook tidak mengulang makna yang sama di dua klausa", async () => {
  assert.deepEqual(
    summary.intraHookEchoRefs,
    [],
    `echo semantik: ${summary.intraHookEchoRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
});

test("spoken copy bebas CTA mekanis, berkas produk, dan pola aksi/subjek berulang", async () => {
  assert.deepEqual(
    summary.mechanicalPhraseRefs,
    [],
    `frasa mekanis: ${summary.mechanicalPhraseRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
});

test("seluruh empat varian menghasilkan minimal 150 segment-sentence unik", async () => {
  assert.ok(
    summary.uniqueSegmentSentenceCount >= SCRIPT_CATALOG_AUDIT_FIXTURE.minimumUniqueSegmentSentences,
    `segment-sentence unik hanya ${summary.uniqueSegmentSentenceCount}/${SCRIPT_CATALOG_AUDIT_FIXTURE.minimumUniqueSegmentSentences}`
  );
});

test("body expansion menghasilkan minimal 100 demo+CTA unik tanpa mengandalkan hook", async () => {
  assert.ok(
    summary.uniqueNonHookSegmentSentenceCount >= SCRIPT_CATALOG_AUDIT_FIXTURE.minimumUniqueNonHookSegmentSentences,
    `demo+CTA unik hanya ${summary.uniqueNonHookSegmentSentenceCount}/${SCRIPT_CATALOG_AUDIT_FIXTURE.minimumUniqueNonHookSegmentSentences}`
  );
});

test("body tidak near-duplicate lintas template", async () => {
  assert.deepEqual(
    summary.nearDuplicateBodyPairs,
    [],
    `body near-duplicate: ${summary.nearDuplicateBodyPairs.map((pair) => `${pair.left.templateId}#${pair.left.variantIndex} ~ ${pair.right.templateId}#${pair.right.variantIndex} (${pair.score})`).join("; ")}`
  );
});

test("body tidak berbagi blok enam kata lintas template", async () => {
  assert.deepEqual(
    summary.sharedBodyBlocks,
    [],
    `blok body dipakai ulang: ${summary.sharedBodyBlocks.map((item) => `${item.block} => ${item.templateIds.join("/")}`).join("; ")}`
  );
});

test("spoken script bebas jargon produksi", async () => {
  assert.deepEqual(
    summary.productionJargonRefs,
    [],
    `jargon produksi: ${summary.productionJargonRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
});

test("spoken script bebas klaim faktual yang tidak ditopang input produk", async () => {
  assert.deepEqual(
    summary.unsupportedClaimRefs,
    [],
    `klaim tanpa data: ${summary.unsupportedClaimRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
});

test("maksimal 66 dari 132 demo menyebut harga render", async () => {
  assert.ok(
    summary.demosMentioningPriceCount <= SCRIPT_CATALOG_AUDIT_FIXTURE.maximumDemoPriceMentions,
    `demo menyebut harga ${summary.demosMentioningPriceCount}/${SCRIPT_CATALOG_AUDIT_FIXTURE.expectedTotalHookCount}; batas ${SCRIPT_CATALOG_AUDIT_FIXTURE.maximumDemoPriceMentions}`
  );
});

test("skeleton proof-slot + harga generik maksimal 20 persen dan tidak dibagi lintas template", async () => {
  assert.ok(
    summary.proofPriceSkeletonCount <= summary.maximumProofPriceSkeletonCount,
    `proof+price skeleton ${summary.proofPriceSkeletonCount}; batas ${summary.maximumProofPriceSkeletonCount}`
  );
  assert.deepEqual(
    summary.repeatedProofPriceSkeletons,
    [],
    `skeleton dipakai lintas template: ${summary.repeatedProofPriceSkeletons.map((item) => `${item.skeleton} => ${item.refs.join("/")}`).join("; ")}`
  );
});

test("spoken VO tidak mengomentari mekanik kreatif iklannya sendiri", async () => {
  assert.deepEqual(
    summary.creativeAnalysisRefs,
    [],
    `analisis kreatif terucap: ${summary.creativeAnalysisRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
});

test("T05 T08 T10 hanya inspeksi atribut netral, bukan bukti perubahan sintetis", async () => {
  assert.deepEqual(
    summary.semanticRiskRefs,
    [],
    `risiko bukti sintetis: ${summary.semanticRiskRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
});

test("tidak ada fragmen kalimat menggantung", async () => {
  assert.deepEqual(
    summary.danglingFragmentRefs,
    [],
    `fragmen menggantung: ${summary.danglingFragmentRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
});

test("count=4 memberi empat demo berbeda pada setiap template", async () => {
  assert.equal(
    summary.count4DemoDuplicateFailures,
    0,
    `template dengan demo berulang: ${summary.count4DemoFailureTemplateIds.join(", ")}`
  );
});

test("CTA tidak exact-repeat lintas template setelah frasa platform dinetralkan", async () => {
  assert.equal(
    summary.crossTemplateCtaDuplicatePairs.length,
    0,
    `CTA dipakai lintas template: ${summary.crossTemplateCtaDuplicatePairs.map((item) => `${item.normalizedCta} => ${item.templateIds.join("/")}`).join("; ")}`
  );
});

test("delivery voiced punya minimal dua tag, silent tanpa tts_text, dan tidak ada unknown tag", async () => {
  assert.equal(
    summary.deliveryFailureVariants,
    0,
    `delivery gagal: ${summary.deliveryFailureRefs.map((item) => `${item.templateId}#${item.variantIndex} (${item.failureReasons.join("; ")})`).join(", ")}`
  );
  assert.deepEqual(summary.unknownAudioTagRefs, []);
});

test("inventaris voiced benar-benar memakai seluruh delivery tag", async () => {
  assert.deepEqual(
    summary.missingDeliveryTags,
    [],
    `tag belum pernah dipakai: ${summary.missingDeliveryTags.join(", ")}; distribusi=${JSON.stringify(summary.deliveryTagDistribution)}`
  );
  for (const tag of DELIVERY_TAGS) {
    assert.ok(summary.deliveryTagDistribution[tag] > 0, `${tag} ada di whitelist tetapi tidak pernah dipakai`);
  }
});

test("setiap template voiced punya minimal satu cue emphasis di empat variannya", async () => {
  assert.deepEqual(
    summary.missingEmphasisCueTemplateIds,
    [],
    `template tanpa [excited]/[serious]: ${summary.missingEmphasisCueTemplateIds.join(", ")}; coverage=${summary.voicedTemplatesWithEmphasisCue}`
  );
  assert.ok(summary.emphasisCueCount > 0, "inventaris emphasis kosong");
});

test("empat varian tiap template voiced punya empat delivery-tag signature unik", async () => {
  assert.deepEqual(
    summary.deliverySignatureFailureTemplateIds,
    [],
    `signature delivery berulang: ${summary.deliverySignatureFailureTemplateIds.join(", ")}`
  );
  for (const template of audit.templates.filter((item) => item.configuration.tier !== "silent_caption")) {
    assert.equal(
      template.uniqueDeliveryTagSignatureCount,
      SCRIPT_CATALOG_AUDIT_FIXTURE.variantsPerTemplate,
      `${template.templateId}: ${template.deliveryTagSignatures.join(" || ")}`
    );
  }
});

test("count=4 tidak mengulang hook atau naskah pada template mana pun", async () => {
  assert.equal(
    summary.count4DuplicateFailures,
    0,
    `template gagal count=4: ${summary.count4FailureTemplateIds.join(", ")}`
  );
});

test("132/132 varian katalog lolos validator tanpa daftar utang", async () => {
  assert.equal(summary.validationFailureRefs.length, 0,
    summary.validationFailureRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}: ${ref.errors.map((e) => e.rule).join(",")}`).join("; "));
  assert.equal(summary.targets.everyVariantPassesValidation, true);
  assert.deepEqual([...KATALOG_BUTUH_COPY], []);
});

test("seluruh aturan yang dulu dikecualikan sekarang tepat nol", async () => {
  for (const rule of [
    "L-05", "L-19", "A-01", "A-02", "S-04", "S-09",
    "SA1", "SA2", "SA4", "SA6", "SA8",
  ]) {
    const refs = summary.validationFailureRefs.filter((ref) => ref.errors.some((error) => error.rule === rule));
    assert.deepEqual(refs, [], `${rule} kembali menjadi utang: ${refs.map((ref) => `${ref.templateId}#${ref.variantIndex}`).join(", ")}`);
  }
});

test("seluruh copy Ads membawa beat utuh, ringkas, dan SPIKE kanonik sampai hasil generator", async () => {
  const adsTemplates = CAMPAIGN_TEMPLATES.filter((item) => item.group === "ads");
  assert.equal(adsTemplates.length, 9);
  for (const template of adsTemplates) {
    const variants = await generateScripts({
      product: auditProductForTemplate(template), register: "bunda", tanpaLlm: true,
      contentType: "ads", qualityTier: template.tier as never,
      durationSec: template.durationSec, templateId: template.id,
      count: 4, hookFamilies: [template.hookFamily as never], lockHookFamily: true,
    });
    for (const variant of variants) {
      assert.deepEqual(variant.segments.map((segment) => segment.label), ["HOOK", "FRICTION", "FRICTION", "SPIKE", "BUTTON"]);
      assert.equal(variant.segments.filter((segment) => segment.role === "demo").length, 1);
      for (const segment of variant.segments.filter((item) => item.label === "FRICTION" || item.label === "SPIKE")) {
        const words = segment.text.replace(/\[[^\]]+\]/g, "").trim().split(/\s+/).filter(Boolean);
        assert.ok(words.length <= 8, `${template.id} ${segment.label} terlalu panjang: ${segment.text}`);
        assert.ok(words.length >= 2, `${template.id} ${segment.label} bukan kalimat utuh: ${segment.text}`);
        assert.match(segment.text, /[.!?]$/, `${template.id} ${segment.label} tidak selesai: ${segment.text}`);
      }
      const spike = variant.segments.find((segment) => segment.label === "SPIKE")!;
      const ratio = spike.start / template.durationSec;
      assert.ok(ratio >= 0.65 && ratio <= 0.8, `${template.id} SPIKE mulai ${Math.round(ratio * 100)}%`);
      assert.equal(variant.validation.passed, true, JSON.stringify(variant.validation.errors));
    }
  }
});

test("Ads kategori layanan memakai aksi dashboard nonfisik", async () => {
  const template = CAMPAIGN_TEMPLATES.find((item) => item.id === "ads-meja-kosong")!;
  const [variant] = await generateScripts({
    product: { ...auditProductForTemplate(template), category: "app" }, register: "bunda", tanpaLlm: true,
    contentType: "ads", qualityTier: template.tier as never,
    durationSec: template.durationSec, templateId: template.id,
    count: 1, hookFamilies: [template.hookFamily as never], lockHookFamily: true,
  });
  const actions = variant.segments.map((segment) => segment.action ?? "").join(" ");
  assert.match(actions, /dashboard|status layanan|jadwal|antrean/);
  assert.doesNotMatch(actions, /pegang produk|putar produk|produk berpindah|buka sisi produk/);
  assert.equal(variant.validation.passed, true, JSON.stringify(variant.validation.errors));
});

test("mutasi beat Ads yang menghapus SPIKE dan BUTTON kembali ditolak", async () => {
  const template = CAMPAIGN_TEMPLATES.find((item) => item.id === "ads-unboxing-pov")!;
  const [variant] = await generateScripts({
    product: auditProductForTemplate(template), register: "bunda", tanpaLlm: true,
    contentType: "ads", qualityTier: template.tier as never,
    durationSec: template.durationSec, templateId: template.id,
    count: 1, hookFamilies: [template.hookFamily as never], lockHookFamily: true,
  });
  const mutated = variant.segments.map((segment) => ({ ...segment }));
  const spike = mutated.find((segment) => segment.label === "SPIKE")!;
  spike.label = "FRICTION";
  mutated[mutated.length - 1].text = "Beli sekarang ya";
  const rules = periksaStoryOsAds({ segments: mutated as never }, { contentType: "ads", durationSec: template.durationSec })
    .map((finding) => finding.gerbang);
  assert.ok(rules.includes("SA1"), `BUTTON rusak tidak ditangkap: ${rules.join(",")}`);
  assert.ok(rules.includes("SA2"), `SPIKE hilang tidak ditangkap: ${rules.join(",")}`);
});



test("daftar KATALOG_BUTUH_COPY cocok dengan kenyataan audit", async () => {
  // Daftar yang ditulis tangan akan basi diam-diam. Ini yang menahannya:
  // begitu satu template copynya ditulis ulang sampai ada varian yang lolos,
  // tes ini merah sampai daftarnya diperbarui.
  const nyata = audit.templates
    .filter((t) => !t.variants.some((v) => v.validation.passed))
    .map((t) => t.templateId)
    .sort();
  assert.deepEqual([...KATALOG_BUTUH_COPY].sort(), nyata);
});
