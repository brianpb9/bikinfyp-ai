// BytePlus ModelArk (Seedance) — provider video NYATA.
// Dok resmi: https://docs.byteplus.com/en/docs/ModelArk/Video_Generation_API
//  - POST {baseUrl}/contents/generations/tasks  (Bearer BYTEPLUS_ARK_API_KEY)
//  - GET  {baseUrl}/contents/generations/tasks/{id}  -> status + content.video_url + usage
// ATURAN SUARA: generate_audio diturunkan dari quality_tier (lihat providers/types.ts) —
// silent_caption=false, high_quality/super_hq=true. Foto produk asli user jadi image
// reference (i2v). Negative prompt wajib "no text, no logo, no writing".

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../../config";
import { runFf } from "../../media/ffmpeg";
import {
  ProviderNotConfigured,
  type VideoProvider, type VideoAsset, type VisualSpec, type ShotSpec,
} from "../types";
import { taskMemo } from "../task-memo";

// Tarif referensi (USD). Sumber:
// - seedance-1-0-pro: $2,5/1M output tokens — https://docs.byteplus.com/docs/ModelArk/1587798
// - pro-fast: 480p $0,01/dtk, 1080p $0,048/dtk — https://opper.ai/bytedance/seedance-1-0-pro-fast
// - lite: ~$0,010/dtk — https://soravideo.art/blog/seedance-2-pricing
// - 1.5 pro: ~$0,26 per 5 dtk 720p — https://tutorial.theaibuilders.dev (Seedance API tutorial)
// Tarif bisa berubah; bila respons mengandung usage.total_tokens DAN model punya tarif token,
// biaya dihitung dari usage (aktual); selain itu dari tarif/detik (estimasi, ditandai di log).
const MODEL_RATES: Record<string, { tokenUsdPerM?: number; perSecUsd?: Record<string, number> }> = {
  "seedance-1-0-lite-i2v-250428": { perSecUsd: { "480p": 0.01, "720p": 0.02 } }, // Retiring — jangan dipakai
  "seedance-1-0-lite-t2v-250428": { perSecUsd: { "480p": 0.01, "720p": 0.02 } }, // Retiring
  "seedance-1-0-pro-fast-251015": { perSecUsd: { "480p": 0.01, "720p": 0.024, "1080p": 0.048 } },
  "seedance-1-0-pro-fast-250528": { perSecUsd: { "480p": 0.01, "720p": 0.024, "1080p": 0.048 } },
  "seedance-1-0-pro-250528": { tokenUsdPerM: 2.5 },
  "seedance-1-5-pro-251215": { perSecUsd: { "480p": 0.026, "720p": 0.052 } },
  "dreamina-seedance-2-0-mini-260615": { perSecUsd: { "720p": 0.034 } }, // ESTIMASI dari COGS BRD §5.3 (Rp8.802/video)
  "dreamina-seedance-2-0-260128": { perSecUsd: { "720p": 0.143 } }, // ESTIMASI dari COGS BRD §5.3 (Rp37.164/video)
};

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

export class ProviderApiError extends Error {
  constructor(provider: string, message: string) {
    super(`${provider}: ${message}`);
    this.name = "ProviderApiError";
  }
}

function imageToDataUri(imagePath: string): string {
  const buf = fs.readFileSync(imagePath);
  const mime = MIME[path.extname(imagePath).toLowerCase()] ?? "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function apiRequest<T>(method: string, url: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${config.byteplusApiKey}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const message = err instanceof Error && err.name === "AbortError" ? "request timeout setelah 30 dtk" : String(err);
    throw new ProviderApiError("byteplus", message);
  } finally {
    clearTimeout(timeout);
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    /* respons bukan JSON */
  }
  if (!res.ok) {
    const errMsg =
      (data?.error as { message?: string } | undefined)?.message ?? text.slice(0, 300);
    throw new ProviderApiError("byteplus", `HTTP ${res.status}: ${errMsg}`);
  }
  return data as T;
}

interface TaskResponse {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
  content?: { video_url?: string };
  usage?: { completion_tokens?: number; total_tokens?: number };
  duration?: number;
  error?: { code?: string; message?: string };
}

