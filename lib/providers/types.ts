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
  index: number;
  durationSec: number;
  prompt: string;
  /** Foto produk asli pengguna sebagai image reference — AI tidak menggambar produk dari nol. */
  imageRefPath: string;
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
  if (!spec.negativePrompt.toLowerCase().includes("no text")) {
    throw new Error(
      "DILARANG: prompt ke model video wajib menyertakan negative instruction 'no text, no logo, no writing'."
    );
  }
}
