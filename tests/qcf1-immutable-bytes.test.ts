import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

process.env.GEMINI_API_KEY = "test-only-key";
process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-qcf1-immutable-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-qcf1-immutable-storage-${process.pid}`;

const { qcF1FrameFidelity } = await import("../lib/media/qc-frame");

test("QC-F1 hashes, OCRs, and sends one immutable input snapshot", async (t) => {
  const framePath = `/tmp/qcf1-immutable-frame-${process.pid}.jpg`;
  const productPath = `/tmp/qcf1-immutable-product-${process.pid}.jpg`;
  const frameBefore = Buffer.from("frame-before-mutation");
  const productBefore = Buffer.from("product-before-mutation");
  fs.writeFileSync(framePath, frameBefore);
  fs.writeFileSync(productPath, productBefore);
  t.after(() => {
    fs.rmSync(framePath, { force: true });
    fs.rmSync(productPath, { force: true });
  });

  const originalFetch = globalThis.fetch;
  let submitted: unknown;
  globalThis.fetch = async (_url, init) => {
    submitted = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      bentuk_sama: true, tutup_sama: true, warna_sama: true, tata_letak_label_sama: true, catatan: "bound",
    }) }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const pending = qcF1FrameFidelity({
    framePath,
    productPhotoPath: productPath,
    productName: "Produk",
    productState: "partial",
  });
  // Mutasi sumber saat OCR asynchronous sedang berjalan. Provider dan digest
  // tetap wajib menggunakan snapshot sebelum mutasi.
  fs.writeFileSync(framePath, "frame-after-mutation");
  fs.writeFileSync(productPath, "product-after-mutation");
  const result = await pending;

  assert.equal(result.status, "PASS");
  assert.equal(result.evidence.frameSha256, crypto.createHash("sha256").update(frameBefore).digest("hex"));
  assert.equal(result.evidence.productPhotoSha256, crypto.createHash("sha256").update(productBefore).digest("hex"));
  const parts = (submitted as { contents: Array<{ parts: Array<{ inline_data?: { data: string } }> }> }).contents[0].parts;
  assert.equal(parts[1].inline_data?.data, frameBefore.toString("base64"));
  assert.equal(parts[2].inline_data?.data, productBefore.toString("base64"));
});
