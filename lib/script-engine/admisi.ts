/**
 * KONTEKS ADMISI KANONIK — satu tempat yang menyusun input validator untuk
 * setiap gerbang yang menentukan render dan uang.
 *
 * KENAPA ADA (reviewer 18 Agu, temuan P0).
 *
 * Tiga gerbang memvalidasi naskah yang sama dengan konteks yang berbeda-beda,
 * dan masing-masing melewatkan hal yang berbeda:
 *
 *   approve retail       tanpa durationSec, tanpa cartLabel
 *   submit job retail    tanpa durationSec, tanpa cartLabel
 *   confirm Enterprise   tanpa format, tanpa durationSec
 *
 * Akibatnya dua arah sekaligus, dan keduanya nyata:
 *
 *   MELOLOSKAN — naskah 30 detik berisi 18 kata lolos, karena tanpa
 *   durationSec validator memakai basis 15 detik. CTA TikTok yang cuma
 *   berkata "keranjang" lolos, karena tanpa cartLabel yang diperiksa hanya
 *   kata generiknya.
 *
 *   MENOLAK — TVC yang sah ditolak L-03/L-19, karena tanpa format aturan
 *   T-01..T-03 tidak pernah dijalankan dan aturan lisan afiliasi justru
 *   dipaksakan ke naskah yang memang bukan afiliasi.
 *
 * Selama tiap pemanggil menyusun konteksnya sendiri, perbedaan seperti ini
 * akan lahir lagi setiap kali ada gerbang baru. Jadi penyusunannya dipindah ke
 * sini, dan pemanggil hanya menyerahkan apa yang memang mereka punya.
 */
import { cartLabelForUrl } from "./cart-label";
import { isTvcTemplate, templateRequiresPriceMention, validateScript, type ValidationResult } from "./validator";
import { getTemplate } from "../templates";
import type { SegmentDraft } from "./templates";

/**
 * SNAPSHOT ADMISI — bentuk naskah seperti yang DITETAPKAN saat ditulis.
 *
 * Kenapa ada (reviewer ronde 4, temuan P0-2). Konteks admisi memang sudah
 * terpusat, tapi isinya masih disusun ulang dari request yang datang belakangan
 * — dan request itu tidak tahu naskahnya ditulis sebagai apa. Dua akibat yang
 * direproduksi, dan keduanya nyata:
 *
 *   HILANG — wordBudget tidak dibawa satu pun pemanggil produksi. Naskah T06
 *   sepanjang 23 kata (target katalognya 24) dinilai dengan jendela default
 *   dan ditolak "harus 62-96 kata".
 *
 *   SALAH GENRE — format dikirim terpisah dari template_id. Template afiliasi
 *   yang dikirim sebagai format:"tvc" melewati L-03; naskah yang sama sebagai
 *   hands_only ditolak. Genre naskah jadi ditentukan oleh isi request, bukan
 *   oleh naskahnya.
 *
 * Jadi bentuknya dibekukan di tempat naskahnya lahir dan ikut tersimpan.
 * Gerbang membaca snapshot; request tidak lagi boleh mengubah genre.
 *
 * Fakta PRODUK (nama, harga) sengaja TIDAK ikut dibekukan — kalau harganya
 * berubah setelah naskah ditulis, angkanya di naskah memang jadi salah dan
 * L-14 harus menangkapnya.
 */
export interface SnapshotAdmisi {
  contentType?: "affiliate" | "ads";
  format?: string | null;
  durationSec?: number | null;
  templateId?: string | null;
  wordBudget?: number | null;
  /** Disimpan untuk jejak. Yang DIPAKAI gerbang tetap label dari URL produk
   *  saat ini — kalau pengguna memindahkan produknya dari TikTok ke Shopee,
   *  naskah lama memang harus ditulis ulang. */
  cartLabel?: string | null;
  requirePriceMention?: boolean;
  /** Level hook & kategori — dipakai S-05 (STANDAR 10/10 baris 5). */
  hookLevel?: string | null;
  productCategory?: string | null;
  /** Mekanik ide terpilih — S-04 mengecualikan mekanik tekstur. */
  mechanic?: string | null;
  /**
   * Skor FYP Gate ide terpilih (audit E15, 19 Agu). Ikut snapshot supaya
   * SAMPAI ke worker: kolom job_prompts.ide_skor sudah disediakan migrasi 0032
   * tapi selalu NULL karena angkanya berhenti di memori proses web.
   */
  ideSkor?: number | null;
  /** Mekanik+format ide sebagai identitas ringkas, untuk job_prompts.ide_id. */
  ideId?: string | null;
  /**
   * Format IDE terpilih (knowledge/formats). Dibawa terpisah dari ideId karena
   * perencana shot memakainya sebagai instruksi kamera (slice 3) — mengurainya
   * kembali dari string gabungan berarti satu tempat lagi yang bisa salah.
   */
  ideaFormat?: string | null;
}

