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
import { CAMPAIGN_TEMPLATES, KATALOG_BUTUH_COPY } from "../lib/templates";

const audit = await generateCatalogScriptAudit();
const { summary } = audit;

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

test("katalog template: hanya TIGA jenis utang yang diketahui, tidak ada yang lain", async () => {
  // DIPERTAJAM, bukan dilonggarkan (18 Agu). Sampai hari ini invariannya
  // "semua 132 varian lolos". Dua gate baru membatalkan sebagian:
  //
  //   L-05  batas Brian 1,5 kata/detik (22 kata untuk 15 dtk). Template
  //         dikalibrasi ke jendela lama 25-30 kata.
  //   L-19  hook wajib memakai perangkat retoris yang dikenali.
  //
  //   A-01/A-02  genre Ads. SELURUH copy template Ads adalah copy AFILIASI:
  //         penutupnya menyuruh "cek keranjang kuning" untuk iklan jasa/app
  //         yang tidak punya keranjang sama sekali. Sebelum 18 Agu ini tidak
  //         terlihat karena naskah Ads dinilai dengan aturan afiliasi — jadi
  //         copy yang salah genre justru yang lolos, dan CTA Ads yang BENAR
  //         ("Detailnya ada di bawah ya") yang ditolak.
  //
  // Ketiganya UTANG COPY yang disengaja dan tercatat. Yang dijaga tes ini:
  // tidak ada JENIS kegagalan lain yang menyusup di baliknya. Kalau suatu hari
  // ada varian gagal karena L-03, L-16, atau apa pun di luar tiga itu, tes ini
  // merah — dan itu memang gunanya.
  //
  // Jalur LLM sudah menulis CTA Ads yang benar (llm.ts blokTugas). Yang merah
  // hanya template cadangan — dan naskah cadangan yang gagal gate memang tidak
  // boleh dirender.
  //
  // SA1/SA2/SA4/SA6 ditambahkan 19 Agu (slice 2, Story OS Ads) — dan ini utang
  // COPY yang sama, bukan jenis baru yang menyusup: seluruh template Ads
  // ditulis sebagai HOOK-BODY-CTA afiliasi, jadi tidak satu pun punya beat
  // BUTTON/SPIKE/FRICTION atau jembatan produk. Template Ads yang gagal
  // memang TIDAK BOLEH dirender (script_source degraded), dan jalur LLM sudah
  // diberi instruksi Story OS penuh. Yang menghapus utang ini adalah penulisan
  // ulang copy template Ads ke bentuk Story OS — pekerjaan copy, milik Brian.
  const UTANG_DIKENAL = new Set([
    "L-05", "L-19", "A-01", "A-02", "S-04", "S-09",
    "SA1", "SA2", "SA4", "SA6", "SA8",
  ]);
  const lain = summary.validationFailureRefs
    .map((ref) => ({ ref, aturan: ref.errors.map((e) => e.rule).filter((r) => !UTANG_DIKENAL.has(r)) }))
    .filter((x) => x.aturan.length > 0);
  assert.deepEqual(
    lain.map((x) => `${x.ref.templateId}#${x.ref.variantIndex}: ${x.aturan.join(",")}`),
    [],
    "varian gagal karena sebab DI LUAR dua utang yang diketahui"
  );
});

test("utang template tercatat angkanya per jenis, bukan diam-diam", async () => {
  // Angkanya ditulis supaya perbaikan copy terlihat maju: begitu template
  // ditulis ulang, angka ini turun dan tesnya memaksa diperbarui.
  const hitung = (aturan: string) =>
    summary.validationFailureRefs.filter((r) => r.errors.some((e) => e.rule === aturan)).length;
  const panjang = hitung("L-05");
  const perangkat = hitung("L-19");
  const genreAds = summary.validationFailureRefs.filter((r) => r.errors.some((e) => e.rule.startsWith("A-"))).length;
  // STANDAR 10/10 baris 9 (kata per shot). TIDAK menambah varian gagal —
  // 82 dari 116 yang sudah gagal L-05 juga melanggar batas per shot. Angkanya
  // dicatat supaya perbaikan copy terlihat maju di dua sumbu, bukan satu.
  const perShot = summary.validationFailureRefs.filter((r) => r.errors.some((e) => e.rule === "S-09")).length;
  assert.ok(perShot > 0 && perShot <= 116, `varian melanggar batas kata per shot: ${perShot}/132`);
  assert.ok(panjang > 0 && panjang <= 130, `varian melanggar batas 22 kata: ${panjang}/132`);
  // Story OS Ads: angkanya dicatat supaya penulisan ulang copy Ads terlihat
  // maju. Nol berarti seluruh template Ads sudah berbentuk Story OS.
  const storyOs = summary.validationFailureRefs.filter((r) => r.errors.some((e) => e.rule.startsWith("SA"))).length;
  assert.ok(storyOs >= 0 && storyOs <= 132, `varian Ads belum berbentuk Story OS: ${storyOs}/132`);
  assert.ok(perangkat > 0 && perangkat <= 17, `varian tanpa perangkat retoris: ${perangkat}/132`);
  // 9 template Ads x 4 varian = 36. Semuanya berpenutup afiliasi.
  assert.ok(genreAds > 0 && genreAds <= 36, `varian Ads dengan CTA salah genre: ${genreAds}/132`);
  // Kalau keduanya nol, katalognya sudah bersih: hapus tes ini dan kembalikan
  // invarian "semua varian lolos".
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
