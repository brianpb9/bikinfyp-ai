// Mesin skrip (FSD F-02): hasilkan 3 varian skrip 15 dtk dari 3 keluarga hook berbeda.
//
// Penulis naskahnya LLM (PATCH 5 STEP 1, hidup sejak 17 Agu 2026) dengan
// template sebagai CADANGAN. Pembagiannya: LLM menulis kalimat; aturan yang
// memutuskan. Keluarga hook, pembagian detik, delivery tags, promo, caption,
// dan validateScript("strict") tetap deterministik.
//
// Sejarah yang perlu diingat, karena komentar di sini pernah berbohong dua kali
// ke arah berlawanan. Versi lama menjanjikan "LLM opsional via LLM_API_KEY"
// padahal tidak ada satu pun panggilan jaringan — pembaca jadi salah menilai
// kenapa naskahnya datar (datar karena template pengisi, bukan karena LLM belum
// dinyalakan). Versi setelahnya menyatakan "SEPENUHNYA DETERMINISTIK" dan
// bertahan setelah LLM-nya benar-benar dipasang.
//
// Kalau jalurnya berubah lagi, ubah komentar ini di commit yang sama.

import {
  BOLD_HOOK_PRIORITY, CATEGORY_HOOK_PRIORITY, CATEGORY_NOUN, CATEGORY_PAIN, CATEGORY_PROOF,
  HOOK_BY_CODE, type HookCode, type HookLevel,
} from "../config/hooks";
import { COMPLIANCE_CHECKLIST } from "../config/compliance";
import { REGISTERS, type Register } from "./registers";
import { renderSegmentsForTier, formatHargaNatural, type SegmentDraft, type TemplateCtx } from "./templates";
import { templateCopy, TEMPLATE_COPY_CAPACITY } from "./template-copy";
import { isTvcTemplate, jendelaKata, templateRequiresPriceMention, validateScript, type ValidationResult } from "./validator";
import { buildCaption, buildHashtags, suggestedPostTime } from "./caption";
import { compileDeliveryText } from "./delivery-tags";
import { keSegmentDraft, laporJatuhKeTemplate, llmSengajaDimatikan, llmSiap, tulisNaskah } from "./llm";
import { bolehIdeaStage, petunjukNaskah, pilihIde, type IdeTerpilih } from "./ide";
import { resolvePromo, promoDeadlineSpokenPhrase, type ActivePromo } from "../promo";
import { getDb } from "../db";

export interface ProductInput {
  id: string;
  name: string;
  price_idr: number;
  category: string;
  /** URL sumber produk (dari link extract) — menentukan istilah keranjang di CTA. */
  sourceUrl?: string | null;
  /** Add-on Promo & Urgency (lib/promo.ts) — opsional semua. */
  promoPriceBeforeIdr?: number | null;
  promoEndsAt?: string | null;
  promoStockLeft?: number | null;
}

/** "Keranjang kuning" cuma istilah TikTok Shop — Shopee/Tokopedia/manual pakai
 * "keranjang" polos (keputusan Brian, 2026-08-03: platform lain jangan
 * dibilang "kuning", itu branding TikTok doang). */
export function cartLabelForUrl(sourceUrl: string | null | undefined): "keranjang kuning" | "keranjang" {
  if (!sourceUrl) return "keranjang";
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "keranjang kuning";
  } catch {
    /* URL tidak valid — default aman: istilah generik */
  }
  return "keranjang";
}

/** Ganti "keranjang kuning" -> "keranjang" di teks bila platform bukan TikTok.
 * Post-processing string, bukan template terpisah per platform — templates.ts
 * tetap satu set (banyak variasi hook_family), cuma istilah keranjangnya yang
 * disesuaikan sesudah dirender. */
function applyCartLabel<T extends string>(text: T, label: "keranjang kuning" | "keranjang"): T {
  return (label === "keranjang kuning" ? text : text.replace(/keranjang kuning/gi, "keranjang")) as T;
}

