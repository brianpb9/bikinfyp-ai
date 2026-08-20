// KONTRAK HASH SIDECAR — sha256 harus atas bytes yang DISIMPAN.
//
// Cacat yang direproduksi: hash dihitung dari unggahan asli sementara storage
// menyimpan WebP hasil normalisasi. Selama normalisasi berhasil, sidecar
// membawa hash yang tidak pernah cocok dengan berkasnya — dan begitu
// verifikasi hash dinyalakan (P0-02 kasus C8), setiap foto SAH ditolak sebagai
// bukti korup. Gerbang yang menolak yang benar akan dimatikan orang.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-hash-${process.pid}.db`;
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hash-store-"));

const { saveProductImages, bacaMetaGambar } = await import("../lib/product-images");
const { mediaStorage } = await import("../lib/storage");

test("sha256 sidecar cocok dengan bytes yang benar-benar disimpan", async () => {
  // PNG kecil yang sah; normalizeProductImageBuffer akan mengubahnya ke WebP,
  // jadi bytes tersimpan BERBEDA dari unggahan — inilah kondisi cacatnya.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const rels = await saveProductImages("uji-hash", [{ mime: "image/png", data: png }]);
  assert.equal(rels.length, 1);

  const meta = await bacaMetaGambar(rels[0]);
  assert.ok(meta, "sidecar tidak ditulis");

  const tersimpan = await mediaStorage().get(rels[0]);
  assert.ok(tersimpan, "berkas tidak ada di storage");
  const shaTersimpan = crypto.createHash("sha256").update(tersimpan.body).digest("hex");

  assert.equal(
    meta.sha256, shaTersimpan,
    `sidecar membawa hash unggahan asli, bukan bytes tersimpan.\n` +
      `  sidecar : ${meta.sha256}\n  tersimpan: ${shaTersimpan}\n` +
      "Verifikasi hash akan menolak foto yang sah."
  );
});
