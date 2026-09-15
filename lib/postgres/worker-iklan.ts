/**
 * CABANG WORKER: FORMAT "iklan_sinematik" (BETA KHUSUS ADMIN).
 *
 * Jalur retail (runProviderPipeline) tidak disentuh sama sekali. Job dengan
 * format ini hanya bisa dibuat lewat /api/admin/iklan, tidak menahan kredit,
 * dan tidak muncul di katalog format pengguna — mutunya belum lulus gerbang
 * studio (review independen 14 Sep 2026: Reject, 4/10 terhadap Blueprint).
 *
 * Yang dikerjakan di sini hanya yang khas job: mengambil foto produk dari
 * storage, memetakan tahap pipeline ke state job, dan menyimpan hasilnya.
 * Isi produksinya seluruhnya di lib/iklan/pipeline.ts — sama persis dengan
 * yang dipakai scripts/iklan-uji.ts, supaya yang diuji dan yang dijalankan
 * pengguna tidak pernah berbeda.
 */

import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { mediaStorage } from "../storage";
import { jalankanIklan } from "../iklan/pipeline";
import { FORMAT_IKLAN } from "../iklan/format";
import type { MesinVideo } from "../iklan/klip";
import type { ProdukIklan } from "../iklan/naskah";

/** Tier job -> mesin video. Hanya "premium" yang memanggil Seedance (±2,5x biaya). */
export function mesinUntukTier(tier: string | null | undefined): MesinVideo {
  return tier === "premium" ? "ultra" : "standard";
}

/** Baris job + produk yang dibutuhkan cabang ini (irisan WorkerRow). */
export interface BarisIklan {
  id: string;
  user_id: string;
  quality_tier: string;
  product_name: string;
  product_category: string | null;
  product_visual_desc: string | null;
  product_claims: string | null;
  product_images: string;
  product_price_idr: number | null;
  product_raw_meta: string | null;
  brand_brief: string | null;
}

/** Merek hanya dari sumber tepercaya (intake), tidak pernah ditebak dari nama. */
function merekDari(rawMeta: string | null): string | null {
  if (!rawMeta) return null;
  try {
    const m = JSON.parse(rawMeta) as { brand?: unknown };
    return typeof m.brand === "string" && m.brand.trim() ? m.brand.trim().slice(0, 80) : null;
  } catch { return null; }
}

export function produkUntukIklan(row: BarisIklan): ProdukIklan {
  return {
    nama: row.product_name,
    merek: merekDari(row.product_raw_meta),
    kategori: row.product_category,
    deskripsi: row.brand_brief ?? row.product_visual_desc,
    klaim: row.product_claims,
    visual: row.product_visual_desc,
    harga_idr: row.product_price_idr ?? null,
  };
}

export interface KaitJobIklan {
  /** Pindah state job; false berarti job sudah tidak aktif dan pekerjaan harus berhenti. */
  pindah: (state: "GENERATING_VOICE" | "COMPOSITING" | "QC_CHECK" | "LABELING") => Promise<boolean>;
  setProviders: (video: string, voice: string) => Promise<void>;
  simpan: (relVideo: string, local: string, qc: unknown) => Promise<void>;
}

class JobBerhenti extends Error {}

export async function jalankanJobIklan(row: BarisIklan, kait: KaitJobIklan): Promise<void> {
  const images = JSON.parse(row.product_images) as string[];
  if (images.length === 0) throw new Error("Produk tidak punya foto — upload minimal 1 foto.");
  const foto = await mediaStorage().materialize(images[0]);
  if (!foto) throw new Error("Foto produk tidak ditemukan di storage.");

  const mesin = mesinUntukTier(row.quality_tier);
  const dir = path.join(config.storageDir, "jobs", row.id, "iklan");
  fs.mkdirSync(dir, { recursive: true });
  await kait.setProviders(mesin === "ultra" ? "seedance-2.5" : "grok-imagine", "gemini-tts");

  const pindah = async (state: Parameters<KaitJobIklan["pindah"]>[0]) => {
    if (!(await kait.pindah(state))) throw new JobBerhenti(`Job tidak lagi aktif saat masuk ${state}.`);
  };

  try {
    const hasil = await jalankanIklan({
      produk: produkUntukIklan(row),
      foto, dir, id: row.id.slice(0, 8), mesin,
      onTahap: async (tahap) => {
        // naskah/gambar/klip semuanya masih GENERATING_VISUAL — state itu sudah
        // dipasang pemanggil sebelum cabang ini dijalankan.
        if (tahap === "suara") await pindah("GENERATING_VOICE");
        if (tahap === "rakit") await pindah("COMPOSITING");
        if (tahap === "gerbang") await pindah("QC_CHECK");
      },
    });

    const gagal = hasil.gerbang.filter((g) => !g.lulus);
    const qc = {
      passed: gagal.length === 0,
      beta: FORMAT_IKLAN,
      mesin,
      durasi_dtk: Number(hasil.total.toFixed(2)),
      shot: hasil.slot.length,
      checks: hasil.gerbang.map((g) => ({ code: g.id, status: g.lulus ? "pass" : "fail", detail: g.nilai })),
      biaya_idr: hasil.biaya,
    };
    // GERBANG TIDAK MEMBLOKIR DI BETA. Format ini dipasang justru untuk
    // dites lewat alur job, dan job yang selalu FAILED tidak menghasilkan
    // apa pun untuk ditinjau. Hasilnya tetap tercatat lengkap di qc_result,
    // dan tidak ada kredit pengguna yang terbakar karena beta ini gratis.
    if (gagal.length) console.warn(`[iklan] job ${row.id.slice(0, 8)}: ${gagal.length} gerbang gagal — ${gagal.map((g) => g.id).join(", ")}`);

    await pindah("LABELING");
    const relVideo = `jobs/${row.id}/output.mp4`;
    await kait.simpan(relVideo, hasil.path, qc);
  } catch (err) {
    if (err instanceof JobBerhenti) { console.warn(`[iklan] job ${row.id.slice(0, 8)}: ${err.message}`); return; }
    throw err;
  }
}