/** Diekspor untuk uji tarif — lihat tests/tarif-model-tak-dikenal.test.ts. */
export function hitungBiayaUntukUji(model: string, totalTokens: number | undefined, durationSec: number, resolution: string) {
  return estimateCostIdr(model, totalTokens, durationSec, resolution);
}

function estimateCostIdr(model: string, totalTokens: number | undefined, durationSec: number, resolution: string): { idr: number; estimated: boolean } {
  const rate = MODEL_RATES[model] ?? {};
  if (totalTokens && rate.tokenUsdPerM) {
    return { idr: Math.round((totalTokens / 1_000_000) * rate.tokenUsdPerM * config.usdIdr), estimated: false };
  }
  // MODEL TAK DIKENAL DITAKSIR MAHAL, BUKAN MURAH.
  //
  // Ditemukan 20 Agu dari daftar task nyata: akun ini memakai
  // `dreamina-seedance-2-5-260628` yang TIDAK ada di MODEL_RATES. Fallback
  // lama jatuh ke 0,01 USD/detik — tarif model termurah di tabel — sehingga
  // 300 detik render model kelas atas tercatat ~Rp49.000 alih-alih ratusan
  // ribu.
  //
  // Kenapa ini berbahaya melebihi salah catat: anggaran canary dan stop-rule
  // membaca angka INI. Menaksir terlalu rendah berarti cap Rp250.000 bisa
  // terlampaui jauh tanpa satu pun gerbang menyadarinya. Untuk uang, taksiran
  // yang aman adalah yang MAHAL.
  const tarifDikenal = rate.perSecUsd?.[resolution] ?? rate.perSecUsd?.["480p"];
  if (tarifDikenal !== undefined) {
    return { idr: Math.round(durationSec * tarifDikenal * config.usdIdr), estimated: true };
  }
  const tertinggi = Math.max(
    ...Object.values(MODEL_RATES).flatMap((r) => Object.values(r.perSecUsd ?? {})),
    0.01
  );
  console.warn(
    `[byteplus] model "${model}" TIDAK ada di MODEL_RATES — biaya ditaksir dengan tarif TERTINGGI yang diketahui ` +
      `($${tertinggi}/dtk). Tambahkan tarifnya sebelum angka ini dipakai untuk keputusan harga.`
  );
  return { idr: Math.round(durationSec * tertinggi * config.usdIdr), estimated: true };
}

/** Susun item content create-task. Diekspor untuk unit test.
 *
 * Dua mode (aturan ModelArk, diverifikasi 2026-08-06: first/last frame TIDAK
 * boleh dicampur reference media):
 * - r2v (BAWAAN sejak 17 Agu 2026): semua foto ber-role "reference_image".
 * - i2v (cadangan): 1 foto tanpa role -> jadi frame pertama PERSIS.
 *
 * BAWAANNYA DIBALIK, dan itu diputuskan dari render berbayar, bukan teori.
 * Spike 17 Agu (docs/spike-2026-08-17, dua klip 5 detik dengan foto Scarlett
 * Acne Serum yang labelnya tajam) menunjukkan dua hal yang menentukan:
 *
 *   1. i2v MERUSAK NAMA MEREK. "SCARLETT" keluar sebagai "SCARLFTT".
 *      r2v mempertahankannya utuh. Untuk produk yang dibayar brand, itu
 *      bukan detail.
 *
 *   2. i2v MEMAKSA PACK SHOT. Frame pertamanya HARFIAH foto produk itu,
 *      jadi detik pertama video adalah foto diam — persis yang dilarang
 *      playbook, dan MUSTAHIL diperbaiki lewat prompt karena itu sifat
 *      mode i2v, bukan kekurangan kalimat.
 *
 * Bonus terukur: r2v selesai 111 detik vs 233 detik.
 *
 * i2v dipertahankan sebagai CADANGAN EKSPLISIT (preferI2v), bukan dihapus:
 * model 1.0 di tier senyap tidak mendukung r2v sama sekali, dan r2v menolak
 * durasi < 4 detik.
 */
