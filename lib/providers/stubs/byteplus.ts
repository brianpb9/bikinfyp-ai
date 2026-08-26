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
import { taskMemo } from "../task-memo";

// Tarif referensi (USD). Sumber:
// - seedance-1-0-pro: $2,5/1M output tokens — https://docs.byteplus.com/docs/ModelArk/1587798
// - pro-fast: 480p $0,01/dtk, 1080p $0,048/dtk — https://opper.ai/bytedance/seedance-1-0-pro-fast
// - lite: ~$0,010/dtk — https://soravideo.art/blog/seedance-2-pricing
// - 1.5 pro: ~$0,26 per 5 dtk 720p — https://tutorial.theaibuilders.dev (Seedance API tutorial)
//
// URUTAN HITUNG: TOKEN DULU, tarif/detik hanya kalau token tidak tersedia.
// Alasannya ada di blok "BIAYA DITENTUKAN MODE" di bawah, dan ini bukan
// preferensi gaya: BytePlus menagih per TOKEN, sedangkan tarif/detik secara
// struktural BUTA terhadap penggandaan mode. Dua render 15 detik — satu tanpa
// referensi (324.900 token), satu dengan reference_video (648.900 token) —
// dilaporkan jalur per-detik dengan angka yang SAMA PERSIS. Itu bukan
// ketidaktelitian tarif; itu satuan yang salah.
type TarifModel = {
  tokenUsdPerM?: number;
  perSecUsd?: Record<string, number>;
  /**
   * Asal tokenUsdPerM — wajib diisi bila tokenUsdPerM ada, supaya tidak ada
   * tarif yang masuk tabel ini tanpa ketahuan dari mana:
   *   "publik"       tarif brosur/dokumentasi vendor.
   *   "turunan-cogs" DIBALIK dari asumsi COGS BRD, jadi MELINGKAR: BRD yang
   *                  menetapkan rupiahnya, dan angka ini hanya menyatakan
   *                  ulang asumsi yang sama dalam satuan token. Ia TIDAK
   *                  membuktikan apa pun tentang tarif akun kita — gunanya
   *                  cuma satu, yaitu membuat laporan biaya ikut bergerak
   *                  saat mode berubah.
   */
  asalTarifToken?: "publik" | "turunan-cogs";
};
const MODEL_RATES: Record<string, TarifModel> = {
  "seedance-1-0-lite-i2v-250428": { perSecUsd: { "480p": 0.01, "720p": 0.02 } }, // Retiring — jangan dipakai
  "seedance-1-0-lite-t2v-250428": { perSecUsd: { "480p": 0.01, "720p": 0.02 } }, // Retiring
  "seedance-1-0-pro-fast-251015": { perSecUsd: { "480p": 0.01, "720p": 0.024, "1080p": 0.048 } },
  "seedance-1-0-pro-fast-250528": { perSecUsd: { "480p": 0.01, "720p": 0.024, "1080p": 0.048 } },
  "seedance-1-0-pro-250528": { tokenUsdPerM: 2.5, asalTarifToken: "publik" },
  "seedance-1-5-pro-251215": { perSecUsd: { "480p": 0.026, "720p": 0.052 } },
  // KEDUA TARIF TOKEN DI BAWAH INI MELINGKAR, dan itu ditulis di sini supaya
  // tidak ada yang mengutipnya sebagai tarif. perSecUsd lamanya ($0,034 dan
  // $0,143) SENDIRI diturunkan dari COGS BRD §5.3 — BRD menetapkan Rp8.802,
  // kode membaliknya jadi tarif/detik, laporan biaya menampilkan Rp8.802 lagi,
  // lalu terlihat "cocok". Tidak pernah sekali pun diperiksa ke sesuatu di
  // luar dirinya sendiri. Mengubahnya ke satuan token TIDAK memperbaiki itu.
  //
  // Yang diperbaiki cuma satu hal, dan itu yang membuatnya layak: rupiahnya
  // kini bergerak mengikuti token nyata, jadi render dengan reference_video
  // berhenti dilaporkan semurah render tanpa referensi.
  //
  //   mini      Rp 8.802 @ 324.900 token (15 dtk 720p, TANPA ref)  -> $1,66/1M
  //   2.0 penuh Rp37.164 @ 648.900 token (15 dtk 720p, DENGAN ref) -> $3,51/1M
  //
  // DAN KONVERSINYA MEMBUKA SATU ANGKA LAGI: pada MODE YANG SAMA, jarak tarif
  // mini vs 2.0 penuh cuma 2,11x — bukan 4,21x seperti yang disiratkan
  // $0,034 vs $0,143. Tarif/detik lama menggabungkan selisih TARIF dengan
  // selisih MODE menjadi satu angka, karena BRD menurunkan mini dari kasus
  // tanpa referensi dan 2.0 penuh dari kasus dengan referensi. Jadi separuh
  // dari "mini jauh lebih murah" selama ini adalah mode, bukan model.
  "dreamina-seedance-2-0-mini-260615": {
    tokenUsdPerM: 1.66, asalTarifToken: "turunan-cogs", perSecUsd: { "720p": 0.034 },
  },
  "dreamina-seedance-2-0-260128": {
    tokenUsdPerM: 3.51, asalTarifToken: "turunan-cogs", perSecUsd: { "720p": 0.143 },
  },
  // Seedance 2.5 — tarif TOKEN, bukan per-detik. Lihat catatan panjang di bawah.
  "dreamina-seedance-2-5-260628": { tokenUsdPerM: 10.7, asalTarifToken: "publik" },
};

