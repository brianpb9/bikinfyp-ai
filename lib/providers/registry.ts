// Registry provider (SRS SR-ABS-01..03):
// - minimal 2 provider video & 2 provider voice terdaftar,
// - pemilihan: ketersediaan -> biaya -> skor historis,
// - failover otomatis saat provider gagal,
// - biaya aktual per panggilan dikembalikan untuk dicatat ke jobs.cost_actual_idr.

import { config } from "../config";
import {
  assertVisualSpec,
  type VideoProvider, type VoiceProvider,
  type VisualSpec, type VoiceSpec, type VideoAsset, type AudioAsset,
} from "./types";
import { mockVideoA } from "./mock/video-a";
import { mockVideoB } from "./mock/video-b";
import { mockVoiceA } from "./mock/voice-a";
import { mockVoiceB } from "./mock/voice-b";
import { byteplusVideo } from "./stubs/byteplus";
import { dashscopeVideo } from "./stubs/dashscope";
// google-tts.ts & azure-tts.ts sengaja TIDAK diimpor: TTS terpisah tidak dipakai di
// jalur produksi (keputusan final 31 Jul) — file dipertahankan sebagai referensi.

// Skor kualitas historis (in-memory; produksi: agregasi dari jobs.qc_result).
const historyScore = new Map<string, number>();
function score(name: string): number {
  return historyScore.get(name) ?? 1.0;
}
function reportResult(name: string, ok: boolean) {
  const cur = score(name);
  historyScore.set(name, ok ? Math.min(1, cur + 0.02) : Math.max(0, cur - 0.2));
}

function videoOrder(): VideoProvider[] {
  const active = config.providerVideo; // "mock" | "byteplus" | "dashscope"
  const list: VideoProvider[] = [];
  if (active === "byteplus") list.push(byteplusVideo, dashscopeVideo);
  else if (active === "dashscope") list.push(dashscopeVideo, byteplusVideo);
  else list.push(mockVideoA, mockVideoB);
  // Mock is a local-test aid only. A production provider outage must fail the
  // job and refund it; silently substituting generated mock media would be a
  // deceptive successful response and invalidates a production smoke.
  if (process.env.NODE_ENV !== "production") {
    for (const p of [mockVideoA, mockVideoB]) if (!list.includes(p)) list.push(p);
  }
  return list;
}

function voiceOrder(): VoiceProvider[] {
  // KEPUTUSAN FINAL 31 Jul 2026: TTS terpisah (Google/Azure/ElevenLabs) TIDAK dipakai
  // untuk jalur produksi — audio tier bersuara digenerate embedded oleh model video.
  // Registry voice hanya berisi mock: untuk mock, `say` mensimulasikan audio embedded
  // (dev/test gratis). google-tts.ts/azure-tts.ts tetap ada sebagai referensi saja.
  return [mockVoiceA, mockVoiceB];
}

export function registeredVideoProviders(): string[] {
  return videoOrder().map((p) => p.name);
}
export function registeredVoiceProviders(): string[] {
  return voiceOrder().map((p) => p.name);
}

export interface VideoGenResult {
  assets: VideoAsset[];
  providerName: string;
  costIdr: number;
}

export async function generateVideoWithFailover(spec: VisualSpec, outDir: string): Promise<VideoGenResult> {
  assertVisualSpec(spec); // aturan keras #1 & #3 — ditegakkan di runtime
  const providers = videoOrder();
  if (providers.length < 2) throw new Error("SR-ABS-01: minimal 2 provider video wajib terdaftar");

  // Ketersediaan dulu, lalu biaya, lalu skor historis.
  const available: VideoProvider[] = [];
  for (const p of providers) {
    try {
      if (await p.healthCheck()) available.push(p);
    } catch {
      /* provider tidak sehat */
    }
  }
  // Urutan konfigurasi (videoOrder) adalah kunci utama: provider yang dipilih operator
  // selalu didahulukan; biaya & skor historis hanya tiebreaker di dalam tier yang sama.
  // Tanpa ini, mock yang lebih murah diam-diam menyalip provider nyata yang dikonfigurasi.
  const priority = new Map(providers.map((p, i) => [p.name, i]));
  available.sort(
    (a, b) =>
      (priority.get(a.name) ?? 99) - (priority.get(b.name) ?? 99) ||
      a.estimateCost(spec) - b.estimateCost(spec) ||
      score(b.name) - score(a.name)
  );

  const errors: string[] = [];
  for (const p of available) {
    try {
      const assets = await p.generate(spec, outDir);
      reportResult(p.name, true);
      return { assets, providerName: p.name, costIdr: assets.reduce((s, a) => s + a.costIdr, 0) };
    } catch (err) {
      reportResult(p.name, false);
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${p.name}: ${msg}`);
      console.warn(`[failover] video ${p.name} gagal: ${msg} -> coba provider berikutnya`);
    }
  }
  throw new Error(`Semua provider video gagal: ${errors.join(" | ")}`);
}

export interface VoiceGenResult {
  asset: AudioAsset;
  providerName: string;
  costIdr: number;
}

export async function synthesizeVoiceWithFailover(spec: VoiceSpec, outDir: string): Promise<VoiceGenResult> {
  const providers = voiceOrder();
  if (providers.length < 2) throw new Error("SR-ABS-01: minimal 2 provider voice wajib terdaftar");

  const available: VoiceProvider[] = [];
  for (const p of providers) {
    try {
      if (await p.healthCheck()) available.push(p);
    } catch {
      /* provider tidak sehat */
    }
  }
  const priority = new Map(providers.map((p, i) => [p.name, i]));
  available.sort(
    (a, b) =>
      (priority.get(a.name) ?? 99) - (priority.get(b.name) ?? 99) ||
      a.estimateCost(spec) - b.estimateCost(spec) ||
      score(b.name) - score(a.name)
  );

  const errors: string[] = [];
  for (const p of available) {
    try {
      const asset = await p.synthesize(spec, outDir);
      reportResult(p.name, true);
      return { asset, providerName: p.name, costIdr: asset.costIdr };
    } catch (err) {
      reportResult(p.name, false);
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${p.name}: ${msg}`);
      console.warn(`[failover] voice ${p.name} gagal: ${msg} -> coba provider berikutnya`);
    }
  }
  throw new Error(`Semua provider voice gagal: ${errors.join(" | ")}`);
}