export interface GeneratedScript {
  hook_family: HookCode;
  emotion: string;
  register: Register;
  quality_tier: "silent_caption" | "high_quality" | "super_hq";
  segments: SegmentDraft[];
  caption: string;
  hashtags: string[];
  validation: ValidationResult;
  /**
   * Tiga ide terbaik BESERTA skornya, diisi HANYA saat FYP Gate gagal.
   *
   * Ada supaya kegagalan gate sampai ke pengguna, bukan berhenti di log server.
   * PATCH 4 §6: kalau tidak ada yang lulus, tampilkan tiga terbaik dan minta
   * pilih — jangan render diam-diam.
   */
  /**
   * Ide ini lolos lewat jalur TIPIS (semua dimensi lewat, total 72-74).
   *
   * Ditandai supaya UI bisa mengatakannya apa adanya. Lulus tipis berarti
   * "tidak ada cacat", bukan "ada yang kuat" — dan pengguna berhak tahu bedanya
   * sebelum membayar render.
   */
  ideBorderline?: boolean;
  /** Skor gate ide yang dipakai, untuk ditampilkan bersama naskahnya. */
  ideSkor?: number;
  ideKandidat?: {
    one_liner: string;
    mechanic: string;
    human_situation: string;
    total: number;
    perDimensi: Record<string, number>;
    sebabGagal: string[];
    alasan: string;
  }[];
}

const MAX_REGEN = 2; // FSD F-02.3: regenerate maksimal 2x
/**
 * Berapa kali naskah LLM boleh ditulis ulang dengan keluhan validator.
 *
 * DUA, bukan satu: percobaan kedua adalah perbaikan pertama yang benar-benar
 * tahu apa yang salah. Bukan lima, karena tiap percobaan satu panggilan
 * berbayar dan kegagalan yang bertahan setelah dua kali biasanya bukan soal
 * kalimat — melainkan permintaannya sendiri (mis. jendela kata mustahil untuk
 * nama produk sepanjang itu). Di situ template cadangan lebih cepat dan pasti.
 */
const MAKS_PERBAIKAN_LLM = 2;

const CATEGORY_SPACE: Record<string, string> = {
  beauty: "Meja skincare", fashion: "Isi lemari", muslim_fashion: "Isi lemari",
  home: "Dapur", kitchen: "Dapur", gadget: "Meja kerja", food: "Stok cemilan",
  kids: "Ruang main", default: "Rumah",
};
const CATEGORY_AKTIVITAS: Record<string, string> = {
  beauty: "skincare-an malem", fashion: "mix and match baju", muslim_fashion: "styling hijab",
  home: "beres-beres rumah", kitchen: "masak tiap hari", gadget: "ganti-ganti aksesori hp",
  food: "jajan online", kids: "belanja kebutuhan anak", default: "belanja online",
};
const CATEGORY_IDENTITAS: Record<string, string> = {
  beauty: "tim glowing", fashion: "anak ootd", muslim_fashion: "anak hijab",
  home: "tim rumah rapi", kitchen: "tim masak rumahan", gadget: "anak gadget",
  food: "anak jajan", kids: "bunda kekinian", default: "anak tiktok",
};

function pick(category: string, table: Record<string, string>): string {
  return table[category] ?? table.default;
}

/** Pilih 3 keluarga hook berbeda; keluarga yang dipakai produk sama <7 hari diturunkan (F-02.2 #3).
 * Level berani/gila memakai BOLD_HOOK_PRIORITY (lintas kategori), bukan prioritas kategori.
 * priorityOverride (Template Terbukti): daftar keluarga pilihan template menang —
 * dipakai sebagai prioritas utama, kekurangan diisi dari prioritas normal. */
/** Selang-seling dua daftar prioritas tanpa duplikat, urutan dipertahankan. */
function interleave(a: HookCode[], b: HookCode[]): HookCode[] {
  const out: HookCode[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] && !out.includes(a[i])) out.push(a[i]);
    if (b[i] && !out.includes(b[i])) out.push(b[i]);
  }
  return out;
}

