// Unit test ekstraksi: parser OG + JSON-LD (fixture HTML) + rate limit.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-extract-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-extract-storage-${process.pid}`;

const { parseOpenGraph, parseJsonLdPrice, parsePriceFromHtml, guessCategory, canExtract } = await import("../lib/extract");
const { getDb } = await import("../lib/db");
const { findOrCreateUserByEmail } = await import("../lib/auth");

const OG_HTML = `<!doctype html><html><head>
<meta property="og:title" content="Serum Glowing Viral 30ml - Brightening" />
<meta property="og:image" content="https://cf.shopee.co.id/file/abc123" />
<meta property="og:description" content="Serum wajah untuk kulit kusam, skincare lokal" />
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Serum Glowing Viral 30ml",
 "offers":{"@type":"Offer","price":"85000","priceCurrency":"IDR"}}
</script></head><body>produk</body></html>`;

test("parseOpenGraph: title/image/description", () => {
  const og = parseOpenGraph(OG_HTML);
  assert.equal(og.title, "Serum Glowing Viral 30ml - Brightening");
  assert.equal(og.image, "https://cf.shopee.co.id/file/abc123");
  assert.ok(og.description?.includes("kusam"));
});

test("parseJsonLdPrice: offers.price numerik & string, blok rusak di-skip", () => {
  assert.equal(parseJsonLdPrice(OG_HTML), 85000);
  const broken = `<script type="application/ld+json">{rusak</script><script type="application/ld+json">{"offers":{"lowPrice":125000}}</script>`;
  assert.equal(parseJsonLdPrice(broken), 125000);
  assert.equal(parseJsonLdPrice("<html>tanpa jsonld</html>"), null);
});

test("guessCategory: skincare -> beauty, hijab -> muslim_fashion, default", () => {
  assert.equal(guessCategory("Serum Glowing Viral 30ml"), "beauty");
  assert.equal(guessCategory("Mukena Adem Premium"), "muslim_fashion");
  assert.equal(guessCategory("Benda Ajaib"), "default");
});

test("rate limit ekstraksi: 10x per 15 menit per user", () => {
  const db = getDb();
  const user = findOrCreateUserByEmail("extract@contoh.com");
  for (let i = 0; i < 10; i++) {
    db.prepare("INSERT INTO audit_log (id, actor, action, entity, entity_id, meta, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), user.id, "product.extract", "products", null, "{}", new Date().toISOString());
  }
  assert.equal(canExtract(user.id), false);
  const lain = findOrCreateUserByEmail("lain@contoh.com");
  assert.equal(canExtract(lain.id), true);
});

test("parsePriceFromHtml: fallback JSON state dan teks Rupiah", () => {
  assert.equal(parsePriceFromHtml(OG_HTML), 85000); // ld+json dulu
  assert.equal(parsePriceFromHtml('<script>{"product":{"price":115000}}</script>'), 115000);
  assert.equal(parsePriceFromHtml("<div>Harga Spesial Rp115.000</div>"), 115000);
  assert.equal(parsePriceFromHtml("<div>Rp 1.500.000</div>"), 1500000);
  assert.equal(parsePriceFromHtml("<div>tanpa harga</div>"), null);
  assert.equal(parsePriceFromHtml('<script>{"price":50}</script>'), null); // terlalu kecil = bukan harga produk
});
