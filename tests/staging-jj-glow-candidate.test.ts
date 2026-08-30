import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { periksaAdmisi } from "../lib/script-engine/admisi";

const require = createRequire(import.meta.url);
const fixture = require("../scripts/staging-jj-glow-candidate.cjs") as {
  segments: Array<{ role:"hook"|"demo"|"story"|"cta";start:number;end:number;text:string;
    visual_direction:string;product_state?:"hidden"|"partial"|"hero" }>;
  admission: Record<string,unknown>;
};

test("naskah manual JJ GLOW melewati gerbang admisi tanpa klaim tak terverifikasi", () => {
  const result = periksaAdmisi({
    segments: fixture.segments,
    snapshot: fixture.admission,
    hookFamily: "H1",
    register: "bestie",
    productName: "JJ GLOW GLUTA PINK BRIGHTENING SOAP",
    productPriceIdr: 1,
    productSourceUrl: null,
    qualityTier: "high_quality",
    format: "hands_only",
  });
  assert.equal(result.passed, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
  const spoken = fixture.segments.map((segment) => segment.text).join(" ");
  assert.doesNotMatch(spoken, /mencerahkan|memutihkan|glowing|mengobati|menyembuhkan|10x/i);
  assert.match(spoken, /terdaftar BPOM/i);
});