export function pickHookFamilies(
  category: string,
  productId: string,
  level: HookLevel = "normal",
  priorityOverride?: HookCode[],
  // M8 (dashboard brand): satu produk bisa minta 2-6 variasi sekaligus.
  // Default 3 = perilaku retail lama persis, tidak berubah.
  count = 3,
  /** true = SEMUA varian memakai priorityOverride[0]. Lihat catatan di bawah. */
  lockFamily = false
): HookCode[] {
  const byCategory = CATEGORY_HOOK_PRIORITY[category] ?? CATEGORY_HOOK_PRIORITY.default;
  // Level 2 ("agak berani") menyelang-selingkan prioritas kategori dengan
  // yang agresif, jadi varian pertama tetap aman sementara varian berikutnya
  // mulai menantang. Tanpa pencampuran ini level 2 akan identik dengan
  // level 1 atau 3 — dan slider yang dua posisinya menghasilkan output sama
  // persis adalah kebohongan kecil yang cepat ketahuan user.
  const base =
    level === "normal" ? byCategory
    : level === "agak_berani" ? interleave(byCategory, BOLD_HOOK_PRIORITY)
    : BOLD_HOOK_PRIORITY;
  // KUNCI vs PRIORITAS — dua hal berbeda, dan membedakannya penting.
  //
  // Tanpa kunci, override cuma menaikkan satu keluarga ke urutan pertama lalu
  // sisa slot diisi dari daftar kategori. Untuk "Template Terbukti" itu memang
  // yang diinginkan: sarankan hook ini duluan, tapi tetap tawarkan variasi.
  //
  // Untuk template yang MENIRU satu konten tertentu, itu salah — dan Brian
  // menemukannya (2026-08-11): memilih satu template menghasilkan tiga skrip
  // dengan hook H12, H2, dan H1. Template itu ada untuk meniru konten yang
  // sudah terbukti; hook-nya sudah baku, jadi ketiga variannya harus memakai
  // keluarga yang sama dan hanya berbeda di susunan kalimatnya.
  if (lockFamily && priorityOverride?.length) {
    return Array.from({ length: count }, () => priorityOverride[0]);
  }
  const priority = priorityOverride?.length
    ? [...new Set([...priorityOverride, ...base])]
    : base;
  let recent: string[] = [];
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    recent = (
      getDb()
        .prepare("SELECT DISTINCT hook_family FROM scripts WHERE product_id = ? AND created_at > ?")
        .all(productId, since) as { hook_family: string }[]
    ).map((r) => r.hook_family);
  } catch {
    /* DB belum siap (tes unit murni) — abaikan deprioritasi */
  }
  const fresh = priority.filter((h) => !recent.includes(h));
  const ordered = [...fresh, ...priority.filter((h) => recent.includes(h))];
  const chosen: HookCode[] = [];
  for (const h of ordered) {
    if (chosen.length >= count) break;
    if (!chosen.includes(h)) chosen.push(h);
  }
  return chosen;
}

function buildCtx(product: ProductInput, register: Register): TemplateCtx {
  const cat = product.category;
  return {
    reg: REGISTERS[register],
    harga: formatHargaNatural(product.price_idr),
    produk: product.name,
    noun: pick(cat, CATEGORY_NOUN),
    pain: pick(cat, CATEGORY_PAIN),
    proof: pick(cat, CATEGORY_PROOF),
    space: pick(cat, CATEGORY_SPACE),
    aktivitas: pick(cat, CATEGORY_AKTIVITAS),
    identitas: pick(cat, CATEGORY_IDENTITAS),
  };
}

/** Suntik elemen promo ke segmen (add-on 2026-08-06). Tiga elemen, urut prioritas:
 * 1. harga coret — MENGGANTI frasa harga di demo ("cuma 85 ribu" -> "dari 120
 *    ribu jadi 85 ribu", +3 kata) supaya jatah kata L-05 tidak jebol,
 * 2. deadline — klausa relatif TANPA angka di CTA (L-14),
 * 3. stok — klausa tanpa angka di demo (angka stok hidup di caption/overlay).
 * Pemanggil mencoba kombinasi dari terlengkap ke kosong dan memakai yang lolos
 * validator (degradasi diam-diam, tidak pernah memblokir). */
