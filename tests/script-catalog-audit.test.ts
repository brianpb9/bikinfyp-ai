import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DELIVERY_TAGS } from "../lib/script-engine/delivery-tags";
import {
  SCRIPT_CATALOG_AUDIT_FIXTURE,
  adsStayOutcomeNeutral,
  adsVisualContractFindings,
  adsProviderReferenceFindings,
  adsUnsupportedOutcomeFindings,
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
  unsupportedAdsOutcomeClaims,
  unsupportedFactualClaims,
} from "../lib/script-engine/catalog-audit";
import { CAMPAIGN_TEMPLATES, KATALOG_BUTUH_COPY } from "../lib/templates";
import { generateScripts } from "../lib/script-engine";
import { periksaStoryOsAds } from "../lib/script-engine/story-os-ads";
import { COMPACTED_TEMPLATE_IDS } from "../lib/script-engine/template-copy";
import { UGC_TEMPLATE_ROLES } from "../lib/media/ugc-template-roles";
import {
  neutralStoryAdsActionContradictions,
  neutralStoryAdsPromptContradictions,
} from "../lib/script-engine/ads-visual-contract";
import { planShots } from "../lib/media/shot-planner";
import { getCreatorCategory } from "../lib/personas";
import { assertVisualSpec } from "../lib/providers/types";
import { buildTaskContent } from "../lib/providers/stubs/byteplus";

const audit = await generateCatalogScriptAudit();
const { summary } = audit;

