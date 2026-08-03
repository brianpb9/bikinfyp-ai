// Template skrip deterministik per keluarga hook (FSD F-02.2).
// Setiap keluarga menghasilkan 3 segmen: hook (0-3 dtk), demo (3-10 dtk), cta (10-15 dtk).
// Aturan yang dijaga oleh template (diverifikasi validator):
// - harga eksplisit di hook atau demo (L-02), CTA menyebut "keranjang kuning" (L-03),
// - >=2 partikel + >=1 filler (L-01, L-04), total 32-48 kata (L-05),
// - produk tidak disebut di hook kecuali H4/H11 (L-06),
// - tanpa angka selain harga (L-14), tanpa overclaim/medis/formal/urgensi palsu (L-10..L-13).

import type { HookCode } from "../config/hooks";
import type { RegisterSpec } from "./registers";

export interface TemplateCtx {
  reg: RegisterSpec;
  harga: string; // frasa harga natural, mis. "85 ribu" / "1,5 juta"
  produk: string; // nama produk
  noun: string; // kata benda kategori, mis. "skincare"
  pain: string; // keluhan khas kategori, mis. "kusamnya"
  proof: string; // bukti konkret, mis. "teksturnya"
  space: string; // ruang/identitas transformasi, mis. "Dapur"
  aktivitas: string; // aktivitas audiens, mis. "skincare-an malem"
  identitas: string; // identitas audiens, mis. "tim glowing"
}

export interface SegmentDraft {
  role: "hook" | "demo" | "cta";
  start: number;
  end: number;
  text: string;
  visual_direction: string;
}

type Triple = { hook: string; demo: string; cta: string };

const VISUAL: Record<string, string> = {
  hook: "Close-up tangan memegang produk, kamera HP goyang natural, tatap produk",
  demo: "Tangan mendemokan produk: putar/buka/pakai perlahan, label produk menghadap kamera",
  cta: "Produk dipegang di samping keranjang belanja HP, tunjuk layar lalu kembali ke produk",
};

// Proporsi basis 15 dtk (hook 20% / demo 46.7% / cta 33.3%) — durasi lain
// skala linear dari basis ini, bukan rasio baru per durasi (2026-08-03,
// perluasan 30/45 dtk).
function seg(t: Triple, durationSec = 15): SegmentDraft[] {
  const hookEnd = Math.round((durationSec * 3) / 15);
  const demoEnd = Math.round((durationSec * 10) / 15);
  return [
    { role: "hook", start: 0, end: hookEnd, text: t.hook, visual_direction: VISUAL.hook },
    { role: "demo", start: hookEnd, end: demoEnd, text: t.demo, visual_direction: VISUAL.demo },
    { role: "cta", start: demoEnd, end: durationSec, text: t.cta, visual_direction: VISUAL.cta },
  ];
}

// Perluasan 30/45 dtk (2026-08-03, v1.1): konten INTI (hook) tetap dipakai
// apa adanya — demo diperpanjang, cta dapat tambahan urgency untuk video
// >15 dtk. Pola di bawah (bukan kalimat generik lagi) diambil dari riset
// pola struktural nyata (Script Example 1/2.pdf, Strategi Penjualan via
// Live Streaming TikTok.pdf — hak cipta sudah dicek, bukan buku pihak
// ketiga) — insight utamanya: struktur TETAP, sudut pandang yang MUTER,
// bukan kalimat yang diulang. Empat teknik di bawah adalah beat yang
// bisa dipakai gantian, bukan "isi kalimat kosong" seperti versi awal:
//   1. show-don't-claim — sensasi/aksi konkret, bukan kata sifat kosong
//   2. value-stack — nilai tambahan baru (bonus), bukan ulang harga/diskon
//   3. mid-engagement — pertanyaan ke penonton, beat jeda yang natural
//   4. implicit-objection — jawab keraguan yang belum diucapkan penonton
// Masih generik lintas-keluarga-hook (bukan ditulis khusus per keluarga,
// scope tetap terkelola) — dipilih deterministik via index keluarga hook.
const DEMO_CONTINUATION: ((c: TemplateCtx) => string)[] = [
  (c) => `pas dipake langsung kerasa bedanya, ${c.proof} nya beneran nyata bukan cuma di foto`,
  (c) => `apalagi kalau order sekarang biasanya ada bonus tambahan, jadi makin worth it sih`,
  (c) => `${cap(c.reg.you)} juga ngerasa gitu nggak sih, pas akhirnya nemu yang beneran works`,
  (c) => `kalau ternyata kurang cocok juga gampang kok, tinggal komplain aja ke seller`,
];

