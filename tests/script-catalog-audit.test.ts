import { test } from "node:test";
import assert from "node:assert/strict";
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
import { CAMPAIGN_TEMPLATES } from "../lib/templates";

const audit = generateCatalogScriptAudit();
const { summary } = audit;

test("whitelist delivery Gemini terkunci ke tag yang disepakati", () => {
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

test("normalisasi menetralkan nama produk dan bentuk harga fixture", () => {
  const angka = normalizeAuditText("Mosseru Bright Shower Gel cuma Rp 189.000!");
  const kata = normalizeAuditText("MOSseru bright shower gel cuma 189 ribu");
  assert.equal(angka, kata);
  assert.equal(angka, "placeholder produk cuma placeholder harga");
});

test("normalisasi uniqueness membuang delivery tag Gemini", () => {
  assert.equal(
    normalizeAuditText("Nah, [short pause] ini baru beda. [giggles] Serius."),
    normalizeAuditText("Nah, ini baru beda. Serius.")
  );
});

test("fixture audit mencakup tepat 33 template katalog aktif", () => {
  assert.equal(summary.templateCount, SCRIPT_CATALOG_AUDIT_FIXTURE.expectedTemplateCount);
});

test("fixture tiap template mengikuti kategori bestFor yang dinormalisasi", () => {
  assert.deepEqual(summary.incompatibleFixtureTemplateIds, []);
  for (const template of CAMPAIGN_TEMPLATES) {
    assert.equal(
      auditProductForTemplate(template).category,
      normalizeBestForCategory(template.bestFor[0] ?? "default"),
      template.id
    );
  }
});

test("guard bahasa mengenali jargon produksi, klaim tanpa data, dan fragmen menggantung", () => {
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

test("33/33 template mempunyai copy khusus", () => {
  assert.equal(
    summary.templatesWithCopy,
    SCRIPT_CATALOG_AUDIT_FIXTURE.expectedTemplateCount,
    `template tanpa copy: ${summary.templatesMissingCopy.join(", ")}`
  );
});

test("33/33 fixed hook unik setelah normalisasi", () => {
  assert.equal(summary.fixedHookCount, SCRIPT_CATALOG_AUDIT_FIXTURE.expectedFixedHookCount);
  assert.equal(
    summary.uniqueFixedHookCount,
    SCRIPT_CATALOG_AUDIT_FIXTURE.expectedFixedHookCount,
    `fixed hook unik hanya ${summary.uniqueFixedHookCount}/${summary.fixedHookCount}`
  );
});

test("132/132 hook count=4 unik setelah normalisasi", () => {
  assert.equal(summary.totalHookCount, SCRIPT_CATALOG_AUDIT_FIXTURE.expectedTotalHookCount);
  assert.equal(
    summary.uniqueTotalHookCount,
    SCRIPT_CATALOG_AUDIT_FIXTURE.expectedTotalHookCount,
    `hook unik hanya ${summary.uniqueTotalHookCount}/${summary.totalHookCount}`
  );
});

test("harga render maksimal muncul di 33/132 hook dan 8/33 fixed hook", () => {
  assert.ok(
    summary.hooksMentioningPriceCount <= SCRIPT_CATALOG_AUDIT_FIXTURE.maximumHookPriceMentions,
    `hook menyebut harga ${summary.hooksMentioningPriceCount}/${summary.totalHookCount}; batas ${SCRIPT_CATALOG_AUDIT_FIXTURE.maximumHookPriceMentions}`
  );
  assert.ok(
    summary.fixedHooksMentioningPriceCount <= SCRIPT_CATALOG_AUDIT_FIXTURE.maximumFixedHookPriceMentions,
    `fixed hook menyebut harga ${summary.fixedHooksMentioningPriceCount}/${summary.fixedHookCount}; batas ${SCRIPT_CATALOG_AUDIT_FIXTURE.maximumFixedHookPriceMentions}`
  );
});

test("hook bebas starter harga boilerplate dan prefix bersama di atas cap", () => {
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

test("hook tidak mengulang makna yang sama di dua klausa", () => {
  assert.deepEqual(
    summary.intraHookEchoRefs,
    [],
    `echo semantik: ${summary.intraHookEchoRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
});

test("spoken copy bebas CTA mekanis, berkas produk, dan pola aksi/subjek berulang", () => {
  assert.deepEqual(
    summary.mechanicalPhraseRefs,
    [],
    `frasa mekanis: ${summary.mechanicalPhraseRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
});

test("seluruh empat varian menghasilkan minimal 150 segment-sentence unik", () => {
  assert.ok(
    summary.uniqueSegmentSentenceCount >= SCRIPT_CATALOG_AUDIT_FIXTURE.minimumUniqueSegmentSentences,
    `segment-sentence unik hanya ${summary.uniqueSegmentSentenceCount}/${SCRIPT_CATALOG_AUDIT_FIXTURE.minimumUniqueSegmentSentences}`
  );
});

test("body expansion menghasilkan minimal 100 demo+CTA unik tanpa mengandalkan hook", () => {
  assert.ok(
    summary.uniqueNonHookSegmentSentenceCount >= SCRIPT_CATALOG_AUDIT_FIXTURE.minimumUniqueNonHookSegmentSentences,
    `demo+CTA unik hanya ${summary.uniqueNonHookSegmentSentenceCount}/${SCRIPT_CATALOG_AUDIT_FIXTURE.minimumUniqueNonHookSegmentSentences}`
  );
});

test("body tidak near-duplicate lintas template", () => {
  assert.deepEqual(
    summary.nearDuplicateBodyPairs,
    [],
    `body near-duplicate: ${summary.nearDuplicateBodyPairs.map((pair) => `${pair.left.templateId}#${pair.left.variantIndex} ~ ${pair.right.templateId}#${pair.right.variantIndex} (${pair.score})`).join("; ")}`
  );
});

test("body tidak berbagi blok enam kata lintas template", () => {
  assert.deepEqual(
    summary.sharedBodyBlocks,
    [],
    `blok body dipakai ulang: ${summary.sharedBodyBlocks.map((item) => `${item.block} => ${item.templateIds.join("/")}`).join("; ")}`
  );
});

test("spoken script bebas jargon produksi", () => {
  assert.deepEqual(
    summary.productionJargonRefs,
    [],
    `jargon produksi: ${summary.productionJargonRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
});

test("spoken script bebas klaim faktual yang tidak ditopang input produk", () => {
  assert.deepEqual(
    summary.unsupportedClaimRefs,
    [],
    `klaim tanpa data: ${summary.unsupportedClaimRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
});

test("maksimal 66 dari 132 demo menyebut harga render", () => {
  assert.ok(
    summary.demosMentioningPriceCount <= SCRIPT_CATALOG_AUDIT_FIXTURE.maximumDemoPriceMentions,
    `demo menyebut harga ${summary.demosMentioningPriceCount}/${SCRIPT_CATALOG_AUDIT_FIXTURE.expectedTotalHookCount}; batas ${SCRIPT_CATALOG_AUDIT_FIXTURE.maximumDemoPriceMentions}`
  );
});

test("skeleton proof-slot + harga generik maksimal 20 persen dan tidak dibagi lintas template", () => {
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

test("spoken VO tidak mengomentari mekanik kreatif iklannya sendiri", () => {
  assert.deepEqual(
    summary.creativeAnalysisRefs,
    [],
    `analisis kreatif terucap: ${summary.creativeAnalysisRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
});

test("T05 T08 T10 hanya inspeksi atribut netral, bukan bukti perubahan sintetis", () => {
  assert.deepEqual(
    summary.semanticRiskRefs,
    [],
    `risiko bukti sintetis: ${summary.semanticRiskRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
});

test("tidak ada fragmen kalimat menggantung", () => {
  assert.deepEqual(
    summary.danglingFragmentRefs,
    [],
    `fragmen menggantung: ${summary.danglingFragmentRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}:${ref.matches.join("/")}`).join(", ")}`
  );
});

test("count=4 memberi empat demo berbeda pada setiap template", () => {
  assert.equal(
    summary.count4DemoDuplicateFailures,
    0,
    `template dengan demo berulang: ${summary.count4DemoFailureTemplateIds.join(", ")}`
  );
});

test("CTA tidak exact-repeat lintas template setelah frasa platform dinetralkan", () => {
  assert.equal(
    summary.crossTemplateCtaDuplicatePairs.length,
    0,
    `CTA dipakai lintas template: ${summary.crossTemplateCtaDuplicatePairs.map((item) => `${item.normalizedCta} => ${item.templateIds.join("/")}`).join("; ")}`
  );
});

test("delivery voiced punya minimal dua tag, silent tanpa tts_text, dan tidak ada unknown tag", () => {
  assert.equal(
    summary.deliveryFailureVariants,
    0,
    `delivery gagal: ${summary.deliveryFailureRefs.map((item) => `${item.templateId}#${item.variantIndex} (${item.failureReasons.join("; ")})`).join(", ")}`
  );
  assert.deepEqual(summary.unknownAudioTagRefs, []);
});

test("inventaris voiced benar-benar memakai seluruh delivery tag", () => {
  assert.deepEqual(
    summary.missingDeliveryTags,
    [],
    `tag belum pernah dipakai: ${summary.missingDeliveryTags.join(", ")}; distribusi=${JSON.stringify(summary.deliveryTagDistribution)}`
  );
  for (const tag of DELIVERY_TAGS) {
    assert.ok(summary.deliveryTagDistribution[tag] > 0, `${tag} ada di whitelist tetapi tidak pernah dipakai`);
  }
});

test("setiap template voiced punya minimal satu cue emphasis di empat variannya", () => {
  assert.deepEqual(
    summary.missingEmphasisCueTemplateIds,
    [],
    `template tanpa [excited]/[serious]: ${summary.missingEmphasisCueTemplateIds.join(", ")}; coverage=${summary.voicedTemplatesWithEmphasisCue}`
  );
  assert.ok(summary.emphasisCueCount > 0, "inventaris emphasis kosong");
});

test("empat varian tiap template voiced punya empat delivery-tag signature unik", () => {
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

test("count=4 tidak mengulang hook atau naskah pada template mana pun", () => {
  assert.equal(
    summary.count4DuplicateFailures,
    0,
    `template gagal count=4: ${summary.count4FailureTemplateIds.join(", ")}`
  );
});

test("semua 132 varian lolos validator pada konfigurasi template aktual", () => {
  assert.equal(
    summary.validationFailureVariants,
    0,
    `varian gagal validasi: ${summary.validationFailureRefs.map((ref) => `${ref.templateId}#${ref.variantIndex}`).join(", ")}`
  );
});
