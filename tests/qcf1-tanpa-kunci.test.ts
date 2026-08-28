// Jalur "tidak bisa diperiksa" harus UNVERIFIED, bukan lolos (reviewer A10).
//
// Berkas TERPISAH karena config membaca env saat impor pertama — mengosongkan
// GEMINI_API_KEY di tengah berkas lain tidak akan berpengaruh, dan tesnya akan
// lulus karena alasan yang salah.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

process.env.GEMINI_API_KEY = "";
process.env.RACUN_NO_DOTENV = "1"; // jangan biarkan .env.local mengisinya lagi
process.env.DB_PATH = `/tmp/racun-test-qcf1nk-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-qcf1nk-storage-${process.pid}`;

const { qcF1FrameFidelity, bolehJadiReferensi } = await import("../lib/media/qc-frame");

test("tanpa GEMINI_API_KEY: UNVERIFIED, dan TIDAK boleh jadi referensi", async () => {
  const framePath = `/tmp/qcf1-frame-${process.pid}.png`;
  const productPhotoPath = `/tmp/qcf1-product-${process.pid}.png`;
  fs.writeFileSync(framePath, "frame-bytes");
  fs.writeFileSync(productPhotoPath, "product-bytes");
  const hasil = await qcF1FrameFidelity({
    framePath,
    productPhotoPath,
    productName: "Scarlett Acne Serum",
    productState: "hero",
  });
  assert.equal(hasil.status, "UNVERIFIED");
  assert.equal(bolehJadiReferensi(hasil), false);
  assert.match(hasil.detail, /GEMINI_API_KEY/);
  assert.equal(hasil.biayaIdr, 0, "tidak ada yang dibayar saat tidak ada yang diperiksa");
  assert.equal(hasil.evidence.frameSha256, crypto.createHash("sha256").update("frame-bytes").digest("hex"));
  assert.equal(hasil.evidence.productPhotoSha256, crypto.createHash("sha256").update("product-bytes").digest("hex"));
  fs.rmSync(framePath, { force: true });
  fs.rmSync(productPhotoPath, { force: true });
});
