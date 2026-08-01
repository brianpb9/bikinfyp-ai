// BytePlus ModelArk (Seedance) — provider video NYATA.
// Dok resmi: https://docs.byteplus.com/en/docs/ModelArk/Video_Generation_API
//  - POST {baseUrl}/contents/generations/tasks  (Bearer BYTEPLUS_ARK_API_KEY)
//  - GET  {baseUrl}/contents/generations/tasks/{id}  -> status + content.video_url + usage
// ATURAN SUARA: generate_audio diturunkan dari quality_tier (lihat providers/types.ts) —
// silent_caption=false, high_quality/super_hq=true. Foto produk asli user jadi image
// reference (i2v). Negative prompt wajib "no text, no logo, no writing".

import fs from "node:fs";
import path from "node:path";
import { config } from "../../config";
import { runFf } from "../../media/ffmpeg";
import {
  ProviderNotConfigured,
  type VideoProvider, type VideoAsset, type VisualSpec, type ShotSpec,
} from "../types";

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

function estimateCostIdr(model: string, totalTokens: number | undefined, durationSec: number, resolution: string): { idr: number; estimated: boolean } {
  const rate = MODEL_RATES[model] ?? {};
  if (totalTokens && rate.tokenUsdPerM) {
    return { idr: Math.round((totalTokens / 1_000_000) * rate.tokenUsdPerM * config.usdIdr), estimated: false };
  }
  const perSec = rate.perSecUsd?.[resolution] ?? rate.perSecUsd?.["480p"] ?? 0.01;
  return { idr: Math.round(durationSec * perSec * config.usdIdr), estimated: true };
}

async function createTask(spec: VisualSpec, shot: ShotSpec): Promise<string> {
  const durationInt = Math.max(2, Math.min(15, Math.ceil(shot.durationSec))); // API hanya bilangan bulat (2–15 dtk tergantung model)
  const tierCfg = config.tiers[spec.qualityTier] ?? config.tiers.silent_caption;
  const body = {
    model: tierCfg.byteplusModel,
    content: [
      {
        type: "text",
        // Negative instruction wajib ikut di prompt (aturan keras #3)
        text: `${shot.prompt}. Negative: ${spec.negativePrompt}`,
      },
      {
        type: "image_url",
        // Foto produk asli user (disk lokal -> data URI base64)
        image_url: { url: imageToDataUri(shot.imageRefPath) },
      },
    ],
    // ATURAN SUARA FINAL: diturunkan dari tier (silent=false, bersuara=true) — ditegakkan assertVisualSpec
    generate_audio: spec.generateAudio,
    resolution: tierCfg.resolution,
    ratio: "9:16",
    duration: durationInt,
    watermark: false,
  };
  const res = await apiRequest<{ id: string }>("POST", `${config.byteplusBaseUrl}/contents/generations/tasks`, body);
  if (!res.id) throw new ProviderApiError("byteplus", "respons create task tanpa id");
  return res.id;
}

async function pollTask(taskId: string, startedAt: number, maxWaitMs: number): Promise<TaskResponse> {
  let delay = 5000;
  for (;;) {
    if (Date.now() - startedAt > maxWaitMs) {
      throw new ProviderApiError("byteplus", `task ${taskId} melebihi batas tunggu ${Math.round(maxWaitMs / 60000)} mnt`);
    }
    await new Promise((r) => setTimeout(r, delay));
    const t = await apiRequest<TaskResponse>("GET", `${config.byteplusBaseUrl}/contents/generations/tasks/${taskId}`);
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
    const submitted = await Promise.all(
      spec.shots.map(async (shot) => {
        const taskId = await createTask(spec, shot);
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