/**
 * SATU tempat yang memutuskan mode referensi — dan satu-satunya yang boleh
 * ditanya soal itu.
 *
 * Dulu keputusannya ada di sini, TAPI arsip prompt menurunkannya sendiri dengan
 * aturan lama (ada foto tambahan? berarti r2v). Begitu r2v jadi bawaan (ADR-001
 * keputusan 1), dua tempat itu tidak lagi sepakat: provider mengirim r2v,
 * arsipnya mencatat "first_frame (i2v)". Terbukti di jalankan STEP 2, 17 Agu —
 * ketiga segmen tercatat i2v padahal ketiganya r2v.
 *
 * Arsip yang salah lebih berbahaya daripada tidak ada arsip: ia dipakai untuk
 * membedah video jelek, dan ia akan mengarahkan pembedahan ke mode yang tidak
 * pernah dipakai. Jadi aturannya tinggal satu salinan, dan pencatat memanggil
 * fungsi yang sama dengan pengirim.
 */
export function modeReferensi(
  spec: VisualSpec,
  model: string
): "reference_image (r2v)" | "first_frame (i2v)" | "text_to_video" {
  // Neutral Story Ads deliberately carry no product references. Keep this
  // explicit policy separate from the legacy empty-spec probe used by the
  // provider mode decision tests: absence alone is not sufficient evidence
  // that a normal product render should switch away from its configured mode.
  if (spec.visualSubjectPolicy === "neutral_story_ads") return "text_to_video";
  const modelDukungR2v = model.includes("dreamina-seedance-2");
  if (modelDukungR2v && spec.preferI2v !== true) return "reference_image (r2v)";
  return "first_frame (i2v)";
}

export function buildTaskContent(spec: VisualSpec, shot: ShotSpec, model: string): unknown[] {
  const textItem = {
    type: "text",
    // Negative instruction wajib ikut di prompt (aturan keras #3)
    text: `${shot.prompt}. Negative: ${spec.negativePrompt}`,
  };
  // r13 (Brian 2026-08-07): 4->7 extra (+1 primer = 8 total) — dites langsung
  // ke BytePlus, API menerima 8 foto referensi tanpa error (bukan API yg
  // membatasi 5, itu batas kode lama).
  const extras = (spec.extraReferenceImagePaths ?? []).slice(0, 7);
  if (!shot.imageRefPath) return [textItem];
  // r2v adalah BAWAAN untuk model yang mendukungnya. Dulu ia hanya dipakai
  // kalau ada foto tambahan atau referenceOnlyImages dinyalakan — artinya
  // jalur retail (satu foto produk) selalu jatuh ke i2v, yaitu mode yang
  // terbukti merusak nama merek dan memaksa pack shot.
  //
  // preferI2v mematikannya secara sadar untuk kasus yang memang menuntut
  // frame pertama persis.
  const useR2v = modeReferensi(spec, model) === "reference_image (r2v)";
  if (!useR2v) {
    return [textItem, { type: "image_url", image_url: { url: imageToDataUri(shot.imageRefPath) } }];
  }
  return [
    textItem,
    { type: "image_url", image_url: { url: imageToDataUri(shot.imageRefPath) }, role: "reference_image" },
    ...extras.map((p) => ({ type: "image_url", image_url: { url: imageToDataUri(p) }, role: "reference_image" })),
  ];
}

const PROVIDER_KEY = "byteplus";

