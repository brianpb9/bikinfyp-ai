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

test("POST kategori default membuat item quarantine retail durable tanpa menyimpan gambar", async () => {
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
  assert.equal(res.status, 202);
  const body = await res.json() as { product_id:string;category_review:{state:string;reason:string};images:unknown[] };
  assert.deepEqual(body.images,[]);
  assert.deepEqual(body.category_review,{state:"QUARANTINED",reason:"CATEGORY_UNKNOWN",reviewedBy:null,reviewedRole:null,reviewedAt:null,version:1});
  const row=getDb().prepare("SELECT category_review_state,category_review_reason,images FROM products WHERE id=?").get(body.product_id) as Record<string,unknown>;
  assert.deepEqual(row,{category_review_state:"QUARANTINED",category_review_reason:"CATEGORY_UNKNOWN",images:"[]"});
  assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=? AND action='product.category_quarantined'").get(body.product_id) as {n:number}).n,1);
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
  getDb().prepare("UPDATE products SET category_review_state='CLEAR',category_review_reason=NULL,category_review_version=1 WHERE id=?").run(id);

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
  getDb().prepare("UPDATE products SET category_review_state='CLEAR',category_review_reason=NULL,category_review_version=1 WHERE id=?").run(id);
  const res = await patchProduct(
    jsonReq(`http://localhost/api/products/${id}`, "PATCH", { brand: "" }),
    { params: Promise.resolve({ id }) }
  );
  assert.equal(res.status, 200);
  const meta = JSON.parse((getDb().prepare("SELECT raw_meta FROM products WHERE id = ?").get(id) as { raw_meta: string }).raw_meta) as Record<string, unknown>;
  assert.equal(meta.brand, undefined);
  assert.deepEqual(meta.og, { price: 1 });
});

test("E3 HTTP category default re-quarantines a previously CLEAR retail product",async()=>{
  const id=uuid();
  getDb().prepare(`INSERT INTO products (id,user_id,name,price_idr,category,product_type_token,
    product_type_confirmed_token,product_type_confirmed_by,product_type_confirmed_at,product_type_version,
    product_type_state,category_review_state,category_review_reason,category_review_version,images,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,1,'CONFIRMED','CLEAR',NULL,1,'[]',?)`).run(
      id,user.id,"Serum Clear",60_000,"beauty","serum wajah","serum wajah",user.id,now(),now());
  const res=await patchProduct(jsonReq(`http://localhost/api/products/${id}`,"PATCH",{
    category:"default",category_outcome:"KNOWN",
  }),{params:Promise.resolve({id})});
  assert.equal(res.status,202,await res.clone().text());
  const row=getDb().prepare("SELECT category_review_state,category_review_reason,images FROM products WHERE id=?").get(id) as Record<string,unknown>;
  assert.deepEqual(row,{category_review_state:"QUARANTINED",category_review_reason:"CATEGORY_UNKNOWN",images:"[]"});
  assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id=? AND action='product.category_quarantined'").get(id) as {n:number}).n,1);
});

test("E3 HTTP canonical category change invalidates stale Founder release provenance",async()=>{
  const id=uuid();
  const releasedAt=now();
  getDb().prepare(`INSERT INTO products (id,user_id,name,price_idr,category,product_type_token,
    product_type_confirmed_token,product_type_confirmed_by,product_type_confirmed_at,product_type_version,
    product_type_state,category_review_state,category_review_reason,category_reviewed_by,
    category_reviewed_role,category_reviewed_at,category_review_version,images,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,1,'CONFIRMED','CLEAR',NULL,?,?,?,2,'[]',?)`).run(
      id,user.id,"Serum Released",60_000,"beauty","serum wajah","serum wajah",user.id,now(),
      "founder-1","Founder/CEO",releasedAt,now());
  const res=await patchProduct(jsonReq(`http://localhost/api/products/${id}`,"PATCH",{
    category:"health",category_outcome:"KNOWN",
  }),{params:Promise.resolve({id})});
  assert.equal(res.status,202,await res.clone().text());
  const row=getDb().prepare(`SELECT category,category_review_state,category_review_reason,
    category_reviewed_by,category_reviewed_role,category_reviewed_at,category_review_version
    FROM products WHERE id=?`).get(id) as Record<string,unknown>;
  assert.deepEqual(row,{category:"health",category_review_state:"QUARANTINED",
    category_review_reason:"CATEGORY_UNKNOWN",category_reviewed_by:null,category_reviewed_role:null,
    category_reviewed_at:null,category_review_version:3});
});

test("usulMerekDariNama menawarkan token merek, bukan deskriptor generik", () => {
  const usul = usulMerekDariNama("Serum Wajah Scarlett Brightening 30ml");
  assert.ok(usul, "harus ada usulan");
  assert.ok(!["serum", "wajah", "brightening"].includes(usul!), `usulan "${usul}" masih kata generik`);
});
