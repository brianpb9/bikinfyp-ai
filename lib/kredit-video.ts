/**
 * KREDIT PER JENIS VIDEO — aturannya, di satu tempat.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA BUKAN SALDO RUPIAH LAGI
 * ────────────────────────────────────────────────────────────────────────────
 * Satu angka rupiah dipakai menjawab tiga pertanyaan sekaligus: berapa uang
 * tersisa, berapa video yang bisa dibuat, dan video JENIS APA. Ketiganya
 * bergerak sendiri-sendiri — harga tiap jenis beda, dan paket memberi jatah
 * per jenis — jadi satu angka tidak akan pernah cukup.
 *
 * Sekarang yang dihitung adalah JATAH VIDEO per jenis.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DUA EMBER, DUA ATURAN
 * ────────────────────────────────────────────────────────────────────────────
 *   langganan — datang dari paket, HABIS saat masa berlakunya berakhir;
 *   topup     — dibeli satuan, TIDAK PERNAH hangus.
 *
 * Pemakaian selalu menghabiskan ember langganan lebih dulu. Kebalikannya
 * terdengar sama saja, tapi tidak: jatah yang akan hangus jadi mengendap
 * sementara jatah abadi yang terpakai, dan pengguna kehilangan sesuatu yang
 * sudah dibayar tanpa pernah tahu.
 *
 * Berkas ini sengaja TIDAK menyentuh database. Ia dipakai dua runtime
 * (PostgreSQL di produksi, SQLite di dev dan tes) lewat lib/postgres/
 * kredit-video.ts dan lib/kredit-video-sqlite.ts. Aturannya tinggal di sini
 * supaya keduanya tidak bisa menyimpang diam-diam.
 */

import type { QualityTier } from "./providers/types";
import { setaraBaru, type Kualitas } from "./kualitas-video";

export type JenisVideo = Kualitas;
export type Ember = "langganan" | "topup";

export const JENIS_VIDEO: readonly JenisVideo[] = ["standard", "premium", "ultra"];

export function jenisDikenal(v: string): v is JenisVideo {
  return (JENIS_VIDEO as readonly string[]).includes(v);
}

/**
 * Jenis kredit yang dipotong oleh sebuah tier.
 *
 * Tier lama ikut dipetakan lewat setaraBaru(): job yang dibuat dari naskah
 * lama tetap harus membayar, dan membayar dari jatah yang setara — bukan
 * lolos gratis karena namanya tidak dikenal.
 */
export function jenisUntukTier(tier: QualityTier): JenisVideo {
  return setaraBaru(tier);
}

export interface SisaJenis {
  langganan: number;
  topup: number;
  total: number;
}

export type SisaKredit = Record<JenisVideo, SisaJenis>;

export const SISA_KOSONG: SisaKredit = {
  standard: { langganan: 0, topup: 0, total: 0 },
  premium: { langganan: 0, topup: 0, total: 0 },
  ultra: { langganan: 0, topup: 0, total: 0 },
};

export function susunSisa(
  langganan: Partial<Record<JenisVideo, number>>,
  topup: Partial<Record<JenisVideo, number>>,
): SisaKredit {
  const hasil = {} as SisaKredit;
  for (const j of JENIS_VIDEO) {
    // Sisa negatif TIDAK PERNAH ditampilkan sebagai negatif. Kalau sampai ada,
    // itu cacat pembukuan yang harus diperbaiki di sumbernya — memajangnya ke
    // pengguna hanya memindahkan kebingungan, dan membiarkannya ikut
    // penjumlahan bisa membuat jatah jenis lain tampak lebih kecil.
    const l = Math.max(0, langganan[j] ?? 0);
    const t = Math.max(0, topup[j] ?? 0);
    hasil[j] = { langganan: l, topup: t, total: l + t };
  }
  return hasil;
}

/**
 * Ember mana yang dipotong untuk satu render — atau null kalau jatahnya habis.
 *
 * Satu fungsi, dipakai kedua runtime. Kalau urutannya diubah di sini, ia
 * berubah di dua-duanya sekaligus; itulah maksudnya ditaruh di sini.
 */
export function emberUntukPakai(sisa: SisaKredit, jenis: JenisVideo): Ember | null {
  if (sisa[jenis].langganan > 0) return "langganan";
  if (sisa[jenis].topup > 0) return "topup";
  return null;
}

export function cukup(sisa: SisaKredit, jenis: JenisVideo, butuh = 1): boolean {
  return sisa[jenis].total >= butuh;
}

// ── Harga add-on per jenis ──────────────────────────────────────────────────

export type HargaPerJenis = Record<JenisVideo, number>;

export interface ItemTopup {
  jenis: JenisVideo;
  qty: number;
}