/**
 * Token per detik NYATA di akun ini, mode BERREFERENSI — diukur, bukan ditaksir
 * (704 task, scripts/tarif-seedance-25.ts): 648.900 token / 15 dtk pada 720p.
 *
 * Dipakai HANYA untuk taksiran pra-render, saat `usage` belum ada. Yang dipakai
 * angka mode berreferensi karena itulah mode yang benar-benar kita jalankan —
 * wajah dikunci dengan reference_video di setiap job. Memproyeksikan dengan
 * angka tanpa-referensi (21.660/dtk) akan menaksir SETENGAH dari biaya nyata,
 * dan taksiran yang kemurahan persis jenis kesalahan yang membuat cap anggaran
 * terlampaui tanpa satu pun gerbang menyadarinya.
 *
 * 480p dan 1080p SENGAJA tidak diisi: keduanya belum diukur per-mode di akun
 * ini, dan menebaknya di sini berarti menaruh angka karangan tepat di jalur
 * yang memutuskan uang. Keduanya jatuh ke tarif/detik, dan jatuhnya ditandai.
 */
const TOKEN_PER_DETIK_DENGAN_REF: Record<string, number> = { "720p": 43_260 };

// ─────────────────────────────────────────────────────────────────────────────
// KENAPA 2.5 MEMAKAI TARIF TOKEN, DAN KENAPA ANGKA DI ATAS BELUM BOLEH DISEBUT
// COGS RESMI — diukur 26 Agu 2026 dari 704 task NYATA di akun ini (hanya baca,
// nol render): scripts/tarif-seedance-25.ts
//
// YANG TERUKUR (fakta akun kita sendiri):
//   Konsumsi token TIDAK bergantung versi model. Ia fungsi resolusi x durasi x
//   mode. Pada 720p seluruh model duduk di ~21.660 token/detik; pada 1080p
//   ~48.700 — sama untuk 2.0, 2.0-mini, DAN 2.5.
//   Pada 15 detik/720p muncul TIGA tingkat token yang sama di ketiga model:
//   324.900 · 540.900 · 648.900 (n=63/88/95). Jadi selisihnya datang dari MODE
//   (jumlah gambar acuan / reference-video), bukan dari versi model.
//
// BIAYA DITENTUKAN MODE, BUKAN MODEL (temuan Brian 27 Agu, 8 task malam itu —
// dan ini yang paling penting dari seluruh pengukuran):
//   mini TANPA referensi          324.900 token
//   mini + reference_video        648.900 token   <-- SAMA PERSIS dengan 2.5
//   2.0 penuh + reference_video   648.900 token
//   2.5 + reference_video         648.900 token
//
//   Kita WAJIB memakai reference_video untuk mengunci wajah. Artinya SETIAP
//   video berwajah konsisten otomatis dua kali lipat biayanya, DI TIER MANA
//   PUN — dan model termurah dengan reference_video menghabiskan sama persis
//   dengan model termahal. Jadi struktur tier "mini murah, 2.5 mahal" keliru
//   secara KONSEP, bukan cuma angkanya.
//
// YANG BELUM TERUKUR: harga rupiah per token untuk AKUN INI. Tidak ada
// kredensial tagihan di lingkungan ini (VOLC_ACCESSKEY dkk kosong), jadi
// invoice tidak bisa dibaca. Brian yang mengambilnya.
//
// SELISIHNYA ADALAH SELISIH TARIF, BUKAN "COGS KERENDAHAN".
// Versi pertama catatan ini menyimpulkan COGS kita 1,5x-3x kerendahan. Itu
// terlalu kuat: ia mengandaikan tarif brosur berlaku untuk akun kita. Yang
// benar-benar bisa dikatakan hanya bahwa keduanya tidak cocok:
//
//   tarif TERSIRAT config.ts   $1,66/1M (mini, tanpa ref)
//                              $3,51/1M (super_hq, dengan ref)
//   tarif PUBLIK Seedance 2.5  $6,40/1M (dengan video input)
//                              $10,70/1M (tanpa video input)
//
//   Config menyiratkan tarif 3,4x sampai 6,4x LEBIH MURAH dari brosur.
//   Kalau kontrak diskon kita nyata, config benar dan brosur tidak relevan.
//   Kalau tidak, tier Rp12.000 rugi selama ini. Arahnya ditentukan TAGIHAN,
//   bukan oleh salah satu dari dua angka ini.
//
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * Hasil hitung biaya. `dasar` ADA supaya laporan tidak lagi menyembunyikan
 * perbedaan kualitas antar angka di balik satu boolean:
 *   "token-nyata"     dari usage.total_tokens respons API — satu-satunya jalur
 *                     yang memakai satuan yang sama dengan tagihan, dan
 *                     satu-satunya yang bisa membedakan mode.
 *   "token-proyeksi"  token diproyeksikan dari durasi (pra-render, belum ada
 *                     usage), mode berreferensi.
 *   "tarif-per-detik" JATUH ke tarif/detik — BUTA terhadap mode.
 *   "tarif-tertinggi" model tak dikenal, ditaksir semahal-mahalnya.
 */
