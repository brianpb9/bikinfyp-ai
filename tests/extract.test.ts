// Unit test ekstraksi: parser OG + JSON-LD (fixture HTML) + rate limit.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-extract-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-extract-storage-${process.pid}`;

const { parseOpenGraph, parseJsonLdPrice, parsePriceFromHtml, parseJsonLdImages, parseInlineProductImages, parseOriginalPriceFromHtml, cleanDescriptionForVisual, guessCategory, canExtract } = await import("../lib/extract");
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

test("parseJsonLdImages: string, array, ImageObject, dan @graph", () => {
  const html =
    '<script type="application/ld+json">{"@type":"Product","image":["https://a.cdn/x1.jpg","https://a.cdn/x2.jpg"]}</script>' +
    '<script type="application/ld+json">{"@graph":[{"@type":"Product","image":{"url":"https://a.cdn/x3.jpg"}}]}</script>' +
    '<script type="application/ld+json">RUSAK{{{</script>';
  assert.deepEqual(parseJsonLdImages(html), ["https://a.cdn/x1.jpg", "https://a.cdn/x2.jpg", "https://a.cdn/x3.jpg"]);
});

test("parseInlineProductImages: unescape signed URL, dedup per hash, saring aset non-produk", () => {
  const h1 = "1fa340ee5b774d87b037186443c54b9b";
  const h2 = "17983a42424d49c1af12bc5188a1a7d8";
  const html =
    `{"img":"https:\\/\\/p16-images-sign-sg.cdn.net\\/tos\\/${h1}~tplv-white-p?x-expires=1\\u0026x-signature=abc"}` +
    `<img src="https://p19-images-sign-sg.cdn.net/tos/${h1}~tplv-resize?x-signature=def">` +
    `<img src="https://p16-images-sign-sg.cdn.net/tos/${h2}~tplv-resize?x-signature=ghi">` +
    '<link href="https://p16-images-comn-sg.cdn.net/img/favicon.ico~tplv-abc">' +
    '<link href="https://p16-images-comn-sg.cdn.net/img/lite-sw/192px.png~tplv-abc">';
  const urls = parseInlineProductImages(html);
  assert.equal(urls.length, 2, JSON.stringify(urls));
  // Dedup h1: varian "resize" menang; query signature utuh setelah unescape (& -> &).
  assert.ok(urls[0].includes("resize") && urls[0].includes(h1));
  assert.ok(urls.every((u) => !u.includes("favicon") && !u.includes("192px")));
  assert.ok(urls[0].includes("x-signature="));
});

test("parseOriginalPriceFromHtml: kunci original/slash > harga jual, ambil yang terkecil", () => {
  const html = '{"originalPrice":250000,"priceFmt":"65.574","slashPriceFmt":"250.000","bundlePrice":"750.000"}';
  assert.equal(parseOriginalPriceFromHtml(html, 65574), 250000);
  assert.equal(parseOriginalPriceFromHtml(html, 300000), 750000 >= 300000 ? null : null); // tidak ada kandidat > harga (bundle bukan kunci original/slash)
  assert.equal(parseOriginalPriceFromHtml("{}", 65574), null);
  assert.equal(parseOriginalPriceFromHtml(html, null), null);
});

test("cleanDescriptionForVisual: buang judul, boilerplate, kata marketing; fallback judul bersih", () => {
  const title = "Promo SKIN1004 Ampoule 30ml | Tokopedia";
  // Deskripsi cuma boilerplate -> fallback ke judul yang dibersihkan (tanpa
  // "Promo"/nama marketplace) — jangan kosong (permintaan 2026-08-06).
  const fb = cleanDescriptionForVisual("Promo SKIN1004 Ampoule 30ml di Toko Mall. Promo khusus pengguna baru di aplikasi Tokopedia!", title);
  assert.ok(fb && fb.includes("SKIN1004 Ampoule 30ml") && !/promo|tokopedia/i.test(fb), String(fb));
  const ok = cleanDescriptionForVisual(
    "Serum botol kaca pink 30ml dengan pipet putih, kemasan kotak pink pastel. Promo khusus pengguna baru di aplikasi Tokopedia!",
    title
  );
  assert.ok(ok && ok.includes("botol kaca pink") && !/promo/i.test(ok), String(ok));
});
