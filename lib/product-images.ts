// Pipeline foto produk (dipakai POST /api/products & POST /api/products/[id]/photos):
// sniff magic bytes (NF-SEC09) -> verifikasi decoder sharp -> normalisasi sisi
// panjang ≤1600px ke WebP (BR-01.5). SEMUA via sharp (Node murni) — web service
// production tidak punya python3+PIL (PIL hanya kontrak container worker).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import sharp from "sharp";
import { config, ensureDirs } from "./config";
import { mediaStorage } from "./storage";
import { klasifikasiGambar, type JenisGambar } from "./media/klasifikasi-gambar";

export const ALLOWED_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};
// r13 (Brian 2026-08-07: "input banyak reference produk sampe 10 kalau perlu")
// — dites langsung ke BytePlus: API menerima 8 foto referensi (1 primary + 7
// extra) tanpa error, bukan API yang membatasi 5 (itu keputusan kode lama).
// TAPI pelajaran hari ini (eksperimen r10, SKIN1004 5-foto beragam justru
// memperburuk label): kuantitas TANPA kurasi bisa kontraproduktif. 8 dipilih
// sebagai kompromi — beri ruang lebih tanpa mendorong user asal upload banyak.
export const MAX_IMAGES = 8;
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
/**
 * BATAS REFERENSI PER GENERASI — 7, terpisah dari batas unggah (MAX_IMAGES=8).
 *
 * Pengguna boleh menyimpan lebih banyak foto di pustakanya daripada yang
 * dikirim ke model dalam satu generasi. Dua angka berbeda untuk dua hal
 * berbeda: yang satu kapasitas simpan, yang satu beban satu permintaan render.
 */
export const MAKS_REFERENSI_PER_GENERASI = 7;

/** Sidecar metadata di storage — kelayakan dihitung SEKALI saat unggah.
 *
 * Disimpan sebagai objek terpisah, bukan kolom DB. Kuncinya `<rel>.meta.json`,
 * jadi ia ikut ke mana pun berkasnya.
 *
 * ALASAN LAMA SUDAH KEDALUWARSA, dan itu dicatat di sini supaya tidak
 * disalin lagi: pilihan ini semula dibenarkan dengan "migrasi terkunci sampai
 * rekonsiliasi ledger". Terverifikasi 20 Agu 2026 — migrasi 0030-0032 SUDAH
 * terpasang sejak 18 Agu (dry-run produksi: would_apply kosong).
 *
 * Pilihannya tetap dipertahankan, dengan alasan yang benar: data ini hidup
 * berdampingan dengan berkasnya di storage, jadi ia tidak perlu jadi utang
 * skema. Yang berubah cuma alasannya — dan alasan yang salah lebih berbahaya
 * daripada tidak ada alasan, karena ia dipakai membenarkan keputusan berikutnya.
 */
export interface MetaGambar {
  sha256: string;
  /**
   * Termasuk `belum_diperiksa` sejak 21 Agu. Sidecar WAJIB bisa menyimpan
   * keadaan "tidak bisa diperiksa" apa adanya; kalau ia hanya punya dua vonis,
   * kegagalan pemeriksaan terpaksa menyamar jadi salah satunya dan bukti yang
   * berbohong itu jadi permanen. Lihat JenisGambar di lib/media/klasifikasi-gambar.ts.
   */
  jenis: JenisGambar;
  layakReferensi: boolean;
  rasioAreaTeks: number;
  jumlahKata: number;
  alasan: string;
}

export const relMeta = (rel: string) => `${rel}.meta.json`;

export async function bacaMetaGambar(rel: string): Promise<MetaGambar | null> {
  try {
    const obj = await mediaStorage().get(relMeta(rel));
    return obj ? (JSON.parse(obj.body.toString("utf8")) as MetaGambar) : null;
  } catch {
    return null;
  }
}

/**
 * Referensi yang BOLEH dikirim ke model, dari daftar rel apa adanya.
 *
 * BACKFILL MALAS — lubang warisan ditutup saat dipakai, bukan sekaligus.
 *
 * Gambar yang diunggah sebelum classifier ada tidak punya sidecar. Menolak
 * semuanya akan mematikan produk yang sudah terlanjur jalan; membiarkannya
 * layak selamanya berarti lubangnya tidak pernah tertutup. Jadi: begitu gambar
 * lama HENDAK dipakai jadi referensi, ia diklasifikasi saat itu juga dan
 * sidecarnya ditulis. Sesudah sekali dipakai, ia tidak lagi warisan.
 *
 * Kenapa di sini dan bukan di skrip migrasi sekali jalan: pustaka lama bisa
 * besar, dan gambar yang tidak pernah dipakai jadi referensi tidak perlu
 * dibayar waktu OCR-nya sama sekali.
 *
 * Kegagalan klasifikasi di jalur ini TIDAK menolak gambarnya (beda dengan
 * jalur unggah): di unggah pengguna sedang menatap layar dan bisa mengulang,
 * sedangkan di sini render sudah berjalan dan gambar itu mungkin satu-satunya
 * yang dimiliki produk tersebut.
 */
export async function referensiLayak(rels: string[]): Promise<string[]> {
  const layak: string[] = [];
  for (const rel of rels) {
    if (layak.length >= MAKS_REFERENSI_PER_GENERASI) break;
    let meta = await bacaMetaGambar(rel);
    if (!meta) meta = await backfillMetaGambar(rel);
    if (!meta || meta.layakReferensi) layak.push(rel);
  }
  return layak;
}

