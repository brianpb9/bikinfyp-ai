// Unduh gambar OG ke storage produk — dipisah dari app/api/products/extract/route.ts
// (F-ENT-01, 2026-08-11) supaya app/api/dashboard/bulk/route.ts bisa
// memakai ulang logika yang SAMA PERSIS (kompresi sharp, batas 5 foto,
// batas 10MB) alih-alih menduplikasi. Lihat komentar asli di route retail
// soal kenapa sharp (bukan python3+PIL) wajib untuk web service.
import fs from "node:fs";
import path from "node:path";
import { config, ensureDirs } from "./config";
import { MAX_IMAGES, normalizeProductImageBuffer } from "./product-images";
import { urutkanFoto } from "./foto-produk-pilih";
import { mediaStorage } from "./storage";

const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

/**
 * Jumlah kata yang terbaca OCR, atau -1 bila tidak bisa dihitung.
 *
 * -1, BUKAN 0. Nol berarti "diperiksa dan bersih"; itu klaim yang tidak boleh
 * dibuat saat pemeriksaannya sendiri gagal. skorFoto() sengaja tidak menghukum
 * -1 — menghukum ketidaktahuan akan menenggelamkan foto bagus hanya karena
 * tesseract kebetulan tersedak.
 */
async function hitungKataFoto(buf: Buffer): Promise<number> {
  try {
    const { hitungKataOcrBuffer } = await import("./media/foto-produk");
    return await hitungKataOcrBuffer(buf);
  } catch {
    return -1;
  }
}

export async function downloadProductImages(productId: string, urls: string[]): Promise<string[]> {
  ensureDirs();
  const dir = path.join(config.storageDir, "uploads", productId);
  fs.mkdirSync(dir, { recursive: true });
  const rels: string[] = [];
  // Batasnya MAX_IMAGES, sama dengan jalur unggah manual — lihat alasannya di
  // lib/extract.ts.
  // DIUNDUH DULU, DINILAI, BARU DISIMPAN BERURUTAN.
  //
  // Urutan simpan menentukan mana yang jadi ACUAN UTAMA render (images[0]), dan
  // acuan utama adalah otoritas bentuk/warna produk bagi mesin gambar. Kalau
  // yang mendarat di posisi 0 adalah banner "DISKON 50%", mesin menggambar
  // bannernya. Brian melaporkannya 8 Sep 2026.
  const kandidat: { buf: Buffer; urutan: number; lebar: number; tinggi: number; kata: number }[] = [];
  for (const [i, url] of urls.slice(0, MAX_IMAGES).entries()) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 10 * 1024 * 1024) continue;
      const meta = await (await import("sharp")).default(buf).metadata();
      kandidat.push({
        buf, urutan: i,
        lebar: meta.width ?? 0, tinggi: meta.height ?? 0,
        kata: await hitungKataFoto(buf),
      });
    } catch {
      /* gambar gagal diunduh/dibuka — lanjut yang lain */
    }
  }

  for (const [i, k] of urutkanFoto(kandidat).entries()) {
    try {
      const normalized = await normalizeProductImageBuffer(k.buf);
      const rel = path.join("uploads", productId, `${i}.webp`).split(path.sep).join("/");
      const abs = path.join(config.storageDir, rel);
      fs.writeFileSync(abs, normalized);
      await mediaStorage().put(rel, normalized, "image/webp");
      if (config.storageMode === "r2") fs.rmSync(abs, { force: true });
      rels.push(rel);
    } catch {
      /* gambar gagal dinormalkan — lanjut yang lain */
    }
  }
  return rels;
}
