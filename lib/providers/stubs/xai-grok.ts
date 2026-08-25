// xAI Grok Imagine — provider video NYATA.
//
// Ditambahkan atas FINAL-MESIN-DAN-HARGA.md (26 Agu 2026), yang memilih
// Grok Imagine 1.5 untuk tier super_hq: COGS Rp19.560 versus Rp37.164 milik
// BytePlus 2.0 penuh, jadi margin naik Rp42.836 -> Rp60.440 (+41%) pada harga
// jual Rp80.000 yang sama.
//
//   POST https://api.x.ai/v1/videos/generations     (Bearer XAI_API_KEY)
//   GET  https://api.x.ai/v1/videos/{request_id}    -> polling sampai status=done
//
// TIGA SIFAT API INI YANG MENGUBAH BENTUK ADAPTER, dan semuanya berasal dari
// pengukuran di dokumen itu — bukan dari membaca dokumentasi vendor:
//
// 1. TIDAK ADA PARAMETER RASIO. Bawaannya 848x480 LANDSCAPE. Satu-satunya cara
//    memaksa 9:16 adalah mengirim GAMBAR AWAL POTRET lewat `image`; keluarannya
//    lalu 400x736. Maka adapter ini MENOLAK shot tanpa gambar acuan alih-alih
//    diam-diam menghasilkan video landscape untuk feed vertikal — kegagalan
//    yang baru ketahuan sesudah dibayar.
//
// 2. MAKSIMAL 15 DETIK per klip.
//
// 3. AUDIO IKUT DIHASILKAN, tanpa tombol untuk mematikannya. Karena itu
//    provider ini hanya sah untuk tier bersuara. Tier silent_caption menuntut
//    generate_audio=false, dan janji itu tidak bisa dipenuhi di sini.
//
// BATAS YANG BELUM DIVERIFIKASI (FINAL-MESIN-DAN-HARGA §7, dibawa ke sini
// supaya tidak hilang dari pandangan orang yang membaca kodenya):
//   - ketajaman 400x736 sesudah diunggah ke TikTok BELUM dinilai;
//   - lafal Bahasa Indonesia BELUM dinilai telinga manusia baris per baris;
//   - konsistensi wajah antar klip BELUM diuji — penting untuk TVC multi-klip.
// Karena itu provider ini DIDAFTARKAN tapi TIDAK dijadikan bawaan super_hq.

import fs from "node:fs";
import path from "node:path";
import { config } from "../../config";
import {
  ProviderNotConfigured,
  type VideoProvider, type VideoAsset, type VisualSpec, type ShotSpec,
} from "../types";
import { taskMemo } from "../task-memo";

const PROVIDER_KEY = "xai-grok-imagine";
const BASE_URL = "https://api.x.ai/v1";

/** Tarif resmi per detik (USD), FINAL-MESIN-DAN-HARGA §2. */
const RATE_USD_PER_SEC: Record<string, number> = {
  "grok-imagine-video": 0.05,
  "grok-imagine-video-1.5": 0.08,
};

/** Batas keras API: satu klip tidak boleh lebih dari 15 detik. */
export const MAKS_DETIK_PER_KLIP = 15;

/** Keluaran nyata saat gambar awal potret dikirim (§2). Dicatat sebagai
 *  konstanta karena dipakai memutuskan, bukan sekadar dilaporkan. */
export const KELUARAN_POTRET = { width: 400, height: 736 } as const;

export function biayaIdr(model: string, durationSec: number): number {
  const perSec = RATE_USD_PER_SEC[model];
  if (perSec === undefined) {
    throw new Error(
      `[xai-grok] tarif model "${model}" tidak diketahui. Menebak tarif berarti menebak margin — ` +
        `daftarkan tarifnya di RATE_USD_PER_SEC sebelum memakai model ini.`,
    );
  }
  return Math.round(perSec * durationSec * config.usdIdr);
}