const AUTHORED_COPY_SNAPSHOT: Record<string, string[]> = {
  "racun-checkout": ["6484cfddc459a814", "c5575d9c9c7d8826", "0fe6dbb747c30d72", "74d613b890569213"],
  "review-jujur": ["8bb47f4b1d3ca292", "6651f93e708e30bc", "2cb54d26ff7c7dea", "237c288bdda522f3"],
  unboxing: ["ce7cdd0391284281", "834e793b77b0d5b9", "5d7729e2367f35b1", "f7430ed8a77e8fa9"],
  "before-after": ["0b8a4238771d7842", "1bcf040bd291d035", "5d24902c57798b81", "c740711a364237d5"],
  "diskon-gede": ["53ef2a4a896b18a5", "fb7af64ecce4c417", "e7d29fab73fe4550", "43ce1482a5ad74bb"],
  "buat-kamu-yang": ["1551320b1675031b", "4fccecc08d34ce1b", "d24cead7ad8eff8b", "86211dbbce35ed8e"],
  "spill-rahasia": ["21134b501bc3ecd2", "cee27d1267678075", "c9e6ba1cc252189c", "0ecce1b36a001035"],
  "t01-tempat-susah": ["0f25a3f507eee336", "eae08e283012cb29", "289149dbb08865bf", "e1f9e79239191ed0"],
  "t02-bedah-fitur": ["d2df54ab86f1cdb0", "fce5dbe724309a96", "26a5b21296ceff46", "1b98ce981ffed5fd"],
  "t03-liputan-event": ["a79c517906d545b2", "34210aa3fead3651", "8ef5a2ea59013dbb", "bd1257a959c97d0c"],
  "t04-hook-indrawi": ["66dbcb984e12f2ad", "c97ad8a822e81e42", "fee794df6c5bba7e", "f8ca6d2a7a9dc78d"],
  "t07-checklist-berjalan": ["153f4f05d5290914", "2c95c172c992736d", "802906857346f818", "c8ca64d35c9f8d83"],
  "t09-bahan-aktif": ["f7b8d72e75bdb6ac", "0c89d79923fe6c9c", "0ff1d991acffd261", "9f1d03aee94a2b08"],
  "t10-bukti-di-lengan": ["cb8455f1c8977c93", "1201f68e4cf37a81", "aabc8a9738e2deaa", "08e4cb36d834351d"],
  "t12-vox-pop": ["2b26db49870ce97f", "773729dc5473f4ff", "68382594e9b4ad92", "d85df3510a64ce24"],
    "kenalin-bisnis": ["1fccb9e0fd0c189a", "3319a10cb0b65433", "8f1ad75dd7088fc2", "9fede81ed1a4f351"],
    "promo-terbatas": ["191ca2880def9d18", "38d6b2f5a5a9943e", "80f639c6ec7376f3", "2cef2dcbbcb03e5e"],
  "tvc-the-drop": ["c3aef3e716baae43", "8609eacc96558a7f", "ca68bed87976479c", "eb8b38ee0097b061"],
  "tvc-tersangka": ["4524bd2c7fed0c14", "6d0e08dbfcb8e7b3", "3841466ada75069b", "5b3df2443a0f2d9d"],
  "tvc-seharian": ["859aaf1eb141f049", "16df12a1db6028a2", "7640aacca7b4ab50", "f027e138aec292b8"],
  "tvc-kain-lari": ["0b2e4feff92fd4f4", "983c62d0fe1ee1aa", "51e0f31ebe4e08d8", "581f28fbdcfd4533"],
  "tvc-jam-tiga": ["498f7a640a1c84e6", "ffdac0e2addebd63", "8e39b08fbf71c728", "d68f3507d9b34c2e"],
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
      if (template.group === "ads" && segment.role === "hook") {
        assert.equal(segment.text, "", `${template.templateId}#${variant.variantIndex}: SA3 hook harus senyap`);
        continue;
      }
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
  assert.ok(riskyEvidenceClaims("t05-before-after", "Lihat dua sisi dan nilai atributnya").length > 0);
  assert.ok(riskyEvidenceClaims("before-after", "Taruh dua tampilan berdampingan").length > 0);
  assert.ok(riskyEvidenceClaims("t10-bukti-di-lengan", "Gunakan sisi pembanding lalu bandingkan").length > 0);
  assert.ok(riskyEvidenceClaims("t08-day-1-vs-day-7", "Eh, kalau kondisi awalnya nggak disimpan, catatan lanjutannya nggak berarti").length > 0);
  assert.ok(riskyEvidenceClaims("t08-day-1-vs-day-7", "Bandingkan teksturnya hanya dengan kondisi pengamatan yang tercatat loh").length > 0);
  assert.ok(riskyEvidenceClaims("t08-day-1-vs-day-7", "Rencana awal dan akhir cukup memeriksa teksturnya pada Serum Uji Katalog ya").length > 0);
  for (const templateId of ["before-after", "t05-before-after", "t08-day-1-vs-day-7", "t10-bukti-di-lengan"]) {
    assert.ok(riskyEvidenceClaims(templateId, "Sesudah pemakaian, hasilnya berubah").length > 0, templateId);
    assert.ok(riskyEvidenceClaims(templateId, "Hasil produk berubah jelas").length > 0, templateId);
    assert.ok(riskyEvidenceClaims(templateId, "Kedua kondisi dibandingkan untuk melihat peningkatan").length > 0, templateId);
  }
  assert.ok(riskyEvidenceClaims("t08-day-1-vs-day-7", "Minggu pertama dan minggu kedua terlihat berbeda").length > 0);
  assert.ok(riskyEvidenceClaims("t08-day-1-vs-day-7", "Kondisinya membaik sepekan kemudian").length > 0);
  const safeControls: Record<string, string> = {
    "before-after": "Lihat satu tampilan dan catat atributnya",
    "t05-before-after": "Periksa produk pada cahaya netral",
    "t08-day-1-vs-day-7": "Amati label produk dalam posisi tetap",
    "t10-bukti-di-lengan": "Catat atribut yang terlihat pada satu area",
  };
  for (const [templateId, copy] of Object.entries(safeControls)) {
    assert.deepEqual(riskyEvidenceClaims(templateId, copy), [], templateId);
  }
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
  for (const phrase of [
    "Dibuat setetes demi setetes",
    "Terbukti di ruang sidang",
    "Ketahuan bagus",
    "Bertahan sampai hari selesai",
  ]) {
    assert.ok(unsupportedFactualClaims(phrase).length > 0, `klaim TVC lolos: ${phrase}`);
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
      assert.equal(variant.segments[0].text, "", `${template.id}: SA3 hook tidak senyap`);
      assert.equal(variant.segments[0].tts_text, undefined, `${template.id}: SA3 hook masih punya TTS`);
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
      for (const segment of variant.segments) {
        assert.deepEqual(unsupportedAdsOutcomeClaims(segment.text), [], `${template.id}: ${segment.text}`);
      }
    }
  }
});

