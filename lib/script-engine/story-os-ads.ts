// STORY OS UNTUK ADS — gerbang SA1–SA8.
//
// Sumber: knowledge/rules/STORY-OS-ADS-v1.md (kanonik, keputusan Brian 19 Agu).
// Berlaku HANYA untuk content_type "ads". Affiliate punya bentuknya sendiri
// (HOOK→BODY→CTA 15 detik) dan tidak boleh dinilai dengan gerbang ini.
//
// PEMBAGIAN PENEGAKAN — dan ini yang paling mudah dibohongi:
//   SA1, SA2, SA3 (bagian hook senyap), SA4, SA6, SA8 → "kode". Bisa dijawab dari STRUKTUR naskah
//     (label beat, field saksi, product_state, regex dialog). Gagal = ditolak.
//   SA5, SA7 serta kualitas visual SA3 → "juri". Menuntut penilaian: apakah
//     konflik terbaca, apakah tiap transisi benar-benar kausal, apakah satu emosi
//     dominan dijaga. Mesin bisa mencari kata "karena", tapi kata "karena"
//     bukan kausalitas — dan gerbang yang mengukur ejaan sambil mengaku
//     mengukur cerita jauh lebih berbahaya daripada tidak ada gerbang.
//
// Dokumen sendiri yang menetapkan pembagian itu (§3): "SA1/SA2/SA4/SA6/SA8
// dapat dicek mesin dari struktur; SA3/SA5/SA7 via juri FYP Gate — label
// jujur: 'kode' vs 'juri'".

import type { SegmentDraft } from "./templates";
import { stripDeliveryTags } from "./delivery-tags";

export type PenegakanSA = "kode" | "juri";

export interface GerbangSA {
  id: string;
  judul: string;
  penegakan: PenegakanSA;
  /** Kenapa ia tidak bisa dicek mesin — wajib diisi untuk yang "juri". */
  catatan?: string;
}

export const GERBANG_SA: GerbangSA[] = [
  { id: "SA1", judul: "Button-first: tanya tersisa + CTA di dalamnya", penegakan: "kode" },
  { id: "SA2", judul: "Spike di 65–80% durasi, di depan saksi", penegakan: "kode" },
  { id: "SA3", judul: "Hook senyap; konflik visual dinilai juri", penegakan: "kode" },
  { id: "SA4", judul: "Friction naik minimal dua kali, tiap tekanan menggeser", penegakan: "kode" },
  {
    id: "SA5", judul: "Kausalitas keras antar beat", penegakan: "juri",
    catatan: "mencari kata 'karena itu' mengukur ejaan, bukan sebab-akibat — naskah kausal tanpa kata itu akan ditolak dan naskah tidak kausal yang menempelkannya akan lolos",
  },
  { id: "SA6", judul: "Bridging produk minimal 2 dari 3", penegakan: "kode" },
  {
    id: "SA7", judul: "Satu emosi dominan, satu reversal", penegakan: "juri",
    catatan: "menuntut membaca keseluruhan busur; tidak ada field struktural yang menyimpannya",
  },
  { id: "SA8", judul: "Body bukan penjelasan hook/produk", penegakan: "kode" },
];

export function penegakanSA(id: string): PenegakanSA | null {
  return GERBANG_SA.find((g) => g.id === id)?.penegakan ?? null;
}

export interface TemuanSA {
  gerbang: string;
  pesan: string;
}

/** Segmen Story OS: SegmentDraft + field khas Ads yang ditulis penulis. */
type SegmenAds = SegmentDraft & {
  block?: string;
  label?: string;
  start_state?: string;
  action?: string;
  product_state?: "hidden" | "partial" | "hero";
  /** Siapa yang menyaksikan pelampiasan. Boleh "suara saja, off camera". */
  saksi?: string;
};