/**
 * Klasifikasi gambar warisan pada pemakaian pertama, lalu tulis sidecarnya.
 *
 * Mengembalikan null kalau berkasnya tidak terjangkau atau pemeriksaannya
 * gagal — pemanggil memperlakukan null sebagai "biarkan lewat", lihat alasan
 * di referensiLayak.
 */
export async function backfillMetaGambar(rel: string): Promise<MetaGambar | null> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-"));
  try {
    const obj = await mediaStorage().get(rel);
    if (!obj) return null;
    const tmp = path.join(dir, path.basename(rel));
    fs.writeFileSync(tmp, obj.body);
    const k = await klasifikasiGambar(tmp);
    const meta: MetaGambar = {
      sha256: crypto.createHash("sha256").update(obj.body).digest("hex"),
      jenis: k.jenis, layakReferensi: k.layakReferensi,
      rasioAreaTeks: k.rasioAreaTeks, jumlahKata: k.jumlahKata, alasan: k.alasan,
    };
    await mediaStorage().put(relMeta(rel), Buffer.from(JSON.stringify(meta)), "application/json");
    console.log(`[pustaka] backfill sidecar ${rel} -> ${meta.jenis}`);
    return meta;
  } catch (err) {
    console.warn(`[pustaka] backfill gagal untuk ${rel}, dibiarkan lewat: ${(err as Error).message}`);
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

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

    // KELAYAKAN DIHITUNG SEKALI, DI SINI. Bukan saat render: di sana biayanya
    // sudah keluar, dan jawabannya tidak akan berubah — gambarnya sama.
    //
    // KONTRAK HASH: sha256 dihitung dari BYTES YANG BENAR-BENAR DISIMPAN,
    // bukan dari unggahan asli.
    //
    // Cacat yang ditutup (ditemukan review independen): versi sebelumnya
    // meng-hash `blobs[i].data` sementara yang ditulis ke storage adalah
    // `normalized ?? blobs[i].data` — WebP hasil normalisasi. Selama
    // normalisasi berhasil (kasus normal), sidecar membawa hash yang TIDAK
    // PERNAH cocok dengan berkasnya. Begitu verifikasi hash dinyalakan di
    // P0-02, setiap foto yang sah akan ditolak sebagai bukti korup.
    //
    // Komentar lama di sini juga keliru: ia menyebut klasifikasi dilakukan
    // atas berkas ASLI, padahal klasifikasiGambar(abs) membaca berkas yang
    // SUDAH dinormalisasi. Perilakunya tidak diubah di sini — yang diperbaiki
    // hanya hash dan keterangannya, supaya keduanya menggambarkan kenyataan.
    const bytesTersimpan = normalized ?? blobs[i].data;
    const sha256 = crypto.createHash("sha256").update(bytesTersimpan).digest("hex");
    let meta: MetaGambar;
    try {
      const k = await klasifikasiGambar(abs);
      meta = { sha256, jenis: k.jenis, layakReferensi: k.layakReferensi,
        rasioAreaTeks: k.rasioAreaTeks, jumlahKata: k.jumlahKata, alasan: k.alasan };
    } catch (err) {
      // RAGU = PROMOSI, sama dengan klasifikasiGambar sendiri.
      meta = { sha256, jenis: "promotional_graphic", layakReferensi: false,
        rasioAreaTeks: 0, jumlahKata: 0, alasan: `Belum bisa diperiksa: ${(err as Error).message}` };
    }

    await mediaStorage().put(rel, fs.readFileSync(abs), rel.endsWith(".webp") ? "image/webp" : blobs[i].mime);
    await mediaStorage().put(relMeta(rel), Buffer.from(JSON.stringify(meta)), "application/json");
    if (config.storageMode === "r2") fs.rmSync(abs, { force: true });
    rels.push(rel);
  }
  return rels;
}

/** Organization uploads use collision-proof object names. Array indexes are
 * unsafe when two teammates upload at the same time: both requests can observe
 * the same length and overwrite the same R2 key. */
export async function saveUniqueProductImages(
  productId: string,
  blobs: { mime: string; data: Buffer }[]
): Promise<string[]> {
  ensureDirs();
  const rels: string[] = [];
  try {
    for (const blob of blobs) {
      // Full decode + normalization is mandatory here. Never fall back to a
      // corrupt original merely because its metadata could still be parsed.
      const normalized = await normalizeProductImageBuffer(blob.data);
      const rel = path.posix.join("uploads", productId, `${crypto.randomUUID()}.webp`);
      // Track before put: an object store may commit then lose the response.
      // Cleanup must still know which idempotent key to delete.
      rels.push(rel);
      await mediaStorage().put(rel, normalized, "image/webp");
    }
    return rels;
  } catch (error) {
    await deleteStoredProductImages(rels).catch((cleanupError) => console.error("[storage] rollback upload tidak tuntas:", cleanupError));
    throw error;
  }
}

export async function deleteStoredProductImages(keys: string[]): Promise<void> {
  const failed: string[] = [];
  await Promise.all(keys.map(async (key) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { await mediaStorage().delete(key); return; }
      catch (error) {
        if (attempt === 3) {
          failed.push(key);
          console.error(`[storage] gagal menghapus ${key} setelah 3 percobaan:`, error);
        }
      }
    }
  }));
  if (failed.length) throw new Error(`Storage cleanup failed for ${failed.length} object(s).`);
}
