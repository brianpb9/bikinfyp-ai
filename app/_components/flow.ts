"use client";

import type { HookLevel } from "@/lib/config/hooks";
import type { SnapshotAdmisi } from "@/lib/script-engine/admisi";

// Konteks alur "bikin video" — disimpan di sessionStorage agar tahan tutup halaman.

export interface FlowProduct {
  productId: string;
  name: string;
  priceIdr: number;
  category: string;
  images: string[];
  /** Harga normal promo (add-on) — dipakai validator client S4 (L-14). */
  promoPriceBeforeIdr?: number | null;
}

export interface FlowSegment {
  role: "hook" | "demo" | "cta";
  start: number;
  end: number;
  text: string;
  visual_direction?: string;
  /** Field TERSTRUKTUR dari penulis LLM (reviewer A2: jangan cuma
   *  visual_direction gabungan — begitu digabung, framing/kamera/aksi tidak
   *  bisa dipisahkan lagi untuk ditampilkan atau diperbaiki). */
  framing?: string;
  camera?: string;
  action?: string;
  expression?: string;
  start_state?: string;
  product_state?: "hidden" | "partial" | "hero";
  mode?: string;
}

export interface FlowScript {
  id: string;
  hook_family: string;
  emotion: string;
  register: string;
  segments: FlowSegment[];
  caption: string;
  hashtags: string[];
  /**
   * Dari mana naskah ini berasal: llm | template | degraded.
   *
   * Wajib sampai ke UI (reviewer 18 Agu): tanpa ini, naskah cadangan tampil
   * persis seperti naskah yang lolos gate, dan penggunanya membayar render
   * tanpa pernah tahu bedanya. `degraded` tidak boleh pernah sampai ke sini —
   * kalau muncul, itu bug, bukan pilihan.
   */
  script_source?: "llm" | "template" | "degraded" | "manual";
  /** Bentuk naskah saat ditulis — dipakai UI supaya gerbangnya sama dengan
   *  server (genre, durasi, jatah kata, label keranjang). */
  admisi?: SnapshotAdmisi;
  /** STANDAR 10/10: "9/12 baris standar" + nilai 0-10 (knowledge/rules). */
  standarGaris?: string;
  standarNilai?: number;
}

export type VideoFormat = "hands_only" | "talking_head" | "vo_broll";

export interface FlowState {
  product?: FlowProduct;
  register?: string;
  emotion?: string;
  qualityTier?: "silent_caption" | "high_quality" | "super_hq";
  format?: VideoFormat;
  durationSec?: 15 | 30 | 45;
  // Tipe kanonik dari lib/config/hooks.ts, bukan salinan. Versi salinan di
  // sini pernah tertinggal di tiga level saat levelnya jadi lima.
  hookLevel?: HookLevel;
  creatorCategory?: string;
  /** Influencer identity selected from the single HDRV roster. */
  avatarId?: string;
  /** Deskripsi avatar premium yang dipilih (lib/avatar-presets .desc).
   *  Kosong berarti pengguna memakai preset kategori lama. */
  avatarDesc?: string;
  scripts?: FlowScript[];
  selectedScriptId?: string;
  jobId?: string;
  returnTo?: string;
}

export const TIER_LABELS: Record<string, string> = {
  silent_caption: "Teks + Musik",
  high_quality: "AI Bersuara",
  super_hq: "AI Bersuara Pro",
};

const KEY = "racun.flow";

export function loadFlow(): FlowState {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as FlowState;
  } catch {
    return {};
  }
}

export function saveFlow(patch: Partial<FlowState>): void {
  if (typeof window === "undefined") return;
  const next = { ...loadFlow(), ...patch };
  sessionStorage.setItem(KEY, JSON.stringify(next));
}

export function clearFlow(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY);
}

/** Nama manusiawi keluarga hook (untuk S4). */
export const HOOK_FAMILY_NAMES: Record<string, string> = {
  H1: "Kaget harga",
  H2: "Masalah",
  H3: "Testimoni",
  H4: "Bukti laris",
  H5: "Peringatan",
  H6: "Rasa penasaran",
  H7: "Statistik rahasia",
  H8: "Panggilan audiens",
  H9: "Perbandingan",
  H10: "Takut kehabisan",
  H11: "Transformasi",
  H12: "Praktis",
  H13: "Identitas",
  H14: "Spill rahasia",
  H15: "Pertanyaan",
  H16: "Cerita penyesalan",
};

export const CATEGORY_OPTIONS = [
  { id: "beauty", label: "Perawatan & Kecantikan" },
  { id: "fashion", label: "Fashion" },
  { id: "muslim_fashion", label: "Fashion Muslim" },
  { id: "home", label: "Rumah Tangga" },
  { id: "kitchen", label: "Alat Dapur" },
  { id: "gadget", label: "Gadget & Aksesori" },
  { id: "food", label: "Makanan & Minuman" },
  { id: "kids", label: "Ibu & Anak" },
  { id: "default", label: "Lainnya" },
];

export function rupiah(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}

export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "baru aja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Kemarin";
  return `${d} hari lalu`;
}