export type HasilBiaya = {
  idr: number;
  /** true bila idr TIDAK dihitung dari pemakaian nyata. */
  estimated: boolean;
  dasar: "token-nyata" | "token-proyeksi" | "tarif-per-detik" | "tarif-tertinggi";
  /**
   * total_tokens dari respons API bila ada. DIBAWA KELUAR, tidak dibuang:
   * tagihan BytePlus didenominasi dalam token, jadi tanpa angka ini "tunggu
   * tagihannya" adalah rencana yang tidak bisa dijalankan — tidak ada sisi
   * kita untuk dicocokkan.
   */
  totalTokens?: number;
  /** Asal tarif yang dipakai. "turunan-cogs" berarti MELINGKAR — lihat TarifModel. */
  asalTarif?: "publik" | "turunan-cogs";
};

/** Diekspor untuk uji tarif — lihat tests/tarif-model-tak-dikenal.test.ts. */
export function hitungBiayaUntukUji(model: string, totalTokens: number | undefined, durationSec: number, resolution: string) {
  return estimateCostIdr(model, totalTokens, durationSec, resolution);
}

function estimateCostIdr(model: string, totalTokens: number | undefined, durationSec: number, resolution: string): HasilBiaya {
  const rate = MODEL_RATES[model] ?? {};

  // 1. PEMAKAIAN NYATA — selalu didahulukan bila ada.
  if (totalTokens && rate.tokenUsdPerM) {
    return {
      idr: Math.round((totalTokens / 1_000_000) * rate.tokenUsdPerM * config.usdIdr),
      estimated: false,
      dasar: "token-nyata",
      totalTokens,
      asalTarif: rate.asalTarifToken,
    };
  }

  // 2. PROYEKSI TOKEN — pra-render, saat usage memang belum bisa ada.
  const tokenPerDetik = TOKEN_PER_DETIK_DENGAN_REF[resolution];
  if (rate.tokenUsdPerM && tokenPerDetik) {
    const proyeksi = Math.round(durationSec * tokenPerDetik);
    return {
      idr: Math.round((proyeksi / 1_000_000) * rate.tokenUsdPerM * config.usdIdr),
      estimated: true,
      dasar: "token-proyeksi",
      asalTarif: rate.asalTarifToken,
    };
  }

  // 3. JATUH KE TARIF/DETIK. Ditandai, bukan didiamkan: angka dari jalur ini
  //    tidak bisa membedakan render berreferensi dari yang tidak.
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
    return { idr: Math.round(durationSec * tarifDikenal * config.usdIdr), estimated: true, dasar: "tarif-per-detik" };
  }
  const tertinggi = Math.max(
    ...Object.values(MODEL_RATES).flatMap((r) => Object.values(r.perSecUsd ?? {})),
    0.01
  );
  console.warn(
    `[byteplus] model "${model}" TIDAK ada di MODEL_RATES — biaya ditaksir dengan tarif TERTINGGI yang diketahui ` +
      `($${tertinggi}/dtk). Tambahkan tarifnya sebelum angka ini dipakai untuk keputusan harga.`
  );
  return { idr: Math.round(durationSec * tertinggi * config.usdIdr), estimated: true, dasar: "tarif-tertinggi" };
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

