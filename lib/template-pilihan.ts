// SEPULUH TEMPLATE TERBAIK UNTUK KATEGORI PRODUKNYA (keputusan Brian, 9 Sep 2026).
//
// "tampilkan 10 katalog terbaik kategori saja dan narasinya bisa ditambahkan
//  yang memancing engagement pengguna seperti X dari 60 pemenang"
//
// ────────────────────────────────────────────────────────────────────────────
// DUA SUMBER, DUA DASAR BUKTI — DAN KEDUANYA DISEBUT APA ADANYA
// ────────────────────────────────────────────────────────────────────────────
// Sampai hari ini retail cuma melihat TIGA preset dari lib/config/template-
// terbukti.json, sementara 28 template kampanye yang sudah dikemas menganggur
// karena satu hal: kartunya berbunyi "X dari 110 video pemenang", dan angka itu
// TIDAK berlaku untuk template kampanye. Menukar sumber datanya tanpa menukar
// kalimatnya akan membuat aplikasi mengklaim bukti yang tidak pernah ada — ke
// penjual yang memakainya untuk memutuskan belanja.
//
// Yang menyelesaikannya bukan kalimat yang lebih hati-hati, melainkan kenyataan
// bahwa KEDUANYA memang berbasis pemenang, cuma dari studi berbeda:
//
//   template-terbukti.json  110 video pemenang, korelasi GMV (statistik)
//   templates.ts             12 video pemenang, dibedah shot demi shot
//
// Jadi tiap kartu membawa angkanya SENDIRI. Tidak ada yang dikarang, tidak ada
// yang dipinjam, dan yang memancing justru angkanya yang asli.
//
// ────────────────────────────────────────────────────────────────────────────
// KENAPA SEPULUH, DAN KENAPA DISARING KATEGORI
// ────────────────────────────────────────────────────────────────────────────
// Ke-28 template tidak sama relevannya. Untuk produk otomotif, template
// "Skincare Malam" bukan pilihan yang lebih buruk — ia pilihan yang salah, dan
// menampilkannya membuat penjual mengira aplikasinya tidak mengerti produknya.
// Sepuluh cukup untuk memberi keleluasaan tanpa berubah jadi katalog.

import { CAMPAIGN_TEMPLATES } from "./templates";
import terbukti from "./config/template-terbukti.json";

export interface TemplatePilihan {
  id: string;
  name: string;
  /** Satu kalimat: KAPAN dipakai. */
  when: string;
  /** Narasi buktinya, apa adanya. Ini yang tampil di badge kartu. */
  bukti: string;
  /** true = berasal dari template-terbukti.json (preset lama). */
  preset: boolean;
  format: string;
  durationSec: number;
  hookLevel: string;
  hookFamilies?: string[];
  bestFor: string[];
  /** Untuk pengurutan — makin besar makin kuat buktinya. */
  bobot: number;
}

/** Jumlah video pemenang yang dibedah shot-demi-shot; sumbernya catatan kepala
 *  lib/templates.ts ("Dari 12 video pemenang yang dibedah Brian"). */
export const PEMENANG_DIBEDAH = 12;

/** Hanya 9:16 dan <=30 detik: retail memposting ke FYP, dan 45 detik di sana
 *  hampir selalu kalah oleh yang lebih pendek. TVC landscape tidak ikut. */
function kampanyeUntukRetail() {
  return CAMPAIGN_TEMPLATES.filter((t) => (t.ratio ?? "9:16") === "9:16" && t.durationSec <= 30);
}

export function semuaTemplatePilihan(): TemplatePilihan[] {
  const dariPreset: TemplatePilihan[] = terbukti.templates.map((t) => ({
    id: t.id,
    name: t.name,
    when: t.desc,
    bukti: `${t.count} dari ${terbukti.total_winners} video pemenang`,
    preset: true,
    format: t.preset.format,
    durationSec: t.preset.durationSec,
    hookLevel: "normal",
    hookFamilies: t.preset.hookFamilies,
    bestFor: [],
    // Bobot dari jumlah pemenangnya sendiri. Preset lama memang berdiri di atas
    // sampel jauh lebih besar, jadi wajar ia tetap muncul lebih dulu.
    bobot: 1_000 + t.count,
  }));

  const dariKampanye: TemplatePilihan[] = kampanyeUntukRetail().map((t) => ({
    id: t.id,
    name: t.name,
    when: t.when,
    bukti: `Dibedah dari ${PEMENANG_DIBEDAH} video pemenang`,
    preset: false,
    format: t.format,
    durationSec: t.durationSec,
    hookLevel: t.hookLevel,
    hookFamilies: t.hookFamily ? [t.hookFamily] : undefined,
    bestFor: t.bestFor,
    bobot: 100,
  }));

  return [...dariPreset, ...dariKampanye];
}

/**
 * Sepuluh template paling pantas untuk sebuah kategori produk.
 *
 * Urutan: cocok-kategori dulu, lalu kekuatan bukti. Preset lama tidak punya
 * bestFor (ia memang lintas kategori) sehingga selalu dianggap cocok — itu
 * disengaja: ketiganya adalah pilihan aman untuk produk apa pun, termasuk
 * kategori yang belum punya template khusus sama sekali.
 */
export function templateTeratas(kategori: string, jumlah = 10): TemplatePilihan[] {
  const cocok = (t: TemplatePilihan) => t.bestFor.length === 0 || t.bestFor.includes(kategori);
  return [...semuaTemplatePilihan()]
    .sort((a, b) => {
      const ca = cocok(a) ? 1 : 0;
      const cb = cocok(b) ? 1 : 0;
      if (ca !== cb) return cb - ca;
      if (a.bobot !== b.bobot) return b.bobot - a.bobot;
      // Pengurutan HARUS total. Tanpa pemutus terakhir ini, dua template
      // berbobot sama bisa bertukar posisi antar-render tergantung mesin
      // penyortir — dan kartu yang berpindah sendiri terbaca sebagai bug.
      return a.id.localeCompare(b.id);
    })
    .slice(0, jumlah);
}
