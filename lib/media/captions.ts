// Sistem caption "Senyap + Teks Tersinkron" (F-05c):
// tiap segmen skrip dipecah jadi card 3–5 kata; durasi per card = kata × faktor
// (rentang 0,35–0,45 dtk, min 0,8 dtk); timeline mulai dari awal segmennya.
// Kata kunci (harga, nama produk) di-highlight warna beda.

import type { SegmentDraft } from "../script-engine/templates";

export interface CaptionCard {
  index: number;
  /** Teks card apa adanya (3–5 kata). */
  text: string;
  /** Kata yang di-highlight (harga, nama produk). */
  highlightWords: string[];
  startSec: number;
  endSec: number;
  segmentRole: string;
}

const PRICE_REGEX = /\d+([.,]\d+)?\s?(ribu|rb|ribuan|juta|jt)\b/i;
const FACTOR_MIN = 0.35;
const FACTOR_MAX = 0.45;
const CARD_MIN_SEC = 0.8;
// Hook = teks STATIS (2026-08-06): koefisien MODEL FYP 1.0 ckpt9-n316 menempatkan
// hook_text_transitions (-0.17) & full_text_transitions (-0.20) di antara sinyal
// negatif terkuat — teks yang gonta-ganti di jendela hook berkorelasi kalah di
// data video jualan. Card hook dibuat sebesar mungkin (hook 15 dtk ≈ 1 card
// penuh; renderer PIL sudah word-wrap multi-baris). Demo/CTA tetap 3-5 kata.
const HOOK_MAX_WORDS_PER_CARD = 12;

function highlightWordsFor(text: string, productName: string): string[] {
  const out = new Set<string>();
  const priceMatch = text.match(PRICE_REGEX);
  if (priceMatch) for (const w of priceMatch[0].split(/\s+/)) out.add(w.toLowerCase());
  for (const w of productName.split(/\s+/)) {
    if (w.length >= 3 && text.toLowerCase().includes(w.toLowerCase())) out.add(w.toLowerCase());
  }
  return [...out];
}

/** Pecah kata jadi grup 3–5 (usahakan 4; sisa didistribusikan agar tidak ada card
 * 1–2 kata di akhir). maxPerCard > 5 (jalur hook statis) memakai pembagian rata
 * sejumlah-minimum-card, ukuran antar card beda maks 1 kata. */
export function splitIntoCards(words: string[], maxPerCard = 5): string[][] {
  if (words.length <= maxPerCard) return [words];
  if (maxPerCard > 5) {
    const k = Math.ceil(words.length / maxPerCard);
    const base = Math.ceil(words.length / k);
    const cards: string[][] = [];
    for (let i = 0; i < words.length; i += base) cards.push(words.slice(i, i + base));
    return cards;
  }
  const cards: string[][] = [];
  let i = 0;
  while (i < words.length) {
    const remaining = words.length - i;
    // Hindari sisa 1–2 kata di card terakhir: seret ke card sebelumnya bila masih <=5
    if (remaining <= 5) {
      cards.push(words.slice(i));
      break;
    }
    let take = 4;
    if (remaining - take === 1 || remaining - take === 2) take = remaining - 3; // sisa 3 di akhir
    cards.push(words.slice(i, i + take));
    i += take;
  }
  return cards;
}

/**
 * Bangun timeline card untuk mode silent_caption.
 * Faktor waktu per kata dihitung agar total TEPAT muat di jendela segmen
 * (dicekak maks 0,45; boleh di bawah 0,35 untuk teks padat, selama tiap card
 * tetap >= 0,8 dtk). Card tidak pernah melampaui akhir segmennya (kecuali
 * kasus ekstrem floor 0,8 — maks +0,5 dtk) supaya tidak ada 2 card tumpang tindih.
 */
export function buildCaptionCards(opts: {
  segments: SegmentDraft[];
  productName: string;
}): CaptionCard[] {
  const cards: CaptionCard[] = [];
  let index = 0;
  for (const seg of opts.segments) {
    const segStart = seg.start;
    const segWindow = seg.end - seg.start;
    const words = seg.text.split(/\s+/).filter(Boolean);
    const groups = splitIntoCards(words, seg.role === "hook" ? HOOK_MAX_WORDS_PER_CARD : 5);
    const totalWords = words.length;
    const minGroup = Math.min(...groups.map((g) => g.length));
    // Faktor pas dengan jendela segmen; floor agar card terpendek >= 0,8 dtk.
    let factor = Math.min(FACTOR_MAX, segWindow / Math.max(totalWords, 1));
    if (minGroup * factor < CARD_MIN_SEC) factor = CARD_MIN_SEC / minGroup;
    let t = segStart;
    groups.forEach((g, gi) => {
      const text = g.join(" ");
      let dur = Math.max(CARD_MIN_SEC, g.length * factor);
      // Tidak ada card yang melampaui akhir segmennya (anti tumpang tindih antar
      // segmen); toleransi +0,5 dtk hanya untuk card terakhir pada kasus floor ekstrem.
      const limit = gi === groups.length - 1 ? seg.end + 0.5 : seg.end;
      if (t + dur > limit) dur = Math.max(0.5, limit - t);
      // Sisakan 1 frame (0,05 dtk) antar card supaya tidak ada frame batas ganda.
      const end = t + Math.max(0.45, dur - 0.05);
      cards.push({
        index: index++,
        text,
        highlightWords: highlightWordsFor(text, opts.productName),
        startSec: Math.round(t * 100) / 100,
        endSec: Math.round(end * 100) / 100,
        segmentRole: seg.role,
      });
      t += dur;
    });
  }
  return cards;
}
