/**
 * KREDENSIAL PARTNER YANG BISA DIGANTI TANPA RESTART.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA INI ADA
 * ────────────────────────────────────────────────────────────────────────────
 * Sampai 2 Sep 2026, mengganti satu API key berarti menyunting .env.server
 * lewat SSH lalu me-recreate container. Itu memaksa restart untuk sesuatu yang
 * sama sekali bukan perubahan kode — dan restart di tengah antrean render
 * membunuh job yang sedang berjalan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA MENGUBAH `config` LANGSUNG, BUKAN MENGGANTI SETIAP PEMANGGIL
 * ────────────────────────────────────────────────────────────────────────────
 * `config` adalah objek biasa, tidak dibekukan, dan setiap pemanggil membaca
 * propertinya SAAT DIPANGGIL (`config.byteplusApiKey` di dalam fungsi), bukan
 * saat impor. Jadi menulis ulang propertinya langsung terlihat oleh seluruh
 * penyedia tanpa satu pun call site diubah.
 *
 * Alternatifnya — mengganti ~30 pembacaan `config.x` jadi `kunci("X")` —
 * menyentuh sembilan berkas penyedia demi hasil yang sama persis, dan setiap
 * berkas yang terlewat akan diam-diam tetap memakai kunci lama.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DUA PROSES, SATU DATABASE
 * ────────────────────────────────────────────────────────────────────────────
 * web dan worker adalah container terpisah dengan memori sendiri. Perubahan
 * dari halaman admin (web) tidak akan pernah terlihat worker kalau hanya
 * ditulis ke memori. Karena itu sumber kebenarannya DATABASE, dan kedua proses
 * menyegarkan diri secara berkala.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * env TETAP CADANGAN
 * ────────────────────────────────────────────────────────────────────────────
 * Nama yang tidak punya baris di database memakai nilai dari .env seperti
 * biasa. Memasang fitur ini tidak pernah mematikan konfigurasi yang sudah
 * berjalan, dan menghapus satu baris mengembalikannya ke env.
 */

import crypto from "node:crypto";
import { config, paymentsProvider } from "./config";
import { kredensialKey } from "./secrets";
import { getPool } from "./postgres/pool";
import type { BarisTampilan, KelompokKredensial, StatusLingkunganDuitku } from "./kredensial-tipe";
import { asalDiizinkan } from "@/lib/asal-oauth";
import { deteksiLingkunganDuitku, type HasilDeteksi, type KanalAktif, type LingkunganDuitku } from "./duitku-deteksi";

export type { BarisTampilan, KelompokKredensial, StatusLingkunganDuitku } from "./kredensial-tipe";

/** Kredensial yang boleh dikelola dari dashboard, dan ke mana ia dipasang. */
export type Kredensial = {
  /** Nama env — dipakai sebagai kunci baris dan ditampilkan ke operator. */
  nama: string;
  label: string;
  /** Properti di `config` yang ditulis ulang saat nilainya berubah. */
  properti: keyof typeof config;
  /** true = nilainya tidak pernah ditampilkan utuh, hanya disamarkan. */
  rahasia: boolean;
  kelompok: KelompokKredensial;
};