export function buildBytePlusTaskBody(spec: VisualSpec, shot: ShotSpec) {
  const tierCfg = config.tiers[spec.qualityTier] ?? config.tiers.silent_caption;
  const content = buildTaskContent(spec, shot, tierCfg.byteplusModel);
  // Mode r2v (ada role reference_image) minimal 4 dtk (diverifikasi: duration 3
  // ditolak InvalidParameter di r2v; i2v tetap 2-15).
  const minDur = content.some((c) => (c as { role?: string }).role === "reference_image") ? 4 : 2;
  const durationInt = Math.max(minDur, Math.min(15, Math.ceil(shot.durationSec))); // API hanya bilangan bulat
  // Seedance 2.5 MENOLAK parameter ratio pada mode frame-pertama:
  // "the output ratio follows the first-frame image" (HTTP 400, diuji
  // 2026-08-15). Perbedaan API nyata dari 2.0, yang justru MEMAKAI ratio —
  // TVC 16:9 kita dirender lewat parameter itu.
  //
  // Jadi ratio dihilangkan hanya untuk 2.5, bukan untuk semua: menghapusnya di
  // 2.0 akan mengubah setiap TVC jadi 9:16 mengikuti foto produk.
  //
  // Ini juga catatan penting kalau produksi mau pindah ke 2.5: rasio keluaran
  // tidak lagi bisa diminta, ia ditentukan foto yang dikirim.
  const modelDuaLima = /seedance-2-5/.test(tierCfg.byteplusModel);
  const punyaFramePertama = !content.some((c) => (c as { role?: string }).role === "reference_image");
  const body = {
    model: tierCfg.byteplusModel,
    content,
    // ATURAN SUARA FINAL: diturunkan dari tier (silent=false, bersuara=true) — ditegakkan assertVisualSpec
    generate_audio: spec.generateAudio,
    resolution: tierCfg.resolution,
    ...(modelDuaLima && punyaFramePertama ? {} : { ratio: spec.ratio ?? "9:16" }),
    duration: durationInt,
    watermark: false,
  };
  return body;
}

export function bytePlusTaskPayloadSha256(spec: VisualSpec, shot: ShotSpec): string {
  return crypto.createHash("sha256").update(JSON.stringify(buildBytePlusTaskBody(spec, shot))).digest("hex");
}

async function createTask(body: ReturnType<typeof buildBytePlusTaskBody>): Promise<string> {
  const res = await apiRequest<{ id: string }>("POST", `${config.byteplusBaseUrl}/contents/generations/tasks`, body);
  if (!res.id) throw new ProviderApiError("byteplus", "respons create task tanpa id");
  return res.id;
}

// r17 (ditemukan 2026-08-09 saat batch-render 4 produk): 1x hiccup jaringan
// sesaat ("TypeError: fetch failed") di SATU poll GET di tengah loop tunggu
// panjang (4-8 mnt) menggagalkan SELURUH job -> failover ke mock, padahal
// shot lain sudah sukses dibayar ke provider (biaya kebakar sia-sia). Sama
// persis pola insiden Gemini TTS 503 (r5) yang sudah dikasih retry 3x -- poll
// GET di sini belum. Retry HANYA utk error transien (bukan HTTP response
// nyata dari server, mis. 400 tolakan gambar) -- gagal HTTP asli TETAP harus
// langsung fail, jangan diulang buta.
async function pollOnce(taskId: string): Promise<TaskResponse> {
  const delaysMs = [2000, 5000, 10000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await apiRequest<TaskResponse>("GET", `${config.byteplusBaseUrl}/contents/generations/tasks/${taskId}`);
    } catch (err) {
      const isHttpError = err instanceof ProviderApiError && /^byteplus: HTTP \d/.test(err.message);
      if (isHttpError || attempt >= delaysMs.length) throw err;
      console.warn(`[byteplus] poll ${taskId} gagal transien (${attempt + 1}/${delaysMs.length + 1}) — retry ${delaysMs[attempt]}ms`);
      await new Promise((r) => setTimeout(r, delaysMs[attempt]));
    }
  }
}

async function pollTask(taskId: string, startedAt: number, maxWaitMs: number): Promise<TaskResponse> {
  let delay = 5000;
  for (;;) {
    if (Date.now() - startedAt > maxWaitMs) {
      throw new ProviderApiError("byteplus", `task ${taskId} melebihi batas tunggu ${Math.round(maxWaitMs / 60000)} mnt`);
    }
    await new Promise((r) => setTimeout(r, delay));
    const t = await pollOnce(taskId);
    if (t.status === "succeeded") return t;
    if (t.status === "failed" || t.status === "cancelled" || t.status === "expired") {
      throw new ProviderApiError("byteplus", `task ${taskId} ${t.status}: ${t.error?.message ?? "tanpa pesan"}`);
    }
    delay = Math.min(delay + 5000, 20000); // backoff 5s -> 20s
  }
}

