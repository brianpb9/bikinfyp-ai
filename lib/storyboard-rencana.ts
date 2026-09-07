/**
 * Perakit masukan planShots untuk storyboard.
 *
 * ---------------------------------------------------------------------------
 * KENAPA MODUL SENDIRI
 * ---------------------------------------------------------------------------
 * lib/postgres/worker.ts merakit masukan yang sama dari baris job (hasil join
 * jobs+scripts+products). Storyboard harus merakit hal yang sama SEBELUM job
 * ada, dari skrip + produk + parameter yang dipilih pengguna.
 *
 * Dua perakitan untuk satu rencana adalah cara paling mudah membuat gambar yang
 * disetujui berbeda dari video yang dirender. Yang mengikat keduanya adalah
 * kolom storyboards.params: rencana ini dibangun darinya, dan route job
 * memakainya lagi apa adanya alih-alih body permintaan.
 *
 * planShots() murni komputasi — tidak membaca berkas, tidak memanggil jaringan
 * (diperiksa 7 Sep 2026) — jadi aman dijalankan di service web yang tidak punya
 * ffmpeg maupun berkas media lokal.
 */
import { planShots } from "./media/shot-planner";
import { getCreatorCategory } from "./personas";
import type { SegmentDraft } from "./script-engine/templates";
import type { QualityTier, VisualSpec } from "./providers/types";

export interface ParamsStoryboard {
  format?: string;
  duration_s?: number;
  quality_tier?: string;
  creator_category?: string;
  avatar_custom_desc?: string | null;
  persona_id?: string | null;
  [k: string]: unknown;
}

export interface SumberRencana {
  storyboardId: string;
  segments: SegmentDraft[];
  productName: string;
  productCategory: string;
  productVisualDesc?: string | null;
  brandBrief?: string | null;
  imageRefPath: string;
  ideaFormat?: string | null;
  templateId?: string | null;
  recordStyle?: string | null;
}

/** Format yang boleh sampai ke perencana. Daftar putih, bukan lolos apa adanya:
 *  nilai asing lebih baik jatuh ke bawaan daripada masuk sebagai format yang
 *  tidak punya tabel beat. */
const FORMAT_DIKENAL = ["hands_only", "talking_head", "tvc"] as const;

export function formatBersih(v: unknown): "hands_only" | "talking_head" | "tvc" {
  return (FORMAT_DIKENAL as readonly string[]).includes(String(v)) ? (v as never) : "hands_only";
}

/**
 * Bangun VisualSpec untuk storyboard.
 *
 * jobId diisi id STORYBOARD, bukan id job — job belum ada. Nilai itu hanya
 * label di dalam spec; yang memakainya sebagai kunci penyimpanan adalah jalur
 * render, dan jalur itu memakai spec-nya sendiri nanti.
 */
export function rencanaStoryboard(sumber: SumberRencana, params: ParamsStoryboard): VisualSpec {
  const kategoriId = String(params.creator_category ?? "hijaber");
  const preset = getCreatorCategory(kategoriId);
  if (!preset) throw new Error(`Kategori kreator tidak dikenal: ${kategoriId}`);

  // Avatar premium: deskripsi pilihan pengguna menggantikan preset kategori,
  // persis seperti yang dilakukan worker. Kosong = perilaku lama.
  const custom = typeof params.avatar_custom_desc === "string" ? params.avatar_custom_desc.trim() : "";
  const category = custom ? { ...preset, promptSeed: custom, handsPrompt: custom } : preset;

  const tier = String(params.quality_tier ?? "high_quality") as QualityTier;

  return planShots({
    jobId: sumber.storyboardId,
    durationSec: Number(params.duration_s ?? 15),
    segments: sumber.segments,
    category,
    productName: sumber.productName,
    productCategory: sumber.productCategory,
    productVisualDesc: sumber.productVisualDesc ?? null,
    brandBrief: sumber.brandBrief ?? null,
    imageRefPath: sumber.imageRefPath,
    qualityTier: tier,
    format: formatBersih(params.format),
    ideaFormat: sumber.ideaFormat ?? null,
    ugcTemplate: sumber.templateId ?? null,
    recordStyle: sumber.recordStyle ?? null,
  });
}