export const KREDENSIAL: readonly Kredensial[] = [
  { nama: "BYTEPLUS_ARK_API_KEY", label: "BytePlus ARK (mesin video)", properti: "byteplusApiKey", rahasia: true, kelompok: "Video & AI" },
  { nama: "KIE_API_KEY", label: "kie.ai (Grok Imagine — kualitas Standard)", properti: "kieApiKey", rahasia: true, kelompok: "Video & AI" },
  { nama: "ANTHROPIC_API_KEY", label: "Anthropic (mesin skrip)", properti: "anthropicApiKey", rahasia: true, kelompok: "Video & AI" },
  { nama: "GEMINI_API_KEY", label: "Gemini (analisa bisnis)", properti: "geminiApiKey", rahasia: true, kelompok: "Video & AI" },
  { nama: "GOOGLE_TTS_API_KEY", label: "Google TTS", properti: "googleTtsApiKey", rahasia: true, kelompok: "Video & AI" },
  { nama: "AZURE_TTS_KEY", label: "Azure TTS", properti: "azureTtsKey", rahasia: true, kelompok: "Video & AI" },

  { nama: "DUITKU_MERCHANT_CODE", label: "Duitku — kode merchant", properti: "duitkuMerchantCode", rahasia: false, kelompok: "Pembayaran" },
  { nama: "DUITKU_API_KEY", label: "Duitku — API key", properti: "duitkuApiKey", rahasia: true, kelompok: "Pembayaran" },
  { nama: "MIDTRANS_SERVER_KEY", label: "Midtrans server key (cadangan)", properti: "midtransServerKey", rahasia: true, kelompok: "Pembayaran" },
  { nama: "MIDTRANS_CLIENT_KEY", label: "Midtrans client key (cadangan)", properti: "midtransClientKey", rahasia: true, kelompok: "Pembayaran" },
  { nama: "SANDBOX_TESTER_EMAILS", label: "Email penguji sandbox (dipisah koma)", properti: "sandboxTesterEmails", rahasia: false, kelompok: "Pembayaran" },

  { nama: "RESEND_API_KEY", label: "Resend (OTP email)", properti: "resendApiKey", rahasia: true, kelompok: "Email & Login" },
  { nama: "RESEND_FROM_EMAIL", label: "Alamat pengirim", properti: "resendFromEmail", rahasia: false, kelompok: "Email & Login" },
  { nama: "GOOGLE_OAUTH_CLIENT_ID", label: "Google SSO — client ID", properti: "googleOauthClientId", rahasia: false, kelompok: "Email & Login" },
  { nama: "GOOGLE_OAUTH_CLIENT_SECRET", label: "Google SSO — client secret", properti: "googleOauthClientSecret", rahasia: true, kelompok: "Email & Login" },

  { nama: "R2_ENDPOINT", label: "Penyimpanan — endpoint", properti: "r2Endpoint", rahasia: false, kelompok: "Penyimpanan" },
  { nama: "R2_BUCKET", label: "Penyimpanan — bucket", properti: "r2Bucket", rahasia: false, kelompok: "Penyimpanan" },
  { nama: "R2_ACCESS_KEY_ID", label: "Penyimpanan — access key", properti: "r2AccessKeyId", rahasia: true, kelompok: "Penyimpanan" },
  { nama: "R2_SECRET_ACCESS_KEY", label: "Penyimpanan — secret key", properti: "r2SecretAccessKey", rahasia: true, kelompok: "Penyimpanan" },
];

export function kredensialDikenal(nama: string): Kredensial | undefined {
  return KREDENSIAL.find((k) => k.nama === nama);
}

/**
 * Nilai env SAAT PROSES MULAI, untuk dikembalikan ketika barisnya dihapus.
 *
 * Tanpa salinan ini "Kembalikan ke .env" hanya menghapus baris database:
 * `config` tetap memegang nilai lama dari database sampai container dimulai
 * ulang — padahal halaman berjanji perubahannya berlaku tanpa restart.
 */
const nilaiEnvAwal = new Map<string, unknown>(
  KREDENSIAL.map((k) => [k.nama, (config as unknown as Record<string, unknown>)[k.properti as string]]),
);

/* ── enkripsi ─────────────────────────────────────────────────────────── */

