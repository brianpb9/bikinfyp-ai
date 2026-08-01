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
  assert.ok(cards.length >= 8, `cards: ${cards.length}`);
  let prevEnd = -1;
  for (const c of cards) {
    assert.ok(c.endSec - c.startSec >= 0.8, `card ${c.index}: ${c.endSec - c.startSec}s`);
    assert.ok(c.startSec >= prevEnd - 0.51, `card ${c.index} tumpang tindih`);
    prevEnd = c.endSec;
    const wc = c.text.split(/\s+/).length;
    assert.ok(wc >= 3 && wc <= 5, `card ${c.index}: ${wc} kata`);
  }
  // Card pertama mulai di awal segmen hook
  assert.equal(cards[0].startSec, 0);
  // Card CTA berada di jendela segmen cta
  const ctaCards = cards.filter((c) => c.segmentRole === "cta");
  assert.ok(ctaCards[0].startSec >= 10);
});

test("highlight: harga & nama produk terdeteksi sebagai kata kunci", () => {
  const cards = buildCaptionCards({ segments, productName: "Serum Glow Bright" });
  const priceCard = cards.find((c) => c.text.includes("85"));
  assert.ok(priceCard, "tidak ada card berisi harga");
  assert.ok(priceCard!.highlightWords.includes("85"), JSON.stringify(priceCard!.highlightWords));
  const nameCard = cards.find((c) => c.text.includes("Serum"));
  assert.ok(nameCard!.highlightWords.includes("serum"));
});
