/**
 * Satu sel render dashboard: SATU skrip + SATU avatar -> satu job antre.
 *
 * Dipisahkan dari app/api/dashboard/campaign/confirm karena matriks avatar x
 * skenario membutuhkan urutan yang PERSIS SAMA — validasi ulang skrip, klaim
 * atomik, hold kredit, snapshot Skor FYP, antre — cuma dengan avatar yang
 * berbeda per sel. Menyalinnya ke route kedua berarti dua salinan aturan uang
 * dan aturan HITL yang akan menyimpang diam-diam; yang pertama menyimpang
 * biasanya justru yang menyangkut kredit.
 *
 * Kontraknya sengaja sempit: pemanggil sudah harus memvalidasi produk, format,
 * template, dan rasio. Fungsi ini tidak memutuskan apa pun soal kreatif — ia
 * mengeksekusi satu sel dan melaporkan hasilnya.
 */
import crypto from "node:crypto";
import type { Pool } from "pg";
import { amplopValidasi, bacaJejak, periksaAdmisi } from "@/lib/script-engine/admisi";
import type { SegmentDraft } from "@/lib/script-engine/templates";
import { tierPriceIdr } from "@/lib/credits";
import { enqueueJob } from "@/lib/job-queue";
import type { PgCreditPaymentRepository } from "@/lib/postgres/credit-payment";
import type { PgJobsRepository } from "@/lib/postgres/jobs";
import { pgAudit, pgSaveFypSnapshot, smokeGetScript } from "@/lib/postgres/smoke-runtime";
import { scoreScriptPlan, type FypVideoFormat } from "@/lib/fyp-score";
import { createJobProductSnapshotRaw } from "@/lib/job-product-snapshot";
import { cleanupUnadmittedReferenceKeys, prepareAdmissionReferenceManifest } from "@/lib/job-admission-reference";
import { aiRenderBlockMessage } from "@/lib/template-render-safety";

export type HasilSel =
  | { status: "queued"; script_id: string; job_id: string }
  | { status: "failed"; script_id: string; reason: string };

/**
 * TVC dan iklan jasa SENGAJA dilewati, bukan dipetakan paksa: model dilatih
 * pada konten organik TikTok (vlog, skit, tutorial) dan tidak punya padanan
 * untuk iklan merek 30 detik. Memaksakan "other" akan menghasilkan angka yang
 * terlihat sah padahal tidak berarti.
 */
const FORMAT_BERSKOR = ["hands_only", "vo_broll", "talking_head"];

export interface SelRender {
  userId: string;
  orgId: string;
  productId: string;
  productName: string;
  productPriceIdr: number;
  /** URL sumber produk — menentukan label keranjang yang wajib disebut CTA. */
  productSourceUrl?: string | null;
  promoPriceBeforeIdr: number | null;
  scriptId: string;
  /** Persona pembawa suara — sudah dibuat/ditemukan pemanggil. */
  personaId: string;
  /** Deskripsi wajah avatar untuk perencana shot. null = biarkan bawaan. */
  avatarCustomDesc: string | null;
  format: string;
  ratio: string;
  noModel: boolean;
  tvcRoute: string | null;
  templateId: string | null;
  recordStyle: string | null;
  shotCount: number | null;
  runId: string;
}

export interface AlatSel {
  pool: Pool;
  jobsRepo: PgJobsRepository;
  creditsRepo: PgCreditPaymentRepository;
}

/**
 * Permintaan render yang BERTENTANGAN dengan naskahnya — ditolak, bukan ditimpa.
 *
 * Admisi menilai naskah memakai genre dari snapshot, tapi baris JOB dulu tetap
 * menyimpan format dan template dari request — dan worker merencanakan shot
 * dari baris job itu. Jadi naskah Ads bisa dirender sebagai talking_head tanpa
 * satu pun gerbang mengeluh, dan videonya tidak cocok dengan naskahnya.
 *
 * Ditolak, bukan diperbaiki diam-diam: harga dan durasi mengikuti format, jadi
 * menimpanya berarti mengubah yang dibayar pengguna tanpa ia tahu.
 *
 * Snapshot yang TIDAK menyebut format (naskah lama, atau format yang memang
 * baru dipilih di langkah confirm) tidak menghalangi apa pun.
 */
