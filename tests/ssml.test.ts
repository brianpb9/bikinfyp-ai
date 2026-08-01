// Unit test SSML builder (lib/providers/ssml.ts)

import { test } from "node:test";
import assert from "node:assert/strict";

const { buildSsml, buildSsmlBody, buildChirpText, escapeXml } = await import("../lib/providers/ssml");

test("escapeXml meng-escape karakter XML", () => {
  assert.equal(escapeXml(`a & b <c> "d" 'e'`), "a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;");
});

test("marker <jeda 800ms> -> <break time=\"800ms\"/>", () => {
  const out = buildSsmlBody("Aku capek. <jeda 800ms> Nah, lanjut.");
  assert.ok(out.includes('<break time="800ms"/>'), out);
});

test("koma setelah discourse marker -> jeda 300ms; koma biasa -> 150ms", () => {
  const out = buildSsmlBody("nah, ini bagus, banget");
  assert.ok(out.includes("nah" + '<break time="300ms"/>'), out);
  assert.ok(out.includes("bagus" + '<break time="150ms"/>'), out);
});

test("ellipsis -> 500ms, titik -> 350ms, seru -> 300ms", () => {
  assert.ok(buildSsmlBody("tunggu... ya").includes('<break time="500ms"/>'));
  assert.ok(buildSsmlBody("satu. dua").includes('<break time="350ms"/>'));
  assert.ok(buildSsmlBody("gas!").includes('!' + '<break time="300ms"/>'));
});

test("harga dibungkus emphasis strong", () => {
  const out = buildSsmlBody("harganya cuma 85 ribu, murah");
  assert.ok(out.includes('<emphasis level="strong">85 ribu</emphasis>'), out);
});

test("buildSsml membungkus voice + lang id-ID", () => {
  const out = buildSsml("halo", "id-ID-GadisNeural");
  assert.ok(out.startsWith('<speak version="1.0"'));
  assert.ok(out.includes('xml:lang="id-ID"'));
  assert.ok(out.includes('<voice name="id-ID-GadisNeural">'));
});

test("buildChirpText: marker jeda jadi tanda baca natural (Chirp3-HD tanpa SSML)", () => {
  const out = buildChirpText("Aku capek. <jeda 800ms> Nah, lanjut.");
  assert.ok(!out.includes("<jeda"), out);
  assert.ok(out.includes("..."), out);
  assert.ok(!/<[a-z]/i.test(out), out);
});
