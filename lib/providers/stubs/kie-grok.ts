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
import { teksPromptShot } from "../teks-prompt";

const PROVIDER_KEY = "kie-grok";

/** Batas keras Grok Imagine: satu klip maksimal 15 detik. */
export const MAKS_DETIK_PER_KLIP = 15;

/**
 * BIAYA DIHITUNG DARI PEMAKAIAN YANG DILAPORKAN KIE.AI, BUKAN DITEBAK.
 *
 * recordInfo mengembalikan `creditsConsumed` — kredit kie.ai yang benar-benar
 * terpakai untuk task itu. Diverifikasi dengan render berbayar 2 Sep 2026:
 * satu klip 6 detik 480p menghabiskan 14,4 kredit, dan saldo akun turun persis
 * sebesar itu (21.091,5 -> 21.077,1).
 *
 * Yang BELUM diketahui adalah nilai rupiah satu kredit kie.ai — itu ada di
 * tagihan pembelian kredit, bukan di API. Selama KIE_IDR_PER_CREDIT belum
 * diisi, biayanya dilaporkan 0 DENGAN peringatan: angka margin apa pun yang
 * memakainya tidak sah. Mengembalikan tebakan diam-diam akan membuat mesin
 * yang harganya tidak pernah diperiksa siapa pun terlihat paling untung —
 * pola yang persis membuat tier Rp12.000 dijual di bawah biaya berbulan-bulan.
 */
function idrPerKredit(): number {
  const n = Number(process.env.KIE_IDR_PER_CREDIT ?? "");
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function biayaDariKredit(kredit: number): number {
  const tarif = idrPerKredit();
  if (!tarif) {
    console.warn(
      `[kie-grok] KIE_IDR_PER_CREDIT belum diisi — ${kredit} kredit kie.ai dilaporkan berbiaya 0. ` +
        "Isi dari tagihan pembelian kredit; sampai itu ada, angka margin yang memakainya TIDAK sah.",
    );
    return 0;
  }
  return Math.round(kredit * tarif);
}

/**
 * Perkiraan sebelum render, dipakai registry untuk mengurutkan provider.
 *
 * Diturunkan dari pengukuran nyata: 14,4 kredit untuk 6 detik = 2,4 kredit per
 * detik pada 480p. Ini PERKIRAAN; biaya yang dicatat ke job memakai angka yang
 * dilaporkan kie.ai untuk task itu sendiri.
 */
const KREDIT_PER_DETIK_480P = 2.4;

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
      // Teks yang PERSIS SAMA dengan yang dikirim ke BytePlus — disusun oleh
      // fungsi yang sama, bukan ditiru. Yang membedakan Standard dari Premium
      // dan Ultra hanya modelnya; promptnya tidak boleh berbeda satu byte pun.
      prompt: teksPromptShot(spec, shot),
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

/** Ambil daftar URL hasil dari bentuk apa pun yang dikirim kie.ai. */
export function ambilResultUrls(isi: Record<string, unknown>): string[] | undefined {
  const langsung = isi.resultUrls;
  if (Array.isArray(langsung) && langsung.length) return langsung as string[];

  const rj = isi.resultJson;
  const objek =
    typeof rj === "string"
      ? (() => {
          try { return JSON.parse(rj) as Record<string, unknown>; } catch { return undefined; }
        })()
      : (rj as Record<string, unknown> | undefined);
  const dari = objek?.resultUrls;
  return Array.isArray(dari) && dari.length ? (dari as string[]) : undefined;
}

async function tungguHasil(taskId: string, mulai: number, batasMs: number): Promise<{ url: string; kredit: number }> {
  for (;;) {
    if (Date.now() - mulai > batasMs) {
      throw new Error(`[kie-grok] task ${taskId} melewati batas ${Math.round(batasMs / 1000)} detik`);
    }
    const data = await ambilJson(
      `${config.kieBaseUrl}${config.kiePathRecord}?taskId=${encodeURIComponent(taskId)}`,
    );
    const isi = (data.data as Record<string, unknown> | undefined) ?? data;
    const status = String(isi.state ?? isi.status ?? "").toLowerCase();

    // resultJson datang sebagai STRING JSON, bukan objek — diverifikasi dari
    // jawaban sungguhan 2 Sep 2026:
    //   "resultJson": "{\"resultUrls\":[\"https://...mp4\"]}"
    // Memperlakukannya sebagai objek membuat urls selalu undefined dan
    // polling berputar sampai batas waktu untuk task yang sebenarnya SUKSES —
    // kegagalan yang paling mahal, karena rendernya sudah dibayar.
    const urls = ambilResultUrls(isi);
    if (urls?.length) return { url: urls[0], kredit: Number(isi.creditsConsumed ?? 0) };

    if (status === "fail" || status === "failed" || status === "error") {
      throw new Error(`[kie-grok] task ${taskId} gagal: ${JSON.stringify(isi).slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

export const kieGrokVideo: VideoProvider = {
  name: "kie-grok-imagine",

  estimateCost(spec: VisualSpec): number {
    const detik = spec.shots.reduce((n, s) => n + s.durationSec, 0);
    return biayaDariKredit(detik * KREDIT_PER_DETIK_480P);
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
      const { url, kredit } = await tungguHasil(taskId, mulai, batasMs);
      const unduh = await fetch(url);
      if (!unduh.ok) throw new Error(`[kie-grok] unduh video HTTP ${unduh.status}`);
      const berkas = path.join(outDir, `shot${shot.index}.mp4`);
      fs.writeFileSync(berkas, Buffer.from(await unduh.arrayBuffer()));
      assets.push({
        filePath: path.resolve(berkas),
        durationSec: shot.durationSec,
        costIdr: biayaDariKredit(kredit),
        // Grok Imagine selalu menghasilkan audio dan tidak punya tombol untuk
        // mematikannya — dinyatakan apa adanya, bukan disamakan dengan tier.
        hasAudio: true,
      });
    }
    return assets;
  },
};
