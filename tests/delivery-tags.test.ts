import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compileDeliveryText, DELIVERY_EMPHASIS_TAGS, DELIVERY_TAGS, misplacedEmphasisTags, stripDeliveryTags, unknownDeliveryTags,
} from "../lib/script-engine/delivery-tags";
import { buildGeminiTtsPrompt } from "../lib/media/gemini-tts";
import { validateScript, type ScriptToValidate } from "../lib/script-engine/validator";

test("whitelist hanya berisi cue delivery Gemini yang dikunci", () => {
  assert.deepEqual(DELIVERY_TAGS, [
    "[short pause]", "[medium pause]", "[long pause]",
    "[giggles]", "[laughs]", "[slow]", "[fast]", "[whispers]", "[excited]", "[serious]",
  ]);
  assert.deepEqual(unknownDeliveryTags("[giggles] [slow] [whispers] [excited] [serious] [curious] [bored]"),
    ["[curious]", "[bored]"]);
  assert.deepEqual(DELIVERY_EMPHASIS_TAGS, ["[excited]", "[serious]"]);
  assert.equal(DELIVERY_TAGS.includes("[shouting]" as never), false);
  assert.deepEqual(misplacedEmphasisTags("[excited] Mulai tegas"), []);
  assert.deepEqual(misplacedEmphasisTags("Mulai [serious] tegas"), ["[serious]"]);
  assert.deepEqual(misplacedEmphasisTags("[excited] Mulai, lalu [excited] lagi"), ["[excited]"]);
});

test("authoring inline dikompilasi jadi text bersih + tts_text bertag", () => {
  const out = compileDeliveryText("Nah, [short pause] ini baru beda. [giggles] Serius.");
  assert.equal(out.text, "Nah, ini baru beda. Serius.");
  assert.equal(out.tts_text, "Nah, [short pause] ini baru beda. [giggles] Serius.");
  assert.equal(stripDeliveryTags(out.tts_text!), out.text);
});

test("prompt Gemini memisahkan style instruction dan transcript dengan jelas", () => {
  const out = buildGeminiTtsPrompt("Nah... [medium pause] ini dia.", "Ucapkan santai:");
  assert.match(out, /^# STYLE INSTRUCTION\nUcapkan santai\n/);
  assert.match(out, /# TRANSCRIPT\nNah\.\.\. \[medium pause\] ini dia\.$/);
  assert.ok(out.indexOf("# STYLE INSTRUCTION") < out.indexOf("# TRANSCRIPT"));
});

const base: ScriptToValidate = {
  hook_family: "H1", register: "bestie", productName: "Serum Glow", priceIdr: 85000,
  qualityTier: "high_quality" as const, durationSec: 15,
  segments: [
    { role: "hook", text: "Bestie, 85 ribu doang, kaget sih ya" },
    { role: "demo", text: "nah, ini Serum Glow, teksturnya enak banget kok" },
    { role: "cta", text: "Cek keranjang kuning ya deh" },
  ],
};

test("validator menerima tag whitelist di tts_text tanpa menghitungnya sebagai kata", () => {
  const tagged = structuredClone(base);
  tagged.segments[0] = {
    ...tagged.segments[0],
    tts_text: "Bestie, [short pause] 85 ribu doang, kaget sih ya",
  };
  const plain = validateScript(base, "strict");
  const result = validateScript(tagged, "strict");
  assert.equal(result.errors.some((e) => e.rule === "L-18"), false);
  assert.equal(result.errors.some((e) => e.rule === "L-05"), plain.errors.some((e) => e.rule === "L-05"));
});

test("validator menolak tag unknown, tag bocor ke text, dan transcript yang berbeda", () => {
  const unknown = structuredClone(base);
  unknown.segments[0] = { ...unknown.segments[0], tts_text: "[curious] Bestie, 85 ribu doang, kaget sih ya" };
  assert.ok(validateScript(unknown, "strict").errors.some((e) => e.rule === "L-18"));

  const leaked = structuredClone(base);
  leaked.segments[0].text = "[giggles] Bestie, 85 ribu doang, kaget sih ya";
  assert.ok(validateScript(leaked, "strict").errors.some((e) => e.rule === "L-18"));

  const mismatch = structuredClone(base);
  mismatch.segments[0] = { ...mismatch.segments[0], tts_text: "[short pause] Kata lain total" };
  assert.ok(validateScript(mismatch, "strict").errors.some((e) => e.rule === "L-18"));

  const misplaced = structuredClone(base);
  misplaced.segments[0] = { ...misplaced.segments[0], tts_text: "Bestie, [excited] 85 ribu doang, kaget sih ya" };
  assert.ok(validateScript(misplaced, "strict").errors.some((e) => e.rule === "L-18"));
});
