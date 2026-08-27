import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, uuid, audit, type ScriptRow, type ProductRow, type JobRow, type PersonaRow } from "@/lib/db";
import { getBalance, holdCredits, tierPriceIdr } from "@/lib/credits";
import { claimManagedStagingTraceNonce, enqueueJob, enqueueManagedStagingTraceJob } from "@/lib/job-queue";
import { failJob, getJob, sweepStaleJobs } from "@/lib/jobs";
import { bacaJejak, periksaAdmisi } from "@/lib/script-engine/admisi";
import type { SegmentDraft } from "@/lib/script-engine/templates";
import { config } from "@/lib/config";
import { getCreatorCategory } from "@/lib/personas";
import { createSignedUrl } from "@/lib/signed-url";
import { assertPaidAdmission } from "@/lib/job-intake";
import { createFypSnapshot } from "@/lib/fyp-snapshot";
import type { FypQualityTier, FypVideoFormat } from "@/lib/fyp-score";
import { pgAudit, pgFindOrCreatePersona, pgGetPersona, pgListJobs, pgSaveFypSnapshot, postgresRuntimeEnabled, postgresSmokeEnabled, smokeCompleteJob, smokeCreateJob, smokeGetProduct, smokeGetScript } from "@/lib/postgres/smoke-runtime";
import { scoreScriptPlan } from "@/lib/fyp-score";
import { pastikanBukanProdukOrg } from "@/lib/dashboard-rbac";
import { createJobProductSnapshotRaw } from "@/lib/job-product-snapshot";
import { assertAdmissionReferenceEvidence, cleanupSupersededReferenceKeys, cleanupUnadmittedReferenceKeys, prepareAdmissionReferenceManifest, withProductEvidenceMutationLock } from "@/lib/job-admission-reference";
import { authorizedManagedStagingZeroValueAdmission } from "@/lib/staging-admission-trace";
import { assertCategoryReviewClear, buildAuthoritativeTypeBoundaryInput, isCategoryReviewClear, validateAuthoritativeProductType } from "@/lib/product-type-boundary";
import { canonicalProductTypeTimestamp } from "@/lib/product-type-timestamp";
import { requireCurrentJobEvidence } from "@/lib/legacy-job-quarantine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/jobs {script_id, persona_id?, format='hands_only', duration_s=15}
// Gerbang HITL ditegakkan DI SINI (SF-04): approved_by_user_at NULL -> 422 SCRIPT_NOT_APPROVED.
export async function POST(req: Request) {
  try {
    // Maintenance gate must run before authentication, database reads, holds,
    // or queue writes. Existing jobs are intentionally unaffected.
    // Satu gerbang untuk semua yang memakan uang — lihat assertPaidAdmission.
    await assertPaidAdmission();
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const body = await req.json().catch(() => ({}));
    const db = postgresRuntimeEnabled() ? null : getDb();
    const script = postgresRuntimeEnabled()
      ? await smokeGetScript(user.id, String(body.script_id ?? ""))
      : db!.prepare("SELECT * FROM scripts WHERE id = ?").get(String(body.script_id ?? "")) as ScriptRow | undefined;
    if (!script) throw ERR.NOT_FOUND("Skripnya");
    const product = postgresRuntimeEnabled()
      ? await smokeGetProduct(user.id, script.product_id)
      : db!.prepare("SELECT * FROM products WHERE id = ? AND user_id = ?").get(script.product_id, user.id) as ProductRow | undefined;
    if (!product) throw ERR.NOT_FOUND("Skripnya");
    assertCategoryReviewClear({state:product.category_review_state as "CLEAR" | "QUARANTINED",reason:product.category_review_reason as never,version:product.category_review_version ?? 0}, product.category);
    // Produk organisasi WAJIB lewat dashboard: RBAC belanja, gerbang review
    // scene, dan library org semuanya hidup di sana. Lihat catatan lengkapnya
    // di pastikanBukanProdukOrg.
    pastikanBukanProdukOrg(product);

    return await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(
      { kind: "DECLARED_PRODUCT_TYPE", sourceId: "stored-product.product_type_token", token: product.product_type_token ?? "", version: 1 },
      product.product_type_state === "CONFIRMED" && product.product_type_confirmed_token
        && product.product_type_confirmed_by && product.product_type_confirmed_at && product.product_type_version === 1
        ? {
            kind: "HUMAN_PRODUCT_TYPE_CONFIRMATION", token: product.product_type_confirmed_token,
            actorId: product.product_type_confirmed_by,
            confirmedAt: canonicalProductTypeTimestamp(product.product_type_confirmed_at),
            version: 1, provenance: "USER_SELF_ASSERTION",
          }
        : null,
    ), async () => withProductEvidenceMutationLock(product.id, async () => {
    // The first C2 check is deliberately read-only. Acquire the same product
    // operation lock as E3/E7, then reload and validate current truth before
    // any durable setup (persona/audit), trace nonce claim, hold, or queue.
    // Keeping the lock through admission prevents a concurrent quarantine
    // from landing between this check and those effects.
    const lockedProduct = postgresRuntimeEnabled()
      ? await smokeGetProduct(user.id, product.id)
      : db!.prepare("SELECT * FROM products WHERE id = ? AND user_id = ?").get(product.id, user.id) as ProductRow | undefined;
    if (!lockedProduct) throw ERR.NOT_FOUND("Produknya");
    assertCategoryReviewClear({state:lockedProduct.category_review_state as "CLEAR" | "QUARANTINED",reason:lockedProduct.category_review_reason as never,version:lockedProduct.category_review_version ?? 0}, lockedProduct.category);
    pastikanBukanProdukOrg(lockedProduct);
    await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(
      { kind: "DECLARED_PRODUCT_TYPE", sourceId: "locked-admission-product.product_type_token", token: lockedProduct.product_type_token ?? "", version: 1 },
      lockedProduct.product_type_state === "CONFIRMED" && lockedProduct.product_type_confirmed_token
        && lockedProduct.product_type_confirmed_by && lockedProduct.product_type_confirmed_at
        && lockedProduct.product_type_version === 1 ? {
          kind: "HUMAN_PRODUCT_TYPE_CONFIRMATION", token: lockedProduct.product_type_confirmed_token,
          actorId: lockedProduct.product_type_confirmed_by,
          confirmedAt: canonicalProductTypeTimestamp(lockedProduct.product_type_confirmed_at),
          version: 1, provenance: "USER_SELF_ASSERTION",
        } : null,
    ), () => undefined);
    await assertAdmissionReferenceEvidence({
      productId: lockedProduct.id,
      candidateRels: JSON.parse(lockedProduct.images || "[]") as string[],
      boundary: "A1",
    });

    // --- GERBANG HITL (aturan keras #5) ---
    if (!script.approved_by_user_at) throw ERR.SCRIPT_NOT_APPROVED();

    // --- Filter kata terlarang dicek ulang saat submit render (aturan keras #6 / QC-07 pra-render) ---
    const segments = JSON.parse(script.segments) as SegmentDraft[];
    // KONTEKS ADMISI KANONIK. Versi lama tidak mengirim durationSec maupun
    // cartLabel, jadi naskah 30 detik dinilai dengan jendela 15 detik dan CTA
    // TikTok yang cuma berkata "keranjang" lolos — keduanya dibuktikan
    // reviewer lewat handler nyata sampai job QUEUED dan hold Rp24.000.
    const recheck = periksaAdmisi({
      segments,
      // Snapshot naskah menang atas body request — lihat SnapshotAdmisi.
      snapshot: bacaJejak(script.validation_result).admisi,
      hookFamily: script.hook_family,
      register: script.register,
      productName: product.name,
      productPriceIdr: product.price_idr,
      productSourceUrl: product.source_url,
      // Skrip promo yang sudah disetujui memuat harga normal — tanpa ini L-14
      // salah menolak angka harga coret saat submit render.
      promoPriceBeforeIdr: product.promo_price_before_idr,
      qualityTier: script.quality_tier,
      format: typeof body.format === "string" ? body.format : null,
    });
    if (!recheck.passed) {
      // Kode FORBIDDEN_WORDS DIPERTAHANKAN untuk kasus kata terlarang: ia
      // sudah jadi kontrak API dan artinya spesifik. Kegagalan gerbang lain
      // (panjang, keranjang, perangkat hook, pemicu penyaring) dulu ikut
      // memakai kode itu dan jadi tidak bisa dibedakan — sekarang punya pesan
      // sendiri yang menyebut sebabnya.
      const kataTerlarang = recheck.errors.some((e) => e.rule === "L-10" || e.rule === "L-11");
      if (kataTerlarang) throw ERR.FORBIDDEN_WORDS();
      throw ERR.BAD_REQUEST(
        `Naskahnya belum memenuhi standar: ${recheck.errors.map((e) => e.message_id).join(" ")}`,
        `Admission failed: ${recheck.errors.map((e) => e.rule).join(",")}`
      );
    }

    let personaId = body.persona_id ? String(body.persona_id) : null;
    // Kategori kreator dari S3: find-or-create persona (user, kategori) — pilihan
    // kategori harus benar-benar tersimpan ke persona/job dan masuk prompt shot.
    if (body.creator_category) {
      const cat = getCreatorCategory(String(body.creator_category));
      if (!cat) throw ERR.BAD_REQUEST("Kategori kreator tidak dikenal.", "Unknown creator category.");
      if (cat.status !== "active")
        throw ERR.BAD_REQUEST(`Kategori "${cat.name}" belum dirilis. Pilih yang aktif dulu ya.`, "Creator category not released.");
      const existing = postgresRuntimeEnabled() ? null : db!
        .prepare("SELECT id FROM personas WHERE user_id = ? AND creator_category = ?")
        .get(user.id, cat.id) as { id: string } | undefined;
      if (postgresRuntimeEnabled()) {
        personaId = (await pgFindOrCreatePersona(user.id, cat)).id;
      } else {
        personaId = existing?.id ?? uuid();
      }
      if (!existing && !postgresRuntimeEnabled()) {
        db!.prepare(
          "INSERT INTO personas (id, user_id, name, creator_category, voice_id, register, created_at) VALUES (?,?,?,?,?,?,?)"
        ).run(personaId, user.id, `Kreator ${cat.name}`, cat.id, "mock-damayanti", "bestie", now());
        audit(user.id, "persona.created", "personas", personaId, { creator_category: cat.id });
      }
    }
    if (personaId && !body.creator_category) {
      const persona = postgresRuntimeEnabled() ? await pgGetPersona(user.id, personaId) : db!
        .prepare("SELECT * FROM personas WHERE id = ? AND user_id = ?")
        .get(personaId, user.id) as PersonaRow | undefined;
      if (!persona) throw ERR.NOT_FOUND("Personanya");
    }
    const format = String(body.format ?? "talking_head");
    // 2026-08-07: VO+Foto dibuang — TikTok tidak lagi mengizinkan slideshow foto+VO.
    if (format === "vo_broll")
      throw ERR.BAD_REQUEST(
        "Format VO + Foto sudah tidak tersedia (kebijakan TikTok) — pilih Wajah AI atau Tangan + VO ya.",
        "vo_broll format retired per TikTok policy."
      );
    if (!["hands_only", "talking_head"].includes(format))
      throw ERR.BAD_REQUEST(
        "Format video tidak dikenal. Pilih: Wajah AI atau Tangan + VO.",
        "Unknown format. Choose talking_head or hands_only."
      );
    const durationS = Number(body.duration_s ?? 15);
    if (![15, 30, 45].includes(durationS))
      throw ERR.BAD_REQUEST("Durasi yang tersedia baru 15, 30, atau 45 detik.", "Only 15s, 30s, or 45s duration is supported.");
    // Wajah AI dibatasi 15 dtk (2026-08-07): durasi >15 = multi-shot = wajah
    // presenter bisa BERGANTI antar potongan (BytePlus menolak semua gambar
    // referensi berwajah — identitas tak bisa dikunci lintas generate).
    if (format === "talking_head" && durationS > 15)
      throw ERR.BAD_REQUEST(
        "Wajah AI saat ini tersedia untuk video 15 detik (menjaga presenter tetap orang yang sama). Durasi panjang segera hadir.",
        "talking_head is limited to 15s until cross-shot identity is solvable."
      );
    // Skrip dibuat untuk durasi tertentu (segmen ikut skala) — job harus
    // memakai durasi yang sama, bukan durasi lain yang tidak pernah divalidasi.
    const scriptDurationSec = Math.max(...segments.map((s) => s.end));
    if (scriptDurationSec !== durationS)
      throw ERR.BAD_REQUEST(
        `Skrip ini dibuat untuk video ${scriptDurationSec} detik. Bikin skrip baru untuk durasi ${durationS} detik ya.`,
        "Script was generated for a different duration."
      );

    // --- Tier kualitas: menentukan model, audio, dan HARGA (P6: harga terlihat sebelum aksi) ---
    // Avatar premium (lib/avatar-presets) dikirim sebagai DESKRIPSI, bukan id:
    // BytePlus menolak foto wajah asli sebagai referensi, jadi yang dipakai
    // prompt memang teksnya. Dibatasi panjangnya supaya tidak jadi saluran
    // menyuntikkan prompt sepanjang apa pun ke perencana shot.
    const avatarCustomDesc = typeof body.avatar_custom_desc === "string" && body.avatar_custom_desc.trim()
      ? body.avatar_custom_desc.trim().slice(0, 600)
      : null;

    const tier = String(body.quality_tier ?? "high_quality") as "silent_caption" | "high_quality" | "super_hq";
    if (tier === "silent_caption")
      throw ERR.BAD_REQUEST("Tier Teks + Musik sudah tidak tersedia — bikin skrip baru dengan AI Bersuara ya.", "silent_caption tier retired.");
    if (!["high_quality", "super_hq"].includes(tier))
      throw ERR.BAD_REQUEST("Tier tidak dikenal. Pilih: high_quality atau super_hq.", "Unknown quality tier.");
    if (script.quality_tier !== tier)
      throw ERR.BAD_REQUEST(
        `Skrip ini dibuat untuk tier ${script.quality_tier}. Bikin skrip baru untuk tier ${tier} ya.`,
        "Script was generated for a different quality tier."
      );
    const listedPriceIdr = tierPriceIdr(tier, durationS);
    const traceCapability = authorizedManagedStagingZeroValueAdmission(req, {
      userId: user.id,
      scriptId: script.id,
      format,
      qualityTier: tier,
      durationS,
    });
    const zeroValueTrace = traceCapability !== null;
    if (traceCapability && !(await claimManagedStagingTraceNonce(traceCapability.nonce, traceCapability.expiresAtMs))) {
      throw ERR.BAD_REQUEST("Kapabilitas trace sudah dipakai atau kedaluwarsa.", "Trace capability was already used or expired.");
    }
    const priceIdr = zeroValueTrace ? 0 : listedPriceIdr;

    // Checkpoint 1E only: compose the parity-tested PG repositories behind
    // the same HTTP contract.  The deterministic completion hook is scoped
    // to RACUN_POSTGRES_SMOKE and never starts the production worker.
    if (postgresRuntimeEnabled()) {
      const created = await smokeCreateJob(user.id, { productId: product.id, scriptId: script.id, format, qualityTier: tier, durationS, priceIdr, avatarCustomDesc, omitZeroLedger: zeroValueTrace });
      // Snapshot Skor FYP BEKU (pre-render) — non-fatal, sama seperti jalur SQLite.
      if (!created.duplicate) {
        try {
          const plan = scoreScriptPlan({
            hookFamily: script.hook_family as Parameters<typeof scoreScriptPlan>[0]["hookFamily"],
            segments, qualityTier: tier, durationSec: durationS,
            format: format as "hands_only" | "vo_broll" | "talking_head",
            productName: product.name, priceIdr: product.price_idr,
          });
          await pgSaveFypSnapshot({
            jobId: created.jobId, scriptId: script.id, modelVersion: plan.modelVersion,
            score: plan.score, rawProbability: plan.rawProbability,
            featuresJson: JSON.stringify(plan.featureValues),
          });
          await pgAudit(user.id, "fyp.snapshot", "fyp_snapshots", created.jobId, { score: plan.score, model_version: plan.modelVersion });
        } catch (snapErr) {
          console.warn(`[fyp-snapshot] gagal untuk job pg ${created.jobId}:`, snapErr);
        }
      }
      // The deterministic completion fixture belongs only to the disposable
      // smoke.  A real PostgreSQL runtime is completed by the queue worker.
      if (!created.duplicate && postgresSmokeEnabled()) await smokeCompleteJob(created.jobId);
      if (!created.duplicate && !postgresSmokeEnabled()) {
        if (zeroValueTrace) await enqueueManagedStagingTraceJob(created.jobId);
        else await enqueueJob(created.jobId);
      }
      return Response.json({ job_id: created.jobId, state: created.duplicate ? "QUEUED" : (postgresSmokeEnabled() ? "READY" : "QUEUED"), quality_tier: tier, hold_idr: priceIdr, ...(created.duplicate ? { duplicate: true } : {}) }, { status: created.duplicate ? 200 : 201 });
    }

    // Submit ganda yang sudah tampak tidak perlu menyalin reference bytes lagi.
    const activeBeforePrepare = db!
      .prepare("SELECT id FROM jobs WHERE script_id = ? AND state NOT IN ('FAILED','REFUNDED','READY')")
      .get(script.id) as { id: string } | undefined;
    let created: { jobId: string; duplicate: boolean } | null = activeBeforePrepare
      ? { jobId: activeBeforePrepare.id, duplicate: true }
      : null;
    const preparedJobId = uuid();
    const preparedSnapshotRels = new Set<string>();

    // Cheap preflight prevents a known-insufficient request from writing any
    // object. The identical check remains in the admitting transaction below;
    // this read is an optimization, never the authority to charge.
    if (!created && getBalance(user.id) < priceIdr) throw ERR.INSUFFICIENT_CREDITS();

    const cleanupKnownNonAdmission = () => cleanupUnadmittedReferenceKeys({
      jobId: preparedJobId,
      snapshotRels: preparedSnapshotRels,
      runtime: "admission-sqlite",
      proveJobAbsent: async () => !db!.prepare("SELECT id FROM jobs WHERE id=?").get(preparedJobId),
    });

    // better-sqlite3 transactions cannot await object storage. Prepare bytes
    // first, then compare the exact ordered images JSON inside the synchronous
    // admission transaction. A mutation race causes a bounded re-prepare with
    // the same job id/deterministic keys; no job, hold, or queue becomes visible
    // from a mismatched attempt.
    for (let attempt = 0; !created && attempt < 3; attempt++) {
      const candidateProduct = db!
        .prepare("SELECT * FROM products WHERE id=? AND user_id=?")
        .get(product.id, user.id) as ProductRow | undefined;
      if (!candidateProduct) throw ERR.NOT_FOUND("Produknya");
      assertCategoryReviewClear({state:candidateProduct.category_review_state as "CLEAR" | "QUARANTINED",reason:candidateProduct.category_review_reason as never,version:candidateProduct.category_review_version ?? 0}, candidateProduct.category);
      try {
        await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(
          { kind: "DECLARED_PRODUCT_TYPE", sourceId: "admission-product.product_type_token", token: candidateProduct.product_type_token ?? "", version: 1 },
          candidateProduct.product_type_state === "CONFIRMED" && candidateProduct.product_type_confirmed_token
            && candidateProduct.product_type_confirmed_by && candidateProduct.product_type_confirmed_at
            && candidateProduct.product_type_version === 1 ? {
              kind: "HUMAN_PRODUCT_TYPE_CONFIRMATION", token: candidateProduct.product_type_confirmed_token,
              actorId: candidateProduct.product_type_confirmed_by,
              confirmedAt: canonicalProductTypeTimestamp(candidateProduct.product_type_confirmed_at),
              version: 1, provenance: "USER_SELF_ASSERTION",
            } : null,
        ), () => undefined);
      } catch (error) {
        await cleanupKnownNonAdmission();
        throw error;
      }
      const candidateImagesRaw = candidateProduct.images;
      const candidateImages = JSON.parse(candidateImagesRaw) as string[];
      let preparedReference: Awaited<ReturnType<typeof prepareAdmissionReferenceManifest>>;
      try {
        preparedReference = await prepareAdmissionReferenceManifest({
          jobId: preparedJobId,
          productId: product.id,
          candidateRels: candidateImages,
          runtime: "admission-sqlite",
          onSnapshotTarget: (snapshotRel) => preparedSnapshotRels.add(snapshotRel),
        });
      } catch (error) {
        await cleanupKnownNonAdmission();
        throw error;
      }
      preparedReference.manifest.references.forEach((ref) => preparedSnapshotRels.add(ref.snapshotRel));

      const outcome = db!.transaction(() => {
        const active = db!
          .prepare("SELECT id FROM jobs WHERE script_id = ? AND state NOT IN ('FAILED','REFUNDED','READY')")
          .get(script.id) as { id: string } | undefined;
        if (active) return { kind: "created" as const, value: { jobId: active.id, duplicate: true } };
        if (getBalance(user.id) < priceIdr) return { kind: "insufficient" as const };
        // Read and freeze product truth inside the same transaction that admits
        // the job. A mutation after the earlier HTTP validation therefore cannot
        // slip between admission and snapshot creation.
        const admissionProduct = db!.prepare("SELECT * FROM products WHERE id=? AND user_id=?").get(product.id, user.id) as ProductRow | undefined;
        if (!admissionProduct) throw ERR.NOT_FOUND("Produknya");
        if (admissionProduct.images !== candidateImagesRaw) return { kind: "images_changed" as const };
        if (admissionProduct.product_type_token !== candidateProduct.product_type_token
          || admissionProduct.product_type_confirmed_token !== candidateProduct.product_type_confirmed_token
          || admissionProduct.product_type_confirmed_by !== candidateProduct.product_type_confirmed_by
          || canonicalProductTypeTimestamp(admissionProduct.product_type_confirmed_at)
            !== canonicalProductTypeTimestamp(candidateProduct.product_type_confirmed_at)
          || admissionProduct.product_type_version !== candidateProduct.product_type_version
          || admissionProduct.product_type_state !== candidateProduct.product_type_state
          || admissionProduct.category_review_state !== candidateProduct.category_review_state
          || admissionProduct.category_review_reason !== candidateProduct.category_review_reason
          || admissionProduct.category_review_version !== candidateProduct.category_review_version) {
          return { kind: "product_type_changed" as const };
        }
        const productSnapshotRaw = createJobProductSnapshotRaw({
          ...admissionProduct,
          category_review_version: admissionProduct.category_review_version ?? 0,
        });
        requireCurrentJobEvidence({
          approvedReferenceManifest: preparedReference.raw,
          jobProductSnapshot: productSnapshotRaw,
          productType: admissionProduct,
        });
        db!.prepare(
          `INSERT INTO jobs (id, user_id, product_id, persona_id, script_id, format, quality_tier, duration_s, approved_reference_manifest, job_product_snapshot, state, created_at, state_changed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?, 'QUEUED', ?, ?)`
        ).run(preparedJobId, user.id, product.id, personaId, script.id, format, tier, durationS, preparedReference.raw, productSnapshotRaw, now(), now());
        if (!holdCredits(user.id, preparedJobId, priceIdr)) throw ERR.INSUFFICIENT_CREDITS();
        db!.prepare("UPDATE scripts SET job_id = ? WHERE id = ?").run(preparedJobId, script.id);
        return { kind: "created" as const, value: { jobId: preparedJobId, duplicate: false } };
      })();
      if (outcome.kind === "created") {
        created = outcome.value;
        if (created.duplicate) {
          await cleanupKnownNonAdmission();
        } else {
          // The transaction wrapper returned only after COMMIT succeeded. Its
          // stored manifest is now authoritative, so retry keys not named by
          // that row can be pruned without touching ambiguous outcomes.
          await cleanupSupersededReferenceKeys({
            jobId: preparedJobId,
            snapshotRels: preparedSnapshotRels,
            runtime: "admission-sqlite",
            readCommittedManifest: async () => (db!
              .prepare("SELECT approved_reference_manifest FROM jobs WHERE id=?")
              .get(preparedJobId) as { approved_reference_manifest: string } | undefined)?.approved_reference_manifest ?? null,
          });
        }
      } else if (outcome.kind === "insufficient") {
        await cleanupKnownNonAdmission();
        throw ERR.INSUFFICIENT_CREDITS();
      }
    }
    if (!created) {
      await cleanupKnownNonAdmission();
      throw ERR.BAD_REQUEST(
        "Data produk berubah saat render diterima. Coba kirim lagi ya.",
        "Product data changed repeatedly during admission. Please retry."
      );
    }
    const jobId = created.jobId;
    if (!created.duplicate) {
      audit(user.id, "job.created", "jobs", jobId, { script_id: script.id, format, quality_tier: tier, price_idr: priceIdr });
      // Snapshot Skor FYP BEKU (pre-render) — bahan loop predicted-vs-actual.
      // Non-fatal: kegagalan scoring tidak boleh menggagalkan job berbayar.
      try {
        const snap = createFypSnapshot(db!, {
          jobId, scriptId: script.id, hookFamily: script.hook_family, segments,
          qualityTier: tier as FypQualityTier, durationSec: durationS,
          format: format as FypVideoFormat, productName: product.name, priceIdr: product.price_idr,
        });
        audit(user.id, "fyp.snapshot", "fyp_snapshots", jobId, { score: snap.score, model_version: snap.modelVersion });
      } catch (snapErr) {
        console.warn(`[fyp-snapshot] gagal untuk job ${jobId}:`, snapErr);
      }
    }
    try {
      // A duplicate request also re-attempts enqueue. BullMQ job-id dedup
      // makes this safe and recovers the narrow case where Redis was down
      // after SQLite committed the hold but before the first enqueue.
      await enqueueJob(jobId);
    } catch (queueError) {
      const queued = getJob(jobId);
      if (queued) failJob(queued, "Antrean render tidak tersedia; kredit dikembalikan otomatis.");
      throw queueError;
    }
    if (created.duplicate)
      return Response.json({ job_id: jobId, state: "QUEUED", quality_tier: tier, hold_idr: priceIdr, duplicate: true });
    return Response.json({ job_id: jobId, state: "QUEUED", quality_tier: tier, hold_idr: priceIdr }, { status: 201 });
    }));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Gambar kecil untuk daftar riwayat.
 *
 *  DULU ini selalu foto produk yang diunggah pengguna, dan itu salah: satu
 *  produk dipakai untuk banyak video, jadi seluruh riwayat tampil dengan foto
 *  yang sama persis — pengguna tidak bisa membedakan video mana yang mana, dan
 *  yang dilihat pertama kali justru foto mentah, bukan hasil kerja kita.
 *
 *  Sekarang video hasilnya sendiri yang dikirim (`preview_url`). Klien
 *  merendernya dengan preload="metadata" sehingga browser hanya menarik frame
 *  pertama, bukan seluruh berkas — kekhawatiran kuota yang dulu jadi alasan
 *  memakai foto produk tetap terjaga. Foto produk tinggal cadangan untuk job
 *  yang belum punya hasil (masih antre/render/gagal). */
