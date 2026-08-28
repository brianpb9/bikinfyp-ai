// Unduh gambar OG ke storage produk — dipisah dari app/api/products/extract/route.ts
// (F-ENT-01, 2026-08-11) supaya app/api/dashboard/bulk/route.ts bisa
// memakai ulang logika yang SAMA PERSIS (kompresi sharp, batas 5 foto,
// batas 10MB) alih-alih menduplikasi. Lihat komentar asli di route retail
// soal kenapa sharp (bukan python3+PIL) wajib untuk web service.
import fs from "node:fs";
import path from "node:path";
import { config, ensureDirs } from "./config";
import { deleteStoredProductImages, normalizeProductImageBuffer, tulisSidecar } from "./product-images";
import { mediaStorage } from "./storage";
import { isControlledStagingImageUrl, isControlledStagingProductUrl } from "./url-safety";
import { safeRemoteGet } from "./safe-remote-fetch";

const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

export async function downloadProductImages(productId: string, urls: string[], sourcePageUrl?: string): Promise<string[]> {
  ensureDirs();
  const dir = path.join(config.storageDir, "uploads", productId);
  fs.mkdirSync(dir, { recursive: true });
  const rels: string[] = [];
  for (const [i, url] of urls.slice(0, 5).entries()) {
    try {
      if (sourcePageUrl && isControlledStagingProductUrl(sourcePageUrl) && !isControlledStagingImageUrl(url)) continue;
      const controlled=Boolean(sourcePageUrl&&isControlledStagingProductUrl(sourcePageUrl));
      const res=await safeRemoteGet(url,{kind:"public",headers:{"user-agent":UA},timeoutMs:8000,maxBytes:10*1024*1024,hopAllowed:controlled?isControlledStagingImageUrl:undefined});
      if (!res.ok || res.status < 200 || res.status >= 300) continue;
      const buf = res.body;
      if (buf.length > 10 * 1024 * 1024) continue;
      const normalized = await normalizeProductImageBuffer(buf);
      const rel = path.join("uploads", productId, `${i}.webp`).split(path.sep).join("/");
      const abs = path.join(config.storageDir, rel);
      fs.writeFileSync(abs, normalized);
      await mediaStorage().put(rel, normalized, "image/webp");
      // BUKTI DITERBITKAN DI SINI JUGA (P0-B1, 21 Agu).
      //
      // Jalur ini menulis bytes TANPA sidecar, dan ia dipakai DUA route — bukan
      // satu: ekstrak-link Retail (app/api/products/extract) dan produk org
      // Enterprise (app/api/dashboard/campaign/product). Jadi lubangnya
      // melintasi kedua produk sekaligus.
      //
      // Urutannya penting: sidecar ditulis SEBELUM berkas lokal dibuang di mode
      // r2, karena classifier membaca path lokal itu.
      //
      // ROLLBACK BILA PENERBITAN BUKTI GAGAL. Objek fotonya sudah ada di
      // storage saat baris ini berjalan, jadi kalau `put` sidecar-nya ditolak,
      // blok tangkap luar akan melewati URL ini DIAM-DIAM dan meninggalkan
      // bytes tanpa bukti — plus berkas lokal basi di mode r2. Bytes tanpa
      // bukti persis keadaan yang seluruh P0-B1 ada untuk menghapusnya, dan ia
      // akan lahir kembali di sini setiap kali object store bermasalah.
      try {
        await tulisSidecar(rel, normalized, abs);
      } catch (errBukti) {
        await deleteStoredProductImages([rel]).catch((errBersih) =>
          console.error(`[unduh] rollback ${rel} tidak tuntas:`, errBersih)
        );
        fs.rmSync(abs, { force: true });
        throw errBukti; // ditangkap blok luar: URL ini dilewati, tanpa sisa
      }
      if (config.storageMode === "r2") fs.rmSync(abs, { force: true });
      rels.push(rel);
    } catch {
      /* gambar gagal diunduh/dibuka — lanjut yang lain */
    }
  }
  return rels;
}
