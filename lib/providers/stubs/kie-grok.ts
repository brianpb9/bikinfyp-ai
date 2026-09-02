/**
 * Grok Imagine lewat kie.ai — mesin untuk kualitas "standard".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * BENTUK PERMINTAAN DAN JAWABAN — DARI BRIAN, BUKAN DARI INGATAN
 * ────────────────────────────────────────────────────────────────────────────
 * Model: grok-imagine/image-to-video
 *
 *   input  { image_urls, index, prompt, mode, aspect_ratio, duration,
 *            resolution, nsfw_checker }
 *   output { resultUrls: [ "...mp4" ] }
 *
 * ────────────────────────────────────────────────────────────────────────────
 * YANG BELUM DIVERIFIKASI, DAN DITANDAI ALIH-ALIH DIANGGAP BENAR
 * ────────────────────────────────────────────────────────────────────────────
 * Brian memberi bentuk INPUT dan OUTPUT, bukan alamat endpoint-nya. Jalur di
 * bawah (createTask + polling recordInfo) mengikuti pola API kie.ai, TAPI
 * belum pernah dijalankan terhadap server sungguhan karena belum ada
 * KIE_API_KEY di sistem ini.
 *
 * Karena itu path-nya dibuat bisa diganti lewat env, dan setiap kegagalan
 * memuat jawaban mentah kie.ai di pesannya — supaya kalau bentuknya ternyata
 * berbeda, yang terlihat adalah jawaban mereka, bukan tebakan kami.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * GAMBAR HARUS BISA DIUNDUH KIE.AI
 * ────────────────────────────────────────────────────────────────────────────
 * `image_urls` berisi URL, bukan berkas. Jadi foto produk wajib dapat diambil
 * dari internet oleh server mereka — dan /api/files TIDAK bisa dipakai untuk
 * itu: rute itu menuntut sesi pemilik, yang tidak dipunyai kie.ai, jadi ia
 * akan selalu menjawab 403.
 *
 * Karena itu ada gerbang tersendiri yang sempit: lib/gambar-provider.ts
 * menyalin foto ke kotak `provider-in/` dan menerbitkan URL mutlak ber-HMAC
 * dengan kunci turunan sendiri. Salinannya dibuang saat job selesai.
 */

import fs from "node:fs";
import path from "node:path";
import { config } from "../../config";
import {
  ProviderNotConfigured,
  type VideoProvider,
  type VideoAsset,
  type VisualSpec,
  type ShotSpec,
} from "../types";
import { taskMemo } from "../task-memo";
import { terbitkanGambarProvider } from "../../gambar-provider";

const PROVIDER_KEY = "kie-grok";

/** Batas keras Grok Imagine: satu klip maksimal 15 detik. */
export const MAKS_DETIK_PER_KLIP = 15;

/**
 * TARIF BELUM DIKETAHUI, dan sengaja tidak ditebak.
 *
 * Kami belum pernah melihat tagihan kie.ai. Mengembalikan 0 akan membuat
 * margin terlihat sempurna pada mesin yang harganya tidak pernah diperiksa
 * siapa pun — pola yang persis membuat tier Rp12.000 dijual di bawah biaya
 * selama berbulan-bulan. Jadi isi KIE_COST_PER_VIDEO_IDR dari tagihan yang
 * benar-benar dilihat; sampai itu ada, biayanya dilaporkan sebagai 0 DENGAN
 * peringatan di log, bukan diam-diam.
 */
function biayaIdr(): number {
  const n = parseInt(process.env.KIE_COST_PER_VIDEO_IDR ?? "", 10);
  if (Number.isFinite(n) && n > 0) return n;
  console.warn(
    "[kie-grok] KIE_COST_PER_VIDEO_IDR belum diisi — biaya render dilaporkan 0. " +
      "Angka margin apa pun yang memakai ini TIDAK sah sampai tarifnya diambil dari tagihan.",
  );
  return 0;
}

/** Rasio yang dipakai kie.ai berbentuk "lebar:tinggi". */
function rasioDari(spec: VisualSpec): string {
  if (spec.ratio) return spec.ratio;
  return spec.height >= spec.width ? "9:16" : "16:9";
}

async function ambilJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${config.kieApiKey}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const teks = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(teks) as Record<string, unknown>;
  } catch {
    /* jawaban bukan JSON — teks mentahnya ikut di pesan galat di bawah */
  }
  if (!res.ok) throw new Error(`[kie-grok] HTTP ${res.status} ${url}: ${teks.slice(0, 300)}`);
  return data;
}

/**
 * URL foto produk yang bisa DIUNDUH kie.ai.
 *
 * Path lokal tidak dikirim apa adanya: server mereka tidak punya disk kita,
 * dan kegagalannya baru muncul menit kemudian sebagai galat samar dari sisi
 * sana. Yang dikirim adalah salinan yang sengaja diterbitkan lewat gerbang
 * provider-in/ — lihat lib/gambar-provider.ts.
 */
