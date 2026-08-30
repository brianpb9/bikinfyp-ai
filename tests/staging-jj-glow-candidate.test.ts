import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { periksaAdmisi } from "../lib/script-engine/admisi";
import {
  assertJjGlowLockedProductState, authorizeJjGlowExactAdmission,
  JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256, JJ_GLOW_PRINCIPAL_ID,
  JJ_GLOW_PRODUCT_ID, JJ_GLOW_SCRIPT_ID, JJ_GLOW_STAGING_WEB_SERVICE_ID,
} from "../lib/staging-jj-glow-exact-admission";

const require = createRequire(import.meta.url);
const fixture = require("../scripts/staging-jj-glow-candidate.cjs") as {
  segments: Array<{ role:"hook"|"demo"|"story"|"cta";start:number;end:number;text:string;
    visual_direction:string;product_state?:"hidden"|"partial"|"hero" }>;
  admission: Record<string,unknown>;
  EXPECTED_PRODUCT_STATE: Record<string,unknown>;
  BPOM_EVIDENCE_PATH: string;
  BPOM_EVIDENCE_SHA256: string;
  assertExpectedProductState(product:Record<string,unknown>):void;
  validateBpomEvidence(bytes:Buffer|null,nowMs?:number):Record<string,unknown>;
};

function productRow(state = fixture.EXPECTED_PRODUCT_STATE):Record<string,unknown> {
  const { brand, staging_reference_rights, images, ...row } = structuredClone(state);
  return { ...row, images: JSON.stringify(images), raw_meta: JSON.stringify({ brand, staging_reference_rights }) };
}

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

test("candidate terikat ke digest seluruh state produk dan C5", () => {
  assert.doesNotThrow(() => fixture.assertExpectedProductState(productRow()));
  for (const field of Object.keys(fixture.EXPECTED_PRODUCT_STATE)) {
    const changed = structuredClone(fixture.EXPECTED_PRODUCT_STATE);
    if (field === "brand") changed[field] = "MEREK LAIN";
    else if (typeof changed[field] === "number") changed[field] = Number(changed[field]) + 1;
    else if (changed[field] === null && ["promo_price_before_idr", "promo_stock_left"].includes(field)) changed[field] = 1;
    else if (changed[field] === null) changed[field] = "MUTATED";
    else changed[field] = `${String(changed[field])}-MUTATED`;
    let rejected = false;
    try { fixture.assertExpectedProductState(productRow(changed)); } catch { rejected = true; }
    assert.equal(rejected, true, field);
  }
});

test("precondition exact-state dijalankan pada row admission terkunci", () => {
  const row = productRow();
  assert.doesNotThrow(() => assertJjGlowLockedProductState(row, JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256));
  for (const field of Object.keys(fixture.EXPECTED_PRODUCT_STATE)) {
    const changed = structuredClone(fixture.EXPECTED_PRODUCT_STATE);
    if (field === "brand") changed[field] = "MEREK LAIN";
    else if (typeof changed[field] === "number") changed[field] = Number(changed[field]) + 1;
    else if (changed[field] === null && ["promo_price_before_idr", "promo_stock_left"].includes(field)) changed[field] = 1;
    else if (changed[field] === null) changed[field] = "MUTATED";
    else changed[field] = `${String(changed[field])}-MUTATED`;
    let rejected = false;
    try { assertJjGlowLockedProductState(productRow(changed), JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256); }
    catch { rejected = true; }
    assert.equal(rejected, true, field);
  }
  const source = fs.readFileSync("lib/postgres/smoke-runtime.ts", "utf8");
  const lock = source.indexOf("FROM products WHERE id=$1 AND user_id=$2 FOR SHARE");
  const exact = source.indexOf("assertJjGlowLockedProductState", lock);
  const snapshot = source.indexOf("createJobProductSnapshotRaw", exact);
  const insert = source.indexOf("INSERT INTO jobs", snapshot);
  assert.ok(lock >= 0 && exact > lock && snapshot > exact && insert > snapshot,
    "exact-state harus diperiksa setelah row lock dan sebelum snapshot/job/hold");
});

test("precondition exact-state hanya tersedia untuk fixture dan web staging exact", () => {
  const intent = { expectedSha256: JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256, userId: JJ_GLOW_PRINCIPAL_ID,
    productId: JJ_GLOW_PRODUCT_ID, scriptId: JJ_GLOW_SCRIPT_ID };
  const runtime = { NODE_ENV: "production", RACUN_DEPLOY_ENV: "staging", RENDER_SERVICE_ID: JJ_GLOW_STAGING_WEB_SERVICE_ID } as NodeJS.ProcessEnv;
  assert.equal(authorizeJjGlowExactAdmission(intent, runtime), JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256);
  assert.equal(authorizeJjGlowExactAdmission({ ...intent, expectedSha256: undefined }, runtime), undefined);
  assert.throws(() => authorizeJjGlowExactAdmission(intent, { ...runtime, RACUN_DEPLOY_ENV: "production" }), /UNAUTHORIZED/);
  assert.throws(() => authorizeJjGlowExactAdmission({ ...intent, userId: "other" }, runtime), /UNAUTHORIZED/);
  assert.throws(() => authorizeJjGlowExactAdmission({ ...intent, expectedSha256: "0".repeat(64) }, runtime), /UNAUTHORIZED/);
});

test("runner memakai OTP acak singkat dan mengirim digest admission", () => {
  const source = fs.readFileSync("scripts/staging-jj-glow-candidate.cjs", "utf8");
  assert.match(source, /crypto\.randomInt\(0, 1_000_000\)/);
  assert.match(source, /otpNow\.getTime\(\) \+ 60_000/);
  assert.match(source, /DELETE FROM otp_codes WHERE id=\$1/);
  assert.match(source, /expected_product_state_sha256: EXPECTED_PRODUCT_STATE_SHA256/);
  assert.doesNotMatch(source, /const OTP\s*=|10 \* 60_000/);
});

test("claim BPOM membutuhkan evidence authoritative exact, belum stale", () => {
  const bytes = fs.readFileSync(fixture.BPOM_EVIDENCE_PATH);
  const evidence = fixture.validateBpomEvidence(bytes, Date.parse("2026-08-31T00:00:00.000Z"));
  assert.equal(evidence.evidence_id, "BPOM-KO-NA18260500350-20260831");
  assert.equal(fixture.BPOM_EVIDENCE_SHA256, "d1c70d7e4f198ca8f63d587ceeeccc18af6b87fe2f7f5fb90a7ebb0b7f711d37");
  assert.throws(() => fixture.validateBpomEvidence(null), /missing/);
  assert.throws(() => fixture.validateBpomEvidence(bytes, Date.parse("2026-09-03T00:00:00.000Z")), /stale/);
  const mismatched = Buffer.from(bytes);
  mismatched[mismatched.length - 2] ^= 1;
  assert.throws(() => fixture.validateBpomEvidence(mismatched), /digest mismatch/);
});
