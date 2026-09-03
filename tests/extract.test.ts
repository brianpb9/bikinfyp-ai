// Unit test ekstraksi: parser OG + JSON-LD (fixture HTML) + rate limit.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-extract-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-extract-storage-${process.pid}`;

const { parseOpenGraph, parseJsonLdPrice, parsePriceFromHtml, parseJsonLdImages, parseInlineProductImages, parseOriginalPriceFromHtml, cleanDescriptionForVisual, guessCategory, canExtract } = await import("../lib/extract");
const { getDb } = await import("../lib/db");
const fs = await import("node:fs");
const path = await import("node:path");
const baca = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
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

// ── LINK BERBAGI DARI APLIKASI ─────────────────────────────────────────────
//
// Tombol "Bagikan" di aplikasi tidak memberi alamat halaman produk — ia memberi
// alamat PENDEK dari domain lain, dan itulah bentuk yang paling sering ditempel
// orang. Link nyata yang gagal 3 Sep 2026:
// https://vt.tokopedia.com/t/ZS9BvcNsopaBj-mXaUd/

test("domain pendek marketplace diterima, domain lain tetap ditolak", async () => {
  const { validateMarketplaceUrl } = await import("../lib/url-safety");
  const boleh = [
    "https://vt.tokopedia.com/t/ZS9BvcNsopaBj-mXaUd/",
    "https://shop-id.tokopedia.com/view/product/1737013876776011484",
    "https://tokopedia.link/abc123",
    "https://shp.ee/abc123",
    "https://shope.ee/abc123",
    "https://vt.tiktok.com/ZSabc/",
    "https://shopee.co.id/product-i.123.456",
    "https://shopee.com/product-i.123.456",
  ];
  for (const u of boleh) assert.equal(validateMarketplaceUrl(u).ok, true, `${u} ditolak`);

  // Daftar putih tetap daftar putih — dan itu penjagaan anti-SSRF, bukan
  // formalitas.
  for (const u of [
    "https://contoh.com/produk",
    "http://169.254.169.254/latest/meta-data/",
    "https://localhost/x",
    "https://tokopedia.com.jahat.id/x",
    "file:///etc/passwd",
  ]) {
    assert.equal(validateMarketplaceUrl(u).ok, false, `${u} LOLOS daftar putih`);
  }
});