export function kontradiksiNaskah(
  snap: { format?: string | null; templateId?: string | null } | undefined,
  minta: { format: string; templateId: string | null }
): string | null {
  if (snap?.format && snap.format !== minta.format) {
    return `Naskah ini ditulis untuk format "${snap.format}", bukan "${minta.format}". Buat naskah baru untuk format itu ya.`;
  }
  if (snap?.templateId && minta.templateId && snap.templateId !== minta.templateId) {
    return `Naskah ini ditulis dari template "${snap.templateId}", bukan "${minta.templateId}".`;
  }
  return null;
}

/** Template yang benar-benar dipersist ke job. Snapshot menang; request hanya
 * fallback untuk naskah legacy yang memang belum punya provenance. */
export function templateIdRenderOtoritatif(
  snap: { templateId?: string | null } | undefined,
  requested: string | null
): string | null {
  return snap?.templateId ?? requested;
}

export async function renderSatuSel(sel: SelRender, alat: AlatSel): Promise<HasilSel> {
  const { pool, jobsRepo, creditsRepo } = alat;
  const gagal = (reason: string): HasilSel => ({ status: "failed", script_id: sel.scriptId, reason });

  // Kepemilikan diperiksa terhadap ORGANISASI, bukan anggota yang kebetulan
  // membuat produknya. Di dashboard brand, produk dibuat satu orang, dibayar
  // dompet organisasi, dan dirender siapa pun di tim — pemeriksaan per-user
  // membuat rekan satu tim ditolak "tidak ditemukan" atas produk yang jelas-
  // jelas ada di daftarnya.
  const script = await smokeGetScript(sel.userId, sel.scriptId, sel.orgId);
  if (!script || script.product_id !== sel.productId || script.job_id) {
    return gagal("Skrip tidak ditemukan atau sudah pernah dipakai.");
  }
  const jejak = bacaJejak(script.validation_result);
  const bentrok = kontradiksiNaskah(jejak.admisi, { format: sel.format, templateId: sel.templateId });
  if (bentrok) return gagal(bentrok);
  // Guard otoritatif WAJIB hidup di sel bersama, bukan hanya route. Request
  // lama dapat menghilangkan template_id; snapshot immutable tetap mengetahui
  // bahwa template bukti membutuhkan footage asli. Posisi ini mendahului
  // approval, job, kredit, dan enqueue.
  const templateIdOtoritatif = templateIdRenderOtoritatif(jejak.admisi, sel.templateId);
  const renderBlockMessage = aiRenderBlockMessage(templateIdOtoritatif);
  if (renderBlockMessage) return gagal(renderBlockMessage);
  const segments = JSON.parse(script.segments) as SegmentDraft[];
  // Tier & durasi diturunkan dari skrip tersimpan (otoritatif) — tidak pernah
  // dipercaya dari body request, sama seperti /api/jobs retail.
  const tier = script.quality_tier as "silent_caption" | "high_quality" | "super_hq";
  const durationS = Math.max(...segments.map((s) => s.end));
  if (sel.format === "talking_head" && durationS !== 15) return gagal("Wajah AI cuma tersedia untuk video 15 detik.");
  if (sel.format === "ads" && durationS !== 15 && durationS !== 30) return gagal("Iklan jasa tersedia untuk 15 atau 30 detik.");
  // TVC punya peta beat tetap untuk 15 dtk (4 beat) dan 30 dtk (2 shot x 3
  // beat). 45 dtk belum punya peta — tolak daripada meregangkan struktur 30
  // dtk dan menghasilkan beat kosong yang mengulang.
  if (sel.format === "tvc" && durationS !== 15 && durationS !== 30) return gagal("TVC tersedia untuk 15 atau 30 detik.");
  const priceIdr = tierPriceIdr(tier, durationS);

  const jobId = crypto.randomUUID();
  const preparedSnapshotRels = new Set<string>();
  const now = new Date().toISOString();
  let admittedProduct: { name: string; priceIdr: number } | null = null;
  const client = await pool.connect();
  let commitAttempted = false;
  try {
    await client.query("BEGIN");
    // Freeze product truth under a row lock in this admission transaction.
    // The org predicate is authoritative for dashboard ownership; caller
    // fields are used for validation/UI only, never for the durable snapshot.
    const admissionProduct = await client.query<{
      name: string; category: string; price_idr: number; raw_meta: string | null;
      product_visual_desc: string | null; brand_brief: string | null; claims: string | null;
      source_url: string | null; promo_price_before_idr: number | null;
      images: string;
    }>("SELECT name,category,price_idr,raw_meta,product_visual_desc,brand_brief,claims,source_url,promo_price_before_idr,images FROM products WHERE id=$1 AND org_id=$2 FOR SHARE", [sel.productId, sel.orgId]);
    if (!admissionProduct.rows[0]) {
      await client.query("ROLLBACK");
      return gagal("Produk organisasi tidak ditemukan.");
    }
    const lockedProduct = admissionProduct.rows[0];
    // KONTEKS ADMISI dan snapshot membaca ROW TERKUNCI YANG SAMA. Lock ini
    // dipertahankan sampai INSERT job + COMMIT, jadi mutation konkuren tidak
    // dapat menyelip di antara SA6 dan bytes snapshot durable.
    const validation = periksaAdmisi({
      segments,
      snapshot: jejak.admisi,
      hookFamily: script.hook_family,
      register: script.register,
      productName: lockedProduct.name,
      productCategory: lockedProduct.category,
      productPriceIdr: lockedProduct.price_idr,
      productSourceUrl: lockedProduct.source_url,
      promoPriceBeforeIdr: lockedProduct.promo_price_before_idr,
      qualityTier: tier,
      durationSec: durationS,
      format: sel.format,
      templateId: templateIdOtoritatif,
    });
    if (!validation.passed) {
      await client.query("ROLLBACK");
      return gagal(`Skrip belum memenuhi standar: ${validation.errors.map((e) => e.message_id).join(" ")}`);
    }
    // Approval harus berada pada transaksi admission yang sama. Koneksi
    // terpisah dapat meng-commit approval meski INSERT job kemudian rollback,
    // dan juga tidak ikut serialisasi klaim job_id untuk request konkuren.
    const persetujuan = await client.query(
      `UPDATE scripts
       SET segments=$1, edited_by_user=0, approved_by_user_at=$2, validation_result=$3
       WHERE id=$4 AND product_id=$5 AND job_id IS NULL
       RETURNING id`,
      [JSON.stringify(segments), now, JSON.stringify(amplopValidasi(validation, jejak)), sel.scriptId, sel.productId]
    );
    if (persetujuan.rowCount !== 1) {
      await client.query("ROLLBACK");
      return gagal("Skrip ini sudah dipakai permintaan lain.");
    }
    await client.query(
      "INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,$2,'script.approved','scripts',$3,$4,$5)",
      [crypto.randomUUID(), sel.userId, sel.scriptId, JSON.stringify({ edited: false }), now]
    );
    const productSnapshotRaw = createJobProductSnapshotRaw(lockedProduct);
    // Hold the product row through storage-first preparation and job INSERT so
    // E8/E9 cannot change the ordered identity between resolution and commit.
    // Failure here precedes job visibility and the later credit hold.
    const preparedReference = await prepareAdmissionReferenceManifest({
      jobId,
      productId: sel.productId,
      candidateRels: JSON.parse(lockedProduct.images) as string[],
      runtime: "admission-postgres-org",
      onSnapshotTarget: (snapshotRel) => preparedSnapshotRels.add(snapshotRel),
    });
    admittedProduct = { name: lockedProduct.name, priceIdr: lockedProduct.price_idr };
    // requires_approval=TRUE: job dashboard brand SELALU berhenti di gerbang
    // review scene (M11). Brand menilai gambar & pesan tiap scene sebelum
    // digabung. Retail tidak pernah menyalakan ini.
    await client.query(
      `INSERT INTO jobs (id,user_id,org_id,bulk_run_id,avatar_custom_desc,product_id,persona_id,script_id,format,quality_tier,duration_s,shot_count,ratio,no_model,tvc_route,template_id,record_style,requires_approval,approved_reference_manifest,job_product_snapshot,state,created_at,state_changed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,TRUE,$18,$19,'QUEUED',$20,$20)`,
      [jobId, sel.userId, sel.orgId, sel.runId, sel.avatarCustomDesc, sel.productId, sel.personaId, sel.scriptId,
        sel.format, tier, durationS, sel.shotCount, sel.ratio, sel.noModel, sel.tvcRoute, templateIdOtoritatif, sel.recordStyle, preparedReference.raw, productSnapshotRaw, now]
    );
    // KLAIM ATOMIK, bukan pemeriksaan tambahan.
    //
    // Penjagaan sebelumnya cuma membaca script.job_id di awal lalu menulisnya
    // di sini — dua permintaan yang datang hampir bersamaan sama-sama membaca
    // kosong, sama-sama membuat job, dan sama-sama menahan kredit. Pengguna
    // dicharge dua kali untuk satu skrip (temuan audit QA 16 Agu 2026).
    //
    // "WHERE job_id IS NULL" membuat pemenangnya ditentukan database, bukan
    // urutan kedatangan: yang kalah mendapat rowCount 0 dan transaksinya
    // digulung balik sebelum kredit tersentuh.
    const klaim = await client.query("UPDATE scripts SET job_id=$1 WHERE id=$2 AND job_id IS NULL", [jobId, sel.scriptId]);
    if (klaim.rowCount !== 1) {
      await client.query("ROLLBACK");
      await cleanupUnadmittedReferenceKeys({
        jobId,
        snapshotRels: preparedSnapshotRels,
        runtime: "admission-postgres-org",
        proveJobAbsent: async () => !(await client.query("SELECT id FROM jobs WHERE id=$1", [jobId])).rows[0],
      });
      return gagal("Skrip ini sudah dipakai permintaan lain.");
    }
    await client.query(
      "INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,$2,'job.created','jobs',$3,$4,$5)",
      [crypto.randomUUID(), sel.userId, jobId,
        JSON.stringify({ script_id: sel.scriptId, campaign_run_id: sel.runId, org_id: sel.orgId, custom_avatar: Boolean(sel.avatarCustomDesc) }), now]
    );
    commitAttempted = true;
    await client.query("COMMIT");
  } catch (error) {
    const rollbackSucceeded = await client.query("ROLLBACK").then(() => true, () => false);
    if (!commitAttempted && rollbackSucceeded && preparedSnapshotRels.size > 0) {
      await cleanupUnadmittedReferenceKeys({
        jobId,
        snapshotRels: preparedSnapshotRels,
        runtime: "admission-postgres-org",
        proveJobAbsent: async () => !(await client.query("SELECT id FROM jobs WHERE id=$1", [jobId])).rows[0],
      });
    }
    throw error;
  } finally {
    client.release();
  }

  if (!admittedProduct) throw new Error("Invariant admission produk tidak tersedia setelah commit.");

  const held = await creditsRepo.holdCredits({ userId: sel.userId, orgId: sel.orgId }, jobId, priceIdr);
  if (!held) {
    await jobsRepo.failJob(jobId, "Kredit organisasi tidak cukup.");
    return gagal("Kredit organisasi tidak cukup.");
  }

  // Snapshot Skor FYP BEKU (pre-render) — bahan loop predicted-vs-actual.
  //
  // Sempat HILANG SAMA SEKALI di jalur ini. Terukur di produksi 16 Agu: sejak
  // 10 Agustus, 12 job tidak punya skor karena createFypSnapshot cuma dipanggil
  // dari /api/jobs retail, sementara dashboard brand membuat job lewat jalur
  // ini. Tidak ada yang menyadarinya selama enam hari karena kegagalannya diam.
  if (FORMAT_BERSKOR.includes(sel.format)) {
    try {
      const plan = scoreScriptPlan({
        hookFamily: script.hook_family as Parameters<typeof scoreScriptPlan>[0]["hookFamily"],
        segments, qualityTier: tier, durationSec: durationS,
        format: sel.format as FypVideoFormat,
        productName: admittedProduct.name, priceIdr: admittedProduct.priceIdr,
      });
      await pgSaveFypSnapshot({
        jobId, scriptId: sel.scriptId, modelVersion: plan.modelVersion,
        score: plan.score, rawProbability: plan.rawProbability,
        featuresJson: JSON.stringify(plan.featureValues),
      });
      await pgAudit(sel.userId, "fyp.snapshot", "fyp_snapshots", jobId, { score: plan.score, model_version: plan.modelVersion });
    } catch (snapErr) {
      // Non-fatal, sama seperti jalur retail: skor gagal tidak boleh
      // menggagalkan job yang sudah dibayar.
      console.warn(`[fyp-snapshot] gagal untuk job dashboard ${jobId}:`, snapErr);
    }
  }

  try {
    await enqueueJob(jobId);
  } catch {
    await jobsRepo.failJob(jobId, "Antrean render tidak tersedia; kredit dikembalikan otomatis.");
    return gagal("Antrean render tidak tersedia — kredit dikembalikan otomatis.");
  }
  return { status: "queued", script_id: sel.scriptId, job_id: jobId };
}
