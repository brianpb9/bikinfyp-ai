// Jalur "tidak bisa diperiksa" harus UNVERIFIED, bukan lolos (reviewer A10).
//
// Berkas TERPISAH karena config membaca env saat impor pertama — mengosongkan
// GEMINI_API_KEY di tengah berkas lain tidak akan berpengaruh, dan tesnya akan
// lulus karena alasan yang salah.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.GEMINI_API_KEY = "";
process.env.RACUN_NO_DOTENV = "1"; // jangan biarkan .env.local mengisinya lagi
process.env.DB_PATH = `/tmp/racun-test-qcf1nk-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-qcf1nk-storage-${process.pid}`;

const { qcF1FrameFidelity, bolehJadiReferensi } = await import("../lib/media/qc-frame");

test("tanpa GEMINI_API_KEY: UNVERIFIED, dan TIDAK boleh jadi referensi", async () => {
  const hasil = await qcF1FrameFidelity({
    framePath: "storage/uploads/f4d0d645-ecd8-4842-be0e-17c14ea5826c/0.webp",
    productPhotoPath: "storage/uploads/f4d0d645-ecd8-4842-be0e-17c14ea5826c/0.webp",
    productName: "Scarlett Acne Serum",
    productState: "hero",
  });
  assert.equal(hasil.status, "UNVERIFIED");
  assert.equal(bolehJadiReferensi(hasil), false);
  assert.match(hasil.detail, /GEMINI_API_KEY/);
  assert.equal(hasil.biayaIdr, 0, "tidak ada yang dibayar saat tidak ada yang diperiksa");
});