const PUNYA_TANYA = /\?|(\bnggak\b|\bgak\b|\bkan\b|\bya\b)\s*[?]?$/i;
const CTA_ADS = /detailnya\s+ada\s+di\s+bawah/i;
/** Kata yang menandai kehadiran saksi bila field `saksi` tidak diisi. */
const SAKSI_TEKS = /\b(petugas|ibu|bunda|pewawancara|penghulu|anak|suara|off camera|grup|teman|kasir|satpam|dokter|guru)\b/i;
/** Pembuka/penjelasan yang dilarang di body Ads (§2 Hukum, §5 Aturan bahasa). */
const PENJELASAN = /\b(aslinya|soalnya ini|karena produk ini|produk ini (bikin|bantu)|kandungannya|isinya|teksturnya|manfaatnya|khasiatnya)\b/i;
/** Kata manfaat yang tidak boleh diucapkan — penonton yang menyimpulkan. */
const KLAIM_MANFAAT = /\b(bikin (gigi|kulit|wajah) (lebih )?(bersih|putih|cerah)|memutihkan|mencerahkan|menghilangkan|ampuh|terbukti)\b/i;

const label = (s: SegmenAds) => String(s.label ?? s.block ?? s.role ?? "").toUpperCase();
const teks = (s: SegmenAds) => stripDeliveryTags(String(s.text ?? "")).trim();

/**
 * Periksa naskah Ads terhadap gerbang SA yang bisa dicek mesin.
 *
 * Mengembalikan temuan KOSONG untuk content_type selain "ads" — bukan karena
 * Affiliate bebas aturan, tapi karena aturannya lain dan sudah punya gerbangnya
 * sendiri (L-03, A-01/A-02, S-04/05/09).
 */