function applyPromoToSegments(
  segments: SegmentDraft[],
  promo: ActivePromo,
  elements: { strike: boolean; deadline: boolean; stock: boolean }
): SegmentDraft[] {
  const harga = formatHargaNatural(promo.priceIdr);
  const before = formatHargaNatural(promo.beforeIdr);
  const deadlinePhrase = promo.endsAt ? promoDeadlineSpokenPhrase(promo.endsAt) : null;
  return segments.map((s) => {
    const transform = (source: string): string => {
      let text = source;
      if (elements.strike && s.role === "demo") {
        if (text.includes(`cuma ${harga}`)) text = text.replace(`cuma ${harga}`, `dari ${before} jadi ${harga}`);
        else if (text.includes(harga)) text = text.replace(harga, `dari ${before} jadi ${harga}`);
      }
      if (elements.stock && promo.stockLeft !== null && s.role === "demo") {
        text = `${text}, stoknya beneran tinggal dikit loh`;
      }
      if (elements.deadline && deadlinePhrase && s.role === "cta") {
        text = `${text}, ${deadlinePhrase}`;
      }
      return text;
    };
    return {
      ...s,
      text: transform(s.text),
      ...(s.tts_text ? { tts_text: transform(s.tts_text) } : {}),
    };
  });
}

