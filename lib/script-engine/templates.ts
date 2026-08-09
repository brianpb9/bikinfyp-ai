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
// Beat 5 & 6 (2026-08-04, v1.2): riset pola publik dari creator konten
// (@kallawaymarketing dkk, caption Instagram — bukan kutipan langsung,
// ditulis ulang jadi kalimat baru) — dua prinsip yang dipetakan:
//   - Modern Story Arc: video pendek butuh "peak, release, peak, release"
//     tiap 10-15 dtk, bukan 1 klimaks di tengah kayak arc cerita klasik.
//   - Dopamine Addiction Loop (Headfake + Rehook): banting kontras dari
//     ekspektasi penonton di tengah demo, lalu buka pertanyaan kecil baru.
// Beat 5 = headfake (kontras), beat 6 = rehook (buka-tutup pertanyaan mini).
const DEMO_CONTINUATION: ((c: TemplateCtx) => string)[] = [
  (c) => `pas dipake langsung kerasa bedanya, ${c.proof} beneran nyata bukan cuma di foto`,
  (c) => `apalagi kalau order sekarang biasanya ada bonus tambahan, jadi makin worth it sih`,
  (c) => `${cap(c.reg.you)} juga ngerasa gitu nggak sih, pas akhirnya nemu yang beneran works`,
  (c) => `kalau ternyata kurang cocok juga gampang kok, tinggal komplain aja ke seller`,
  (c) => `eh tapi bukan itu doang serunya, yang bikin beda malah ${c.proof} pas dipake langsung`,
  (c) => `terus ${c.reg.you} mungkin ngira ribet duluan, eh ternyata enggak sama sekali`,
];

function demoContinuation(c: TemplateCtx, family: HookCode, offset: number): string {
  const index = (parseInt(family.slice(1), 10) + offset) % DEMO_CONTINUATION.length;
  return DEMO_CONTINUATION[index](c);
}

// r19b (Brian 2026-08-09): filler pendek (4-6 kata) KHUSUS durasi dasar
// 15dtk, dipakai buat nambal celah sempit [25,30] tier bersuara (cuma +4
// s/d +10 kata dari basis COMPACT_T ~20-21 kata). DEMO_CONTINUATION di atas
// terlalu kasar (~13-16 kata/kalimat) buat celah sesempit ini — sekali
// nambah selalu MELUBER lewat maxWc (kasus nyata: 32 kata vs max 30).
const DEMO_MICRO_FILLER: string[] = [
  "beneran kerasa banget bedanya",
  "worth banget buat dicoba deh",
  "nggak nyesel sama sekali sih",
  "seriusan recommended banget buat harian",
  "apalagi harganya semurah itu loh",
  "kualitasnya juga oke banget kok",
];

