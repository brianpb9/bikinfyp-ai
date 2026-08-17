// Abstraksi provider AI (SRS §4.3). WAJIB: minimal 2 provider per jenis, failover otomatis.
//
// ATURAN SUARA (KEPUTUSAN FINAL 31 Jul 2026 — mengganti aturan "selalu senyap"):
// pengaturan audio diturunkan dari quality_tier, TIDAK PERNAH bisa diubah user:
//   silent_caption -> generate_audio=false (video bisu + caption tersinkron + musik)
//   high_quality   -> generate_audio=true  (audio embedded dari model)
//   super_hq       -> generate_audio=true  (audio embedded dari model)
// VisualSpec.generateAudio WAJIB konsisten dengan qualityTier — divalidasi registry.
//
// ATURAN KERAS (tetap): prompt ke model video WAJIB menyertakan negative instruction
// "no text, no logo, no writing" — divalidasi registry sebelum panggilan.

export class ProviderNotConfigured extends Error {
  constructor(provider: string, envKey: string) {
    super(`Provider ${provider} belum dikonfigurasi: env ${envKey} kosong`);
    this.name = "ProviderNotConfigured";
  }
}

export type QualityTier = "silent_caption" | "high_quality" | "super_hq";

export interface ShotSpec {
  /** true bila shot ini memang TANPA ORANG (packshot produk).
   *
   *  Dipakai dua hal: memastikan promptnya tidak ikut membawa kunci subjek
   *  (lihat shot-planner), dan menandai shot yang boleh dibangun dari FOTO
   *  ASLI brand alih-alih digenerate — lihat lib/media/packshot-asli.ts. */
  tanpaOrang?: boolean;
  index: number;
  durationSec: number;
  prompt: string;
  /** Foto produk asli pengguna sebagai image reference — AI tidak menggambar produk dari nol. */
  imageRefPath: string;
  /** Produk TIDAK boleh terlihat di shot ini (dari peran template/rute).
   *
   *  Dibawa sebagai DATA, bukan disimpulkan dari teks prompt: keputusan yang
   *  mengeluarkan uang (frame pertama buatan) tidak boleh bergantung pada
   *  kebetulan pilihan kata dalam prompt berbahasa Inggris. */
  withholdProduct?: boolean;
  /**
   * Keadaan yang SUDAH BENAR di frame pertama, sebagaimana ditulis penulis
   * naskah ("the bottle is already in her hand at chest height").
   *
   * Dibawa sebagai data karena frame turunan dibangun DARI kalimat ini.
   * Prompt shot menggambarkan apa yang TERJADI sepanjang klip; frame pertama
   * butuh apa yang sudah benar SEBELUM ada yang bergerak. Memakai prompt shot
   * sebagai gantinya membuat frame pertamanya menggambarkan gerakan, dan model
   * video lalu mengulang gerakan yang sudah terjadi.
   *
   * Kosong pada jalur template — di situ frame turunan memakai prompt shot.
   */
  startState?: string;
}