/** Batas atas satu pesanan per jenis — pagar terhadap salah ketik dan iseng. */
export const MAKS_QTY_PER_JENIS = 500;

export class PesananTidakSah extends Error {
  constructor(pesan: string) {
    super(pesan);
    this.name = "PesananTidakSah";
  }
}

/**
 * Bersihkan dan gabungkan isi pesanan.
 *
 * Menerima apa pun yang datang dari klien lalu MEMBUANG yang tidak masuk akal,
 * bukan membiarkannya lewat untuk diperiksa di tempat lain: yang dihitung dari
 * daftar ini adalah jumlah tagihan.
 */
export function rapikanItem(items: unknown): ItemTopup[] {
  if (!Array.isArray(items)) throw new PesananTidakSah("Isi pesanan tidak terbaca.");
  const per = new Map<JenisVideo, number>();
  for (const mentah of items) {
    const o = mentah as { jenis?: unknown; qty?: unknown };
    const jenis = String(o?.jenis ?? "");
    if (!jenisDikenal(jenis)) throw new PesananTidakSah(`Jenis video "${jenis}" tidak dikenal.`);
    const qty = Number(o?.qty ?? 0);
    if (!Number.isInteger(qty) || qty < 0) throw new PesananTidakSah("Jumlah harus bilangan bulat tidak negatif.");
    if (qty === 0) continue;
    // Digabung, bukan ditolak: dua baris untuk jenis yang sama adalah bentuk
    // yang wajar dari klien, dan menjumlahkannya tidak menyembunyikan apa pun.
    per.set(jenis, (per.get(jenis) ?? 0) + qty);
  }
  const hasil: ItemTopup[] = [];
  for (const j of JENIS_VIDEO) {
    const qty = per.get(j);
    if (!qty) continue;
    if (qty > MAKS_QTY_PER_JENIS) {
      throw new PesananTidakSah(`Maksimal ${MAKS_QTY_PER_JENIS} video ${j} dalam satu pesanan.`);
    }
    hasil.push({ jenis: j, qty });
  }
  if (!hasil.length) throw new PesananTidakSah("Pilih dulu berapa video yang mau dibeli.");
  return hasil;
}

/**
 * Total tagihan. Jenis yang harganya belum diatur admin DITOLAK, bukan
 * dihitung nol — pesanan yang lolos dengan harga nol berarti barang gratis.
 */
export function totalTagihan(items: ItemTopup[], harga: Partial<HargaPerJenis>): number {
  let total = 0;
  for (const it of items) {
    const h = harga[it.jenis];
    if (!h || h <= 0) throw new PesananTidakSah(`Harga video ${it.jenis} belum diatur.`);
    total += h * it.qty;
  }
  return total;
}

// ── Masa berlaku langganan ──────────────────────────────────────────────────

export interface Langganan {
  id: string;
  paketId: string;
  paketNama: string;
  kuotaStandard: number;
  kuotaPremium: number;
  kuotaUltra: number;
  mulaiPada: string;
  berakhirPada: string;
  status: "aktif" | "dibatalkan";
}

/**
 * Masih berlaku?
 *
 * Perbandingan STRING atas ISO-8601 UTC, bukan aritmetika waktu di SQL. Kolom
 * waktu di skema ini bertipe TEXT; `berakhir_pada > NOW() - INTERVAL` pernah
 * membuat /admin 500 karena alasan yang sama. Selama keduanya ISO UTC ber-Z,
 * urutan leksikografis sama dengan urutan waktu.
 */
export function langgananBerlaku(l: Pick<Langganan, "berakhirPada" | "status">, sekarangIso: string): boolean {
  return l.status === "aktif" && l.berakhirPada > sekarangIso;
}

export function akhirDari(mulaiIso: string, masaHari: number): string {
  const t = Date.parse(mulaiIso);
  if (!Number.isFinite(t)) throw new Error(`Waktu mulai tidak sah: ${mulaiIso}`);
  return new Date(t + masaHari * 24 * 60 * 60 * 1000).toISOString();
}

export interface PaketLangganan {
  id: string;
  nama: string;
  keterangan: string;
  hargaIdr: number;
  kuotaStandard: number;
  kuotaPremium: number;
  kuotaUltra: number;
  masaHari: number;
  urutan: number;
  aktif: boolean;
}

export function kuotaPaket(p: PaketLangganan): Record<JenisVideo, number> {
  return { standard: p.kuotaStandard, premium: p.kuotaPremium, ultra: p.kuotaUltra };
}

/** Berapa video seluruhnya — dipakai kartu paket supaya tidak dihitung di layar. */
export function totalVideoPaket(p: PaketLangganan): number {
  return p.kuotaStandard + p.kuotaPremium + p.kuotaUltra;
}