export function periksaStoryOsAds(
  script: { segments: SegmenAds[] },
  ctx: { contentType?: "affiliate" | "ads" | null; durationSec?: number | null }
): TemuanSA[] {
  if (ctx.contentType !== "ads") return [];
  const segs = script.segments ?? [];
  if (segs.length < 3) return [];
  const temuan: TemuanSA[] = [];
  const durasi = ctx.durationSec ?? (segs[segs.length - 1]?.end ?? 15);

  // ---- SA3 Hook senyap ---------------------------------------------------
  // Mutu konflik visualnya tetap wilayah juri, tetapi syarat kanonik yang
  // objektif tidak boleh dibiarkan sebagai harapan: beat HOOK tidak membawa
  // dialog, termasuk jalur TTS opsional.
  const hook = segs.find((s) => label(s).includes("HOOK")) ?? segs[0];
  const hookTts = stripDeliveryTags(String((hook as SegmenAds & { tts_text?: string }).tts_text ?? "")).trim();
  if (teks(hook) || hookTts) {
    temuan.push({ gerbang: "SA3", pesan: "HOOK Story Ads wajib senyap: text dan tts_text harus kosong" });
  }

  // ---- SA1 Button-first ---------------------------------------------------
  // Button = segmen terakhir. Ia wajib memuat CTA Ads DAN satu tanya kecil
  // yang tersisa; CTA telanjang tanpa tanya adalah penutup iklan biasa, dan
  // itu persis bentuk yang Story OS gantikan.
  const button = segs[segs.length - 1];
  const teksButton = teks(button);
  if (!CTA_ADS.test(teksButton)) {
    temuan.push({ gerbang: "SA1", pesan: 'button harus memuat CTA Ads "Detailnya ada di bawah ya" di dalam kalimat ceritanya' });
  } else {
    const tanpaCta = teksButton.replace(CTA_ADS, "").replace(/\bya\b\.?/gi, "").trim();
    const adaTanya = /\?/.test(tanpaCta) || (tanpaCta.length >= 8 && PUNYA_TANYA.test(tanpaCta));
    if (!adaTanya) {
      temuan.push({ gerbang: "SA1", pesan: "button tidak menyisakan satu tanya kecil — CTA berdiri sendiri, itu penutup iklan biasa" });
    }
  }

  // ---- SA2 Spike + saksi --------------------------------------------------
  const iSpike = segs.findIndex((s) => label(s).includes("SPIKE"));
  if (iSpike < 0) {
    temuan.push({ gerbang: "SA2", pesan: "tidak ada beat berlabel SPIKE — tanpa pelampiasan, iklan hanya menumpuk tekanan" });
  } else {
    const spike = segs[iSpike];
    const punyaSaksi = Boolean(spike.saksi?.trim()) ||
      SAKSI_TEKS.test(`${spike.start_state ?? ""} ${spike.action ?? ""} ${spike.visual_direction ?? ""}`);
    if (!punyaSaksi) {
      temuan.push({ gerbang: "SA2", pesan: "spike tanpa saksi — pelampiasan pribadi tidak terasa; sebut saksinya (boleh suara saja, off camera)" });
    }
    // Posisi 65–80% durasi. Diberi kelonggaran ke bawah untuk 10 detik, di
    // mana satu segmen saja sudah 40% durasi dan aritmetikanya mustahil pas.
    const mulai = Number(spike.start ?? 0);
    const rasio = durasi > 0 ? mulai / durasi : 0;
    const batasBawah = durasi <= 10 ? 0.4 : 0.5;
    if (rasio < batasBawah || rasio > 0.9) {
      temuan.push({
        gerbang: "SA2",
        pesan: `spike mulai di ${Math.round(rasio * 100)}% durasi — Story OS menaruhnya di 65–80% (toleransi ${Math.round(batasBawah * 100)}–90%)`,
      });
    }
  }

  // ---- SA4 Friction x2 ----------------------------------------------------
  const friction = segs.filter((s) => label(s).includes("FRICTION"));
  if (friction.length < 2) {
    temuan.push({ gerbang: "SA4", pesan: `friction cuma ${friction.length} beat — tekanan harus NAIK minimal dua kali sebelum spike` });
  } else {
    // Tiap tekanan wajib punya GESER: sesuatu berubah (posisi, keputusan,
    // benda berpindah). Shot tanpa geser = shot yang bisa dihapus.
    const tanpaGeser = friction.filter((s) => String(s.action ?? "").trim().length < 12);
    if (tanpaGeser.length) {
      temuan.push({ gerbang: "SA4", pesan: `${tanpaGeser.length} beat friction tanpa geser — tulis apa yang BERUBAH di action, bukan suasana` });
    }
  }

  // ---- SA6 Bridging >= 2 --------------------------------------------------
  // (a) aksi jujur dengan produk di friction; (b) produk hadir di frame
  // pertama tanpa dijelaskan; (c) pengakuan ringan di button sebelum CTA.
  const jembatan: string[] = [];
  const aksiProduk = friction.some((s) => /\b(sikat|tuang|oles|semprot|buka|ambil|masuk\w*|pegang|usap|pakai)\b/i.test(String(s.action ?? "")));
  if (aksiProduk) jembatan.push("a");
  const hookAwal = segs[0];
  if ((hookAwal.product_state ?? "hidden") !== "hidden") jembatan.push("b");
  const pengakuan = teksButton.replace(CTA_ADS, "").trim();
  if (/\b(tadi|barusan|udah|sempat|nggak aku hapus|aku kabarin)\b/i.test(pengakuan)) jembatan.push("c");
  if (jembatan.length < 2) {
    temuan.push({
      gerbang: "SA6",
      pesan: `bridging cuma ${jembatan.length} dari 3 (${jembatan.join(",") || "nol"}) — penonton tidak tahu kenapa produknya ini`,
    });
  }

  // ---- SA8 Body bukan penjelasan -----------------------------------------
  for (const s of segs.slice(1, -1)) {
    const t = teks(s);
    if (!t) continue;
    if (PENJELASAN.test(t)) {
      temuan.push({ gerbang: "SA8", pesan: `body menjelaskan, bukan bercerita: "${t.slice(0, 60)}"` });
      break;
    }
    if (KLAIM_MANFAAT.test(t)) {
      temuan.push({ gerbang: "SA8", pesan: `body mengucapkan manfaat: "${t.slice(0, 60)}" — penonton yang menyimpulkan, bukan kita` });
      break;
    }
  }

  return temuan;
}