test("sembilan Story Ads menolak outcome tanpa bukti dan menerima staging netral", () => {
  const mutations: Record<string, string> = {
    "ads-unboxing-pov": "Segelnya terbuka mulus.",
    "ads-meja-kosong": "Nah, alurnya ringkas dan tugasnya tersusun.",
    "ads-panas-ekstrem": "Produknya mendinginkan ruangan jadi sejuk.",
    "ads-tembus-dinding": "Produknya tetap utuh setelah benturan.",
    "ads-atap-jebol": "Produknya masih bekerja setelah jatuh.",
    "ads-dobrak-pintu": "Pesannya sampai otomatis.",
    "ads-waktu-berhenti": "Semua pekerjaan jadi lebih cepat.",
    "kenalin-bisnis": "Antreannya bergerak dan layanannya merespons.",
    "promo-terbatas": "Kualitasnya meningkat.",
  };
  const safeControls: Record<string, string> = {
    "ads-unboxing-pov": "Swatch warna polos diangkat dari kardus.",
    "ads-meja-kosong": "Tiga kartu warna blank diletakkan di meja.",
    "ads-panas-ekstrem": "Lampu panggung merah menyala.",
    "ads-tembus-dinding": "Panel karton panggung digeser.",
    "ads-atap-jebol": "Konfeti putih turun dari panel.",
    "ads-dobrak-pintu": "Petugas mengangkat kartu warna polos.",
    "ads-waktu-berhenti": "Aktor menahan pose di panggung.",
    "kenalin-bisnis": "Kartu lipat polos dibuka di meja.",
    "promo-terbatas": "Dua kartu warna polos dibuka bersamaan.",
  };
  assert.deepEqual(Object.keys(mutations).sort(), CAMPAIGN_TEMPLATES.filter((item) => item.group === "ads").map((item) => item.id).sort());
  for (const [templateId, copy] of Object.entries(mutations)) {
    assert.ok(unsupportedAdsOutcomeClaims(copy).length > 0, `${templateId}: ${copy}`);
    assert.deepEqual(unsupportedAdsOutcomeClaims(safeControls[templateId]), [], `${templateId}: ${safeControls[templateId]}`);
  }
});

test("prompt final dan first frame 9 Story Ads x 4 tetap netral tanpa generated factual text", () => {
  const adsTemplates = audit.templates.filter((template) => template.group === "ads");
  assert.equal(adsTemplates.length, 9);
  for (const template of adsTemplates) {
    assert.equal(template.variants.length, 4);
    for (const variant of template.variants) {
      assert.ok(variant.assembledShotDirections.length > 0, `${template.templateId}#${variant.variantIndex} tanpa prompt final`);
      const firstFrame = variant.assembledShotDirections[0];
      assert.match(firstFrame, /blank|unprinted|no letters/i, `${template.templateId}#${variant.variantIndex} first frame tidak mengunci prop blank`);
      assert.deepEqual(unsupportedAdsOutcomeClaims(firstFrame), [], `${template.templateId}#${variant.variantIndex} first frame meminta fakta sintetis`);
      for (const [shotIndex, prompt] of variant.assembledShotDirections.entries()) {
        assert.deepEqual(
          neutralStoryAdsPromptContradictions(prompt, {}, variant.assembledShotNumericScaffolds[shotIndex]),
          [],
          `${template.templateId}#${variant.variantIndex} melanggar kontrak subjek visual`
        );
        assert.deepEqual(
          unsupportedAdsOutcomeClaims(prompt),
          [],
          `${template.templateId}#${variant.variantIndex} prompt visual: ${prompt.slice(0, 240)}`
        );
      }
    }
  }
  assert.equal(summary.targets.adsStayOutcomeNeutral, true);
  assert.deepEqual(summary.adsUnsupportedOutcomeRefs, []);
  assert.equal(summary.targets.adsVisualContractClean, true);
  assert.deepEqual(summary.adsVisualContractRefs, []);
  assert.deepEqual(adsVisualContractFindings(audit.templates), []);
  assert.equal(summary.targets.adsProviderReferencesClean, true);
  assert.deepEqual(summary.adsProviderReferenceRefs, []);
  assert.deepEqual(adsProviderReferenceFindings(audit.templates), []);
  for (const template of adsTemplates) for (const variant of template.variants) {
    assert.deepEqual(variant.providerReferencePaths, []);
    assert.equal(variant.providerContentImageCount, 0);
  }
});

