// Audit C9 (19 Agu 2026): merek tepercaya harus PUNYA SUMBER di intake.
// Reproduksi: sebelum perbaikan, POST/PATCH produk MEMBUANG field brand —
// products.raw_meta.brand tidak pernah tertulis, gerbang QC-F1 selamanya
// UNVERIFIED. Tes ini gagal pada kode lama dan mengunci perbaikannya.
//
// Catatan kepemilikan: kolom products.brand (migrasi 0033) milik sesi lain —
// jalur di sini SENGAJA memakai raw_meta.brand, alamat fallback yang sudah
// dibaca merekTepercaya() di lib/postgres/worker.ts.

import { after, test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-brand-intake-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-brand-intake-storage-${process.pid}`;
process.env.RACUN_WORKER_DISABLED = "1";

const { getDb, now, uuid } = await import("../lib/db");
const { findOrCreateUserByPhone, issueToken, cookieName } = await import("../lib/auth");
const { POST: createProduct } = await import("../app/api/products/route");
const { PATCH: patchProduct } = await import("../app/api/products/[id]/route");
const { usulMerekDariNama } = await import("../lib/media/qc");
const { setPeriksaLabelFotoForTests } = await import("../lib/media/label-terbaca");
const { setProductImageClassifierForTests } = await import("../lib/product-images");

// Test ini mengunci persistence brand, bukan kualitas OCR/classifier. Sejak E1
// menegakkan kedua gate, kontrol positif harus menyatakan bukti sah eksplisit.
setPeriksaLabelFotoForTests(async (_fotoPath, _productName, brand) => ({
  terbaca: true,
  kata: ["Glowbening", "Serum"],
  cocokNama: true,
  cocokMerek: brand ? true : null,
}));
setProductImageClassifierForTests(async () => ({
  jenis: "product_photo",
  layakReferensi: true,
  rasioAreaTeks: 0.001,
  jumlahKata: 2,
  alasan: "fixture brand intake adalah packshot sah",
}));
after(() => {
  setPeriksaLabelFotoForTests(undefined);
  setProductImageClassifierForTests(undefined);
});

const user = findOrCreateUserByPhone("085555000333");
const token = await issueToken(user.id, user.phone ?? "");
const authHeaders = { cookie: `${cookieName()}=${token}` };

// PNG 1x1 valid (sniff + decode lolos) untuk syarat minimal 1 foto.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function jsonReq(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify(body),
  });
}

test("POST /api/products menulis brand terkonfirmasi ke raw_meta.brand", async () => {
  const res = await createProduct(
    jsonReq("http://localhost/api/products", "POST", {
      name: "Serum Glow Bening 30ml",
      price_idr: 89000,
      category: "beauty",
      product_type: "serum wajah",
      confirmed_product_type: "serum wajah",
      brand: "  Glowbening  ",
      images_base64: [`data:image/png;base64,${PNG_1X1}`],
    })
  );
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  const { product_id } = (await res.json()) as { product_id: string };
  const row = getDb().prepare("SELECT raw_meta FROM products WHERE id = ?").get(product_id) as { raw_meta: string | null };
  const meta = JSON.parse(row.raw_meta ?? "{}") as { brand?: string };
  assert.equal(meta.brand, "Glowbening", "brand hasil konfirmasi user harus tersimpan (ter-trim)");
});

test("POST tanpa brand -> raw_meta tetap tanpa brand (tidak menebak diam-diam)", async () => {
  const res = await createProduct(
    jsonReq("http://localhost/api/products", "POST", {
      name: "Produk Tanpa Merek",
      price_idr: 50000,
      category: "default",
      product_type: "produk fisik tanpa merek",
      confirmed_product_type: "produk fisik tanpa merek",
      images_base64: [`data:image/png;base64,${PNG_1X1}`],
    })
  );
  assert.equal(res.status, 201);
  const { product_id } = (await res.json()) as { product_id: string };
  const row = getDb().prepare("SELECT raw_meta FROM products WHERE id = ?").get(product_id) as { raw_meta: string | null };
  const meta = JSON.parse(row.raw_meta ?? "{}") as { brand?: string };
  assert.equal(meta.brand, undefined);
});

test("PATCH menulis brand dan MEMPERTAHANKAN raw_meta.og hasil scrape", async () => {
  const id = uuid();
  getDb().prepare(
    `INSERT INTO products (id, user_id, source_url, name, price_idr, category,
       product_type_token,product_type_confirmed_token,product_type_confirmed_by,product_type_confirmed_at,product_type_version,product_type_state,
       images, raw_meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, user.id, "https://toko.example/p", "Serum Scarlett Brightening", 60000, "beauty",
    "serum wajah", "serum wajah", user.id, now(), 1, "CONFIRMED", "[]",
    JSON.stringify({ og: { price: 60000, original: 90000 } }), now());

  const res = await patchProduct(
    jsonReq(`http://localhost/api/products/${id}`, "PATCH", { brand: "Scarlett" }),
    { params: Promise.resolve({ id }) }
  );
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const row = getDb().prepare("SELECT raw_meta FROM products WHERE id = ?").get(id) as { raw_meta: string | null };
  const meta = JSON.parse(row.raw_meta ?? "{}") as { brand?: string; og?: { price?: number } };
  assert.equal(meta.brand, "Scarlett");
  assert.equal(meta.og?.price, 60000, "og hasil scrape tidak boleh tertimpa");
});

test("PATCH brand kosong -> menghapus brand tanpa menyentuh og", async () => {
  const id = uuid();
  getDb().prepare(
    `INSERT INTO products (id, user_id, name, price_idr, category,
       product_type_token,product_type_confirmed_token,product_type_confirmed_by,product_type_confirmed_at,product_type_version,product_type_state,
       images, raw_meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, user.id, "Produk Hapus Merek", 60000, "beauty",
    "produk fisik", "produk fisik", user.id, now(), 1, "CONFIRMED", "[]",
    JSON.stringify({ brand: "Salah", og: { price: 1 } }), now());
  const res = await patchProduct(
    jsonReq(`http://localhost/api/products/${id}`, "PATCH", { brand: "" }),
    { params: Promise.resolve({ id }) }
  );
  assert.equal(res.status, 200);
  const meta = JSON.parse((getDb().prepare("SELECT raw_meta FROM products WHERE id = ?").get(id) as { raw_meta: string }).raw_meta) as Record<string, unknown>;
  assert.equal(meta.brand, undefined);
  assert.deepEqual(meta.og, { price: 1 });
});

test("usulMerekDariNama menawarkan token merek, bukan deskriptor generik", () => {
  const usul = usulMerekDariNama("Serum Wajah Scarlett Brightening 30ml");
  assert.ok(usul, "harus ada usulan");
  assert.ok(!["serum", "wajah", "brightening"].includes(usul!), `usulan "${usul}" masih kata generik`);
});
