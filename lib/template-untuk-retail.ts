// TEMPLATE UNTUK RETAIL — jembatan dari katalog penuh ke penjual perorangan.
//
// KETIMPANGAN YANG DIPERBAIKI (2026-08-15). Dashboard enterprise memakai
// CAMPAIGN_TEMPLATES: 33 template, masing-masing sudah dirender sungguhan dan
// lolos dua pemeriksa mutu. Retail memakai lib/config/template-terbukti.json:
// TIGA preset, tanpa video contoh.
//
// Tidak ada alasan produk untuk beda itu. Penjual perorangan justru yang
// paling butuh pilihan yang sudah terbukti — mereka tidak punya tim kreatif
// yang bisa menebak konsep sendiri, dan ke-33 template ini lahir dari
// pembedahan video pemenang.
//
// Yang TIDAK ikut dibawa: rasio 16:9. Template TVC dirender landscape untuk
// layar TV, sementara seluruh alur retail 9:16 untuk FYP. Menawarkannya di
// retail berarti menjual video yang salah bentuk untuk tempat mereka
// memasangnya.

import { CAMPAIGN_TEMPLATES, type CampaignTemplate } from "./templates";

export interface TemplateRetail {
  id: string;
  name: string;
  /** Satu kalimat: KAPAN dipakai, bukan apa isinya. */
  when: string;
  format: CampaignTemplate["format"];
  durationSec: number;
  hookLevel: CampaignTemplate["hookLevel"];
  /** Kategori produk yang paling cocok — untuk menyaring di galeri. */
  bestFor: string[];
}

/** Template yang layak ditawarkan ke penjual retail.
 *
 *  Disaring, bukan disalin bulat-bulat: hanya yang 9:16 dan berdurasi 15/30
 *  detik. Retail memposting ke FYP, dan durasi 45 detik di sana hampir selalu
 *  kalah oleh yang lebih pendek. */
export function templateUntukRetail(): TemplateRetail[] {
  return CAMPAIGN_TEMPLATES.filter((t) => (t.ratio ?? "9:16") === "9:16" && t.durationSec <= 30).map((t) => ({
    id: t.id,
    name: t.name,
    when: t.when,
    format: t.format,
    durationSec: t.durationSec,
    hookLevel: t.hookLevel,
    bestFor: t.bestFor,
  }));
}

/** Preset yang dipakai saat penjual memilih sebuah template — bentuknya sama
 *  dengan yang sudah dipakai layar /bikin/gaya, supaya tidak ada perubahan
 *  perilaku selain daftarnya jadi jauh lebih panjang. */
export function presetRetail(id: string): { format: string; durationSec: number; hookLevel: string } | null {
  const t = CAMPAIGN_TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  return { format: t.format, durationSec: t.durationSec, hookLevel: t.hookLevel };
}