test("aksi 9 Story Ads x 4 hanya memakai subjek prop netral untuk kategori fisik maupun layanan", async () => {
  const adsTemplates = CAMPAIGN_TEMPLATES.filter((template) => template.group === "ads");
  for (const template of adsTemplates) for (const category of ["beauty", "jasa"]) {
    const product = { ...auditProductForTemplate(template), category };
    const variants = await generateScripts({
      product, register: "bunda", tanpaLlm: true, contentType: "ads",
      qualityTier: template.tier as never, durationSec: template.durationSec,
      templateId: template.id, count: 4,
      hookFamilies: [template.hookFamily as never], lockHookFamily: true,
    });
    for (const [variantIndex, variant] of variants.entries()) {
      for (const segment of variant.segments) {
        assert.ok(segment.action, `${template.id}#${variantIndex} tanpa action`);
        assert.deepEqual(neutralStoryAdsActionContradictions(segment.action!), [], `${template.id}#${variantIndex}: ${segment.action}`);
      }
      const spec = planShots({
        jobId: `contract-${template.id}-${category}-${variantIndex}`,
        durationSec: template.durationSec, segments: variant.segments,
        category: getCreatorCategory("hijaber")!, productName: product.name,
        productCategory: category, productVisualDesc: `bottle labelled ${product.name}`,
        brandBrief: `show ${product.name} as a readable product name`,
        imageRefPath: "/tmp/contract-product.jpg", qualityTier: template.tier,
        format: template.format, ugcTemplate: template.id, shotCountOverride: template.shotCount,
        extraImageRefPaths: ["/tmp/extra-product-a.jpg", "/tmp/extra-product-b.jpg"],
      });
      assert.equal(spec.visualSubjectPolicy, "neutral_story_ads");
      assert.deepEqual(spec.shots.flatMap((shot) => shot.imageRefPath ? [shot.imageRefPath] : []), []);
      assert.deepEqual(spec.extraReferenceImagePaths ?? [], []);
      assert.doesNotThrow(() => assertVisualSpec(spec));
      for (const shot of spec.shots) {
        const content = buildTaskContent(spec, shot, "dreamina-seedance-2-0-mini-260615") as Array<{ type?: string }>;
        assert.equal(content.filter((item) => item.type === "image_url").length, 0, `${template.id}/${category} mengirim image ke provider`);
      }
      const prompts = spec.shots.map((shot) => shot.prompt);
      for (const [shotIndex, prompt] of prompts.entries()) {
        assert.deepEqual(neutralStoryAdsPromptContradictions(prompt, {}, spec.shots[shotIndex].trustedNumericScaffolds), [], `${template.id}/${category}#${variantIndex}: ${prompt.slice(0, 300)}`);
        assert.doesNotMatch(prompt, new RegExp(product.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
      }
    }
  }
});

test("mutasi aksi dan prompt produk nyata mematikan kontrak visual Ads", () => {
  const identity = { productName: "Kemeja Uji", productCategory: "fashion" };
  const safeScaffold = "continuous 15-second story. Shot 1 of 3. at 0-3 seconds";
  assert.deepEqual(
    neutralStoryAdsPromptContradictions(safeScaffold, {}, ["15-second", "Shot 1 of 3", "at 0-3 seconds"]),
    []
  );
  for (const disguised of ["189000-second offer", "Shot 189000 of 1 offer", "at 189000-189001 seconds offer"]) {
    assert.notDeepEqual(neutralStoryAdsPromptContradictions(disguised, {}, ["15-second", "Shot 1 of 3", "at 0-3 seconds"]), [], disguised);
  }
  for (const [prompt, allowed] of [
    ["continuous 15-second story; injected 15-second", "15-second"],
    ["Shot 1 of 4; injected Shot 1 of 4", "Shot 1 of 4"],
    ["at 3-6 seconds; injected at 3-6 seconds", "at 3-6 seconds"],
  ] as const) {
    assert.notDeepEqual(neutralStoryAdsPromptContradictions(prompt, {}, [allowed]), [], `collision exact lolos: ${allowed}`);
  }
  for (const injectedAvatar of [
    "woman holding a bottle marked ACME beside a blank card",
    "creator presenting branded serum packaging next to an unprinted swatch",
    "presenter beside a readable ACME identifier and a plain colour card",
  ]) assert.notDeepEqual(neutralStoryAdsPromptContradictions(injectedAvatar), [], injectedAvatar);
  for (const action of [
    "talent menahan produk di depan saksi",
    "talent memutar kemasannya di samping swatch blank",
    "talent mengangkat botolnya sambil memegang kartu blank",
    "talent mengangkat Kemeja Uji di samping kartu blank",
    "talent mengangkat fashion di samping kartu blank",
    "talent membuka kartu blank 189000 di meja",
    "talent membuka kartu blank Rp189.000 di meja",
    "talent membuka kartu blank 50% di meja",
    "talent membuka kartu blank 7 di meja",
    "talent membuka kartu blank café di meja",
    "talent membuka kartu blank cafe\u0301 di meja",
    "talent membuka kartu blank Ж di meja",
    "talent membuka kartu blank 189000-second offer di meja",
    "talent membuka kartu blank Shot 189000 of 1 offer di meja",
    "talent membuka kartu blank at 189000-189001 seconds offer di meja",
  ]) assert.notDeepEqual(neutralStoryAdsActionContradictions(action, identity), [], action);
  for (const safe of [
    "talent membuka kartu warna polos di meja",
    "talent menunjuk blok warna pada kartu blank",
    "swatch blank dipindahkan mendekati saksi",
    "talent membuka kartu blank di meja.",
    "kartu blank bergerak — perlahan",
  ]) assert.deepEqual(neutralStoryAdsActionContradictions(safe, identity), [], safe);
  assert.notDeepEqual(neutralStoryAdsPromptContradictions("Product hero, label squarely readable to camera."), []);
  for (const prompt of [
    "talent memutar kemasannya di samping swatch blank",
    "talent mengangkat botolnya sambil memegang kartu blank",
    "talent mengangkat Kemeja Uji di samping kartu blank",
    "talent mengangkat fashion di samping kartu blank",
    "talent membuka kartu blank 189000 di meja",
    "talent membuka kartu blank Rp189.000 di meja",
    "talent membuka kartu blank 50% di meja",
    "talent membuka kartu blank 7 di meja",
    "talent membuka kartu blank café di meja",
    "talent membuka kartu blank cafe\u0301 di meja",
    "talent membuka kartu blank Ж di meja",
    "talent membuka kartu blank 189000-second offer di meja",
    "talent membuka kartu blank Shot 189000 of 1 offer di meja",
    "talent membuka kartu blank at 189000-189001 seconds offer di meja",
  ]) assert.notDeepEqual(neutralStoryAdsPromptContradictions(prompt, identity), [], prompt);
  const mutation = structuredClone(audit.templates);
  mutation.find((template) => template.templateId === "ads-atap-jebol")!.variants[0].assembledShotDirections[0] =
    "Presenter holding product, label readable, true small size about the width of a hand.";
  assert.ok(adsVisualContractFindings(mutation).length > 0);
  assert.throws(
    () => assertVisualSpec({
      jobId: "mutation", width: 720, height: 1280,
      shots: [{ index: 0, durationSec: 5, prompt: "blank card", imageRefPath: "/tmp/product.jpg" }],
      extraReferenceImagePaths: ["/tmp/extra-product.jpg"],
      negativePrompt: "added text overlay", qualityTier: "high_quality", generateAudio: true,
      visualSubjectPolicy: "neutral_story_ads",
    }),
    /tanpa referensi gambar produk/
  );
  const providerMutation = structuredClone(audit.templates);
  const providerVariant = providerMutation.find((template) => template.templateId === "ads-atap-jebol")!.variants[0];
  providerVariant.providerReferencePaths = ["/tmp/product.jpg"];
  providerVariant.providerContentImageCount = 1;
  assert.ok(adsProviderReferenceFindings(providerMutation).length > 0);
});

test("mutasi subjek produk tetap terdeteksi setelah action dirakit menjadi prompt final", async () => {
  const template = CAMPAIGN_TEMPLATES.find((item) => item.id === "ads-unboxing-pov")!;
  const product = { id: "final-prompt", name: "Kemeja Uji", price_idr: 189000, category: "fashion" };
  const [base] = await generateScripts({
    product, register: "netral", qualityTier: template.tier, durationSec: template.durationSec,
    contentType: "ads", templateId: template.id, count: 1, tanpaLlm: true,
  });
  for (const action of [
    "talent memutar kemasannya di samping swatch blank",
    "talent mengangkat botolnya sambil memegang kartu blank",
    "talent mengangkat Kemeja Uji di samping kartu blank",
    "talent mengangkat fashion di samping kartu blank",
    "talent membuka kartu blank 189000 di meja",
    "talent membuka kartu blank Rp189.000 di meja",
    "talent membuka kartu blank 50% di meja",
    "talent membuka kartu blank 7 di meja",
    "talent membuka kartu blank café di meja",
    "talent membuka kartu blank cafe\u0301 di meja",
    "talent membuka kartu blank Ж di meja",
    "talent membuka kartu blank 189000-second offer di meja",
    "talent membuka kartu blank Shot 189000 of 1 offer di meja",
    "talent membuka kartu blank at 189000-189001 seconds offer di meja",
  ]) {
    const segments = structuredClone(base.segments);
    segments[1].action = action;
    assert.throws(() => planShots({
        jobId: "mutated-final-prompt", durationSec: template.durationSec, segments,
        category: getCreatorCategory("hijaber")!, productName: product.name,
        productCategory: product.category, imageRefPath: "/tmp/product.jpg",
        qualityTier: template.tier, format: template.format, ugcTemplate: template.id,
        shotCountOverride: template.shotCount,
      }),
      /Kontrak (?:visual|prompt final) neutral Story Ads dilanggar/,
      `prompt final meloloskan: ${action}`
    );
  }
});

test("mutasi outcome visual mematikan target audit secara end-to-end", async () => {
  const mutations: Array<[string, string, string]> = [
    ["ads-tembus-dinding", "durability", "the product remains undamaged beside a broken wall"],
    ["ads-atap-jebol", "destruction", "the ceiling gives way with debris and dust bursting forward"],
    ["ads-meja-kosong", "automatic-work", "a dashboard shows work finishing by itself and a progress bar completing"],
    ["ads-panas-ekstrem", "relief", "the product activates and creates the first moment of relief"],
    ["ads-waktu-berhenti", "efficacy", "the product is the only thing still moving in the scene"],
    ["kenalin-bisnis", "service-result", "a dashboard shows the queue moving and a service result"],
    ["promo-terbatas", "scarcity", "a deadline and limited stock countdown fill the screen"],
    ["ads-dobrak-pintu", "reviewer-durability-exact", "produk ini tahan benturan"],
    ["ads-unboxing-pov", "generated-readable-fact", "a card shows a readable product name and price"],
  ];
  for (const [templateId, outcomeClass, mutation] of mutations) {
    const opening = UGC_TEMPLATE_ROLES[templateId].opening!;
    const original = opening.role;
    try {
      opening.role = mutation;
      const mutatedAudit = await generateCatalogScriptAudit();
      assert.equal(mutatedAudit.summary.targets.adsStayOutcomeNeutral, false, `${templateId}:${outcomeClass}`);
      assert.ok(
        mutatedAudit.summary.adsUnsupportedOutcomeRefs.some((ref) =>
          ref.templateId === templateId && ref.role.startsWith("shot_prompt_")
        ),
        `${templateId}:${outcomeClass} tidak tertangkap pada prompt final`
      );
    } finally {
      opening.role = original;
    }
  }
});

test("shared evaluator menangkap exact phrase dan paraphrase pada setiap layer visual", () => {
  const mutations = [
    "produk ini tahan benturan",
    "the service completes every job automatically",
    "the package is drop-proof and remains intact",
    "this product delivers visible results",
    "pekerjaan selesai sendiri tanpa tangan",
    "the product cools the room and relieves discomfort",
    "the offer ends tonight and only two units remain",
    "everything freezes while only the product moves",
    "the booking is confirmed and the queue is cleared",
    "the dashboard workflow becomes faster and the progress bar completes",
    "a card shows a readable product name and price",
    "harga dan nama produk tercetak pada kartu",
    "nama layanan ditulis di depan saksi",
    "harga pada label disorot ke kamera",
  ];
  for (const phrase of mutations) {
    assert.ok(unsupportedAdsOutcomeClaims(phrase).length > 0, `detector tidak memahami: ${phrase}`);

    const actionMutation = structuredClone(audit.templates);
    actionMutation.find((template) => template.templateId === "ads-meja-kosong")!.variants[0].segments[0].action = phrase;
    assert.ok(adsUnsupportedOutcomeFindings(actionMutation).some((ref) => ref.role.endsWith(":action")), `action: ${phrase}`);

    const visualMutation = structuredClone(audit.templates);
    visualMutation.find((template) => template.templateId === "ads-tembus-dinding")!.variants[0].segments[0].visualDirection = phrase;
    assert.ok(adsUnsupportedOutcomeFindings(visualMutation).some((ref) => ref.role.endsWith(":visual_direction")), `visual_direction: ${phrase}`);

    const promptMutation = structuredClone(audit.templates);
    promptMutation.find((template) => template.templateId === "ads-atap-jebol")!.variants[0].assembledShotDirections[0] = phrase;
    assert.ok(adsUnsupportedOutcomeFindings(promptMutation).some((ref) => ref.role === "shot_prompt_1"), `assembled prompt: ${phrase}`);

    const opening = UGC_TEMPLATE_ROLES["ads-dobrak-pintu"].opening!;
    const originalRole = opening.role;
    const originalCamera = opening.camera;
    try {
      opening.role = phrase;
      assert.ok(adsUnsupportedOutcomeFindings(audit.templates).some((ref) => ref.role === "ugc_role_opening"), `role: ${phrase}`);
      opening.role = originalRole;
      opening.camera = phrase;
      assert.ok(adsUnsupportedOutcomeFindings(audit.templates).some((ref) => ref.role === "ugc_role_opening"), `camera: ${phrase}`);
    } finally {
      opening.role = originalRole;
      opening.camera = originalCamera;
    }
  }
});

test("role staging kesembilan Ads adalah safe controls", () => {
  for (const template of CAMPAIGN_TEMPLATES.filter((item) => item.group === "ads")) {
    const roles = UGC_TEMPLATE_ROLES[template.id];
    assert.ok(roles, `${template.id} tanpa role table`);
    const directions = [roles.opening, ...roles.middle, roles.closing].filter(Boolean);
    for (const direction of directions) {
      assert.deepEqual(unsupportedAdsOutcomeClaims(`${direction!.role} ${direction!.camera}`), [], `${template.id}: ${direction!.role}`);
    }
  }
});

test("katalog 9 Ads konsisten dengan role render netral dan menahan preview legacy", () => {
  const concepts: Record<string, { name: RegExp; metadata: RegExp; role: RegExp }> = {
    "ads-unboxing-pov": { name: /POV Kardus Panggung/, metadata: /kardus|swatch warna polos/i, role: /inside a lightweight cardboard prop box|unprinted colour swatch/i },
    "ads-meja-kosong": { name: /Tiga Kartu di Meja/, metadata: /tiga kartu warna|tanpa hasil layanan/i, role: /three unprinted colour cards/i },
    "ads-panas-ekstrem": { name: /Panggung Lampu Merah/, metadata: /lampu merah|suasana, bukan hasil/i, role: /staged red lamp|theatrical haze/i },
    "ads-tembus-dinding": { name: /Panel Karton Bergeser/, metadata: /panel karton|staging teatrikal/i, role: /cardboard wall panel|foam pieces/i },
    "ads-atap-jebol": { name: /Konfeti dari Panel/, metadata: /panel kertas|konfeti/i, role: /paper ceiling panel|white confetti/i },
    "ads-dobrak-pintu": { name: /Pintu Panggung Terbuka/, metadata: /panel pintu ringan|gerak properti ringan/i, role: /freestanding stage-door panel/i },
    "ads-waktu-berhenti": { name: /Tableau Jam Properti/, metadata: /menahan pose|pose yang disengaja/i, role: /hold still poses|prop clock/i },
    "kenalin-bisnis": { name: /Kartu Lipat di Meja/, metadata: /kartu lipat|fakta lewat audio/i, role: /folded blank colour card/i },
    "promo-terbatas": { name: /Dua Kartu Warna/, metadata: /dua kartu warna|harga tidak digambar AI/i, role: /two contrasting plain colour cards/i },
  };
  const legacy = /alat.{0,20}lenyap|hilangnya pekerjaan|keluhan.{0,35}(?:selesai|terselesaikan)|cuma produk.{0,25}(?:bergerak|jalan)|deadline|berbatas waktu|atap runtuh|mendobrak|menembus ruangan/i;
  for (const template of CAMPAIGN_TEMPLATES.filter((item) => item.group === "ads")) {
    const expected = concepts[template.id];
    assert.ok(expected, `${template.id}: mapping konsep katalog belum ada`);
    const metadata = `${template.when} ${template.caution?.badge ?? ""} ${template.caution?.note ?? ""}`;
    const roles = UGC_TEMPLATE_ROLES[template.id];
    const roleText = [roles.opening, ...roles.middle, roles.closing].filter(Boolean).map((item) => `${item!.role} ${item!.camera}`).join(" ");
    assert.match(template.name, expected.name, `${template.id}: nama katalog melenceng`);
    assert.match(metadata, expected.metadata, `${template.id}: deskripsi/caution melenceng`);
    assert.match(roleText, expected.role, `${template.id}: role render melenceng`);
    assert.doesNotMatch(`${template.name} ${metadata}`, legacy, `${template.id}: metadata legacy masih menjanjikan hasil lama`);
    assert.equal(template.preview, null, `${template.id}: preview legacy masih ditampilkan untuk konsep baru`);
  }
});

test("Ads kategori layanan tanpa bukti fitur memakai aksi kartu yang netral", async () => {
  const template = CAMPAIGN_TEMPLATES.find((item) => item.id === "ads-meja-kosong")!;
  for (const category of ["app", "jasa", "toko"]) {
    const variants = await generateScripts({
      product: { ...auditProductForTemplate(template), category }, register: "bunda", tanpaLlm: true,
      contentType: "ads", qualityTier: template.tier as never,
      durationSec: template.durationSec, templateId: template.id,
      count: 4, hookFamilies: [template.hookFamily as never], lockHookFamily: true,
    });
    for (const variant of variants) {
      const actions = variant.segments.map((segment) => segment.action ?? "").join(" ");
      assert.match(actions, /kartu|catatan|amplop/);
      assert.doesNotMatch(actions, /dashboard|status|jadwal|antrean|otomatis|notifikasi|balasan|slot|diproses/);
      assert.doesNotMatch(actions, /pegang produk|putar produk|produk berpindah|buka sisi produk/);
      assert.equal(variant.validation.passed, true, JSON.stringify(variant.validation.errors));
    }
  }
});

test("T05, T08, T10, dan before-after seluruhnya tinggal inspeksi satu keadaan", () => {
  for (const templateId of ["before-after", "t05-before-after", "t08-day-1-vs-day-7", "t10-bukti-di-lengan"]) {
    const template = audit.templates.find((item) => item.templateId === templateId)!;
    assert.equal(template.variants.length, 4);
    for (const variant of template.variants) {
      for (const segment of variant.segments) {
        assert.deepEqual(riskyEvidenceClaims(templateId, segment.text), [], `${templateId}#${variant.variantIndex}: ${segment.text}`);
      }
    }
  }
});

test("empat varian Kartu Tanya Produk bebas narasumber dan testimoni sintetis", () => {
  const template = audit.templates.find((item) => item.templateId === "t12-vox-pop")!;
  assert.equal(template.variants.length, 4);
  for (const variant of template.variants) {
    const copy = variant.segments.map((segment) => segment.text).join(" ");
    assert.doesNotMatch(copy, /narasumber|testimoni|wawancara|pendapat|rekomendasi|tanya(?:kan)? (?:satu )?orang|kata (?:dia|mereka)/i);
  }
});

test("seluruh penutup TVC bebas klaim proses, kualitas, dan ketahanan terlarang", () => {
  for (const template of audit.templates.filter((item) => item.group === "tvc")) {
    for (const variant of template.variants) {
      const cta = variant.segments.find((segment) => segment.role === "cta")!;
      assert.deepEqual(unsupportedFactualClaims(cta.text), [], `${template.templateId}#${variant.variantIndex}: ${cta.text}`);
      assert.doesNotMatch(cta.text, /dibuat setetes|terbukti|ketahuan bagus|bertahan|diuji|masih bekerja|dinilai sesudah/i);
    }
  }
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
