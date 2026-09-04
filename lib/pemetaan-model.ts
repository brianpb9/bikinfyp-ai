/**
 * PEMETAAN MESIN & MODEL PER PAKET — dari database, bukan dari kode.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA INI ADA
 * ────────────────────────────────────────────────────────────────────────────
 * Permintaan Brian 4 Sep 2026: bisa menentukan sendiri model tiap paket dari
 * halaman admin, "sehingga memungkinkan ekspansi bisnis model apabila rasanya
 * kedepan muncul efisiensi bisnis dengan perubahan model untuk setiap
 * packagenya".
 *
 * Sampai kini mesin dan model dipaku di KUALITAS (lib/kualitas-video.ts).
 * Mengganti model Premium menuntut ubah kode, bangun image, dan deploy — dan
 * deploy hari ini terbukti membunuh proses yang sedang berjalan. Keputusan yang
 * sifatnya komersial tidak seharusnya menuntut rilis.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * BAWAAN KODE TETAP JADI DASAR
 * ────────────────────────────────────────────────────────────────────────────
 * Tabel yang kosong berarti "pakai KUALITAS", jadi memasang fitur ini tidak
 * mengubah satu pun perilaku sampai ada yang benar-benar memakainya. Ini bukan
 * kehati-hatian berlebihan: fitur baru yang diam-diam mengubah keluaran adalah
 * cara paling cepat kehilangan kepercayaan pada rilis berikutnya.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA CACHE, DAN KENAPA TIDAK ASYNC
 * ────────────────────────────────────────────────────────────────────────────
 * mesinUntuk() dipanggil dari videoOrder() di registry — jalur sinkron yang
 * dilewati setiap render. Menjadikannya async menular ke seluruh rantai
 * provider tanpa memberi manfaat apa pun, karena jawabannya berubah paling
 * cepat sekali per beberapa menit.
 *
 * Jadi polanya sama dengan kredensial (lib/kredensial.ts): dimuat ke memori,
 * disegarkan berkala, dan dibaca secara sinkron. Perubahan dari /admin terlihat
 * oleh worker dalam satu siklus penyegaran, tanpa restart.
 */

import { KUALITAS, type Kualitas, type Mesin } from "./kualitas-video";
import { config } from "./config";

export interface BarisPemetaan {
  kualitas: Kualitas;
  mesin: Mesin;
  model: string;
  diperbaruiPada?: string;
  diperbaruiOleh?: string;
}

const MESIN_DIKENAL: Mesin[] = ["kie-grok", "byteplus"];

let cache: Partial<Record<Kualitas, BarisPemetaan>> = {};
let terakhirDimuat = 0;

/** Untuk uji — dan HANYA untuk uji. */
export function setPemetaanUntukUji(baris: BarisPemetaan[] | null): void {
  cache = {};
  for (const b of baris ?? []) cache[b.kualitas] = b;
  terakhirDimuat = baris === null ? 0 : Date.now();
}

export function pemetaanTersimpan(): BarisPemetaan[] {
  return Object.values(cache);
}

/**
 * Mesin yang BERLAKU untuk sebuah kualitas: pemetaan admin kalau ada, kalau
 * tidak bawaan kode.
 */
export function mesinBerlaku(kualitas: Kualitas): Mesin {
  return cache[kualitas]?.mesin ?? KUALITAS[kualitas].mesin;
}

/** Model yang BERLAKU untuk sebuah kualitas. */
export function modelBerlaku(kualitas: Kualitas): string {
  return cache[kualitas]?.model ?? KUALITAS[kualitas].model;
}

/**
 * Periksa satu usulan pemetaan. Mengembalikan alasan tolak, atau null.
 *
 * Ditolak DI SINI, bukan di ujung: pemetaan yang salah baru ketahuan saat
 * render — sesudah naskah ditulis, gambar dibayar, dan pembeli menunggu.
 */
