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
import { config } from "./config";
import { kredensialKey } from "./secrets";
import { getPool } from "./postgres/pool";
import type { BarisTampilan, KelompokKredensial } from "./kredensial-tipe";

export type { BarisTampilan, KelompokKredensial } from "./kredensial-tipe";

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
  { nama: "ANTHROPIC_API_KEY", label: "Anthropic (mesin skrip)", properti: "anthropicApiKey", rahasia: true, kelompok: "Video & AI" },
  { nama: "GEMINI_API_KEY", label: "Gemini (analisa bisnis)", properti: "geminiApiKey", rahasia: true, kelompok: "Video & AI" },
  { nama: "GOOGLE_TTS_API_KEY", label: "Google TTS", properti: "googleTtsApiKey", rahasia: true, kelompok: "Video & AI" },
  { nama: "AZURE_TTS_KEY", label: "Azure TTS", properti: "azureTtsKey", rahasia: true, kelompok: "Video & AI" },

  { nama: "DUITKU_MERCHANT_CODE", label: "Duitku — kode merchant", properti: "duitkuMerchantCode", rahasia: false, kelompok: "Pembayaran" },
  { nama: "DUITKU_API_KEY", label: "Duitku — API key", properti: "duitkuApiKey", rahasia: true, kelompok: "Pembayaran" },
  { nama: "MIDTRANS_SERVER_KEY", label: "Midtrans server key (cadangan)", properti: "midtransServerKey", rahasia: true, kelompok: "Pembayaran" },
  { nama: "MIDTRANS_CLIENT_KEY", label: "Midtrans client key (cadangan)", properti: "midtransClientKey", rahasia: true, kelompok: "Pembayaran" },

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
    for (const r of rows) {
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
    terakhirDimuat = Date.now();
    return dipasang;
  } catch (err) {
    console.error("[kredensial] gagal memuat dari database, memakai nilai env:", err);
    return 0;
  }
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
  if (Date.now() - terakhirDimuat < maksUsiaMs) return;
  await muatKredensial();
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
 * Redirect URI yang HARUS terdaftar di Google Cloud Console, apa adanya.
 *
 * Ada di sini karena redirect_uri_mismatch adalah kegagalan yang paling mudah
 * dibuat dan paling sulit didiagnosis: Google menolak SEBELUM callback kita
 * tersentuh, jadi tidak ada satu pun log di sisi kita yang menunjukkan
 * penyebabnya. Operator lalu menebak-nebak — dengan atau tanpa www, dengan
 * atau tanpa garis miring — sementara nilai yang benar sebenarnya sudah pasti
 * dan bisa dibaca dari APP_BASE_URL.
 *
 * Ditampilkan di halaman kredensial supaya jadi tempelan yang disalin, bukan
 * tebakan.
 */
export function redirectUriGoogle(): string {
  const base = config.appBaseUrl.replace(/\/+$/, "");
  // APP_BASE_URL kosong -> kembalikan kosong, JANGAN path relatif.
  // "/api/auth/google/callback" terlihat masuk akal dan akan disalin operator
  // ke Google Console, lalu ditolak dengan galat yang sama sekali tidak
  // menunjuk ke penyebabnya. Kosong memaksa halaman mengatakan apa adanya.
  if (!base) return "";
  return `${base}/api/auth/google/callback`;
}
