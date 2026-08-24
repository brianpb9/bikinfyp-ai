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
import { klasifikasiGambar, KEBIJAKAN_KLASIFIKASI, type HasilKlasifikasi, type JenisGambar } from "./media/klasifikasi-gambar";

let klasifikasiGambarUntukTest: ((path: string) => Promise<HasilKlasifikasi>) | undefined;
/** Seam deterministik ingestion-test; tidak mengubah classifier produksi. */
export function setProductImageClassifierForTests(classifier?: (path: string) => Promise<HasilKlasifikasi>): void {
  klasifikasiGambarUntukTest = classifier;
}

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
  /**
   * Revisi aturan klasifikasi yang MENERBITKAN bukti ini.
   *
   * Tanpa field ini, bukti yang dibuat aturan lama tidak bisa dibedakan dari
   * bukti yang dibuat aturan sekarang — dan aturan yang diperketat tidak akan
   * pernah berlaku surut. Nilainya selalu diambil dari KEBIJAKAN_KLASIFIKASI,
   * bukan ditulis literal, supaya penerbit dan penilainya tidak bisa
   * berselisih.
   */
  versiBukti: number;
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
 * Referensi yang BOLEH dikirim ke model — PROYEKSI dari resolver pusat.
 *
 * KARANTINA MENGGANTIKAN BACKFILL MALAS (21 Agu). Versi lama mengklasifikasi
 * gambar warisan SAAT hendak dipakai jadi referensi, lalu menulis sidecarnya
 * dari dalam jalur baca. Itu dicabut, dan tiga alasannya masing-masing cukup:
 *
 *   - bukti yang dicetak di tengah jalur render tidak pernah dilihat siapa pun.
 *     Tidak ada rantai kustodi: ia menempel pada bytes apa pun yang kebetulan
 *     ada di storage detik itu;
 *   - di produksi jalur baca itu bisa berjalan di runtime TANPA
 *     ffmpeg/tesseract (service web Render `runtime: node`). Klasifikasi gagal,
 *     dan vonis kegagalan itu DIBEKUKAN jadi sidecar permanen — foto produk
 *     yang sah dicap promosi selamanya oleh mesin yang kebetulan tidak punya
 *     OCR;
 *   - menulis dari jalur baca membuat operasi baca tidak idempoten.
 *
 * Penggantinya: gambar tanpa bukti sah DIKARANTINA — tidak layak, dan jalur
 * baca tidak menulis apa pun. Bukti hanya diterbitkan di jalur
 * ingestion/revalidasi yang terbukti punya binernya.
 *
 * FUNGSI INI SENGAJA TIPIS. Ia proyeksi dari `resolveApprovedReference`, bukan
 * aturan kedua: dua jalur baca yang bisa berbeda jawaban adalah cara divergensi
 * W1/W2 lahir kembali lewat pintu belakang. Pemanggil yang butuh alasan
 * penolakan memanggil resolvernya langsung.
 *
 * BATAS `MAKS_REFERENSI_PER_GENERASI` TIDAK diterapkan di sini. Ia batas satu
 * PERMINTAAN RENDER, bukan batas kelayakan — dan menerapkannya di sini membuat
 * fungsi ini berbeda jawaban dari resolver begitu produk punya lebih dari tujuh
 * foto sah. Pembatasan itu milik pemanggil yang menyusun payload generasi.
 */
export async function referensiLayak(rels: string[]): Promise<string[]> {
  const { resolveApprovedReference } = await import("./product-truth");
  const hasil = await resolveApprovedReference(rels);
  return hasil.tersetujui.map((r) => r.rel);
}

/**
 * Menerbitkan sidecar untuk bytes yang BARU SAJA disimpan.
 *
 * Satu-satunya penerbit bukti di berkas ini, dan sengaja begitu: selama
 * penerbitan tersebar, setiap penulis bisa punya aturannya sendiri tentang apa
 * yang masuk ke sidecar.
 *
 * KONTRAK HASH: sha256 dihitung dari BYTES YANG BENAR-BENAR DISIMPAN, bukan
 * dari unggahan asli sebelum normalisasi WebP.
 *
 * KEGAGALAN KLASIFIKASI BUKAN VONIS. Kalau `klasifikasiGambar` sendiri
 * melempar, yang ditulis `belum_diperiksa` — bukan `promotional_graphic`.
 * `klasifikasiGambar` sudah menangani kegagalannya sendiri dengan cara itu;
 * blok tangkap di sini hanya jaring untuk kegagalan di luar dugaannya.
 */