export interface VisualSpec {
  jobId: string;
  width: number;
  height: number;
  shots: ShotSpec[];
  negativePrompt: string; // wajib mengandung MANDATORY_NEGATIVE_PROMPT
  qualityTier: QualityTier;
  /** Wajib === (qualityTier !== 'silent_caption'). */
  generateAudio: boolean;
  /** Foto produk ke-2..5 sebagai referensi identitas TAMBAHAN (2026-08-06).
   * Hanya dipakai model yang mendukung mode reference-to-video (Seedance 2.0);
   * ModelArk MELARANG first_frame dicampur reference_image, jadi provider
   * beralih ke mode semua-referensi bila daftar ini terisi (diverifikasi
   * nyata: r2v butuh durasi >= 4 dtk). */
  extraReferenceImagePaths?: string[];
  /** AI UGC Ads: gambar yang dikirim adalah VISUAL BISNIS (logo, foto toko,
   * screenshot app) — konteks, BUKAN subjek yang harus muncul utuh di layar.
   *
   * Bedanya penting. Pada jalur i2v biasa, gambar menjadi frame pertama, jadi
   * mengirim logo akan menghasilkan video tentang logo. Untuk iklan jasa yang
   * kita inginkan adalah presenter yang berbicara, dengan visual bisnis
   * sekadar mengarahkan suasana — itu peran reference_image, bukan first
   * frame. */
  referenceOnlyImages?: boolean;
  /** Paksa mode i2v (frame pertama persis) — CADANGAN, bukan jalur biasa.
   *
   *  Bawaan sekarang r2v karena i2v terbukti merusak nama merek dan memaksa
   *  pack shot di detik pertama (spike 17 Agu 2026, docs/spike-2026-08-17).
   *  Nyalakan hanya kalau memang butuh frame pertama yang identik dengan foto
   *  — dan sadari harganya. */
  preferI2v?: boolean;
  /** Rasio aspek yang diminta ("9:16" | "1:1" | "16:9").
   *
   * TERBUKTI hanya "9:16" — itu satu-satunya nilai yang pernah benar-benar
   * dirender ke BytePlus. Parameternya memang ada di API mereka, jadi dua
   * nilai lain sangat mungkin jalan, tapi sampai ada render berbayar yang
   * membuktikannya jangan diperlakukan sebagai fakta. */
  ratio?: string;
  /** Berapa orang yang boleh ada di frame (lihat maksOrangPerFrame di
   *  shot-planner). Dibawa di spec supaya QC-11 memeriksa aturan yang PERSIS
   *  sama dengan yang diperintahkan ke model, bukan tebakannya sendiri. */
  maxPeople?: number;
}

export interface VideoAsset {
  filePath: string;
  durationSec: number;
  costIdr: number;
  /** true bila klip membawa audio embedded (tier bersuara via provider nyata). */
  hasAudio?: boolean;
}

export interface VoiceSpec {
  jobId: string;
  text: string;
  segmentIndex: number;
  /** Batas waktu segmen (detik) — VO tidak boleh melebihi slotnya. */
  slotSec: number;
  language: "id-ID";
  register: string;
}

export interface AudioAsset {
  filePath: string;
  durationSec: number;
  costIdr: number;
}

export interface VideoProvider {
  readonly name: string;
  generate(spec: VisualSpec, outDir: string): Promise<VideoAsset[]>;
  estimateCost(spec: VisualSpec): number;
  healthCheck(): Promise<boolean>;
}

export interface VoiceProvider {
  readonly name: string;
  synthesize(spec: VoiceSpec, outDir: string): Promise<AudioAsset>;
  estimateCost(spec: VoiceSpec): number;
  healthCheck(): Promise<boolean>;
}

/** true bila nama provider adalah provider simulasi lokal. */
export const isMockProviderName = (name: string) => name.startsWith("mock-");

/** Validasi wajib sebelum VisualSpec boleh dikirim ke provider mana pun. */
export function assertVisualSpec(spec: VisualSpec) {
  const expected = spec.qualityTier !== "silent_caption";
  if (spec.generateAudio !== expected) {
    throw new Error(
      `DILARANG: generateAudio (${spec.generateAudio}) tidak konsisten dengan tier ${spec.qualityTier} ` +
        `(harus ${expected}). Pengaturan audio hanya boleh diturunkan dari tier.`
    );
  }
  // Yang divalidasi: larangan OVERLAY tambahan, bukan larangan tulisan.
  // Versi lama menuntut substring "no text" — dan itu justru yang menekan
  // label produk sampai jadi coretan (lihat MANDATORY_NEGATIVE_PROMPT).
  if (!spec.negativePrompt.toLowerCase().includes("no added text overlay")) {
    throw new Error(
      "DILARANG: prompt ke model video wajib menyertakan negative instruction 'no added text overlay' " +
        "(melarang lapisan teks tambahan, BUKAN melarang tulisan yang tercetak di produk)."
    );
  }
}