/**
 * JEJAK NASKAH yang menumpang di kolom validation_result: dari mana naskahnya
 * berasal, dan bentuk apa yang dipakai saat menilainya.
 *
 * Menumpang, bukan kolom sendiri, karena migrasi 0030-0032 masih tertahan di
 * produksi dan menambah migrasi keempat memperlebar risiko rilis yang sedang
 * ditutup. Kolomnya sudah bertipe JSON dan sudah ikut terbaca bersama
 * naskahnya, jadi jejaknya tidak hilang sambil menunggu.
 */
export interface JejakNaskah {
  /** Explicit human authorship; never a provider-failure fallback. */
  script_source?: "llm" | "template" | "degraded" | "manual";
  admisi?: SnapshotAdmisi;
}

function parse(validationResult: unknown): Record<string, unknown> | null {
  const obj = typeof validationResult === "string"
    ? (() => { try { return JSON.parse(validationResult); } catch { return null; } })()
    : validationResult;
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
}

/** Baca snapshot dari kolom validation_result (JSON string atau objek). */
export function bacaSnapshot(validationResult: unknown): SnapshotAdmisi | null {
  const snap = parse(validationResult)?.admisi;
  return snap && typeof snap === "object" ? (snap as SnapshotAdmisi) : null;
}

export function bacaJejak(validationResult: unknown): JejakNaskah {
  const obj = parse(validationResult);
  const jejak: JejakNaskah = {};
  const src = obj?.script_source;
  if (src === "llm" || src === "template" || src === "degraded" || src === "manual") jejak.script_source = src;
  const snap = obj?.admisi;
  if (snap && typeof snap === "object") jejak.admisi = snap as SnapshotAdmisi;
  return jejak;
}

/**
 * Amplop yang DISIMPAN di validation_result: vonis terbaru + jejak yang tidak
 * boleh hilang.
 *
 * Kenapa ada (reviewer ronde 3 & 4, "provenance FAIL"): rute approve menimpa
 * seluruh kolom dengan hasil validasi baru, jadi script_source lenyap persis
 * pada langkah yang menentukan naskah itu jadi dirender. Sekarang vonisnya
 * yang diganti, jejaknya yang dibawa.
 */
export function amplopValidasi(validation: ValidationResult, jejak: JejakNaskah): ValidationResult & JejakNaskah {
  return {
    ...validation,
    ...(jejak.script_source ? { script_source: jejak.script_source } : {}),
    ...(jejak.admisi ? { admisi: jejak.admisi } : {}),
  };
}

export interface SumberAdmisi {
  segments: SegmentDraft[];
  /** Bentuk naskah saat ditulis. Menang atas apa pun yang dikirim pemanggil. */
  snapshot?: SnapshotAdmisi | null;
  hookFamily: string;
  register: string;
  productName: string;
  productPriceIdr: number;
  /** URL sumber produk — MENENTUKAN label keranjang yang wajib disebut CTA. */
  productSourceUrl?: string | null;
  promoPriceBeforeIdr?: number | null;
  qualityTier?: string | null;
  /** Kosong = diturunkan dari segmen. Lihat durasiDariSegmen(). */
  durationSec?: number | null;
  format?: string | null;
  templateId?: string | null;
  wordBudget?: number | null;
  hookLevel?: string | null;
  productCategory?: string | null;
}

/**
 * Durasi dari SEGMEN, bukan dari tebakan 15 detik.
 *
 * Tabel scripts tidak menyimpan durasi, tapi segmennya menyimpan timecode —
 * dan `end` segmen terakhir memang durasinya. Ini yang membuat naskah 30 detik
 * berhenti dinilai dengan jendela kata 15 detik.
 */
export function durasiDariSegmen(segments: SegmentDraft[]): number {
  const akhir = Math.max(0, ...segments.map((s) => Number(s.end) || 0));
  // Dibulatkan ke durasi yang memang dijual; nilai aneh jatuh ke 15 seperti
  // perilaku lama, bukan ke angka karangan.
  for (const d of [15, 30, 45]) if (Math.abs(akhir - d) <= 2) return d;
  return akhir > 0 ? Math.round(akhir) : 15;
}