export function periksaPemetaan(input: { kualitas: string; mesin: string; model: string }): string | null {
  if (!(input.kualitas in KUALITAS)) return `Paket "${input.kualitas}" tidak dikenal.`;
  if (!MESIN_DIKENAL.includes(input.mesin as Mesin)) return `Mesin "${input.mesin}" tidak dikenal.`;
  const model = input.model.trim();
  if (!model) return "Nama modelnya belum diisi.";
  if (model.length > 120) return "Nama modelnya terlalu panjang.";
  // BENTUK MODEL HARUS COCOK DENGAN MESINNYA.
  //
  // Ini penjagaan yang benar-benar pernah dibutuhkan: BytePlus menolak model
  // tanpa awalan yang benar dengan HTTP 404 di ujung render, dan kie.ai
  // memakai bentuk "<keluarga>/<tugas>". Memasangkan keduanya secara silang
  // menghasilkan job yang gagal SESUDAH naskah ditulis dan gambar disiapkan.
  if (input.mesin === "byteplus" && !/^(dreamina-|seedance-)/.test(model)) {
    return 'Model BytePlus harus diawali "dreamina-" atau "seedance-".';
  }
  if (input.mesin === "kie-grok" && !model.includes("/")) {
    return 'Model kie.ai berbentuk "<keluarga>/<tugas>", contoh "grok-imagine/image-to-video".';
  }
  return null;
}

/** Muat pemetaan dari database ke memori. Aman dipanggil berulang. */
export async function muatPemetaan(): Promise<void> {
  try {
    const { postgresRuntimeEnabled } = await import("./postgres/smoke-runtime");
    if (!postgresRuntimeEnabled()) return;
    const { getPool } = await import("./postgres/pool");
    const pool = getPool(config.databaseUrl);
    const { rows } = await pool.query<{ kualitas: Kualitas; mesin: Mesin; model: string; diperbarui_pada: string; diperbarui_oleh: string }>(
      "SELECT kualitas, mesin, model, diperbarui_pada, diperbarui_oleh FROM pemetaan_model",
    );
    const baru: Partial<Record<Kualitas, BarisPemetaan>> = {};
    for (const r of rows) {
      // Baris yang tidak lolos pemeriksaan DIABAIKAN, bukan dipakai.
      // Tabel bisa saja diisi lewat psql langsung; pemetaan rusak yang dipakai
      // menghasilkan kegagalan di ujung render, jauh dari sebabnya.
      const tolak = periksaPemetaan(r);
      if (tolak) {
        console.error(`[pemetaan-model] baris "${r.kualitas}" diabaikan: ${tolak}`);
        continue;
      }
      baru[r.kualitas] = { kualitas: r.kualitas, mesin: r.mesin, model: r.model, diperbaruiPada: r.diperbarui_pada, diperbaruiOleh: r.diperbarui_oleh };
    }
    cache = baru;
    terakhirDimuat = Date.now();
  } catch (err) {
    // Gagal memuat TIDAK mengosongkan cache: bawaan kode tetap berlaku, dan
    // pemetaan yang sudah termuat tetap dipakai. Database yang sesaat tidak
    // terjangkau tidak boleh diam-diam mengembalikan semua paket ke bawaan.
    console.error("[pemetaan-model] gagal memuat:", (err as Error).message);
  }
}

export async function pastikanPemetaanSegar(maksUsiaMs = 30_000): Promise<void> {
  if (Date.now() - terakhirDimuat < maksUsiaMs) return;
  await muatPemetaan();
}

let timer: NodeJS.Timeout | null = null;

/** Penyegaran berkala supaya perubahan dari /admin ikut terlihat worker. */
export function mulaiPenyegaranPemetaan(intervalMs = 30_000): void {
  if (timer) return;
  void muatPemetaan();
  timer = setInterval(() => void muatPemetaan(), intervalMs);
  timer.unref?.();
}
