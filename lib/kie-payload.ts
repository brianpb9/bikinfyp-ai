/**
 * Bentuk permintaan kie.ai PER MODEL.
 *
 * ---------------------------------------------------------------------------
 * KENAPA DIPISAH PER MODEL
 * ---------------------------------------------------------------------------
 * Brian 9 Sep 2026 menambahkan tiga model kie.ai, dan ketiganya menuntut bentuk
 * masukan yang BERBEDA — bukan sekadar nilai berbeda:
 *
 *   grok-imagine/image-to-video   image_urls[]        + index + mode
 *   bytedance/seedance-2-mini     first_frame_url     + last_frame_url
 *   bytedance/seedance-2-5        reference_image_urls[] + reference_video/audio
 *   seedream/5-pro-image-to-image image_urls[]        + quality (GAMBAR, bukan video)
 *
 * Satu bentuk untuk semuanya berarti model yang baru dipilih admin menerima
 * medan yang tidak ia kenal dan kehilangan medan yang ia wajibkan. Yang terjadi
 * bukan galat yang jelas melainkan generation yang gagal di sisi provider,
 * beberapa menit kemudian, dengan pesan yang tidak menyebut medan mana yang
 * kurang. Persis yang Brian minta dihindari.
 *
 * ---------------------------------------------------------------------------
 * MODEL TAK DIKENAL DITOLAK, BUKAN DITEBAK
 * ---------------------------------------------------------------------------
 * badanKie() melempar untuk model yang belum punya pembangun. Menjatuhkannya ke
 * bentuk grok "supaya jalan" adalah cara terpelan untuk membakar uang: tugasnya
 * terkirim, ditagih, lalu gagal — dan lognya menunjuk provider, bukan kita.
 */

export type ModelKie =
  | "grok-imagine/image-to-video"
  | "bytedance/seedance-2-mini"
  | "bytedance/seedance-2-5"
  | "seedream/5-pro-image-to-image";

/** Model kie.ai yang menghasilkan GAMBAR, bukan video. Jalur pemakaiannya beda. */
export const MODEL_GAMBAR_KIE: readonly string[] = ["seedream/5-pro-image-to-image"];

export interface KonteksVideo {
  prompt: string;
  /** Gambar acuan yang sudah BERUPA URL publik — kie.ai mengambilnya sendiri. */
  imageUrls: string[];
  aspectRatio: string;
  durationSec: number;
  resolution: string;
  generateAudio: boolean;
  /** Frame terakhir, kalau ada. Hanya dipakai model yang menerimanya. */
  lastFrameUrl?: string | null;
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
}

export interface KonteksGambar {
  prompt: string;
  imageUrls: string[];
  aspectRatio: string;
  /** "basic" | "hd" menurut kie.ai. Dibiarkan string supaya nilai baru tidak
   *  menuntut deploy hanya untuk dikenali. */
  quality?: string;
  outputFormat?: string;
}

/** Nilai yang dikirim ke SEMUA model. Dikumpulkan supaya tidak ada satu model
 *  pun yang diam-diam lupa mengaktifkan penyaring konten. */
const SELALU = { nsfw_checker: true } as const;

export function badanKieVideo(model: string, k: KonteksVideo): Record<string, unknown> {
  const durasi = Math.round(k.durationSec);

  switch (model) {
    case "grok-imagine/image-to-video":
      return {
        image_urls: k.imageUrls,
        index: 0,
        prompt: k.prompt,
        mode: "normal",
        aspect_ratio: k.aspectRatio,
        duration: durasi,
        resolution: k.resolution,
        ...SELALU,
      };

    case "bytedance/seedance-2-mini": {
      if (k.imageUrls.length === 0) {
        throw new Error("[kie] seedance-2-mini menuntut first_frame_url — tanpa gambar awal ia tidak punya apa pun untuk digerakkan.");
      }
      return {
        first_frame_url: k.imageUrls[0],
        // last_frame_url DIHILANGKAN kalau tidak ada, bukan dikirim kosong.
        // Medan kosong bukan "tidak diisi" bagi provider — ia URL tidak sah, dan
        // ditolak lebih keras daripada medan yang memang tidak ada.
        ...(k.lastFrameUrl ? { last_frame_url: k.lastFrameUrl } : {}),
        prompt: k.prompt,
        generate_audio: k.generateAudio,
        resolution: k.resolution,
        aspect_ratio: k.aspectRatio,
        duration: durasi,
        web_search: false,
        ...SELALU,
      };
    }

    case "bytedance/seedance-2-5":
      return {
        prompt: k.prompt,
        reference_image_urls: k.imageUrls,
        // Array kosong DIHILANGKAN. Sebagian model memperlakukan array kosong
        // sebagai "ada rujukan tapi tak terbaca" dan menolak permintaannya.
        ...(k.referenceVideoUrls?.length ? { reference_video_urls: k.referenceVideoUrls } : {}),
        ...(k.referenceAudioUrls?.length ? { reference_audio_urls: k.referenceAudioUrls } : {}),
        generate_audio: k.generateAudio,
        resolution: k.resolution,
        aspect_ratio: k.aspectRatio,
        duration: durasi,
        output_format: "mp4",
        web_search: false,
        ...SELALU,
      };

    default:
      throw new Error(
        `[kie] model "${model}" belum punya pembangun payload. ` +
          `Menebak bentuknya berarti mengirim tugas yang ditagih lalu gagal — ` +
          `tambahkan modelnya di lib/kie-payload.ts dulu.`,
      );
  }
}

export function badanKieGambar(model: string, k: KonteksGambar): Record<string, unknown> {
  switch (model) {
    case "seedream/5-pro-image-to-image": {
      if (k.imageUrls.length === 0) {
        throw new Error("[kie] seedream/5-pro-image-to-image menuntut image_urls — ia mengubah gambar, bukan membuat dari nol.");
      }
      return {
        prompt: k.prompt,
        image_urls: k.imageUrls,
        aspect_ratio: k.aspectRatio,
        quality: k.quality ?? "basic",
        output_format: k.outputFormat ?? "png",
        ...SELALU,
      };
    }
    default:
      throw new Error(`[kie] model gambar "${model}" belum punya pembangun payload.`);
  }
}