async function createTask(spec: VisualSpec, shot: ShotSpec): Promise<string> {
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
        const remembered = await memo.get(spec.jobId, shot.index, PROVIDER_KEY);
        if (remembered) {
          console.log(`[byteplus] job ${spec.jobId} shot ${shot.index}: lanjutkan task ${remembered} (tidak submit ulang)`);
          return { shot, taskId: remembered, startedAt: Date.now() };
        }
        const taskId = await createTask(spec, shot);
        // Disimpan SEBELUM polling. Menyimpannya setelah polling selesai tidak
        // ada gunanya — justru jendela antara submit dan selesai itulah yang
        // ingin dilindungi.
        await memo.put(spec.jobId, shot.index, PROVIDER_KEY, taskId);
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
      // TOKEN IKUT DICATAT DI LOG, dan itu disengaja: tagihan BytePlus
      // didenominasi token, jadi log inilah sisi kita saat rekonsiliasi.
      // Sebelumnya angka ini dibaca dari respons lalu dibuang begitu saja.
      const jejakToken = cost.totalTokens !== undefined ? `, token=${cost.totalTokens}` : "";
      const jejakTarif = cost.asalTarif === "turunan-cogs" ? " [tarif MELINGKAR: turunan asumsi COGS]" : "";
      const peringatanButaMode =
        cost.dasar === "tarif-per-detik" || cost.dasar === "tarif-tertinggi"
          ? " [BUTA MODE: tarif/detik tidak membedakan render berreferensi]"
          : "";
      console.log(
        `[byteplus] job ${spec.jobId} shot ${shot.index}: selesai ${secs} dtk, model=${tierCfg.byteplusModel}, ` +
          `audio=${spec.generateAudio}, biaya Rp${cost.idr} (dasar=${cost.dasar}${jejakToken})${jejakTarif}${peringatanButaMode}`
      );
      assets.push({
        filePath: path.resolve(outPath),
        durationSec: durSec,
        costIdr: cost.idr,
        hasAudio: spec.generateAudio,
        usageTokens: cost.totalTokens,
      });
    }
    return assets;
  },
};
