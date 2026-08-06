// Unit test sistem caption (F-05c): split 3–5 kata, timing min 0,8 dtk, timeline segmen.

import { test } from "node:test";
import assert from "node:assert/strict";

const { buildCaptionCards, splitIntoCards } = await import("../lib/media/captions");
const { renderSegments } = await import("../lib/script-engine/templates");

const segments = [
  { role: "hook" as const, start: 0, end: 3, text: "Say masa 85 ribu dapet kualitas kayak gini sih", visual_direction: "x" },
  { role: "demo" as const, start: 3, end: 10, text: "nah jadi gini ini Serum Glow Bright teksturnya tuh niat banget padahal harganya cuma 85 ribu", visual_direction: "x" },
  { role: "cta" as const, start: 10, end: 15, text: "Aku taruh linknya di keranjang kuning ya tinggal CO aja deh", visual_direction: "x" },
];

test("splitIntoCards: grup 3–5 kata, tanpa card 1–2 kata di akhir", () => {
  for (const n of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20]) {
    const words = Array.from({ length: n }, (_, i) => `w${i}`);
    const cards = splitIntoCards(words);
    assert.equal(cards.flat().length, n);
    for (const c of cards) {
      assert.ok(c.length >= 3 && c.length <= 5, `n=${n}: card ${c.length} kata`);
    }
  }
});

test("buildCaptionCards: jumlah card masuk akal, timing min 0,8 dtk, urut naik", () => {
  const cards = buildCaptionCards({ segments, productName: "Serum Glow Bright" });
  assert.ok(cards.length >= 7, `cards: ${cards.length}`);
  let prevEnd = -1;
  for (const c of cards) {
    assert.ok(c.endSec - c.startSec >= 0.8, `card ${c.index}: ${c.endSec - c.startSec}s`);
    assert.ok(c.startSec >= prevEnd - 0.51, `card ${c.index} tumpang tindih`);
    prevEnd = c.endSec;
    const wc = c.text.split(/\s+/).length;
    // Hook = card statis besar (maks 12 kata, evidensi transisi teks — lihat captions.ts);
    // demo/cta tetap 3-5 kata.
    if (c.segmentRole === "hook") assert.ok(wc >= 3 && wc <= 12, `card hook ${c.index}: ${wc} kata`);
    else assert.ok(wc >= 3 && wc <= 5, `card ${c.index}: ${wc} kata`);
  }
  // Card pertama mulai di awal segmen hook
  assert.equal(cards[0].startSec, 0);
  // Card CTA berada di jendela segmen cta
  const ctaCards = cards.filter((c) => c.segmentRole === "cta");
  assert.ok(ctaCards[0].startSec >= 10);
});

test("hook statis: hook 15 dtk (<=12 kata) = TEPAT 1 card memenuhi jendela hook", () => {
  const cards = buildCaptionCards({ segments, productName: "Serum Glow Bright" });
  const hookCards = cards.filter((c) => c.segmentRole === "hook");
  assert.equal(hookCards.length, 1, `hook harus 1 card statis, dapat ${hookCards.length}`);
  assert.equal(hookCards[0].startSec, 0);
  assert.ok(hookCards[0].endSec >= 2.5, `card hook berakhir terlalu cepat: ${hookCards[0].endSec}`);
});

test("hook panjang (30 dtk + snapback): card hook dibagi rata, tidak balik ke 3-5 kata", () => {
  const words = Array.from({ length: 20 }, (_, i) => `w${i}`);
  const groups = splitIntoCards(words, 12);
  assert.equal(groups.length, 2);
  for (const g of groups) assert.ok(g.length >= 10 && g.length <= 12, `grup ${g.length} kata`);
});

test("highlight: harga & nama produk terdeteksi sebagai kata kunci", () => {
  const cards = buildCaptionCards({ segments, productName: "Serum Glow Bright" });
  const priceCard = cards.find((c) => c.text.includes("85"));
  assert.ok(priceCard, "tidak ada card berisi harga");
  assert.ok(priceCard!.highlightWords.includes("85"), JSON.stringify(priceCard!.highlightWords));
  const nameCard = cards.find((c) => c.text.includes("Serum"));
  assert.ok(nameCard!.highlightWords.includes("serum"));
});