/** Gambar awal dikirim sebagai data URI base64 (§2: "Gambar boleh data URI"). */
function dataUri(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(absPath).toString("base64")}`;
}

async function createTask(spec: VisualSpec, shot: ShotSpec, model: string): Promise<string> {
  // TANPA GAMBAR AWAL, KELUARANNYA LANDSCAPE. Ditolak di sini, bukan dibiarkan
  // lolos: video landscape untuk feed 9:16 adalah kegagalan yang baru terlihat
  // sesudah render dibayar, dan sesudah itu uangnya sudah keluar.
  if (!shot.imageRefPath) {
    throw new Error(
      `[xai-grok] shot ${shot.index} tanpa imageRefPath. Grok tidak punya parameter rasio; ` +
        `9:16 HANYA bisa dipaksa lewat gambar awal potret. Tanpa itu keluarannya 848x480 landscape.`,
    );
  }
  if (!fs.existsSync(shot.imageRefPath)) {
    throw new Error(`[xai-grok] shot ${shot.index}: gambar acuan tidak ada di ${shot.imageRefPath}`);
  }
  if (shot.durationSec > MAKS_DETIK_PER_KLIP) {
    throw new Error(
      `[xai-grok] shot ${shot.index}: ${shot.durationSec} detik melebihi batas ${MAKS_DETIK_PER_KLIP} detik.`,
    );
  }

  const res = await fetch(`${BASE_URL}/videos/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.xaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      // Negative prompt digabung ke prompt: API ini tidak punya field terpisah,
      // sementara aturan keras repo mewajibkan instruksi itu ikut terkirim.
      prompt: `${shot.prompt}\n\nNEGATIVE: ${spec.negativePrompt}`,
      image: { url: dataUri(shot.imageRefPath) },
      duration: shot.durationSec,
    }),
  });
  if (!res.ok) {
    throw new Error(`[xai-grok] createTask HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { request_id?: string; id?: string };
  const id = json.request_id ?? json.id;
  if (!id) throw new Error(`[xai-grok] respons tanpa request_id: ${JSON.stringify(json).slice(0, 300)}`);
  return id;
}

async function pollTask(requestId: string, startedAt: number, timeoutMs: number): Promise<{ url: string }> {
  for (;;) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`[xai-grok] task ${requestId} melewati batas ${Math.round(timeoutMs / 1000)} detik`);
    }
    const res = await fetch(`${BASE_URL}/videos/${requestId}`, {
      headers: { Authorization: `Bearer ${config.xaiApiKey}` },
    });
    if (!res.ok) {
      throw new Error(`[xai-grok] pollTask HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      status?: string;
      url?: string;
      video?: { url?: string };
      error?: unknown;
    };
    const status = json.status ?? "";
    if (status === "done" || status === "succeeded") {
      const url = json.url ?? json.video?.url;
      if (!url) throw new Error(`[xai-grok] status ${status} tapi tanpa URL video`);
      return { url };
    }
    if (status === "failed" || status === "error" || json.error) {
      throw new Error(`[xai-grok] task ${requestId} gagal: ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

export const xaiGrokVideo: VideoProvider = {
  name: "xai-grok-imagine",

  estimateCost(spec: VisualSpec): number {
    const model = config.xaiVideoModel;
    return spec.shots.reduce((sum, s) => sum + biayaIdr(model, s.durationSec), 0);
  },

  async healthCheck(): Promise<boolean> {
    return Boolean(config.xaiApiKey);
  },

  async generate(spec: VisualSpec, outDir: string): Promise<VideoAsset[]> {
    if (!config.xaiApiKey) throw new ProviderNotConfigured("xai-grok-imagine", "XAI_API_KEY");

    // AUDIO SELALU IKUT dan tidak bisa dimatikan (§4). Tier bisu menjanjikan
    // sebaliknya, jadi janji itu ditolak di sini alih-alih dilanggar diam-diam.
    if (!spec.generateAudio) {
      throw new Error(
        `[xai-grok] tier ${spec.qualityTier} menuntut video BISU, sedangkan Grok Imagine selalu ` +
          `menghasilkan audio dan tidak punya tombol untuk mematikannya.`,
      );
    }

    const model = config.xaiVideoModel;
    const perShotTimeoutMs =
      (config.stateTimeoutsMin.GENERATING_VISUAL * 60_000) / Math.max(1, spec.shots.length);

    // Percobaan ulang wajib MELANJUTKAN task yang sudah dibayar, bukan mengirim
    // yang baru — pola yang sama dengan adapter BytePlus, dan alasannya sama:
    // worker yang mati saat polling kehilangan request_id bersama prosesnya,
    // dan tanpa ini xAI menagih dua kali untuk shot yang sama.
    const memo = taskMemo();
    const submitted = await Promise.all(
      spec.shots.map(async (shot) => {
        const remembered = await memo.get(spec.jobId, shot.index, PROVIDER_KEY);
        if (remembered) {
          console.log(`[xai-grok] job ${spec.jobId} shot ${shot.index}: lanjutkan task ${remembered}`);
          return { shot, taskId: remembered, startedAt: Date.now() };
        }
        const taskId = await createTask(spec, shot, model);
        await memo.put(spec.jobId, shot.index, PROVIDER_KEY, taskId);
        console.log(`[xai-grok] job ${spec.jobId} shot ${shot.index}: task ${taskId} dikirim`);
        return { shot, taskId, startedAt: Date.now() };
      }),
    );

    const assets: VideoAsset[] = [];
    for (const { shot, taskId, startedAt } of submitted) {
      const { url } = await pollTask(taskId, startedAt, perShotTimeoutMs);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`[xai-grok] unduh video HTTP ${res.status}`);
      const filePath = path.join(outDir, `shot${shot.index}.mp4`);
      fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
      assets.push({
        filePath,
        durationSec: shot.durationSec,
        costIdr: biayaIdr(model, shot.durationSec),
        hasAudio: true,
      });
    }
    return assets;
  },
};