async function urlGambar(spec: VisualSpec, shot: ShotSpec): Promise<string> {
  const p = shot.imageRefPath;
  if (!p) {
    throw new Error(
      `[kie-grok] shot ${shot.index} tanpa gambar acuan. grok-imagine/image-to-video menuntut ` +
        `image_urls — tanpa gambar, model ini tidak punya apa pun untuk digerakkan.`,
    );
  }
  // Sudah berupa alamat? Pakai apa adanya — menerbitkan ulang hanya menambah
  // salinan dan tautan yang harus dibersihkan.
  if (/^https?:\/\//i.test(p)) return p;
  return terbitkanGambarProvider(p, spec.jobId, shot.index);
}

/**
 * Badan permintaan createTask — dipisah dari pengirimannya supaya bisa diuji
 * tanpa jaringan, pola yang sama dengan buildTaskContent di provider BytePlus.
 */
export function buatBadanTask(spec: VisualSpec, shot: ShotSpec, imageUrl: string) {
  if (shot.durationSec > MAKS_DETIK_PER_KLIP) {
    throw new Error(
      `[kie-grok] shot ${shot.index}: ${shot.durationSec} detik melebihi batas ${MAKS_DETIK_PER_KLIP} detik.`,
    );
  }
  return {
    model: config.kieGrokModel,
    input: {
      image_urls: [imageUrl],
      index: 0,
      // Negative prompt DIGABUNG ke prompt: bentuk permintaan yang kami terima
      // tidak punya field terpisah untuknya, sementara aturan keras repo
      // mewajibkan "no text, no logo, no writing" ikut terkirim. Menghilangkannya
      // diam-diam berarti tier ini satu-satunya yang boleh melanggar aturan itu.
      prompt: `${shot.prompt}\n\nNEGATIVE: ${spec.negativePrompt}`,
      mode: "normal",
      aspect_ratio: rasioDari(spec),
      duration: Math.round(shot.durationSec),
      resolution: config.tiers[spec.qualityTier]?.resolution ?? "480p",
      nsfw_checker: true,
    },
  };
}

async function buatTask(spec: VisualSpec, shot: ShotSpec): Promise<string> {
  const data = await ambilJson(`${config.kieBaseUrl}${config.kiePathCreate}`, {
    method: "POST",
    body: JSON.stringify(buatBadanTask(spec, shot, await urlGambar(spec, shot))),
  });
  const id =
    (data.taskId as string) ??
    ((data.data as Record<string, unknown> | undefined)?.taskId as string) ??
    (data.id as string);
  if (!id) throw new Error(`[kie-grok] jawaban createTask tanpa taskId: ${JSON.stringify(data).slice(0, 300)}`);
  return id;
}

async function tungguHasil(taskId: string, mulai: number, batasMs: number): Promise<string> {
  for (;;) {
    if (Date.now() - mulai > batasMs) {
      throw new Error(`[kie-grok] task ${taskId} melewati batas ${Math.round(batasMs / 1000)} detik`);
    }
    const data = await ambilJson(
      `${config.kieBaseUrl}${config.kiePathRecord}?taskId=${encodeURIComponent(taskId)}`,
    );
    const isi = (data.data as Record<string, unknown> | undefined) ?? data;
    const status = String(isi.state ?? isi.status ?? "").toLowerCase();

    // Bentuk jawaban yang Brian berikan: { resultUrls: [ "...mp4" ] }
    const urls =
      (isi.resultUrls as string[] | undefined) ??
      ((isi.resultJson as Record<string, unknown> | undefined)?.resultUrls as string[] | undefined);
    if (urls?.length) return urls[0];

    if (status === "fail" || status === "failed" || status === "error") {
      throw new Error(`[kie-grok] task ${taskId} gagal: ${JSON.stringify(isi).slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

export const kieGrokVideo: VideoProvider = {
  name: "kie-grok-imagine",

  estimateCost(spec: VisualSpec): number {
    return spec.shots.length * biayaIdr();
  },

  async healthCheck(): Promise<boolean> {
    return Boolean(config.kieApiKey);
  },

  async generate(spec: VisualSpec, outDir: string): Promise<VideoAsset[]> {
    if (!config.kieApiKey) throw new ProviderNotConfigured("kie-grok-imagine", "KIE_API_KEY");

    const batasMs =
      (config.stateTimeoutsMin.GENERATING_VISUAL * 60_000) / Math.max(1, spec.shots.length);

    // Percobaan ulang MELANJUTKAN task yang sudah dibayar, bukan mengirim yang
    // baru — pola yang sama dengan BytePlus, dan alasannya sama: worker yang
    // mati saat polling kehilangan taskId bersama prosesnya, dan tanpa ini
    // kie.ai menagih dua kali untuk shot yang sama.
    const memo = taskMemo();
    const dikirim = await Promise.all(
      spec.shots.map(async (shot) => {
        const diingat = await memo.get(spec.jobId, shot.index, PROVIDER_KEY);
        if (diingat) {
          console.log(`[kie-grok] job ${spec.jobId} shot ${shot.index}: lanjutkan task ${diingat}`);
          return { shot, taskId: diingat, mulai: Date.now() };
        }
        const taskId = await buatTask(spec, shot);
        await memo.put(spec.jobId, shot.index, PROVIDER_KEY, taskId);
        console.log(`[kie-grok] job ${spec.jobId} shot ${shot.index}: task ${taskId} dikirim`);
        return { shot, taskId, mulai: Date.now() };
      }),
    );

    const assets: VideoAsset[] = [];
    for (const { shot, taskId, mulai } of dikirim) {
      const url = await tungguHasil(taskId, mulai, batasMs);
      const unduh = await fetch(url);
      if (!unduh.ok) throw new Error(`[kie-grok] unduh video HTTP ${unduh.status}`);
      const berkas = path.join(outDir, `shot${shot.index}.mp4`);
      fs.writeFileSync(berkas, Buffer.from(await unduh.arrayBuffer()));
      assets.push({
        filePath: path.resolve(berkas),
        durationSec: shot.durationSec,
        costIdr: biayaIdr(),
        // Grok Imagine selalu menghasilkan audio dan tidak punya tombol untuk
        // mematikannya — dinyatakan apa adanya, bukan disamakan dengan tier.
        hasAudio: true,
      });
    }
    return assets;
  },
};
