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
import { isNeutralStoryAdsTemplate } from "./ads-visual-contract";

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
  dialogue?: string;
  spoken_text?: string;
  speech?: string;
  voiceover?: string;
  narration?: string;
  transcript?: string;
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

const SPEECH_FIELDS = ["text", "tts_text", "dialogue", "spoken_text", "speech", "voiceover", "narration", "transcript"] as const;

function hookSignals(s: SegmenAds): boolean[] {
  return [
    s.block !== undefined && String(s.block).toUpperCase() === "HOOK",
    s.label !== undefined && String(s.label).toUpperCase() === "HOOK",
    s.role !== undefined && String(s.role).toLowerCase() === "hook",
  ];
}

/** Invariant struktural SA3 yang dipakai schema, mapper, validator, planner,
 * dan worker. Tidak mengurutkan atau menormalkan input secara diam-diam. */
export function temuanHookSenyapAds(segments: Array<Record<string, unknown>>): string[] {
  const findings: string[] = [];
  if (segments.length === 0) return ["SA3: tepat satu HOOK wajib ada sebagai segments[0]"];
  const candidates = segments.map((segment) => hookSignals(segment as unknown as SegmenAds).some(Boolean));
  const count = candidates.filter(Boolean).length;
  if (count !== 1) findings.push(`SA3: tepat satu HOOK wajib ada; ditemukan ${count}`);
  if (!candidates[0]) findings.push("SA3: HOOK wajib segments[0]; beat sebelum HOOK dilarang");
  for (const [field, expected] of [["block", "HOOK"], ["label", "HOOK"], ["role", "hook"]] as const) {
    if (!segments.some((segment) => segment[field] !== undefined)) continue;
    const matches = segments.map((segment) => String(segment[field] ?? "").toLowerCase() === expected.toLowerCase());
    if (matches.filter(Boolean).length !== 1 || !matches[0]) {
      findings.push(`SA3: penanda ${field} wajib unik dan menunjuk segments[0]`);
    }
  }

  const first = segments[0];
  for (const key of SPEECH_FIELDS) {
    const value = first?.[key];
    if (typeof value === "string" && value.trim()) findings.push(`SA3: segments[0].${key} wajib kosong`);
  }
  if (Number(first?.start) !== 0) findings.push("SA3: HOOK wajib mulai tepat pada detik 0");
  for (let index = 1; index < segments.length; index++) {
    if (Number(segments[index]?.start) <= 0) findings.push(`SA3: segmen ${index} tidak boleh mulai pada detik 0 atau sebelumnya`);
  }
  return [...new Set(findings)];
}

export interface StoryAdsIdentity {
  contentType?: "affiliate" | "ads" | null;
  templateId?: string | null;
}

/** Genre Story Ads hanya boleh datang dari snapshot admisi/template resmi.
 * Label bebas keluaran LLM bukan identitas genre. */
export function isStructuredStoryAds(identity: StoryAdsIdentity): boolean {
  return identity.contentType === "ads" || isNeutralStoryAdsTemplate(identity.templateId);
}

/** Struktur minimum/kanonik Story OS yang harus gagal sebelum provider. */
export function temuanStrukturStoryAds(segments: Array<Record<string, unknown>>): TemuanSA[] {
  const findings: TemuanSA[] = [];
  const labels = segments.map((segment) => String(segment.label ?? segment.block ?? segment.role ?? "").toUpperCase());
  const expected = ["HOOK", "FRICTION", "FRICTION", "SPIKE", "BUTTON"];
  if (segments.length !== expected.length) {
    findings.push({ gerbang: "SA4", pesan: `struktur Story Ads wajib tepat 5 beat; ditemukan ${segments.length}` });
  }
  const required: Array<[string, number, string]> = [
    ["FRICTION", 2, "SA4"], ["SPIKE", 1, "SA2"], ["BUTTON", 1, "SA1"],
  ];
  for (const [name, count, gate] of required) {
    const actual = labels.filter((value) => value === name).length;
    if (actual !== count) findings.push({ gerbang: gate, pesan: `${name} wajib ${count} beat; ditemukan ${actual}` });
  }
  if (labels.length === expected.length && labels.some((value, index) => value !== expected[index])) {
    findings.push({ gerbang: "SA4", pesan: `urutan beat wajib ${expected.join("→")}; ditemukan ${labels.join("→")}` });
  }
  return findings;
}

/** Offset VO final. Hanya Story Ads beridentitas otoritatif yang dikenai SA3;
 * Affiliate boleh memiliki label bebas HOOK dengan dialog pada detik nol. */
export function voiceoverStartSecForSegments(segments: SegmentDraft[], identity: StoryAdsIdentity): number {
  const records = segments as unknown as Array<Record<string, unknown>>;
  if (isStructuredStoryAds(identity)) {
    const findings = [
      ...temuanHookSenyapAds(records),
      ...temuanStrukturStoryAds(records).map((finding) => `${finding.gerbang}: ${finding.pesan}`),
    ];
    if (findings.length) throw new Error(`Kontrak Story Ads worker dilanggar: ${findings.join(", ")}`);
  }
  return segments.find((segment) => stripDeliveryTags(segment.tts_text ?? segment.text).trim())?.start ?? 0;
}

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
  const temuan: TemuanSA[] = [];
  const durasi = ctx.durationSec ?? (segs[segs.length - 1]?.end ?? 15);

  // ---- SA3 Hook senyap ---------------------------------------------------
  // Mutu konflik visualnya tetap wilayah juri, tetapi syarat kanonik yang
  // objektif tidak boleh dibiarkan sebagai harapan: beat HOOK tidak membawa
  // dialog, termasuk jalur TTS opsional.
  for (const pesan of temuanHookSenyapAds(segs as unknown as Array<Record<string, unknown>>)) {
    temuan.push({ gerbang: "SA3", pesan });
  }
  temuan.push(...temuanStrukturStoryAds(segs as unknown as Array<Record<string, unknown>>));

  // Temuan struktural lengkap sudah tersedia untuk payload pendek. Jangan
  // dereference BUTTON/SPIKE yang memang tidak ada.
  if (segs.length < 3) return temuan;

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