function demoContinuation(c: TemplateCtx, family: HookCode, offset: number): string {
  const index = (parseInt(family.slice(1), 10) + offset) % DEMO_CONTINUATION.length;
  return DEMO_CONTINUATION[index](c);
}

// CTA urgency (lapis kedua, video >15 dtk saja — hook/cta 15 dtk tidak
// disentuh): kosakata aman, dicek tidak menyentuh L-13 (FAKE_URGENCY_PHRASES)
// atau L-12 (FORMAL_PHRASES) di validator.ts.
const CTA_URGENCY: string[] = ["stoknya kelihatan menipis nih", "buruan ya, keburu diserbu yang lain"];

function ctaUrgency(family: HookCode): string {
  const index = parseInt(family.slice(1), 10) % CTA_URGENCY.length;
  return CTA_URGENCY[index];
}

// CTA bersama — semua menyebut "keranjang kuning" (L-03).
function ctaDefault(c: TemplateCtx): string {
  const { me } = c.reg;
  return `${cap(me)} taruh linknya di keranjang kuning ya, tinggal CO aja deh`;
}

const T: Record<HookCode, (c: TemplateCtx) => Triple> = {
  H1: (c) => ({
    hook: c.reg.genzStyle
      ? `Cuy, ${c.harga} doang dapet kualitas segini? sumpah gue kira tipu-tipu loh`
      : `${c.reg.sapaan}, masa ${c.harga} dapet kualitas kayak gini sih? aku ngecek ulang loh`,
    demo: `nah jadi gini, ini ${c.produk}. pas ${c.reg.me} pegang langsung kerasa sih bedanya, ${c.proof} tuh niat banget, padahal harganya cuma ${c.harga}`,
    cta: ctaDefault(c),
  }),
  H2: (c) => ({
    hook: `${c.reg.sapaan}, udah coba macem-macem ${c.noun} tapi ${c.pain} balik lagi terus nggak sih?`,
    demo: `nah, ${c.reg.me} juga gitu dulu. terus nemu ${c.produk}, sumpah beda sih. ${c.pain} nggak balik, harganya cuma ${c.harga}`,
    cta: `Yang relate, cek keranjang kuning ya, siapa tau cocok juga deh`,
  }),
  H3: (c) => ({
    hook: `Semenjak pake ini, ${c.pain} nggak pernah balik lagi sih, beneran`,
    demo: `nah jadi gini, ${c.reg.me} pake ${c.produk} tiap hari. ${c.proof} tuh enak, nggak mengecewakan, dan harganya cuma ${c.harga} doang`,
    cta: `Yang mau ngerasain juga, cek keranjang kuning ya, ${c.reg.me} taruh di situ deh`,
  }),
  H4: (c) => ({
    hook: `Jadi ini nih yang kemarin laku keras sampe sold out berkali-kali itu?`,
    demo: `nah wajar sih rame, soalnya ${c.produk} ini ${c.proof} beneran bagus, detailnya niat, dan harganya cuma ${c.harga}`,
    cta: `Yang penasaran sama yang rame itu, langsung cek keranjang kuning ya deh`,
  }),
  H5: (c) => ({
    hook: `Jangan beli ${c.noun} sembarangan ya, nonton ini dulu deh biar nggak nyesel`,
    demo: `nah jadi gini, kemaren ${c.reg.me} nemu ${c.produk}. ${cap(c.proof)} tuh beneran niat, harganya juga masuk akal, cuma ${c.harga}`,
    cta: `Yang mau aman pilihannya, cek keranjang kuning ya, ${c.reg.me} taruh linknya deh`,
  }),
  H6: (c) => ({
    hook: `Nggak banyak yang sadar, tapi ${c.noun} yang bagus itu sebenernya nggak harus mahal loh`,
    demo: `nah, contohnya ${c.produk} ini. ${cap(c.proof)} bagus, gampang dipake, dan harganya cuma ${c.harga} doang sih`,
    cta: `Yang baru tau, langsung cek keranjang kuning ya, biar nggak kudet deh`,
  }),
  H7: (c) => ({
    hook: `Cuma satu dari sepuluh orang yang tau trik milih ${c.noun} kayak gini loh`,
    demo: `nah jadi gini, kuncinya tuh di bahan dan harga. ${c.produk} ini dua-duanya masuk, dan cuma ${c.harga}`,
    cta: ctaDefault(c),
  }),
  H8: (c) => ({
    hook: `Buat kalian yang sering ${c.aktivitas}, wajib merapat sih, ini penting banget`,
    demo: `nah, ini ${c.produk} yang lagi ${c.reg.me} pake terus. ${cap(c.proof)} tuh niat, awet, dan harganya cuma ${c.harga} doang`,
    cta: `Yang ngerasa butuh, cek keranjang kuning ya, jangan ditunda-tunda deh`,
  }),
  H9: (c) => ({
    hook: `${cap(c.noun)} murah vs mahal tuh bedanya apa sih? ${c.reg.me} buktiin langsung ya`,
    demo: `nah jadi gini, ${c.produk} ini harganya cuma ${c.harga}, tapi ${c.proof} dan hasilnya nggak kalah sama yang mahal`,
    cta: `Yang tim hemat kayak ${c.reg.me}, cek keranjang kuning ya, lumayan banget deh`,
  }),
  H10: (c) => ({
    hook: `Kalau nggak kebagian jangan nyesel ya, yang kemarin aja cepet banget abisnya loh`,
    demo: `nah, ini ${c.produk} yang dicari-cari itu. ${cap(c.proof)} bagus, harganya cuma ${c.harga}, pantas sih rame`,
    cta: `Yang mau, langsung cek keranjang kuning ya, jangan nunggu abis deh`,
  }),
  H11: (c) => ({
    hook: `${c.space} ${c.reg.me} berubah total semenjak ada ini sih, sumpah beda banget`,
    demo: `nah, ini dia ${c.produk}. gampang dipake, ${c.proof} niat, dan harganya cuma ${c.harga} doang`,
    cta: `Yang mau berubah juga, cek keranjang kuning ya deh`,
  }),
  H12: (c) => ({
    hook: `Nggak perlu usaha ekstra lagi kalau udah punya ini, beneran ngefek sih`,
    demo: `nah jadi gini, ${c.produk} ini tinggal dipake aja, ${c.proof} bagus, dan harganya cuma ${c.harga}`,
    cta: `Yang tim anti ribet, langsung cek keranjang kuning ya, ${c.reg.me} taruh deh`,
  }),
  H13: (c) => ({
    hook: `Belum sah jadi ${c.identitas} kalau belum punya ini sih, sepakat nggak?`,
    demo: `nah jadi gini, ${c.produk} ini ${c.proof} bagus, awet dipake, dan harganya cuma ${c.harga} doang`,
    cta: `Yang mau sah juga, cek keranjang kuning ya, tinggal CO deh`,
  }),
  H14: (c) => ({
    hook: `Sini ${c.reg.me} spill ${c.noun} yang lagi ${c.reg.me} pake terus, catet ya`,
    demo: `nah jadi gini, namanya ${c.produk}. ${cap(c.proof)} tuh niat banget, enak dipake, dan harganya cuma ${c.harga}`,
    cta: c.reg.genzStyle
      ? `Cus cek keranjang kuning ya, jangan sampe nyesel deh`
      : `Yang penasaran, cek keranjang kuning ya, jangan sampe nyesel deh`,
  }),
  H15: (c) => ({
    hook: `Ada yang relate nggak sih, ${c.noun} bagus tuh biasanya mahal? nah ini enggak loh`,
    demo: `jadi gini, ini ${c.produk}. ${cap(c.proof)} bagus, gampang dipake, dan harganya cuma ${c.harga} doang`,
    cta: `Yang relate juga, cek keranjang kuning ya, biar kita kembaran deh`,
  }),
  H16: (c) => ({
    hook: c.reg.genzStyle
      ? `Penyesalan terbesar gue: baru tau barang ini sekarang, kemaren-kemaren ke mana aja sih`
      : `Penyesalan aku tuh cuma satu: baru tau barang ini sekarang, kemana aja sih`,
    demo: `nah, ini ${c.produk}. ${cap(c.proof)} bagus, harganya cuma ${c.harga}, dan gampang banget dipake`,
    cta: `Yang nggak mau nyesel kayak ${c.reg.me}, cek keranjang kuning ya deh`,
  }),
};