/** Susun input validator yang LENGKAP dari data yang tersedia. */
export function konteksAdmisi(sumber: SumberAdmisi) {
  const snap = sumber.snapshot ?? null;
  const durationSec = snap?.durationSec ?? sumber.durationSec ?? durasiDariSegmen(sumber.segments);
  const templateId = snap?.templateId ?? sumber.templateId;
  const wordBudget = snap?.wordBudget ?? sumber.wordBudget;
  // GENRE — urutan otoritasnya disengaja:
  //   1. katalog template (data kami, tidak bisa dikirim klien),
  //   2. snapshot naskah,
  //   3. baru kiriman pemanggil (baris lama yang belum punya snapshot).
  // Tanpa urutan ini, genre naskah ditentukan oleh isi request: reviewer
  // membuktikan template afiliasi bisa dinilai sebagai TVC — dan lolos L-03 —
  // hanya dengan menuliskan format:"tvc".
  const tpl = getTemplate(templateId ?? null);
  const genre: "tvc" | "ads" | "affiliate" = tpl
    ? tpl.kind
    : isTvcTemplate(templateId) || (snap?.format ?? sumber.format) === "tvc"
      ? "tvc"
      : (snap?.contentType ?? "affiliate") === "ads"
        ? "ads"
        : "affiliate";
  const contentType: "affiliate" | "ads" = genre === "ads" ? "ads" : "affiliate";
  // Kalau genre-nya BUKAN TVC, nilai "tvc" di field format dibuang: itu cara
  // request membelokkan genre lewat pintu belakang.
  const formatRekam = snap?.format ?? sumber.format ?? undefined;
  const format = genre === "tvc" ? "tvc" : formatRekam === "tvc" ? undefined : formatRekam;
  return {
    contentType,
    templateId: templateId ?? null,
    hook_family: sumber.hookFamily,
    register: sumber.register,
    segments: sumber.segments,
    productName: sumber.productName,
    priceIdr: sumber.productPriceIdr,
    promoPriceBeforeIdr: sumber.promoPriceBeforeIdr ?? null,
    qualityTier: (sumber.qualityTier ?? "silent_caption") as "silent_caption" | "high_quality" | "super_hq",
    durationSec,
    // Label keranjang mengikuti platform — "keranjang kuning" itu branding
    // TikTok, dan menyuruh pembeli Shopee mencarinya adalah menyuruhnya
    // mencari sesuatu yang tidak ada.
    //
    // Pemanggil yang TIDAK PUNYA url produk (UI, yang cuma memegang naskah)
    // memakai label dari snapshot. Bedanya disengaja: `null` berarti "produk
    // ini memang bukan TikTok", `undefined` berarti "saya tidak tahu" — dan
    // menebak "keranjang" untuk yang kedua membuat UI meloloskan naskah yang
    // ditolak server.
    cartLabel: sumber.productSourceUrl !== undefined
      ? cartLabelForUrl(sumber.productSourceUrl)
      : (snap?.cartLabel ?? "keranjang"),
    ...(format ? { format: format as "hands_only" | "vo_broll" | "talking_head" | "tvc" | "ads" } : {}),
    requirePriceMention: snap?.requirePriceMention ?? (templateRequiresPriceMention(templateId) && Number(sumber.productPriceIdr ?? 0) > 0),
    // STANDAR 10/10 baris 4 & 5 butuh tiga hal ini; tanpa mereka aturannya
    // diam-diam tidak pernah berjalan.
    hookLevel: snap?.hookLevel ?? sumber.hookLevel ?? null,
    productCategory: snap?.productCategory ?? sumber.productCategory ?? null,
    mechanic: snap?.mechanic ?? null,
    ...(wordBudget ? { wordBudget } : {}),
  };
}

/**
 * Gerbang admisi: dipanggil SEBELUM job dibuat dan sebelum kredit ditahan.
 *
 * Memakai mode "light" dengan sengaja — bukan karena lebih longgar, tapi
 * karena aturan yang menentukan SAH-tidaknya sudah keras di kedua mode
 * (SELALU_KERAS di validator). Yang tetap lunak hanyalah aturan gaya, dan
 * naskah yang sudah disunting pengguna memang tidak boleh diblokir karena
 * selera.
 */
export function periksaAdmisi(sumber: SumberAdmisi): ValidationResult {
  return validateScript(konteksAdmisi(sumber) as never, "light");
}