function attachPreview<T extends { product_images: string; output_video?: string | null; product_category: string; category_review_state: string; category_review_reason: string | null; category_review_version: number }>(j: T) {
  let thumb_url: string | null = null;
  try {
    const imgs = JSON.parse(j.product_images) as string[];
    if (imgs.length > 0) thumb_url = createSignedUrl(imgs[0], "thumb");
  } catch {
    /* abaikan */
  }
  const { product_images: _omit, output_video,product_category,category_review_state,
    category_review_reason,category_review_version,...rest } = j;
  const publishable=isCategoryReviewClear({state:category_review_state as "CLEAR"|"QUARANTINED",
    reason:category_review_reason as never,version:category_review_version},product_category);
  return { ...rest, thumb_url, preview_url: publishable && output_video ? createSignedUrl(output_video) : null };
}

// GET /api/jobs — riwayat job pengguna.
export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    if (!postgresRuntimeEnabled()) sweepStaleJobs();
    const jobs = postgresRuntimeEnabled() ? await pgListJobs(user.id) : getDb()
      .prepare(
        `SELECT j.id, j.state, j.format, j.duration_s, j.created_at, j.completed_at,
                j.provider_video, j.provider_voice, j.cost_actual_idr, j.script_id,
                p.name AS product_name, p.images AS product_images,p.category AS product_category,
                p.category_review_state,p.category_review_reason,p.category_review_version,
                o.video_url AS output_video,
                fs.score AS fyp_score, fs.posted_url AS fyp_posted_url
         FROM jobs j JOIN products p ON p.id = j.product_id
         LEFT JOIN outputs o ON o.job_id = j.id
         LEFT JOIN fyp_snapshots fs ON fs.job_id = j.id
         WHERE j.user_id = ? AND j.org_id IS NULL ORDER BY j.created_at DESC LIMIT 50`
      )
      .all(user.id) as (JobRow & { script_id: string; product_images: string; output_video: string | null; product_category:string; category_review_state:string; category_review_reason:string|null; category_review_version:number })[];
    const withThumbs = jobs.map(attachPreview);
    return Response.json({ jobs: withThumbs });
  } catch (err) {
    return errorResponse(err);
  }
}