test("judul dan foto terbaca dari parameter og_info di alamat pengalihan", async () => {
  const { parseOgInfoDariUrl } = await import("../lib/extract");
  // Bentuk aslinya, disalin dari pengalihan vt.tokopedia.com yang sungguhan.
  const og = encodeURIComponent(JSON.stringify({
    title: "Cetaphil Baby Wash & Shampoo 400ml",
    image: "https://p16-oec-sg.ibyteimg.com/tos-alisg/32e3f4da.webp",
  }));
  const rantai = [
    "https://vt.tokopedia.com/t/ZS9BvcNsopaBj-mXaUd/",
    `https://shop-id.tokopedia.com/view/product/173701?og_info=${og}&utm_source=whatsapp`,
  ];
  const hasil = parseOgInfoDariUrl(rantai);
  assert.equal(hasil.title, "Cetaphil Baby Wash & Shampoo 400ml");
  assert.match(hasil.image ?? "", /^https:\/\/p16-oec-sg\.ibyteimg\.com\//);

  // Rantai tanpa og_info tidak melempar apa pun — ini jalur CADANGAN, dan
  // kegagalannya tidak boleh menjatuhkan pengambilan yang lain.
  assert.deepEqual(parseOgInfoDariUrl(["https://tokopedia.com/x", "bukan-url"]), {});
  assert.deepEqual(parseOgInfoDariUrl(["https://tokopedia.com/x?og_info=bukan-json"]), {});
});

test("pengalihan ke luar daftar putih DITOLAK, bukan diikuti", async () => {
  // redirect: "follow" akan mengikuti pengalihan ke mana pun — termasuk keluar
  // dari daftar putih. Sebuah link marketplace yang sah bisa mengalihkan ke
  // alamat internal, dan seluruh penjagaan anti-SSRF terlewati begitu saja.
  const src = baca("lib/extract.ts");
  assert.match(src, /redirect: "manual"/, "pengalihan masih diikuti fetch tanpa pemeriksaan");
  assert.match(src, /const sah = validateMarketplaceUrl\(berikut\)/, "lompatan pengalihan tidak divalidasi ulang");
  assert.match(src, /pengalihan ke luar daftar putih/, "pengalihan ke luar daftar putih tidak ditolak");
  assert.match(src, /MAKS_LOMPATAN/, "tidak ada batas jumlah pengalihan");
});

test("ensureDirs tidak membuat direktori SQLite saat runtime Postgres", async () => {
  // Cacat lama yang baru terlihat 3 Sep 2026: ensureDirs() selalu membuat
  // direktori database SQLite, termasuk di production tempat SQLite dimatikan
  // dan container web tidak punya izin tulis di /srv/app —
  //   EACCES: permission denied, mkdir '/srv/app/data'
  //
  // Ia bersembunyi di belakang bug lain: jalurnya ada di unduh foto produk,
  // dan ekstraksi link berbagi selalu gagal sebelum sampai ke sana.
  const src = baca("lib/config.ts");
  const fungsi = src.slice(src.indexOf("export function ensureDirs()"));
  const badan = fungsi.slice(0, fungsi.indexOf("\n}\n") + 2);
  assert.match(badan, /RACUN_DB_RUNTIME/, "ensureDirs tidak memeriksa runtime");
  assert.match(badan, /if \(!pakaiPostgres\) dir\.unshift\(path\.dirname\(config\.dbPath\)\)/,
    "direktori SQLite masih dibuat tanpa syarat");
  // Direktori penyimpanan TETAP dibuat tanpa syarat — ia tempat singgah berkas
  // untuk FFmpeg di kedua runtime, bahkan saat penyimpanan utamanya S3/MinIO.
  assert.match(badan, /config\.storageDir/, "direktori penyimpanan tidak lagi dibuat");
});

test("ensureDirs benar-benar melewati direktori SQLite di runtime Postgres", async () => {
  // Bukan cuma bentuk kodenya — perilakunya. Dijalankan dengan penanda runtime
  // Postgres pada direktori database yang TIDAK ADA; kalau ia masih mencoba
  // membuatnya, direktori itu akan lahir.
  const os = await import("node:os");
  const dirUji = path.join(os.tmpdir(), `uji-ensuredirs-${process.pid}`);
  const dbUji = path.join(dirUji, "db", "racun.db");
  const asalRuntime = process.env.RACUN_DB_RUNTIME;
  const { config, ensureDirs } = await import("../lib/config");
  const asalDb = config.dbPath;
  const asalStorage = config.storageDir;
  (config as { dbPath: string }).dbPath = dbUji;
  (config as { storageDir: string }).storageDir = path.join(dirUji, "storage");
  process.env.RACUN_DB_RUNTIME = "postgres";
  try {
    ensureDirs();
    assert.equal(fs.existsSync(path.dirname(dbUji)), false, "direktori SQLite tetap dibuat di runtime Postgres");
    assert.equal(fs.existsSync(path.join(dirUji, "storage", "uploads")), true, "direktori penyimpanan tidak dibuat");
  } finally {
    (config as { dbPath: string }).dbPath = asalDb;
    (config as { storageDir: string }).storageDir = asalStorage;
    if (asalRuntime === undefined) delete process.env.RACUN_DB_RUNTIME;
    else process.env.RACUN_DB_RUNTIME = asalRuntime;
    fs.rmSync(dirUji, { recursive: true, force: true });
  }
});

// ── LINK SHOPEE: UA MENENTUKAN, DAN BERANDA BUKAN PRODUK ───────────────────
//
// Link pendek Shopee (id.shp.ee) yang dilaporkan Brian 3 Sep 2026 menghasilkan
// produk bernama "Shopee Indonesia | Situs Belanja Online Terlengkap...".
// Diuji ke link sungguhan, empat kombinasi header:
//   UA ponsel  -> HTTP 200 TANPA pengalihan, isinya halaman depan
//   UA desktop -> HTTP 301 ke shopee.co.id/product/817167067/...
// Header `accept` tidak berpengaruh; hanya UA.

test("pengambil halaman memakai User-Agent desktop", () => {
  const src = baca("lib/extract.ts");
  // Dengan UA ponsel, Shopee menyajikan halaman pembuka aplikasi — tag Open
  // Graph-nya tag beranda, bukan produk.
  assert.match(src, /Macintosh; Intel Mac OS X/, "UA bukan desktop — Shopee tidak akan mengalihkan ke produk");
  assert.ok(!/Android 13; Pixel 7/.test(src), "UA ponsel kembali dipakai");
});

test("judul halaman depan marketplace DITOLAK, tidak disajikan sebagai produk", async () => {
  const { extractFromUrl } = await import("../lib/extract");
  // Tidak memanggil jaringan: yang diuji daftar polanya, lewat fungsi yang
  // sama yang dipakai extractFromUrl.
  const src = baca("lib/extract.ts");
  assert.match(src, /JUDUL_BERANDA\.some\(\(re\) => re\.test\(judul\)\)/, "judul beranda tidak diperiksa");
  assert.match(src, /halaman depan marketplace, bukan produk/, "penolakan tidak menyebut sebabnya");
  // Pesannya memberi tahu apa yang harus dilakukan, bukan cuma bahwa gagal.
  assert.match(src, /Buka produknya lalu salin link dari tombol Bagikan/, "pesan tidak menyarankan tindakan");
  assert.equal(typeof extractFromUrl, "function");
});

test("harga boilerplate yang berulang identik tidak dianggap harga produk", async () => {
  const { parsePriceFromHtml } = await import("../lib/extract");
  // Halaman produk Shopee tidak memuat harga aslinya di HTML sisi server.
  // Yang tersisa cuma teks voucher — pada halaman deterjen 5 liter, SELURUH 13
  // pola "Rp" berbunyi "Rp1.000.000". Mengisinya berarti harga salah masuk ke
  // hook video: "cuma sejuta!" untuk produk puluhan ribu.
  const voucher = Array(13).fill("<div>Min. belanja Rp1.000.000,-</div>").join("");
  assert.equal(parsePriceFromHtml(voucher), null, "ambang voucher diambil sebagai harga produk");

  // Halaman produk sungguhan mengulang harganya bersama harga LAIN (coret,
  // cicilan, varian) — keseragaman total di banyak kemunculan yang mencurigakan.
  assert.equal(parsePriceFromHtml("<div>Rp85.000</div><div>Rp120.000</div><div>Rp85.000</div>"), 85_000);
  assert.equal(parsePriceFromHtml("<div>Harga Rp89.000</div>"), 89_000);
  // Pengulangan sedikit tetap diterima — ambangnya 5, bukan 2.
  assert.equal(parsePriceFromHtml(Array(4).fill("<div>Rp50.000</div>").join("")), 50_000);
});