/** AES-256-GCM. Format tersimpan: iv.tag.ciphertext, ketiganya base64url. */
export function enkripsi(nilai: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", kredensialKey(), iv);
  const enc = Buffer.concat([c.update(nilai, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function dekripsi(tersimpan: string): string {
  const [iv, tag, enc] = tersimpan.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !enc) throw new Error("bentuk kredensial tersimpan tidak dikenal");
  const d = crypto.createDecipheriv("aes-256-gcm", kredensialKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

/* ── samaran untuk ditampilkan ────────────────────────────────────────── */

/**
 * Nilai rahasia TIDAK PERNAH dikirim utuh ke layar.
 *
 * Empat karakter terakhir cukup untuk menjawab satu-satunya pertanyaan yang
 * benar-benar ditanyakan operator — "yang terpasang ini yang mana?" — tanpa
 * membuat halaman admin jadi tempat menyalin kunci produksi.
 */
export function samarkan(nilai: string): string {
  if (!nilai) return "";
  if (nilai.length <= 8) return "•".repeat(nilai.length);
  return `${"•".repeat(8)}${nilai.slice(-4)}`;
}

/* ── muat & terapkan ──────────────────────────────────────────────────── */

type Baris = { name: string; value_enc: string; updated_at: string; updated_by: string };

let terakhirDimuat = 0;
const meta = new Map<string, { updated_at: string; updated_by: string }>();

async function bacaBaris(): Promise<Baris[]> {
  const pool = getPool(config.databaseUrl);
  const { rows } = await pool.query<Baris>(
    "SELECT name, value_enc, updated_at, updated_by FROM runtime_secrets",
  );
  return rows;
}

/**
 * Baca dari database dan pasang ke `config`. Aman dipanggil berulang.
 *
 * Kegagalan TIDAK melempar: kalau database sedang tidak bisa dihubungi,
 * proses harus tetap berjalan dengan nilai env yang sudah ada. Kredensial yang
 * gagal disegarkan adalah masalah; proses yang mati karenanya lebih buruk.
 */
export async function muatKredensial(): Promise<number> {
  try {
    const rows = await bacaBaris();
    let dipasang = 0;
    meta.clear();
    // Nama yang tidak lagi punya baris kembali ke nilai env-nya.
    const adaBaris = new Set(rows.map((r) => r.name));
    for (const k of KREDENSIAL) {
      if (!adaBaris.has(k.nama)) (config as unknown as Record<string, unknown>)[k.properti as string] = nilaiEnvAwal.get(k.nama);
    }
    for (const r of rows) {
      if (r.name === BARIS_LINGKUNGAN_DUITKU) {
        bacaCatatanDuitku(r.value_enc);
        continue;
      }
      const k = kredensialDikenal(r.name);
      if (!k) continue; // baris untuk nama yang sudah tidak dikelola — abaikan
      try {
        (config as unknown as Record<string, string>)[k.properti as string] = dekripsi(r.value_enc);
        meta.set(r.name, { updated_at: r.updated_at, updated_by: r.updated_by });
        dipasang++;
      } catch {
        // Satu baris rusak (mis. AUTH_SECRET dirotasi tanpa mengulang isi
        // tabel) tidak boleh menjatuhkan seluruh pemuatan.
        console.error(`[kredensial] gagal mendekripsi ${r.name} — memakai nilai env`);
      }
    }
    // Baris catatan yang TIDAK ADA tidak menghapus catatan di memori: ia bisa
    // saja belum selesai ditulis oleh deteksi yang sedang berjalan di proses
    // ini. Catatan lama tetap tidak berlaku untuk pasangan kunci lain karena
    // diikat ke sidiknya.
    terapkanLingkunganDuitku();
    terakhirDimuat = Date.now();
    return dipasang;
  } catch (err) {
    console.error("[kredensial] gagal memuat dari database, memakai nilai env:", err);
    return 0;
  }
}

/* ── lingkungan Duitku: dideteksi, bukan dibaca dari env ─────────────── */
//
// Lihat lib/duitku-deteksi.ts untuk alasannya. Singkatnya: pasangan kode
// merchant + API key hanya dikenali Duitku di SATU lingkungan, jadi
// lingkungannya ditanyakan ke Duitku setiap kali pasangan itu berubah, dan
// jawabannya menimpa DUITKU_IS_PRODUCTION.
//
// Hasilnya disimpan di runtime_secrets (terenkripsi seperti baris lain) supaya
// proses web yang baru mulai tidak perlu bertanya ulang. Catatan itu diikat ke
// SIDIK pasangan kuncinya: begitu kode atau kunci diganti, catatan lama tidak
// berlaku lagi dan Duitku ditanya ulang.
//
// WORKER TIDAK PERNAH BERTANYA SENDIRI — ia hanya membaca catatan tersimpan.
// Itu cukup karena tidak ada jalur worker yang memakai duitkuIsProduction;
// semua jalur uang (checkout, webhook, status pesanan) hidup di web. Kalau
// suatu saat worker ikut memproses pembayaran, ia wajib memanggil
// pastikanLingkunganDuitku() dan lingkunganDuitkuPasti() seperti webhook.

const BARIS_LINGKUNGAN_DUITKU = "DUITKU_LINGKUNGAN_TERDETEKSI";
const JEDA_ULANG_GAGAL_MS = 60_000;

/**
 * Saklar EKSPLISIT untuk mematikan deteksi: DUITKU_DETEKSI_LINGKUNGAN=0.
 *
 * Hanya untuk uji dan pengembangan offline — tempat kunci Duitku-nya palsu dan
 * bertanya ke Duitku sungguhan justru salah. Dengan saklar ini
 * DUITKU_IS_PRODUCTION kembali jadi satu-satunya sumber, dan dianggap pasti.
 * DIABAIKAN di NODE_ENV=production: operator yang menyalin pengaturan uji ke
 * server tidak boleh diam-diam mengembalikan perilaku yang membuat checkout
 * mati 13 Sep 2026.
 */
let peringatanSaklar = false;
function deteksiDimatikan(): boolean {
  if (process.env.DUITKU_DETEKSI_LINGKUNGAN !== "0") return false;
  if (process.env.NODE_ENV === "production") {
    if (!peringatanSaklar) {
      peringatanSaklar = true;
      console.error("[kredensial] DUITKU_DETEKSI_LINGKUNGAN=0 DIABAIKAN di production — lingkungan Duitku tetap dideteksi.");
    }
    return false;
  }
  return true;
}
/** DUITKU_IS_PRODUCTION dari env — hanya dipakai selama pasangan kunci belum dikenali. */
const produksiDariEnv = config.duitkuIsProduction;

type CatatanDuitku = { sidik: string; lingkungan: LingkunganDuitku; kanal: KanalAktif[]; diperiksa_at: string };

let catatanDuitku: CatatanDuitku | null = null;
let gagalDuitku: { sidik: string; at: number; hasil: HasilDeteksi } | null = null;
let pemeriksaanBerjalan: { sidik: string; janji: Promise<HasilDeteksi> } | null = null;

/** Sidik pasangan kunci — BUKAN kuncinya. Cukup untuk tahu "masih pasangan yang sama?". */
function sidikDuitku(merchantCode: string, apiKey: string): string {
  return crypto.createHash("sha256").update(`${merchantCode}\n${apiKey}`).digest("hex").slice(0, 24);
}

function sidikSekarang(): string | null {
  if (!config.duitkuMerchantCode || !config.duitkuApiKey) return null;
  return sidikDuitku(config.duitkuMerchantCode, config.duitkuApiKey);
}

function bacaCatatanDuitku(valueEnc: string): void {
  try {
    const c = JSON.parse(dekripsi(valueEnc)) as CatatanDuitku;
    if (c && typeof c.sidik === "string" && (c.lingkungan === "production" || c.lingkungan === "sandbox")) {
      catatanDuitku = { ...c, kanal: Array.isArray(c.kanal) ? c.kanal : [] };
    }
  } catch {
    console.error(`[kredensial] catatan ${BARIS_LINGKUNGAN_DUITKU} tidak terbaca — lingkungan Duitku akan dideteksi ulang`);
  }
}

/** Catatan yang berlaku untuk pasangan kunci SAAT INI, atau null. */
function catatanBerlaku(): CatatanDuitku | null {
  const s = sidikSekarang();
  return s && catatanDuitku?.sidik === s ? catatanDuitku : null;
}

function terapkanLingkunganDuitku(): void {
  const c = deteksiDimatikan() ? null : catatanBerlaku();
  config.duitkuIsProduction = c ? c.lingkungan === "production" : produksiDariEnv;
}

/**
 * Apakah lingkungan Duitku SUDAH PASTI untuk pasangan kunci terpasang?
 *
 * false berarti config.duitkuIsProduction sedang memakai DUITKU_IS_PRODUCTION
 * sebagai tebakan. Jalur yang memindahkan uang — webhook — WAJIB menolak
 * bekerja di atas tebakan: salah menebak "sandbox" menandai pembayaran
 * sungguhan sebagai uang mainan, salah menebak "production" mengisi dompet
 * sungguhan dengan uang mainan.
 */
export function lingkunganDuitkuPasti(): boolean {
  return deteksiDimatikan() || catatanBerlaku() !== null;
}

async function simpanCatatanDuitku(c: CatatanDuitku): Promise<void> {
  try {
    await getPool(config.databaseUrl).query(
      `INSERT INTO runtime_secrets (name, value_enc, updated_at, updated_by)
            VALUES ($1,$2,$3,'deteksi-otomatis')
       ON CONFLICT (name) DO UPDATE
          SET value_enc = EXCLUDED.value_enc, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [BARIS_LINGKUNGAN_DUITKU, enkripsi(JSON.stringify(c)), c.diperiksa_at],
    );
  } catch (err) {
    // Gagal menyimpan bukan alasan menggagalkan deteksi: proses ini sudah
    // memegang jawabannya, dan proses lain akan bertanya sendiri.
    console.error("[kredensial] gagal menyimpan lingkungan Duitku:", err instanceof Error ? err.message : err);
  }
}

/**
 * Pastikan lingkungan Duitku sesuai pasangan kunci yang terpasang.
 *
 * Murah bila pasangannya sudah dikenali — tanpa jaringan sama sekali. Duitku
 * hanya ditanya saat pasangan berubah (atau `paksa`), dan kegagalan ditahan
 * 60 detik supaya gateway yang sedang mati tidak ditanya di setiap permintaan.
 *
 * Selama pasangan belum dikenali, DUITKU_IS_PRODUCTION dari env tetap berlaku.
 */
export async function pastikanLingkunganDuitku(opts: { paksa?: boolean; deteksi?: typeof deteksiLingkunganDuitku } = {}): Promise<HasilDeteksi | null> {
  const s = sidikSekarang();
  if (!s || (deteksiDimatikan() && !opts.deteksi)) {
    terapkanLingkunganDuitku();
    return null;
  }
  const berlaku = catatanBerlaku();
  if (berlaku && !opts.paksa) {
    terapkanLingkunganDuitku();
    return { status: "dikenali", lingkungan: berlaku.lingkungan, kanal: berlaku.kanal };
  }
  if (!opts.paksa && gagalDuitku?.sidik === s && Date.now() - gagalDuitku.at < JEDA_ULANG_GAGAL_MS) {
    return gagalDuitku.hasil;
  }
  if (pemeriksaanBerjalan?.sidik === s) return pemeriksaanBerjalan.janji;

  const deteksi = opts.deteksi ?? deteksiLingkunganDuitku;
  const janji = (async () => {
    const hasil = await deteksi(config.duitkuMerchantCode, config.duitkuApiKey);
    // Kunci bisa diganti SELAMA pertanyaan berjalan; jawaban untuk pasangan
    // lama tidak boleh ditempelkan ke pasangan baru.
    if (sidikSekarang() !== s) return hasil;
    if (hasil.status === "dikenali") {
      const lama = catatanDuitku;
      catatanDuitku = { sidik: s, lingkungan: hasil.lingkungan, kanal: hasil.kanal, diperiksa_at: new Date().toISOString() };
      gagalDuitku = null;
      if (lama?.sidik !== s || lama.lingkungan !== hasil.lingkungan) {
        console.log(`[kredensial] lingkungan Duitku terdeteksi: ${hasil.lingkungan} (merchant ${config.duitkuMerchantCode})`);
      }
      await simpanCatatanDuitku(catatanDuitku);
    } else {
      gagalDuitku = { sidik: s, at: Date.now(), hasil };
      console.error(`[kredensial] lingkungan Duitku belum bisa dipastikan (merchant ${config.duitkuMerchantCode}): ${hasil.alasan}`);
    }
    terapkanLingkunganDuitku();
    return hasil;
  })();
  pemeriksaanBerjalan = { sidik: s, janji };
  try {
    return await janji;
  } finally {
    if (pemeriksaanBerjalan?.janji === janji) pemeriksaanBerjalan = null;
  }
}

/**
 * Kode kanal yang AKTIF di merchant terpasang, atau null bila belum diketahui.
 *
 * Kanal aktif berbeda per merchant DAN per lingkungan: QRIS (NQ) aktif di
 * merchant sandbox, tapi tidak ada di merchant production D24570. Menawarkan
 * kanal yang tidak aktif berarti pembeli baru tahu sesudah menekannya.
 */
export function kanalAktifDuitku(): string[] | null {
  const c = deteksiDimatikan() ? null : catatanBerlaku();
  // Daftar kosong = tidak diketahui, BUKAN "tidak ada kanal". Menyaring dengan
  // daftar kosong akan menyembunyikan seluruh tombol bayar.
  return c && c.kanal.length > 0 ? c.kanal.map((k) => k.kode) : null;
}

/** Ringkasan untuk halaman admin. Tidak memuat kunci dalam bentuk apa pun. */
export function statusLingkunganDuitku(): StatusLingkunganDuitku {
  const c = deteksiDimatikan() ? null : catatanBerlaku();
  const s = sidikSekarang();
  const gagal = s && gagalDuitku?.sidik === s && gagalDuitku.hasil.status !== "dikenali" ? gagalDuitku.hasil : null;
  return {
    terpasang: s !== null,
    merchant: config.duitkuMerchantCode,
    lingkungan: config.duitkuIsProduction ? "production" : "sandbox",
    sumber: c ? "terdeteksi" : "env",
    kanal: c?.kanal ?? [],
    ...(c ? { diperiksa_at: c.diperiksa_at } : {}),
    ...(gagal ? { galat: gagal.alasan } : {}),
  };
}

/** Simpan nilai baru, lalu langsung terapkan di proses ini. */
export async function simpanKredensial(nama: string, nilai: string, oleh: string): Promise<void> {
  const k = kredensialDikenal(nama);
  if (!k) throw new Error(`Kredensial tidak dikenal: ${nama}`);
  const pool = getPool(config.databaseUrl);
  await pool.query(
    `INSERT INTO runtime_secrets (name, value_enc, updated_at, updated_by)
          VALUES ($1,$2,$3,$4)
     ON CONFLICT (name) DO UPDATE
        SET value_enc = EXCLUDED.value_enc,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by`,
    [nama, enkripsi(nilai), new Date().toISOString(), oleh],
  );
  await muatKredensial();
}

/** Hapus baris — nilainya kembali ke env. */
export async function hapusKredensial(nama: string): Promise<void> {
  if (!kredensialDikenal(nama)) throw new Error(`Kredensial tidak dikenal: ${nama}`);
  const pool = getPool(config.databaseUrl);
  await pool.query("DELETE FROM runtime_secrets WHERE name = $1", [nama]);
  await muatKredensial();
}


/** Daftar untuk halaman admin — nilai rahasia selalu disamarkan. */
export async function daftarKredensial(): Promise<BarisTampilan[]> {
  await muatKredensial();
  return KREDENSIAL.map((k) => {
    const nilai = String((config as unknown as Record<string, unknown>)[k.properti as string] ?? "");
    const m = meta.get(k.nama);
    return {
      nama: k.nama,
      label: k.label,
      kelompok: k.kelompok,
      rahasia: k.rahasia,
      terisi: nilai !== "",
      contoh: nilai === "" ? "" : k.rahasia ? samarkan(nilai) : nilai,
      sumber: nilai === "" ? "kosong" : m ? "database" : "env",
      ...(m ? { updated_at: m.updated_at, updated_by: m.updated_by } : {}),
    };
  });
}

/**
 * Segarkan kalau sudah basi. Dipanggil dari rute yang MEMAKAI kredensial.
 *
 * KENAPA BUKAN instrumentation.ts. Itu percobaan pertama, dan ia menjatuhkan
 * build: Next mengompilasi instrumentation untuk edge runtime JUGA, dan di
 * sana `fs`/`path`/`stream` tidak ada. Penjagaan `NEXT_RUNTIME !== "nodejs"`
 * berlaku saat JALAN, sedangkan webpack menelusuri impornya saat BUILD —
 * jadi penjagaan runtime tidak pernah menyelamatkan build. Ketahuan saat
 * build, bukan saat deploy.
 *
 * Cara ini lebih sempit tapi jujur: hanya jalur yang benar-benar memakai
 * kredensial yang membayar biayanya, dan biayanya satu query ringan paling
 * sering sekali per 30 detik.
 */
export async function pastikanSegar(maksUsiaMs = 30_000): Promise<void> {
  if (Date.now() - terakhirDimuat >= maksUsiaMs) await muatKredensial();
  // Tanpa jaringan bila pasangan kunci Duitku sudah dikenali; lihat
  // pastikanLingkunganDuitku.
  if (paymentsProvider() === "duitku") await pastikanLingkunganDuitku();
}

/* ── penyegaran berkala ───────────────────────────────────────────────── */

let timer: NodeJS.Timeout | null = null;

/**
 * Menyegarkan berkala supaya perubahan dari web ikut terlihat worker.
 *
 * unref() dipasang agar proses tidak tertahan hidup hanya karena timer ini —
 * skrip sekali-jalan harus tetap bisa selesai sendiri.
 */
export function mulaiPenyegaranKredensial(intervalMs = 30_000): void {
  if (timer) return;
  void muatKredensial();
  timer = setInterval(() => void muatKredensial(), intervalMs);
  timer.unref?.();
}

/** Untuk uji. */
export function statusKredensial() {
  return { terakhirDimuat, dariDatabase: meta.size };
}

/**
 * SEMUA redirect URI yang harus terdaftar di Google Cloud Console, apa adanya.
 *
 * Ada di sini karena redirect_uri_mismatch adalah kegagalan yang paling mudah
 * dibuat dan paling sulit didiagnosis: Google menolak SEBELUM callback kita
 * tersentuh, jadi tidak ada satu pun log di sisi kita yang menunjukkan
 * penyebabnya. Operator lalu menebak-nebak — dengan atau tanpa www, dengan
 * atau tanpa garis miring.
 *
 * JAMAK, bukan tunggal. redirect_uri mengikuti domain yang sedang dibuka
 * pengunjung (lihat lib/asal-oauth.ts), jadi selama satu sistem melayani lebih
 * dari satu domain, SETIAP domain punya URI-nya sendiri dan semuanya harus
 * terdaftar. Menampilkan satu saja persis mengulang kegagalan 5 Sep 2026:
 * APP_BASE_URL pindah ke aiugc.id, halaman ini menampilkan satu alamat baru,
 * dan login Google mati di dua domain sekaligus.
 *
 * Ditampilkan di halaman kredensial supaya jadi tempelan yang disalin, bukan
 * tebakan.
 */
export function redirectUriGoogleTerdaftar(): string[] {
  // Sumbernya SATU dengan yang dipakai rute — bukan rumus kembar yang bisa
  // menyimpang diam-diam. APP_BASE_URL kosong -> daftar kosong, JANGAN path
  // relatif: "/api/auth/google/callback" terlihat masuk akal, akan disalin
  // operator ke Google Console, lalu ditolak dengan galat yang tidak menunjuk
  // ke penyebabnya. Kosong memaksa halaman mengatakan apa adanya.
  return asalDiizinkan().map((asal) => `${asal}/api/auth/google/callback`);
}