export async function tulisSidecar(
  rel: string,
  bytesTersimpan: Buffer,
  absLokal: string,
  // Bisa disuntik SUPAYA JALUR TANGKAP DI BAWAH BISA DIUJI. `klasifikasiGambar`
  // sendiri dikontrak tidak pernah menolak, jadi tanpa suntikan ini blok
  // tangkapnya tidak terjangkau test mana pun — dan cabang yang tidak bisa
  // diuji adalah cabang yang diam-diam salah.
  klasifikasi: (p: string) => Promise<HasilKlasifikasi> = klasifikasiGambar
): Promise<MetaGambar> {
  const sha256 = crypto.createHash("sha256").update(bytesTersimpan).digest("hex");
  let meta: MetaGambar;
  try {
    const k = await klasifikasi(absLokal);
    meta = {
      sha256,
      jenis: k.jenis,
      layakReferensi: k.layakReferensi,
      rasioAreaTeks: k.rasioAreaTeks,
      jumlahKata: k.jumlahKata,
      alasan: k.alasan,
      versiBukti: KEBIJAKAN_KLASIFIKASI.versiBukti,
    };
  } catch (err) {
    meta = {
      sha256,
      jenis: "belum_diperiksa",
      layakReferensi: false,
      rasioAreaTeks: 0,
      jumlahKata: 0,
      alasan: `Kami belum bisa memeriksa gambar ini: ${(err as Error).message}`,
      versiBukti: KEBIJAKAN_KLASIFIKASI.versiBukti,
    };
  }
  await mediaStorage().put(relMeta(rel), Buffer.from(JSON.stringify(meta)), "application/json");
  return meta;
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
  // Berkas lokal yang ditulis sepanjang jalan. Di mode r2 ia staging yang
  // dibuang setelah put; di mode filesystem ia berkasnya sendiri. Dicatat
  // supaya rollback tahu apa yang harus dibersihkan.
  const lokal: string[] = [];
  try {
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
      lokal.push(abs);

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
      // PERNAH cocok dengan berkasnya, dan setiap foto sah akan ditolak sebagai
      // bukti korup begitu verifikasi hash dinyalakan.
      const bytesTersimpan = normalized ?? blobs[i].data;
      // rel dicatat SEBELUM put: object store bisa commit lalu kehilangan
      // responsnya, dan rollback tetap harus tahu kunci mana yang harus dibuang.
      rels.push(rel);
      await mediaStorage().put(rel, fs.readFileSync(abs), rel.endsWith(".webp") ? "image/webp" : blobs[i].mime);
      await tulisSidecar(rel, bytesTersimpan, abs, klasifikasiGambarUntukTest ?? klasifikasiGambar);
      if (config.storageMode === "r2") fs.rmSync(abs, { force: true });
    }
    return rels;
  } catch (error) {
    // ROLLBACK SEBATCH, bukan per-foto.
    //
    // Sebelumnya fungsi ini melempar tanpa membersihkan apa pun: kalau put
    // `.meta.json` gagal, objek fotonya, berkas lokalnya, DAN seluruh foto dari
    // iterasi sebelumnya tetap tertinggal — sementara kedua route pemanggil
    // cuma mengubah error jadi response. Hasilnya bytes tanpa bukti, persis
    // keadaan yang seluruh P0-B1 ada untuk menghapusnya.
    //
    // Yang dibuang: foto DAN sidecar-nya (deleteStoredProductImages menangani
    // keduanya sebagai satu unit), plus staging lokal.
    await deleteStoredProductImages(rels).catch((errBersih) =>
      console.error("[storage] rollback unggah tidak tuntas:", errBersih)
    );
    for (const abs of lokal) fs.rmSync(abs, { force: true });
    throw error;
  }
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
      // BUKTI DITERBITKAN DI SINI JUGA (P0-B1, 21 Agu).
      //
      // Jalur ini sebelumnya menulis bytes TANPA sidecar sama sekali — jadi
      // setiap produk yang dibuat lewat dashboard enterprise tidak punya satu
      // pun bukti yang menyatakan fotonya layak. Begitu resolver ketat menyala,
      // produk-produk itu terbrick seluruhnya, bukan sebagian.
      //
      // Berkas sementara diperlukan karena jalur ini — beda dari
      // saveProductImages — tidak pernah menulis salinan lokal; ia langsung
      // put ke object store. Classifier butuh path lokal.
      const tmpKlas = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-org-"));
      try {
        const abs = path.join(tmpKlas, path.basename(rel));
        fs.writeFileSync(abs, normalized);
        await tulisSidecar(rel, normalized, abs, klasifikasiGambarUntukTest ?? klasifikasiGambar);
      } finally {
        try {
          fs.rmSync(tmpKlas, { recursive: true, force: true });
        } catch (errBersih) {
          console.warn(`[storage] gagal membersihkan ${tmpKlas}: ${(errBersih as Error).message}`);
        }
      }
    }
    return rels;
  } catch (error) {
    await deleteStoredProductImages(rels).catch((cleanupError) => console.error("[storage] rollback upload tidak tuntas:", cleanupError));
    throw error;
  }
}

/**
 * Menghapus foto BESERTA sidecar-nya — satu unit, bukan dua.
 *
 * Sejak P0-B1 setiap foto punya `<kunci>.meta.json`, dan fungsi ini dipakai di
 * tiga tempat yang semuanya berarti "foto ini tidak ada lagi": rollback saat
 * unggah gagal, rollback saat penambahan ke DB gagal, dan penghapusan foto oleh
 * pengguna. Menghapus hanya kunci fotonya meninggalkan bukti yatim di object
 * store — dan bukti yatim itu bukan cuma sampah: ia bukti yang menyatakan
 * sesuatu tentang berkas yang sudah tidak ada, persis keadaan yang resolver
 * laporkan sebagai REF_MISSING.
 *
 * `delete` idempoten di kedua backend (`rm --force`; S3 DeleteObject atas kunci
 * yang tidak ada tetap sukses), jadi menghapus sidecar yang memang belum pernah
 * ada aman — termasuk untuk foto warisan dari sebelum P0-B1.
 */
export async function deleteStoredProductImages(keys: string[]): Promise<void> {
  const failed: string[] = [];
  const sasaran = keys.flatMap((key) => [key, relMeta(key)]);
  await Promise.all(sasaran.map(async (key) => {
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