function demoMicroFiller(family: HookCode, offset: number): string {
  const index = (parseInt(family.slice(1), 10) + offset) % DEMO_MICRO_FILLER.length;
  return DEMO_MICRO_FILLER[index];
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

// Hook snapback (Triple Hook Method step 3 — Context/Lean/Contrarian
// Snapback, riset pola publik 2026-08-04, ditulis ulang bukan kutipan
// langsung): dipakai HANYA saat durationSec > 15 — jendela hook di 30 dtk
// jadi 6 dtk (bukan 3 dtk), cukup ruang buat satu baris yang membanting arah
// dari ekspektasi awal hook, bukan sekadar mengulang. Generik lintas-keluarga
// (tanpa nama produk — aman untuk L-06 di semua family, exempt atau tidak).
const HOOK_SNAPBACK: ((c: TemplateCtx) => string)[] = [
  (c) => `eh tapi jangan salah sangka dulu, ternyata bukan yang biasa-biasa aja`,
  (c) => `padahal awalnya ${c.reg.me} pikir sama aja kayak yang lain, eh ternyata enggak`,
  (c) => `tapi pas dicoba sendiri, baru sadar dugaan ${c.reg.me} salah total`,
];

function hookSnapback(c: TemplateCtx, family: HookCode): string {
  const index = parseInt(family.slice(1), 10) % HOOK_SNAPBACK.length;
  return HOOK_SNAPBACK[index](c);
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
 * durationSec > 15 (v1.2, 2026-08-04): hook dapet baris snapback (Triple Hook
 * Method step 3), demo diperpanjang dengan kalimat lanjutan generik termasuk
 * beat headfake/rehook (lihat demoContinuation) — copy inti H1..H16 tidak diubah.
 */
function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

export function renderSegmentsForTier(
  family: HookCode,
  c: TemplateCtx,
  tier: "silent_caption" | "high_quality" | "super_hq",
  durationSec = 15,
  cartLabel: "keranjang kuning" | "keranjang" = "keranjang kuning"
): SegmentDraft[] {
  const triple = (tier === "silent_caption" ? T : COMPACT_T)[family](c);
  // r19c (Brian 2026-08-09, lanjutan investigasi sama): dulu "keranjang kuning"
  // -> "keranjang" (buat sumber non-TikTok) di-substitusi SESUDAH fungsi ini
  // return, di index.ts. Loop fill-kata di bawah jadi mikir sudah cukup
  // (>=minWc) padahal APLIKASI NYATA (pasca-substitusi -1 kata) jatuh balik
  // di bawah minWc — kasus nyata: 25 kata internal -> 24 kata final, gagal
  // L-05. Substitusi dipindah ke SINI (sebelum loop hitung kata) supaya loop
  // menghitung kata versi FINAL, bukan versi sementara.
  if (cartLabel !== "keranjang kuning") {
    triple.cta = triple.cta.replace(/keranjang kuning/gi, cartLabel);
  }
  const longer = durationSec > 15;
  if (longer) {
    // Snapback hook HANYA di silent_caption (teks overlay, dibaca bebas —
    // jatah kata longgar 32-48/15dtk). Tier bersuara (10-22/15dtk) diucapkan
    // sungguhan sesuai durasi shot BytePlus — nggak ada ruang buat baris
    // tambahan di hook tanpa bikin demo gagal ikut tumbuh (lihat wajib
    // offset<1 di bawah) atau kebentur maksimum L-05.
    if (tier === "silent_caption") {
      triple.hook = `${triple.hook}, ${hookSnapback(c, family)}`;
    }
    // Urgency lapis kedua di CTA duluan (sekali saja, sebelum loop demo di
    // bawah, biar ikut terhitung ke target kata) — lapis pertama ada di
    // demo lewat beat value-stack/show-don't-claim, bukan diulang di sini.
    triple.cta = `${triple.cta}, ${ctaUrgency(family)}`;
  }
  // Kalimat lanjutan ditambahkan SATU PER SATU sampai total kata menyentuh
  // titik tengah rentang L-05 untuk tier+durasi ini (bukan jumlah tetap) —
  // dasar kata dari silent_caption jauh lebih panjang dari tier bersuara,
  // jumlah kalimat lanjutan yang dibutuhkan beda jauh antar keduanya.
  // r13 (Brian 2026-08-07: "VO hanya sampai detik 20 padahal video 30 detik,
  // sisanya kosong") — [10,22] dikalibrasi utk audio embedded LAMA (~20
  // kata/15dtk = ~1,07 kata/dtk). Gemini TTS (suara resmi sejak r5) TERUKUR
  // ~1,93 kata/dtk pada skrip Wardah nyata (38 kata = 19,72 dtk) — jauh
  // lebih cepat, jadi target lama SELALU menyisakan durasi kosong di video
  // >15 dtk. Dinaikkan ke [20,34] (~1,8 kata/dtk) supaya narasi mendekati
  // durasi video sungguhan; belum kalibrasi sempurna (baru 1 titik data
  // nyata), pantau lapor-hasil berikutnya utk penyesuaian lanjutan.
  //
  // r19 (Brian 2026-08-09, "sound dan video tidak match, sound kecepatan"
  // — video 15dtk pakai skrip 22 kata, batas BAWAH lama = 20 kata/15dtk
  // cuma ngisi ~10,4dtk dari 15dtk = ~4,6dtk hening di ujung, kerasa kayak
  // suara "kabur" duluan sebelum video abis). [20,34] ternyata juga bisa
  // MELUBER di ujung atas (34 kata/15dtk = ~17,6dtk, video cuma 15dtk ->
  // audio kepotong tengah kalimat). Dipersempit ke [25,30] (~1,93 kata/dtk
  // asli) supaya batas bawah ngisi ~90% durasi video (minim hening) DAN
  // batas atas tidak pernah melebihi durasi video (minim terpotong).
  //
  // r19b (Brian 2026-08-09, lanjutan investigasi bug yang sama): loop ini
  // dulu HANYA jalan di dalam blok `durationSec > 15` di atas — artinya
  // kasus durasi DASAR 15dtk (paling umum, termasuk video dress yang
  // dilaporkan) TIDAK PERNAH dapat kalimat lanjutan sama sekali, walau
  // basis COMPACT_T tier bersuara cuma ~20-21 kata (di bawah minWc baru
  // 25). Sekarang loop jalan di SEMUA durasi; hanya perilaku "wajib minimal
  // 1 lanjutan" (forceAtLeastOne) yang tetap dikunci ke durasi >15dtk biar
  // silent_caption di 15dtk (yang templatenya sudah penuh/pas) tidak
  // dipaksa nambah baris yang tidak perlu dan berisiko kebentur maxWc.
  const [baseMinWc, baseMaxWc] = tier === "silent_caption" ? [32, 48] : [25, 30];
  const scale = durationSec / 15;
  const minWc = Math.round(baseMinWc * scale);
  const maxWc = Math.round(baseMaxWc * scale);
  const targetWc = Math.round(((baseMinWc + baseMaxWc) / 2) * scale);
  const forceAtLeastOne = longer;
  // Minimal 1 lanjutan demo WAJIB ditambah (durasi >15dtk saja) biar demo
  // beneran lebih panjang (bukan cuma jendela waktu yang molor diam-diam) —
  // tanpa syarat ini, hook snapback + cta urgency di atas bisa sendirian
  // menyentuh target di tier bersuara (jatah kata sempit) dan demo jadi
  // nggak nambah sama sekali. Di durasi dasar 15dtk, top-up cuma jalan
  // sampai minWc tercapai (tidak dipaksa jika basis sudah cukup).
  //
  // r19 (Brian 2026-08-09): loop lama cuma cek target SEBELUM nambah, jadi
  // 1x penambahan kalimat lanjutan (butiran kasar, bisa 10+ kata) bisa
  // MELUBER lewat maxWc dalam sekali lompatan (kasus nyata: 55 target/60
  // max jadi 63). Sekarang tiap penambahan DICOBA dulu — hanya di-commit
  // kalau tidak melebihi maxWc, KECUALI count saat ini masih di bawah
  // minWc (lebih baik sedikit meluber daripada kritis kurang/hening).
  let offset = 0;
  while (offset < 8) {
    const current = wordCount(`${triple.hook} ${triple.demo} ${triple.cta}`);
    const satisfied = forceAtLeastOne ? offset >= 1 && current >= targetWc : current >= minWc;
    if (satisfied) break;
    // r19d (Brian 2026-08-09, lanjutan investigasi sama): DEMO_CONTINUATION
    // (~10-16 kata/kalimat) cukup kasar buat celah SEMPIT di ujung target —
    // kasus nyata: celah tinggal 6 kata (49->55) tapi kalimat lanjutan yang
    // tersedia nambah 12 kata sekaligus jadi 61 (lewat max 60), sedangkan
    // guard "current>=minWc" belum aktif (current 49 masih di bawah minWc
    // 50) jadi commit tetap terjadi. Begitu celah ke target sudah sempit
    // (<=8 kata), pindah ke DEMO_MICRO_FILLER (4-6 kata) biar presisi,
    // kalimat besar cuma dipakai selagi celahnya masih lebar.
    const gapToTarget = (forceAtLeastOne ? targetWc : minWc) - current;
    const addition = longer && gapToTarget > 8 ? demoContinuation(c, family, offset) : demoMicroFiller(family, offset);
    const candidate = `${triple.demo}, ${addition}`;
    const candidateWc = wordCount(`${triple.hook} ${candidate} ${triple.cta}`);
    if (candidateWc > maxWc && current >= minWc) break; // sudah cukup, jangan meluber demi apa-apa
    triple.demo = candidate;
    offset++;
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
