import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, uuid, audit, type ScriptRow, type ProductRow, type JobRow, type PersonaRow } from "@/lib/db";
import { tierPriceIdr } from "@/lib/credits";
import { pakaiKredit as pakaiKreditSqlite } from "@/lib/kredit-video-sqlite";
import { TIER_DIJUAL, tierMasihDiterima } from "@/lib/paket-kredit";
import { jenisUntukTier } from "@/lib/kredit-video";
import { pakaiKredit } from "@/lib/kredit-video-runtime";
import { enqueueJob } from "@/lib/job-queue";
import { failJob, getJob, sweepStaleJobs } from "@/lib/jobs";
import { bacaJejak, periksaAdmisi } from "@/lib/script-engine/admisi";
import type { SegmentDraft } from "@/lib/script-engine/templates";
import { config } from "@/lib/config";
import { getCreatorCategory } from "@/lib/personas";
import { createSignedUrl } from "@/lib/signed-url";
import { assertPaidAdmission } from "@/lib/job-intake";
import { createFypSnapshot } from "@/lib/fyp-snapshot";
import type { FypQualityTier, FypVideoFormat } from "@/lib/fyp-score";
import type { QualityTier } from "@/lib/providers/types";
import { pgAudit, pgFindOrCreatePersona, pgGetPersona, pgListJobs, pgSaveFypSnapshot, postgresRuntimeEnabled, postgresSmokeEnabled, smokeCompleteJob, smokeCreateJob, smokeGetProduct, smokeGetScript } from "@/lib/postgres/smoke-runtime";
import { scoreScriptPlan } from "@/lib/fyp-score";
import { pastikanBukanProdukOrg } from "@/lib/dashboard-rbac";

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
    // Produk organisasi WAJIB lewat dashboard: RBAC belanja, gerbang review
    // scene, dan library org semuanya hidup di sana. Lihat catatan lengkapnya
    // di pastikanBukanProdukOrg.
    pastikanBukanProdukOrg(product);

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

    const tier = String(body.quality_tier ?? "high_quality") as QualityTier;
    if (tier === "silent_caption")
      throw ERR.BAD_REQUEST("Tier Teks + Musik sudah tidak tersedia — bikin skrip baru dengan AI Bersuara ya.", "silent_caption tier retired.");
    // Daftar tier yang boleh ditagih dibaca dari SATU sumber (lib/paket-kredit).
    // Sebelumnya daftarnya diketik ulang di sini, jadi menambah tier baru
    // berarti route ini menolaknya dengan pesan "tidak dikenal" sementara
    // halaman harga sudah memajangnya.
    // DITERIMA, bukan DIJUAL: naskah yang dibuat sebelum penamaan baru
    // menyimpan tier lamanya, dan job harus memakai tier yang sama dengan
    // naskahnya. Memakai daftar 'dijual' di sini akan menabrak orang yang
    // sudah bikin naskah tapi belum menekan Bikin.
    if (!tierMasihDiterima(tier))
      throw ERR.BAD_REQUEST(`Tier tidak dikenal. Pilih: ${TIER_DIJUAL.join(", ")}.`, "Unknown quality tier.");
    if (script.quality_tier !== tier)
      throw ERR.BAD_REQUEST(
        `Skrip ini dibuat untuk tier ${script.quality_tier}. Bikin skrip baru untuk tier ${tier} ya.`,
        "Script was generated for a different quality tier."
      );
    const priceIdr = tierPriceIdr(tier, durationS);
    // Yang ditagih sekarang adalah SATU JATAH VIDEO dari jenis ini, bukan
    // rupiah. priceIdr tetap dihitung karena masih dipakai laporan dan riwayat
    // — ia jadi keterangan nilai, bukan alat bayar.
    const jenis = jenisUntukTier(tier);

    // ── FOTO PRODUK DIPERIKSA SEBELUM JATAH TERPOTONG ───────────────────────
    //
    // Job be16d8f3 (4 Sep 2026) memakai banner promosi 320x320 sebagai foto
    // produk. Model menyalin tulisan bannernya jadi bayangan di sepanjang
    // video, dan videonya keluar persegi karena mesin mengikuti rasio acuan.
    // Rp13.500 keluar untuk tiga percobaan yang semuanya ditolak QC.
    //
    // Sampai hari itu tidak ada satu pun pemeriksaan foto di seluruh alur.
    // Ditaruh DI SINI, tepat sebelum smokeCreateJob memotong jatah kredit di
    // dalam transaksinya: memeriksanya sesudah itu berarti mengembalikan
    // kredit untuk sesuatu yang sudah bisa kita tolak lebih dulu.
    // `images` bisa berupa TEKS JSON (SQLite) atau ARRAY (repositori Postgres
    // sudah mengurainya). Versi pertama hanya menangani yang pertama, dan
    // JSON.parse atas sebuah array melempar — lalu ditelan try/catch, jadi
    // gerbangnya diam-diam tidak pernah berjalan.
    const fotoUtama = (() => {
      const mentah = (product as { images?: unknown }).images;
      try {
        const daftar = Array.isArray(mentah) ? mentah : (JSON.parse(String(mentah ?? "[]")) as unknown[]);
        const pertama = daftar[0];
        return typeof pertama === "string" && pertama ? pertama : null;
      } catch { return null; }
    })();
    if (fotoUtama) {
      // mediaStorage().materialize DIPANGGIL PADA OBJEKNYA, tidak dicomot lepas.
      //
      // Versi pertama menulis `const { materialize } = ...` lalu memanggilnya
      // sendirian; metodenya kehilangan `this`, melempar, dan `.catch(() =>
      // null)` menelannya tanpa jejak. Akibatnya gerbang foto TIDAK PERNAH
      // berjalan sekali pun di produksi — job 5ecb6860 lolos dengan foto
      // 320x320 yang seharusnya ditolak.
      //
      // Kegagalannya sekarang DICATAT. Diam adalah cara sebuah gerbang berhenti
      // bekerja tanpa ada yang tahu.
      const { mediaStorage } = await import("@/lib/storage");
      const lokal = await mediaStorage()
        .materialize(fotoUtama)
        .catch((e) => {
          console.error(`[foto-produk] ${product.id}: gagal mengambil foto — ${(e as Error).message}`);
          return null;
        });
      if (lokal) {
        const { periksaFotoProduk } = await import("@/lib/media/foto-produk");
        // OCR dilewati DI SINI: yang memblokir hanya ukuran, dan hitungan
        // kata cuma jadi peringatan log. Worker memanggilnya lagi dengan OCR
        // saat memutuskan pemotongan poster — di sana ia memang menentukan.
        const periksa = await periksaFotoProduk(lokal, { lewatiOcr: true });
        console.log(`[foto-produk] ${product.id}: ${periksa.lebar}x${periksa.tinggi}, ditolak=${periksa.ditolak}`);
        if (periksa.ditolak) {
          throw ERR.BAD_REQUEST(
            periksa.alasanTolak ?? "Foto produknya belum bisa dipakai.",
            `Product photo rejected: ${periksa.lebar}x${periksa.tinggi}`,
          );
        }
        for (const p of periksa.peringatan) console.warn(`[foto-produk] ${product.id}: ${p}`);
      } else {
        console.warn(`[foto-produk] ${product.id}: foto tidak bisa diambil — gerbang dilewati`);
      }
    } else {
      console.warn(`[foto-produk] ${product.id}: tidak ada foto utama — gerbang dilewati`);
    }

    // Checkpoint 1E only: compose the parity-tested PG repositories behind
    // the same HTTP contract.  The deterministic completion hook is scoped
    // to RACUN_POSTGRES_SMOKE and never starts the production worker.
    if (postgresRuntimeEnabled()) {
      const created = await smokeCreateJob(user.id, { productId: product.id, scriptId: script.id, format, qualityTier: tier, durationS, priceIdr, jenisVideo: jenis, avatarCustomDesc });
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
      if (!created.duplicate && !postgresSmokeEnabled()) await enqueueJob(created.jobId, "retail");
      return Response.json({ job_id: created.jobId, state: created.duplicate ? "QUEUED" : (postgresSmokeEnabled() ? "READY" : "QUEUED"), quality_tier: tier, jenis_video: jenis, hold_idr: priceIdr, ...(created.duplicate ? { duplicate: true } : {}) }, { status: created.duplicate ? 200 : 201 });
    }

    // Buat job + hold dalam satu transaksi. Submit ganda yang sangat cepat
    // mengembalikan job aktif yang sama, tanpa hold/charge kedua.
    const created = db!.transaction(() => {
      const active = db!
        .prepare("SELECT id FROM jobs WHERE script_id = ? AND state NOT IN ('FAILED','REFUNDED','READY')")
        .get(script.id) as { id: string } | undefined;
      if (active) return { jobId: active.id, duplicate: true };
      const jobId = uuid();
      db!.prepare(
        `INSERT INTO jobs (id, user_id, product_id, persona_id, script_id, format, quality_tier, duration_s, state, created_at, state_changed_at)
         VALUES (?,?,?,?,?,?,?,?, 'QUEUED', ?, ?)`
      ).run(jobId, user.id, product.id, personaId, script.id, format, tier, durationS, now(), now());
      // Jatah dipotong di transaksi yang SAMA dengan penulisan baris job —
      // alasan lengkapnya di lib/postgres/smoke-runtime.ts. better-sqlite3
      // menjalankan transaksi bersarang lewat savepoint, jadi ini tetap satu
      // satuan yang batal utuh kalau ada yang gagal.
      if (!pakaiKreditSqlite(user.id, jenis, jobId)) throw ERR.INSUFFICIENT_CREDITS();
      db!.prepare("UPDATE scripts SET job_id = ? WHERE id = ?").run(jobId, script.id);
      return { jobId, duplicate: false };
    })();
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
      await enqueueJob(jobId, "retail");
    } catch (queueError) {
      const queued = getJob(jobId);
      if (queued) failJob(queued, "Antrean render tidak tersedia; kredit dikembalikan otomatis.");
      throw queueError;
    }
    if (created.duplicate)
      return Response.json({ job_id: jobId, state: "QUEUED", quality_tier: tier, jenis_video: jenis, hold_idr: priceIdr, duplicate: true });
    return Response.json({ job_id: jobId, state: "QUEUED", quality_tier: tier, jenis_video: jenis, hold_idr: priceIdr }, { status: 201 });
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
function attachPreview<T extends { product_images: string; output_video?: string | null }>(j: T) {
  let thumb_url: string | null = null;
  try {
    const imgs = JSON.parse(j.product_images) as string[];
    if (imgs.length > 0) thumb_url = createSignedUrl(imgs[0], "thumb");
  } catch {
    /* abaikan */
  }
  const { product_images: _omit, output_video, ...rest } = j;
  return { ...rest, thumb_url, preview_url: output_video ? createSignedUrl(output_video) : null };
}

// GET /api/jobs — riwayat job pengguna.
export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    if (!postgresRuntimeEnabled()) sweepStaleJobs();
    const jobs = postgresRuntimeEnabled() ? await pgListJobs(user.id) : getDb()
      .prepare(
        `SELECT j.id, j.state, j.format, j.duration_s, j.quality_tier, j.created_at, j.completed_at,
                j.provider_video, j.provider_voice, j.cost_actual_idr, j.script_id,
                p.name AS product_name, p.images AS product_images,
                o.video_url AS output_video,
                fs.score AS fyp_score, fs.posted_url AS fyp_posted_url
         FROM jobs j JOIN products p ON p.id = j.product_id
         LEFT JOIN outputs o ON o.job_id = j.id
         LEFT JOIN fyp_snapshots fs ON fs.job_id = j.id
         WHERE j.user_id = ? AND j.org_id IS NULL ORDER BY j.created_at DESC LIMIT 50`
      )
      .all(user.id) as (JobRow & { script_id: string; product_images: string; output_video: string | null })[];
    const withThumbs = jobs.map(attachPreview);
    return Response.json({ jobs: withThumbs });
  } catch (err) {
    return errorResponse(err);
  }
}
