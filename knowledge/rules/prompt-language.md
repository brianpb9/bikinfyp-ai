# Gate rules (fix before showing)

## Structure
- HOOK ×1 first, BODY 1–5, CTA ×1 last. Contiguous timecodes.
- Every segment: start_state · framing+angle · camera movement · sequenced action · product_state at end · expression. Two to four sentences.
- Mode consistency per segment (see modes.md).
- CTA: ≥4s, "one continuous take", product hero, label readable, held still for the final second.
- Time direction (Aturan 4.1): the model moves TOWARD the prompt; what you describe arrives at the END of the clip. State the starting condition explicitly ("already lit from the very first frame", "soap still in box, untouched") or the model will invent it.

## Dialogue
- Total words ≤ 1.5 × seconds (≈25–30 words for 18–20s). Per segment ≤ 10 words. Faster = rushed lipsync; rejected.
- Casual register by default (gue/lo or aku/kamu by category: beauty/fashion→"aku/kamu Say", gadget/food→"gue/lo", home/kids/muslim→"aku/kamu Bun", else "aku/kamu Kak"). Keep pronouns consistent across all segments.
- No double negatives in one sentence. No numbers as digits in spoken lines; prices as words.
- Overclaim: only visible-in-frame or clearly subjective. Banned in all types: medical claims, whitening, instant, "revolutionary", "terbaik", "wajib banget", competitor names.
- Hook does not name the product (except trend/after-routine formats).

## Kamus salah ucap (TTS/lipsync) — replace at writing time, re-generating never fixes it
| Written | Heard | Use instead | Why |
|---|---|---|---|
| lecet | leles | luka | mid-word /c/ collapses in closed syllable |
| tumit | tumut | kaki | closed syllable -mit, /i/→/u/ |
| busanya | busunya | lembut banget | vowel harmony pull |
| "-nya di" (detailnya di bawah) | "-nya ki bawah" | insert buffer: "detailnya **ada** di bawah" | /d/ eroded after -nya |
Prefer open-syllable words (ka-ki, lu-ka, su-ka, co-ba, pa-kai). Safe list: ini, aku, pakai, coba, suka, kaki, luka, tali, badan, gerak, enak, cukup, lembut, ringan, banget, masuk, bawah, detailnya, ada, ya, pagi, tebal, manis, kecil, tunggu, olahraga.
Do not ask TTS to speak "pelan" (triples duration); write "dengan tempo wajar" if a delivery note is needed. Use one identical delivery prefix for all lines.

## Visual
- One person in frame. NEGATIVE GLOBAL always includes: no crowd, no background people, no second person, no fake logos, no text overlay, no captions, no watermark, no cinematic colour grade, no studio gloss.
- Write positives, not negatives, inside segment descriptions ("no people appear" trips NSFW filters). Avoid hand-only close-ups as start/end frames for packshots (filter false positives) — use product-only frame + zoompan in post.
- Small text, numbers, prices, logos: post-production only if ever; never ask the model to render them.
- Categories with a publicly known "correct way" (holding a newborn, helmet, wudhu, knife work): write the technique explicitly in the segment ("one hand cupped behind the baby's head and neck…").
- Fashion: no lookbook walk-toward-camera; use real movement.
- Fabric: describe how it falls ("hangs limply, folds over on itself, drapes under its own weight"), never "folded/flat".
- Flat delivery fix: instead of "casually and warmly" write "bright excited energy, genuinely delighted, lively rising intonation" when the beat needs it.
- Off-camera VO: write "A woman's voice speaks OFF CAMERA as narration" or a face will appear.

## Production reminders (say once if relevant)
- Faces and products must come from reference photo files, not descriptions (max ~80% likeness otherwise). Two references per frame: cast+room, product.
- Consistency is won at the image stage: MASTER frame → derived frames ("Keep exactly the same … Change only this: …") → video → assemble.
- Final: −14 LUFS, hard cut at end (no fade), AI-content label on.
