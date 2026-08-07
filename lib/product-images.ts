// Pipeline foto produk (dipakai POST /api/products & POST /api/products/[id]/photos):
// sniff magic bytes (NF-SEC09) -> verifikasi decoder sharp -> normalisasi sisi
// panjang ≤1600px ke WebP (BR-01.5). SEMUA via sharp (Node murni) — web service
// production tidak punya python3+PIL (PIL hanya kontrak container worker).

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config, ensureDirs } from "./config";
import { mediaStorage } from "./storage";

export const ALLOWED_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};
export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // NF-SEC09

export function sniffMime(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  return null;
}

export async function verifyDecodableImage(data: Buffer): Promise<boolean> {
  // Magic bytes saja masih bisa dipalsukan; sharp memverifikasi struktur decoder.
  try {
    const info = await sharp(data, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    return Boolean(info.width && info.height);
  } catch {
    return false;
  }
}

// BytePlus ModelArk MENOLAK gambar referensi < 300px di sisi manapun (insiden
// production 2026-08-07 job 990a734e: foto ekstrak-link 200x200 -> "HTTP 400:
// expected the width to be at least 300px"). MIN_REF_SIDE dikasih margin di
// atas ambang provider (rasio kompresi WebP bisa geser beberapa px).
export const MIN_REF_SIDE = 320;

/** Normalisasi foto produk: turunkan sisi panjang ke <=1600px, TAPI naikkan
 * foto yang lebih kecil dari MIN_REF_SIDE (foto kecil dari link ekstrak/
 * thumbnail toko) supaya tidak ditolak provider video saat jadi referensi.
 * Dipakai bersama oleh upload manual (POST /api/products) dan ekstrak-link
 * (POST /api/products/extract) — SATU aturan ukuran, bukan dua yang bisa beda. */
export async function normalizeProductImageBuffer(data: Buffer): Promise<Buffer> {
  const meta = await sharp(data, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
  const minSide = Math.min(meta.width ?? MIN_REF_SIDE, meta.height ?? MIN_REF_SIDE);
  const pipeline = sharp(data, { failOn: "error", limitInputPixels: 40_000_000 }).rotate();
  if (minSide < MIN_REF_SIDE) {
    // Upscale foto kecil ke lantai aman — kualitas turun tapi tetap dipakai
    // (menolak foto ekstrak-link otomatis akan memutus USP "auto-fill foto").
    return pipeline.resize({ width: MIN_REF_SIDE, height: MIN_REF_SIDE, fit: "outside", withoutEnlargement: false })
      .webp({ quality: 82, effort: 4 }).toBuffer();
  }
  return pipeline.resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 }).toBuffer();
}

/** Simpan foto ke storage produk. startIndex untuk APPEND ke produk yang sudah
 * punya foto (nama file tidak boleh bertabrakan dengan yang lama). */
export async function saveProductImages(
  productId: string,
  blobs: { mime: string; data: Buffer }[],
  startIndex = 0
): Promise<string[]> {
  ensureDirs();
  const dir = path.join(config.storageDir, "uploads", productId);
  fs.mkdirSync(dir, { recursive: true });
  const rels: string[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const idx = startIndex + i;
    const ext = ALLOWED_MIME[blobs[i].mime] ?? ".png";
    let rel = path.join("uploads", productId, `${idx}${ext}`).split(path.sep).join("/");
    let abs = path.join(config.storageDir, rel);
    let normalized: Buffer | null = null;
    try {
      normalized = await normalizeProductImageBuffer(blobs[i].data);
      rel = path.join("uploads", productId, `${idx}.webp`).split(path.sep).join("/");
      abs = path.join(config.storageDir, rel);
    } catch {
      /* kompresi gagal tidak fatal — file asli tetap dipakai */
    }
    fs.writeFileSync(abs, normalized ?? blobs[i].data);
    await mediaStorage().put(rel, fs.readFileSync(abs), rel.endsWith(".webp") ? "image/webp" : blobs[i].mime);
    if (config.storageMode === "r2") fs.rmSync(abs, { force: true });
    rels.push(rel);
  }
  return rels;
}
