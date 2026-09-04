/**
 * Gambar yang HARUS BISA DIUNDUH oleh penyedia render dari luar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA INI ADA
 * ────────────────────────────────────────────────────────────────────────────
 * BytePlus menerima foto produk sebagai data URI — bytes-nya ikut di dalam
 * badan permintaan, jadi tidak ada yang perlu dibuka ke internet.
 *
 * kie.ai tidak. Model grok-imagine/image-to-video menerima `image_urls`:
 * ALAMAT, bukan berkas. Server merekalah yang mengunduh gambarnya. Jadi foto
 * itu wajib bisa diambil dari internet, oleh pihak yang tidak punya sesi kita.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA BUKAN /api/files
 * ────────────────────────────────────────────────────────────────────────────
 * /api/files SENGAJA menuntut dua hal sekaligus: tanda tangan HMAC yang sah DAN
 * sesi pemilik berkas. Komentarnya menyatakan itu apa adanya — "tanda tangan
 * saja memang tidak cukup untuk membaca objek privat". kie.ai tidak punya sesi,
 * jadi jalur itu akan selalu menjawab 403. Melonggarkan /api/files supaya kie.ai
 * bisa lewat berarti melonggarkannya untuk SEMUA berkas hasil pengguna.
 *
 * Maka gerbangnya dipisah, dan sempit dengan sengaja:
 *
 *   1. hanya melayani awalan kunci `provider-in/` — kotak yang isinya cuma
 *      salinan yang kita taruh sendiri untuk dikirim ke penyedia;
 *   2. kunci HMAC-nya DITURUNKAN TERPISAH, bukan kunci URL media. Bocornya
 *      salah satu tidak membocorkan yang lain;
 *   3. umurnya pendek, dan salinannya dihapus saat job selesai;
 *   4. hanya gambar. Isi yang bukan JPEG/PNG/WebP ditolak dari sini.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * YANG DIAKUI TERBUKA
 * ────────────────────────────────────────────────────────────────────────────
 * Selama tautan itu hidup, siapa pun yang MEMEGANG tautannya bisa mengunduh
 * gambarnya tanpa login. Itu memang sifat tautan-sebagai-kapabilitas, dan itu
 * satu-satunya bentuk yang bisa dipakai penyedia luar. Yang terbuka juga bukan
 * hasil render melainkan foto produk yang tetap kita kirimkan ke penyedia
 * render pihak ketiga dengan cara apa pun.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { mediaStorage } from "./storage";

/** Semua kunci yang boleh keluar lewat gerbang ini berawalan ini. */
export const AWALAN_PROVIDER = "provider-in/";

/**
 * Umur tautan. Panjang bukan karena longgar, tapi karena penyedia mengunduh
 * gambarnya kapan saja selama task-nya berjalan — dan task yang mengantre di
 * sisi mereka bisa duduk lama sebelum disentuh. Tautan yang mati di tengah
 * antrean menghasilkan kegagalan yang tampak seperti gangguan penyedia.
 */
export const TTL_DETIK = 2 * 60 * 60;

/** Jenis yang boleh dilayani, dikenali dari BYTES-nya, bukan dari nama berkas. */
const TANDA: { mime: string; cocok: (b: Buffer) => boolean }[] = [
  { mime: "image/jpeg", cocok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", cocok: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  {
    mime: "image/webp",
    cocok: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
];

/** Ekstensi yang mungkin terpakai — dipakai juga saat menyapu salinan. */
const EKSTENSI = [".jpg", ".jpeg", ".png", ".webp"];

export function mimeGambar(bytes: Buffer): string | null {
  return TANDA.find((t) => t.cocok(bytes))?.mime ?? null;
}

function kunci(): Buffer {
  // Diturunkan sendiri, sejalan dengan lib/secrets.ts. Sengaja TIDAK memakai
  // mediaUrlKey(): gerbang ini tanpa sesi, jadi kalau kuncinya bocor yang
  // jatuh hanyalah kotak provider-in/, bukan seluruh berkas hasil pengguna.
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(process.env.AUTH_SECRET || "dev-secret-racun-ai-jangan-dipakai-produksi", "utf8"),
      Buffer.alloc(0),
      // NAMA INI BUKAN LABEL — ia bahan penurun kunci HKDF. Menggantinya saat
      // mengganti merek membuat setiap URL gambar yang sudah diterbitkan tidak
      // sah, dan kie.ai gagal mengunduh acuan di tengah render yang sudah
      // dibayar. Lihat catatan lengkap di lib/secrets.ts.
      Buffer.from("bikinfyp/gambar-provider/v1", "utf8"),
      32,
    ),
  );
}