export const byteplusVideo: VideoProvider = {
  name: "byteplus-ark-seedance",

  estimateCost(spec: VisualSpec): number {
    const tierCfg = config.tiers[spec.qualityTier] ?? config.tiers.silent_caption;
    const totalSec = spec.shots.reduce((s, sh) => s + Math.ceil(sh.durationSec), 0);
    return estimateCostIdr(tierCfg.byteplusModel, undefined, totalSec, tierCfg.resolution).idr;
  },

  async healthCheck(): Promise<boolean> {
    return config.byteplusApiKey !== ""; // tanpa panggilan API (menghindari biaya)
  },

  async generate(spec: VisualSpec, outDir: string): Promise<VideoAsset[]> {
    if (!config.byteplusApiKey) throw new ProviderNotConfigured("byteplus-ark-seedance", "BYTEPLUS_ARK_API_KEY");

    const perShotTimeoutMs = (config.stateTimeoutsMin.GENERATING_VISUAL * 60_000) / Math.max(1, spec.shots.length);

    // Submit semua shot dulu (paralel), lalu polling — hemat waktu total.
    const memo = taskMemo();
    const submitted = await Promise.all(
      spec.shots.map(async (shot) => {
        // Percobaan ulang harus MELANJUTKAN task yang sudah dibayar, bukan
        // mengirim yang baru. Worker yang mati saat polling kehilangan id
        // task-nya bersama prosesnya, dan tanpa langkah ini BytePlus menagih
        // dua kali untuk shot yang sama.
        const body = buildBytePlusTaskBody(spec, shot);
        const payloadSha256 = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
        const remembered = await memo.get(spec.jobId, shot.index, PROVIDER_KEY, payloadSha256);
        if (remembered) {
          console.log(`[byteplus] job ${spec.jobId} shot ${shot.index}: lanjutkan task ${remembered} (tidak submit ulang)`);
          return { shot, taskId: remembered, startedAt: Date.now() };
        }
        const taskId = await createTask(body);
        // Disimpan SEBELUM polling. Menyimpannya setelah polling selesai tidak
        // ada gunanya — justru jendela antara submit dan selesai itulah yang
        // ingin dilindungi.
        await memo.put(spec.jobId, shot.index, PROVIDER_KEY, taskId, payloadSha256);
        console.log(`[byteplus] job ${spec.jobId} shot ${shot.index}: task ${taskId} dikirim`);
        return { shot, taskId, startedAt: Date.now() };
      })
    );

    const assets: VideoAsset[] = [];
    for (const { shot, taskId, startedAt } of submitted) {
      const result = await pollTask(taskId, startedAt, perShotTimeoutMs);
      const videoUrl = result.content?.video_url;
      if (!videoUrl) throw new ProviderApiError("byteplus", `task ${taskId} sukses tapi tanpa video_url`);

      const outPath = path.join(outDir, `shot${shot.index}.mp4`);
      const dlController = new AbortController();
      const dlTimeout = setTimeout(() => dlController.abort(), 60_000);
      let dl: Response;
      try {
        dl = await fetch(videoUrl, { signal: dlController.signal });
      } catch (err) {
        const message = err instanceof Error && err.name === "AbortError" ? "unduh video timeout setelah 60 dtk" : String(err);
        throw new ProviderApiError("byteplus", message);
      } finally {
        clearTimeout(dlTimeout);
      }
      if (!dl.ok) throw new ProviderApiError("byteplus", `unduh video gagal HTTP ${dl.status}`);
      fs.writeFileSync(outPath, Buffer.from(await dl.arrayBuffer()));

      const secs = Math.round((Date.now() - startedAt) / 1000);
      const durSec = result.duration ?? Math.ceil(shot.durationSec);
      const tierCfg = config.tiers[spec.qualityTier] ?? config.tiers.silent_caption;
      const cost = estimateCostIdr(tierCfg.byteplusModel, result.usage?.total_tokens, durSec, tierCfg.resolution);
      console.log(
        `[byteplus] job ${spec.jobId} shot ${shot.index}: selesai ${secs} dtk, model=${tierCfg.byteplusModel}, audio=${spec.generateAudio}, biaya Rp${cost.idr}${cost.estimated ? " (estimasi tarif)" : " (dari usage)"}`
      );
      assets.push({ filePath: path.resolve(outPath), durationSec: durSec, costIdr: cost.idr, hasAudio: spec.generateAudio });
    }
    return assets;
  },
};