async function generateOne(
  product: ProductInput,
  register: Register,
  emotion: string,
  family: HookCode,
  tier: "silent_caption" | "high_quality" | "super_hq",
  durationSec: number,
  beats?: { hookEnd: number; demoEnd: number },
  wordBudget?: number,
  templateId?: string | null,
  variantIndex = 0,
  contentType: "affiliate" | "ads" = "affiliate",
  format = "hands_only",
  /** Petunjuk ide terpilih (Idea Stage). Kosong = perilaku tanpa Gate 3. */
  petunjukIde?: string,
  /** true = lewati penulis LLM sepenuhnya, pakai template. */
  tanpaLlm = false
): Promise<GeneratedScript> {
  // Ambang Rp100.000 diturunkan dari data, bukan ditebak: tiga video pemenang
  // yang menyebut harga ada di Rp27-30 ribu, sedangkan yang produknya di atas
  // itu (serum, kursi kantoran) tidak menyebut harganya sama sekali. Di bawah
  // ambang, keluarannya SAMA PERSIS seperti sebelumnya.
  const hargaMahal = (product.price_idr ?? 0) > 100_000;
  const ctx = buildCtx(product, register);
  const cartLabel = cartLabelForUrl(product.sourceUrl);
  // Variasi kalimat khusus template, kalau templatenya sudah ditulis. Yang
  // BERUBAH cuma kata-katanya — keluarga hook, urutan beat, dan pembagian
  // detik tetap dari template, jadi kesetiaan yang diminta Brian 11 Agustus
  // ("template = tiru persis konten itu") tidak dilanggar.
  //
  // Kerangka waktunya diambil dari hasil renderSegmentsForTier, bukan dihitung
  // ulang: start/end tiap segmen sudah mengikuti beats template, dan menyusun
  // ulang di sini berarti dua rumus waktu yang bisa berbeda diam-diam.
  const dasar = renderSegmentsForTier(family, ctx, tier, durationSec, cartLabel, beats, wordBudget, hargaMahal);
  const variasi = templateCopy(templateId, variantIndex, ctx);
  const teksVariasi = variasi ? [variasi.hook, variasi.demo, variasi.cta] : null;
  // ---- JALUR PENULIS LLM ----
  //
  // Menggantikan kalimat template. Yang TIDAK diganti: delivery tags, promo,
  // validateScript("strict"), caption. LLM menulis; aturan yang memutuskan.
  //
  // Kegagalan apa pun jatuh ke template — produk tidak boleh mati karena satu
  // penyedia — TAPI jatuhnya BERISIK. Naskah template yang dikirim diam-diam
  // adalah persis cara kondisi "benar tapi datar" bertahan berbulan-bulan
  // tanpa ada yang menyadarinya.
  const promo = resolvePromo({
    priceIdr: product.price_idr,
    promoPriceBeforeIdr: product.promoPriceBeforeIdr,
    promoEndsAt: product.promoEndsAt,
    promoStockLeft: product.promoStockLeft,
  });
  const validate = (segs: SegmentDraft[]) =>
    validateScript(
      {
        hook_family: family, register, segments: segs, productName: product.name,
        priceIdr: product.price_idr, promoPriceBeforeIdr: promo?.beforeIdr ?? null,
        requirePriceMention: templateRequiresPriceMention(templateId),
        format: isTvcTemplate(templateId) ? "tvc" : undefined,
        qualityTier: tier, durationSec, wordBudget,
      },
      "strict"
    );

  /** Rakit kandidat lengkap (cart label + delivery tags + promo) lalu nilai. */
  const rakitDanNilai = (sumber: SegmentDraft[], dariLlm: boolean) => {
    const baseSegments = sumber.map((s, i) => {
      const authored = applyCartLabel(dariLlm ? s.text : (teksVariasi?.[i] ?? s.text), cartLabel);
      return { ...s, ...compileDeliveryText(authored) };
    });
    // Kombinasi promo dari terlengkap ke kosong — pakai yang pertama lolos.
    // Promo yang lolos LEBIH DIUTAMAKAN daripada naskah polos yang juga lolos,
    // karena elemen promo memang yang diminta pengguna.
    if (promo) {
      for (const combo of [
        { strike: true, deadline: true, stock: true },
        { strike: true, deadline: true, stock: false },
        { strike: true, deadline: false, stock: false },
      ]) {
        const candidate = applyPromoToSegments(baseSegments, promo, combo);
        const res = validate(candidate);
        if (res.passed) return { segments: candidate, validation: res };
      }
    }
    return { segments: baseSegments, validation: validate(baseSegments) };
  };

  const { minWc, maxWc } = jendelaKata({
    qualityTier: tier, durationSec, wordBudget, productName: product.name,
  });

  // ---- LINGKAR PERBAIKAN LLM ----
  //
  // Naskah yang tidak lolos validator TIDAK BOLEH dikirim diam-diam: gerbang
  // konfirmasi (render-cell.ts) dan rute approve menolaknya, jadi pengguna
  // berakhir dengan naskah yang mustahil disetujui dan tidak tahu kenapa.
  //
  // Jadi kegagalan dikembalikan ke penulisnya beserta keluhan validator yang
  // SEBENARNYA. Menyuruh "coba lagi" tanpa alasan cuma mengocok dadu — dan
  // itu persis yang dilakukan normalizeSegments, yang cuma merapikan spasi
  // dan tidak akan pernah bisa menambah jeda lisan atau membetulkan kata ganti.
  let hasil: { segments: SegmentDraft[]; validation: ReturnType<typeof validate> } | null = null;
  let keluhan: string[] = [];
  if (llmSiap() && !tanpaLlm) {
    for (let percobaan = 0; percobaan < MAKS_PERBAIKAN_LLM; percobaan++) {
      try {
        const segs = await tulisNaskah({
          productName: product.name, productCategory: product.category,
          priceIdr: product.price_idr ?? 0, durationSec, contentType, cartLabel,
          register, hookFamily: family, hookLevel: "normal", format,
          contoh: variasi ? `${variasi.hook} / ${variasi.demo} / ${variasi.cta}` : null,
          wordMin: minWc, wordMax: maxWc,
          keluhan: keluhan.length ? keluhan : undefined,
          ide: petunjukIde,
        });
        const kandidat = rakitDanNilai(keSegmentDraft(segs), true);
        if (kandidat.validation.passed) {
          // Baris POSITIF, sengaja. Sampai sekarang jalur LLM hanya menulis log
          // saat GAGAL, jadi keberhasilannya tidak bisa dibuktikan dari log —
          // dan "tidak ada JATUH KE TEMPLATE" bukan bukti kalau tidak ada
          // permintaan sama sekali. Ini yang membuat verifikasi produksi bisa
          // dijawab dengan bukti, bukan dengan ketiadaan bukti.
          console.log(
            `[script-engine] naskah LLM DIPAKAI untuk "${product.name}" ` +
              `(percobaan ${percobaan + 1}/${MAKS_PERBAIKAN_LLM}, tier ${tier}${petunjukIde ? ", dengan ide" : ""})`
          );
          hasil = kandidat;
          break;
        }
        keluhan = kandidat.validation.errors.map((e) => e.message_id);
        console.warn(
          `[script-engine] naskah LLM "${product.name}" ditolak validator ` +
            `(percobaan ${percobaan + 1}/${MAKS_PERBAIKAN_LLM}): ${keluhan.join(" | ")}`
        );
      } catch (err) {
        laporJatuhKeTemplate((err as Error).message, { productName: product.name });
        break;
      }
    }
    if (!hasil && keluhan.length) {
      laporJatuhKeTemplate(
        `naskah tidak lolos validator setelah ${MAKS_PERBAIKAN_LLM} percobaan: ${keluhan.join(" | ")}`,
        { productName: product.name }
      );
    }
  } else if (!llmSengajaDimatikan() && !tanpaLlm) {
    // Dimatikan sengaja (SCRIPT_LLM=0) TIDAK dilaporkan sebagai kabar buruk —
    // itu konfigurasi, bukan kegagalan. Kunci yang hilang tetap alarm.
    laporJatuhKeTemplate("ANTHROPIC_API_KEY belum di-set", { productName: product.name });
  }

  // Jalur template — cadangan, dan tetap memakai regenerate lamanya. Di sini
  // normalisasi memang masuk akal: templatenya deterministik, jadi kegagalan
  // yang tersisa memang soal perapian teks.
  if (!hasil) {
    hasil = rakitDanNilai(dasar, false);
    for (let attempt = 0; attempt < MAX_REGEN && !hasil.validation.passed; attempt++) {
      const rapi = normalizeSegments(hasil.segments);
      hasil = { segments: rapi, validation: validate(rapi) };
    }
  }
  const { segments, validation } = hasil;
  const reg = REGISTERS[register];
  return {
    hook_family: family,
    emotion,
    register,
    quality_tier: tier,
    segments,
    caption: applyCartLabel(buildCaption({ produk: product.name, proof: ctx.proof, reg, promo, hookFamily: family, kategori: product.category }), cartLabel),
    hashtags: buildHashtags(product.category),
    validation,
  };
}