function tandaTangan(relPath: string, exp: number): string {
  return crypto.createHmac("sha256", kunci()).update(`${relPath}:${exp}`).digest("hex");
}

export function verifikasiGambarProvider(relPath: string, exp: number, sig: string): boolean {
  // Awalan diperiksa DULU, sebelum tanda tangan. Tanda tangan yang sah atas
  // kunci di luar provider-in/ tetap harus ditolak — kalau tidak, satu bug
  // di tempat lain yang bisa membujuk kita menandatangani kunci sembarangan
  // langsung berubah jadi jalur baca tanpa sesi untuk seluruh penyimpanan.
  if (!relPath.startsWith(AWALAN_PROVIDER)) return false;
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const a = Buffer.from(tandaTangan(relPath, exp), "utf8");
  const b = Buffer.from(String(sig), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function kunciGambar(jobId: string, shotIndex: number, ext: string): string {
  const aman = EKSTENSI.includes(ext.toLowerCase()) ? ext.toLowerCase() : ".jpg";
  return `${AWALAN_PROVIDER}${jobId}/${shotIndex}${aman}`;
}

/**
 * Salin satu gambar ke kotak provider-in/ dan kembalikan URL MUTLAK-nya.
 *
 * URL-nya mutlak, bukan relatif seperti createSignedUrl: yang akan membukanya
 * adalah server orang lain, dan alamat relatif tidak berarti apa-apa di sana.
 * Karena itu APP_BASE_URL wajib terisi — tanpa itu kita hanya bisa menyusun
 * alamat yang pasti gagal diunduh, dan kegagalannya baru terlihat sebagai
 * galat samar dari penyedia beberapa menit kemudian.
 */
export async function terbitkanGambarProvider(
  berkasLokal: string,
  jobId: string,
  shotIndex: number,
): Promise<string> {
  const basis = config.appBaseUrl.replace(/\/+$/, "");
  if (!basis) {
    throw new Error(
      "APP_BASE_URL kosong — penyedia yang mengunduh gambar lewat URL (kie.ai) tidak bisa dilayani. " +
        "Isi APP_BASE_URL dengan alamat publik situs ini.",
    );
  }
  if (!/^https?:\/\//i.test(basis)) {
    throw new Error(`APP_BASE_URL bukan alamat http(s): "${basis}"`);
  }

  const bytes = await fs.promises.readFile(berkasLokal);
  if (!mimeGambar(bytes)) {
    throw new Error(`Berkas ${path.basename(berkasLokal)} bukan JPEG/PNG/WebP — tidak diterbitkan.`);
  }

  const key = kunciGambar(jobId, shotIndex, path.extname(berkasLokal));
  await mediaStorage().put(key, bytes, mimeGambar(bytes) ?? undefined);

  const exp = Math.floor(Date.now() / 1000) + TTL_DETIK;
  return `${basis}/api/provider-image/${key}?exp=${exp}&sig=${tandaTangan(key, exp)}`;
}

/**
 * Buang salinan milik sebuah job.
 *
 * Dipanggil saat job selesai. Kegagalannya tidak boleh menjatuhkan job yang
 * sudah sukses — tautannya kedaluwarsa sendiri, jadi paling buruk ada berkas
 * yang menumpang tidur di penyimpanan.
 */
export async function hapusGambarProvider(jobId: string, jumlahShot: number): Promise<void> {
  const storage = mediaStorage();
  for (let i = 0; i < Math.max(0, jumlahShot); i++) {
    for (const ext of EKSTENSI) {
      await storage.delete(`${AWALAN_PROVIDER}${jobId}/${i}${ext}`).catch(() => {});
    }
  }
}
