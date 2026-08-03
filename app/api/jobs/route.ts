import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, uuid, audit, type ScriptRow, type ProductRow, type JobRow, type PersonaRow } from "@/lib/db";
import { getBalance, holdCredits, tierPriceIdr } from "@/lib/credits";
import { enqueueJob } from "@/lib/job-queue";
import { failJob, getJob, sweepStaleJobs } from "@/lib/jobs";
import { validateScript } from "@/lib/script-engine/validator";
import type { SegmentDraft } from "@/lib/script-engine/templates";
import { config } from "@/lib/config";
import { getCreatorCategory } from "@/lib/personas";
import { createSignedUrl } from "@/lib/signed-url";
import { assertJobIntakeOpen } from "@/lib/job-intake";
import { pgFindOrCreatePersona, pgGetPersona, pgListJobs, postgresRuntimeEnabled, postgresSmokeEnabled, smokeCompleteJob, smokeCreateJob, smokeGetProduct, smokeGetScript } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/jobs {script_id, persona_id?, format='hands_only', duration_s=15}
// Gerbang HITL ditegakkan DI SINI (SF-04): approved_by_user_at NULL -> 422 SCRIPT_NOT_APPROVED.
export async function POST(req: Request) {
  try {
    // Maintenance gate must run before authentication, database reads, holds,
    // or queue writes. Existing jobs are intentionally unaffected.
    assertJobIntakeOpen();
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

    // --- GERBANG HITL (aturan keras #5) ---
    if (!script.approved_by_user_at) throw ERR.SCRIPT_NOT_APPROVED();

    // --- Filter kata terlarang dicek ulang saat submit render (aturan keras #6 / QC-07 pra-render) ---
    const segments = JSON.parse(script.segments) as SegmentDraft[];
    const recheck = validateScript(
      {
        hook_family: script.hook_family,
        register: script.register,
        segments,
        productName: product.name,
        priceIdr: product.price_idr,
        qualityTier: script.quality_tier as "silent_caption" | "high_quality" | "super_hq",
      },
      "light"
    );
    if (!recheck.passed) throw ERR.FORBIDDEN_WORDS();

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
    const format = String(body.format ?? "hands_only");
    if (!["hands_only", "talking_head", "vo_broll"].includes(format))
      throw ERR.BAD_REQUEST(
        "Format video tidak dikenal. Pilih: Tangan saja, Wajah AI, atau VO + Foto.",
        "Unknown format. Choose hands_only, talking_head, or vo_broll."
      );
    const durationS = Number(body.duration_s ?? 15);
    if (durationS !== 15)
      throw ERR.BAD_REQUEST("Durasi MVP baru 15 detik.", "Only 15s duration is supported in MVP.");

    // --- Tier kualitas: menentukan model, audio, dan HARGA (P6: harga terlihat sebelum aksi) ---
    const tier = String(body.quality_tier ?? "silent_caption") as "silent_caption" | "high_quality" | "super_hq";
    if (!["silent_caption", "high_quality", "super_hq"].includes(tier))
      throw ERR.BAD_REQUEST("Tier tidak dikenal. Pilih: silent_caption, high_quality, atau super_hq.", "Unknown quality tier.");
    // Wajah AI & VO+Foto namanya sendiri sudah menjanjikan suara — tier senyap
    // tidak masuk akal (dan QC-04 bakal gagal keras karena video benar-benar bisu).
    if ((format === "talking_head" || format === "vo_broll") && tier === "silent_caption")
      throw ERR.BAD_REQUEST(
        "Wajah AI dan VO + Foto butuh suara — pilih tier High Quality atau Super HQ, bukan Senyap + Teks.",
        "talking_head/vo_broll require an audio-bearing quality tier."
      );
    if (script.quality_tier !== tier)
      throw ERR.BAD_REQUEST(
        `Skrip ini dibuat untuk tier ${script.quality_tier}. Bikin skrip baru untuk tier ${tier} ya.`,
        "Script was generated for a different quality tier."
      );
    const priceIdr = tierPriceIdr(tier);

    // Checkpoint 1E only: compose the parity-tested PG repositories behind
    // the same HTTP contract.  The deterministic completion hook is scoped
    // to RACUN_POSTGRES_SMOKE and never starts the production worker.
    if (postgresRuntimeEnabled()) {
      const created = await smokeCreateJob(user.id, { productId: product.id, scriptId: script.id, format, qualityTier: tier, durationS, priceIdr });
      // The deterministic completion fixture belongs only to the disposable
      // smoke.  A real PostgreSQL runtime is completed by the queue worker.
      if (!created.duplicate && postgresSmokeEnabled()) await smokeCompleteJob(created.jobId);
      if (!created.duplicate && !postgresSmokeEnabled()) await enqueueJob(created.jobId);
      return Response.json({ job_id: created.jobId, state: created.duplicate ? "QUEUED" : (postgresSmokeEnabled() ? "READY" : "QUEUED"), quality_tier: tier, hold_idr: priceIdr, ...(created.duplicate ? { duplicate: true } : {}) }, { status: created.duplicate ? 200 : 201 });
    }

    // Buat job + hold dalam satu transaksi. Submit ganda yang sangat cepat
    // mengembalikan job aktif yang sama, tanpa hold/charge kedua.
    const created = db!.transaction(() => {
      const active = db!
        .prepare("SELECT id FROM jobs WHERE script_id = ? AND state NOT IN ('FAILED','REFUNDED','READY')")
        .get(script.id) as { id: string } | undefined;
      if (active) return { jobId: active.id, duplicate: true };
      if (getBalance(user.id) < priceIdr) throw ERR.INSUFFICIENT_CREDITS();
      const jobId = uuid();
      db!.prepare(
        `INSERT INTO jobs (id, user_id, product_id, persona_id, script_id, format, quality_tier, duration_s, state, created_at, state_changed_at)
         VALUES (?,?,?,?,?,?,?,?, 'QUEUED', ?, ?)`
      ).run(jobId, user.id, product.id, personaId, script.id, format, tier, durationS, now(), now());
      if (!holdCredits(user.id, jobId, priceIdr)) throw ERR.INSUFFICIENT_CREDITS();
      db!.prepare("UPDATE scripts SET job_id = ? WHERE id = ?").run(jobId, script.id);
      return { jobId, duplicate: false };
    })();
    const jobId = created.jobId;
    if (!created.duplicate)
      audit(user.id, "job.created", "jobs", jobId, { script_id: script.id, format, quality_tier: tier, price_idr: priceIdr });
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
  } catch (err) {
    return errorResponse(err);
  }
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
                p.name AS product_name, p.images AS product_images
         FROM jobs j JOIN products p ON p.id = j.product_id
         WHERE j.user_id = ? ORDER BY j.created_at DESC LIMIT 50`
      )
      .all(user.id) as (JobRow & { script_id: string; product_images: string })[];
    // Lampirkan signed URL thumbnail (foto produk pertama) untuk daftar — hemat kuota, tanpa autoplay.
    const withThumbs = jobs.map((j) => {
      let thumb_url: string | null = null;
      try {
        const imgs = JSON.parse(j.product_images) as string[];
        if (imgs.length > 0) thumb_url = createSignedUrl(imgs[0], "thumb");
      } catch {
        /* abaikan */
      }
      const { product_images: _omit, ...rest } = j;
      return { ...rest, thumb_url };
    });
    return Response.json({ jobs: withThumbs });
  } catch (err) {
    return errorResponse(err);
  }
}
