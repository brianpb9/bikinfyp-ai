/**
 * Satu pintu ke kredit video, apa pun runtime-nya.
 *
 * Rute dan worker memanggil berkas ini, bukan salah satu implementasi. Tanpa
 * pintu ini, setiap pemanggil harus mengulang `if (postgresRuntimeEnabled())`
 * — dan cabang yang diulang di banyak tempat adalah cabang yang cepat atau
 * lambat lupa diikutkan di salah satunya.
 */
import { config } from "./config";
import { postgresRuntimeEnabled } from "./postgres/smoke-runtime";
import type {
  Ember,
  HargaPerJenis,
  ItemTopup,
  JenisVideo,
  PaketLangganan,
  SisaKredit,
} from "./kredit-video";

async function pg() {
  const { PgKreditVideo } = await import("./postgres/kredit-video");
  return new PgKreditVideo(config.databaseUrl);
}
async function sq() {
  return import("./kredit-video-sqlite");
}

export async function sisaKredit(userId: string): Promise<SisaKredit> {
  return postgresRuntimeEnabled() ? (await pg()).sisa(userId) : (await sq()).sisaKredit(userId);
}

/** Satu baris riwayat jatah, bentuk yang sama di kedua runtime. */
export interface BarisRiwayat {
  jenis: JenisVideo;
  ember: string;
  delta: number;
  tipe: string;
  catatan: string | null;
  dibuat_pada: string;
  job_id: string | null;
  job_state: string | null;
  produk: string | null;
}

export async function riwayatKredit(userId: string, batas = 50): Promise<BarisRiwayat[]> {
  return postgresRuntimeEnabled()
    ? ((await pg()).riwayat(userId, batas) as unknown as Promise<BarisRiwayat[]>)
    : ((await sq()).riwayatKredit(userId, batas) as unknown as BarisRiwayat[]);
}

export interface LanggananRingkas {
  id: string;
  paketId: string;
  paketNama: string;
  mulaiPada: string;
  berakhirPada: string;
  sisa: Record<JenisVideo, number>;
}

export async function langgananAktif(userId: string): Promise<LanggananRingkas[]> {
  if (postgresRuntimeEnabled()) {
    return (await (await pg()).langgananAktif(userId)).map((l) => ({
      id: l.id, paketId: l.paketId, paketNama: l.paketNama,
      mulaiPada: l.mulaiPada, berakhirPada: l.berakhirPada, sisa: l.sisa,
    }));
  }
  return (await sq()).langgananAktif(userId);
}

export async function pakaiKredit(userId: string, jenis: JenisVideo, jobId: string): Promise<Ember | null> {
  return postgresRuntimeEnabled() ? (await pg()).pakai(userId, jenis, jobId) : (await sq()).pakaiKredit(userId, jenis, jobId);
}

export async function kembalikanKredit(userId: string, jobId: string): Promise<boolean> {
  return postgresRuntimeEnabled() ? (await pg()).kembalikan(userId, jobId) : (await sq()).kembalikanKredit(userId, jobId);
}

export async function hargaKredit(): Promise<Partial<HargaPerJenis>> {
  return postgresRuntimeEnabled() ? (await pg()).harga() : (await sq()).hargaKredit();
}

export async function setHargaKredit(jenis: JenisVideo, hargaIdr: number, adminId: string): Promise<void> {
  if (postgresRuntimeEnabled()) await (await pg()).setHarga(jenis, hargaIdr, adminId);
  else (await sq()).setHargaKredit(jenis, hargaIdr, adminId);
}

export async function catatPesananTopup(paymentId: string, items: ItemTopup[], harga: Partial<HargaPerJenis>): Promise<number> {
  return postgresRuntimeEnabled()
    ? (await pg()).catatPesananTopup(paymentId, items, harga)
    : (await sq()).catatPesananTopup(paymentId, items, harga);
}

export async function kreditkanTopup(userId: string, paymentId: string): Promise<number> {
  return postgresRuntimeEnabled() ? (await pg()).kreditkanTopup(userId, paymentId) : (await sq()).kreditkanTopup(userId, paymentId);
}

export async function mulaiLangganan(userId: string, paket: PaketLangganan, paymentId: string | null): Promise<string | null> {
  return postgresRuntimeEnabled() ? (await pg()).mulaiLangganan(userId, paket, paymentId) : (await sq()).mulaiLangganan(userId, paket, paymentId);
}

export async function bonusKredit(userId: string, jenis: JenisVideo, qty: number, catatan: string): Promise<void> {
  if (postgresRuntimeEnabled()) await (await pg()).bonus(userId, jenis, qty, catatan);
  else (await sq()).bonusKredit(userId, jenis, qty, catatan);
}

export async function daftarPaket(hanyaAktif = true): Promise<PaketLangganan[]> {
  return postgresRuntimeEnabled() ? (await pg()).daftarPaket(hanyaAktif) : (await sq()).daftarPaket(hanyaAktif);
}

export async function ambilPaket(id: string): Promise<PaketLangganan | null> {
  return postgresRuntimeEnabled() ? (await pg()).ambilPaket(id) : (await sq()).ambilPaket(id);
}

export async function simpanPaket(p: PaketLangganan): Promise<void> {
  if (postgresRuntimeEnabled()) await (await pg()).simpanPaket(p);
  else (await sq()).simpanPaket(p);
}

export async function nonaktifkanPaket(id: string): Promise<void> {
  if (postgresRuntimeEnabled()) await (await pg()).nonaktifkanPaket(id);
  else (await sq()).nonaktifkanPaket(id);
}