export function renderSegments(family: HookCode, c: TemplateCtx): SegmentDraft[] {
  return seg(T[family](c));
}

// Template KOMPAK untuk tier bersuara (audio embedded): total ~10–22 kata per 15 dtk
// (aturan bahasa hasil uji 31 Jul — ~20 kata/15 dtk). Tanpa tanda kurung instruksi (L-17);
// jeda dramatis diarahkan shot planner sebagai instruksi di luar tanda kutip dialog.
const COMPACT_T: Record<HookCode, (c: TemplateCtx) => Triple> = {
  H1: (c) => ({
    hook: `${c.reg.sapaan}, ${c.harga} dapet kualitas segini? sumpah sih`,
    demo: `nah, ini ${c.produk}, ${c.proof} niat banget`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H2: (c) => ({
    hook: `${c.reg.sapaan}, ${c.pain} balik lagi terus nggak sih?`,
    demo: `nah, nemu ${c.produk}, sumpah beda, cuma ${c.harga}`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H3: (c) => ({
    hook: `${c.pain} nggak balik semenjak pake ini sih`,
    demo: `nah, ${c.produk} ini ${c.proof} enak, cuma ${c.harga}`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H4: (c) => ({
    hook: `ini yang kemarin sold out terus itu?`,
    demo: `nah wajar, ${c.produk} ${c.proof} bagus, cuma ${c.harga}`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H5: (c) => ({
    hook: `jangan beli ${c.noun} sembarangan ya, nonton ini`,
    demo: `nah, ${c.produk} ${c.proof} niat, cuma ${c.harga}`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H6: (c) => ({
    hook: `${c.noun} bagus tuh nggak harus mahal loh`,
    demo: `nah, contohnya ${c.produk}, cuma ${c.harga}`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H7: (c) => ({
    hook: `satu dari sepuluh orang tau trik ini loh`,
    demo: `nah, ${c.produk} dua-duanya masuk, cuma ${c.harga}`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H8: (c) => ({
    hook: `yang sering ${c.aktivitas}, merapat sih`,
    demo: `nah, ${c.produk} ${c.proof} niat, cuma ${c.harga}`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H9: (c) => ({
    hook: `${c.noun} murah vs mahal, bedanya apa sih?`,
    demo: `nah, ${c.produk} cuma ${c.harga}, nggak kalah`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H10: (c) => ({
    hook: `nggak kebagian jangan nyesel ya, cepet abisnya`,
    demo: `nah, ${c.produk} yang dicari itu, cuma ${c.harga}`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H11: (c) => ({
    hook: `${c.space} berubah total semenjak ada ini sih`,
    demo: `nah, ${c.produk} gampang dipake, cuma ${c.harga}`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H12: (c) => ({
    hook: `nggak perlu ribet lagi kalau punya ini sih`,
    demo: `nah, ${c.produk} tinggal dipake, cuma ${c.harga}`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H13: (c) => ({
    hook: `belum sah jadi ${c.identitas} kalau belum punya ini`,
    demo: `nah, ${c.produk} awet, cuma ${c.harga}`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H14: (c) => ({
    hook: `sini ${c.reg.me} spill ${c.noun} andalan, catet ya`,
    demo: `nah, ${c.produk} ${c.proof} niat, cuma ${c.harga}`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H15: (c) => ({
    hook: `${c.noun} bagus biasanya mahal? ini enggak loh`,
    demo: `nah, ${c.produk} cuma ${c.harga} doang`,
    cta: `Cek keranjang kuning ya deh`,
  }),
  H16: (c) => ({
    hook: `penyesalan ${c.reg.me}: baru tau ini sekarang sih`,
    demo: `nah, ${c.produk} bagus, cuma ${c.harga}`,
    cta: `Cek keranjang kuning ya deh`,
  }),
};

/** Render segmen sesuai tier: silent_caption = template penuh; tier bersuara = kompak.
 * durationSec > 15 (v1, 2026-08-03): demo diperpanjang dengan kalimat lanjutan
 * generik (lihat demoContinuation) — hook/cta inti tidak diubah.
 */
function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

export function renderSegmentsForTier(
  family: HookCode,
  c: TemplateCtx,
  tier: "silent_caption" | "high_quality" | "super_hq",
  durationSec = 15
): SegmentDraft[] {
  const triple = (tier === "silent_caption" ? T : COMPACT_T)[family](c);
  if (durationSec > 15) {
    // Urgency lapis kedua di CTA duluan (sekali saja, sebelum loop demo di
    // bawah, biar ikut terhitung ke target kata) — lapis pertama ada di
    // demo lewat beat value-stack/show-don't-claim, bukan diulang di sini.
    triple.cta = `${triple.cta}, ${ctaUrgency(family)}`;
    // Kalimat lanjutan ditambahkan SATU PER SATU sampai total kata menyentuh
    // titik tengah rentang L-05 untuk tier+durasi ini (bukan jumlah tetap) —
    // dasar kata dari silent_caption jauh lebih panjang dari tier bersuara,
    // jumlah kalimat lanjutan yang dibutuhkan beda jauh antar keduanya.
    const [baseMinWc, baseMaxWc] = tier === "silent_caption" ? [32, 48] : [10, 22];
    const scale = durationSec / 15;
    const targetWc = Math.round(((baseMinWc + baseMaxWc) / 2) * scale);
    let offset = 0;
    while (wordCount(`${triple.hook} ${triple.demo} ${triple.cta}`) < targetWc && offset < 8) {
      triple.demo = `${triple.demo}, ${demoContinuation(c, family, offset)}`;
      offset++;
    }
  }
  return seg(triple, durationSec);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Format harga natural untuk skrip lisan: 85000 -> "85 ribu", 1500000 -> "1,5 juta". */
export function formatHargaNatural(priceIdr: number): string {
  if (priceIdr >= 1_000_000) {
    const jt = priceIdr / 1_000_000;
    const str = Number.isInteger(jt) ? String(jt) : jt.toFixed(1).replace(".", ",");
    return `${str} juta`;
  }
  if (priceIdr >= 1000) return `${Math.round(priceIdr / 1000)} ribu`;
  return `${priceIdr} perak`;
}

/** Format harga rupiah untuk overlay teks: 85000 -> "Rp85.000". */
export function formatHargaOverlay(priceIdr: number): string {
  return "Rp" + priceIdr.toLocaleString("id-ID");
}