/** Normalisasi ringan antar-attempt: rapikan spasi/tanda baca ganda. */
function normalizeSegments(segments: SegmentDraft[]): SegmentDraft[] {
  const normalize = (text: string) => text.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  return segments.map((s) => ({
    ...s,
    text: normalize(s.text),
    ...(s.tts_text ? { tts_text: normalize(s.tts_text) } : {}),
  }));
}

/** Generator utama: 3 varian, masing-masing beda keluarga hook. */
export async function generateScripts(opts: {
  product: ProductInput;
  register: Register;
  emotion?: string;
  qualityTier?: "silent_caption" | "high_quality" | "super_hq";
  durationSec?: number;
  hookLevel?: HookLevel;
  /** Template Terbukti: keluarga hook pilihan pola pemenang (prioritas utama). */
  hookFamilies?: HookCode[];
  /** M8: jumlah variasi skrip yang diminta (dashboard brand: 2-6). Default 3 = retail. */
  count?: number;
  /** true = semua varian memakai hookFamilies[0]. Dipakai template yang meniru
   * satu konten tertentu, di mana hook-nya memang sudah baku. */
  lockHookFamily?: boolean;
  /** Batas beat sebagai PECAHAN durasi, diambil dari shot list template.
   * Kosong = pembagian generik (hook 20%, demo sampai 67%). */
  beats?: { hookEnd: number; demoEnd: number };
  /** Total kata seluruh video, dari dokumen template. Hanya untuk template
   * tanpa VO — lihat catatan di lib/script-engine/templates.ts. */
  wordBudget?: number;
  /** Id template yang sedang ditiru. Dipakai mengambil VARIASI KALIMAT dari
   *  lib/script-engine/template-copy.ts.
   *
   *  Kenapa perlu: mengunci keluarga hook membuat semua varian keluar sama
   *  persis, karena mesin punya satu teks tetap per keluarga — layar "pilih
   *  skrip" jadi pilihan palsu. Brian memilih opsi (b) 2026-08-12: hook tetap
   *  dikunci template, tapi kalimatnya bervariasi. */
  templateId?: string | null;
  /** Mengubah aturan CTA dan overlay (lihat references/content-types.md). */
  contentType?: "affiliate" | "ads";
  /** Petunjuk strategi untuk penulis LLM. */
  format?: string;
  /** Job milik organisasi = jalur Enterprise; Idea Stage selalu ikut di sana. */
  orgId?: string | null;
  /** Paksa jalur template — dipakai jalur anonim yang tidak boleh keluar uang. */
  tanpaLlm?: boolean;
}): Promise<GeneratedScript[]> {
  const { product, register } = opts;
  const count = opts.count ?? 3;
  if (opts.templateId && count > TEMPLATE_COPY_CAPACITY) {
    throw new RangeError(
      `Template hanya mendukung maksimal ${TEMPLATE_COPY_CAPACITY} variasi unik; count=${count} ditolak agar naskah tidak berulang.`
    );
  }
  const emotion = opts.emotion ?? "senang";
  const tier = opts.qualityTier ?? "silent_caption";
  const durationSec = opts.durationSec ?? 15;
  const families = pickHookFamilies(
    product.category, product.id, opts.hookLevel ?? "normal",
    opts.hookFamilies, count, opts.lockHookFamily === true
  );
  // Berurutan, BUKAN Promise.all: tiap varian memanggil LLM, dan menembakkan
  // enam permintaan sekaligus ke satu akun akan menabrak rate limit persis
  // saat pengguna paling menunggu. Selisih waktunya kecil dibanding satu klip
  // video yang butuh dua sampai empat menit.
  //
  // IDEA STAGE — SEKALI per permintaan, bukan per varian.
  //
  // Modelnya kelas atas dan idenya adalah keputusan paling menentukan di
  // seluruh pipeline; menjalankannya tiga kali melipatgandakan biaya paling
  // mahal tanpa menambah apa pun. Peringkat kandidatnya justru berguna:
  // varian ke-i mendapat ide peringkat ke-i, jadi tiga varian benar-benar tiga
  // SUDUT berbeda — bukan satu ide yang ditulis ulang tiga kali, yang selama
  // ini membuat layar "pilih naskah" terasa seperti pilihan palsu.
  //
  // GAGAL = LANJUT TANPA IDE. Idea Stage adalah lapisan mutu, bukan syarat
  // hidup: kalau modelnya tidak tersedia, naskah tetap ditulis seperti hari
  // ini. Yang tidak boleh adalah gagal diam-diam, jadi sebabnya dicatat.
  let ide: IdeTerpilih | null = null;
  // BERGERBANG TIER. Idea Stage memakai model kelas atas dan sampai dua
  // panggilan pembuat ide per permintaan; high_quality tetap memakai penulis
  // LLM, yang tidak ia dapat cuma Gate 3. Enterprise selalu ikut.
  if (llmSiap() && !opts.tanpaLlm && bolehIdeaStage({ tier, orgId: opts.orgId })) {
    try {
      ide = await pilihIde({
        productName: product.name, productCategory: product.category,
        kategoriNoun: pick(product.category, CATEGORY_NOUN),
        priceIdr: product.price_idr ?? 0, durationSec,
        contentType: opts.contentType ?? "affiliate", register,
        format: opts.format, hookLevel: opts.hookLevel ?? "normal",
      });
      console.log(
        `[idea] "${product.name}": ${ide.peringkat.length} kandidat dinilai, terpilih ` +
          `${ide.ide.mechanic} (${ide.nilai.total}) — "${ide.ide.one_liner}"`
      );
      if (!ide.nilai.lulus) {
        // TIDAK ADA naskah yang ditulis dari ide yang gagal gate.
        //
        // Versi pertama tetap memakai ide terbaik "karena harus ada yang
        // dipakai". Hasilnya terbaca: naskah Scarlett 17 Agu ditulis dari ide
        // bernilai nativeness 3, dan memang terasa dirakit. Menulis naskah dari
        // ide yang kita sendiri nilai gagal berarti mengubah gerbang jadi
        // hiasan — ia melaporkan kegagalan lalu melanjutkan seolah tidak.
        //
        // Yang benar menurut PATCH 4 §6: tampilkan tiga ide terbaik beserta
        // skornya dan minta pengguna memilih. Jadi kandidatnya dibawa keluar
        // lewat ideKandidat, dan naskahnya ditulis TANPA ide — perilaku
        // sebelum Gate 3, yang jujur sebagai "belum ada sudut yang layak".
        console.warn(
          `[idea] "${product.name}": tidak ada ide yang lulus FYP Gate setelah ${ide.putaran} putaran ` +
            `(terbaik ${ide.nilai.total} — ${ide.nilai.sebabGagal.join(", ")}). ` +
            `Naskah ditulis TANPA ide; tiga kandidat teratas dikembalikan untuk dipilih pengguna.`
        );
      }
    } catch (err) {
      console.warn(`[idea] "${product.name}": Idea Stage dilewati — ${(err as Error).message}`);
    }
  }

  const hasil: GeneratedScript[] = [];
  for (let i = 0; i < families.length; i++) {
    // Varian ke-i memakai ide peringkat ke-i kalau ada; kalau kandidatnya lebih
    // sedikit dari variannya, sisanya memakai ide terbaik.
    // Ide dipakai HANYA kalau gate lulus. Kalau tidak, naskah ditulis tanpa
    // ide dan kandidatnya ditawarkan ke pengguna (lihat catatan di atas).
    const ideVarian = ide?.nilai.lulus ? (ide.peringkat[i] ?? ide.peringkat[0])?.ide ?? ide.ide : null;
    hasil.push(await generateOne(product, register, emotion, families[i], tier, durationSec,
      opts.beats, opts.wordBudget, opts.templateId, i, opts.contentType, opts.format,
      ideVarian ? petunjukNaskah(ideVarian) : undefined, opts.tanpaLlm === true));
  }
  // Gate gagal: tiga terbaik ikut keluar supaya UI bisa menampilkannya dan
  // meminta pengguna memilih — bukan disimpan diam-diam di log server.
  // Lulus (bersih maupun tipis): skornya ikut, dan yang tipis DITANDAI.
  if (ide?.nilai.lulus) {
    for (const v of hasil) {
      v.ideSkor = ide.nilai.total;
      if (ide.nilai.borderline) v.ideBorderline = true;
    }
    if (ide.nilai.borderline) {
      console.log(
        `[idea] "${product.name}": LULUS TIPIS ${ide.nilai.total} — semua dimensi lewat ambangnya, ` +
          `tapi tidak ada yang menonjol. Ditandai borderline supaya terlihat di layar.`
      );
    }
  }
  if (ide && !ide.nilai.lulus) {
    const tiga = ide.peringkat.slice(0, 3).map((p) => ({
      one_liner: p.ide.one_liner,
      mechanic: p.ide.mechanic,
      human_situation: p.ide.human_situation,
      total: p.nilai.total,
      perDimensi: p.nilai.perDimensi,
      sebabGagal: p.nilai.sebabGagal,
      alasan: p.nilai.alasan,
    }));
    for (const v of hasil) v.ideKandidat = tiga;
  }
  return hasil;
}

export function outputExtras(category: string) {
  return { suggested_post_time: suggestedPostTime(category), compliance_checklist: COMPLIANCE_CHECKLIST };
}

export { HOOK_BY_CODE };
export { TEMPLATE_COPY_CAPACITY } from "./template-copy";
