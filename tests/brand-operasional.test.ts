// EMPAT PERBAIKAN OPERASIONAL BRAND (Brian, 8 Sep 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { skorFoto, urutkanFoto, RASIO_BANNER, MIN_SISI_PX } from "../lib/foto-produk-pilih";
import { MAX_IMAGES } from "../lib/product-images";
import { parseShopeeStateImages } from "../lib/extract";

const kode = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");

// ── 1. EMAIL APPROVAL ───────────────────────────────────────────────────────
test("menyetujui brand mengirim email ke OWNER-nya", () => {
  // Layar /dashboard/menunggu berjanji "kami kabari lewat email begitu
  // selesai", dan sampai 8 Sep 2026 tidak ada kode yang mengirimnya.
  const r = kode("app/api/admin/org-status/route.ts");
  assert.match(r, /emailBrandDisetujui/, "tidak ada email saat disetujui");
  assert.match(r, /role = 'owner'/, "penerimanya bukan owner organisasi");
  assert.match(r, /status === "active"/, "email tidak dikaitkan ke status active");
});

test("email yang gagal TIDAK membatalkan persetujuan", () => {
  // Statusnya sudah tersimpan sebelum email disusun; melempar di sana membuat
  // admin menekan tombolnya lagi.
  const r = kode("app/api/admin/org-status/route.ts");
  // Dicari PEMANGGILANNYA, bukan baris import — versi pertama tes ini
  // menemukan `import { emailBrandDisetujui }` di baris 6 dan menyimpulkan
  // emailnya dikirim sebelum status tersimpan. Gagal untuk alasan yang salah.
  const i = r.indexOf("await emailBrandDisetujui(");
  const sebelum = r.slice(0, i);
  assert.match(sebelum, /UPDATE organizations SET status/, "email dikirim sebelum status tersimpan");
  assert.match(r.slice(i - 400, i + 400), /try \{|catch/, "pengiriman email tidak dibungkus try/catch");
});

// ── 2. ADMIN MENEMUKAN YANG MENUNGGU ────────────────────────────────────────
test("admin punya saringan dan hitungan 'menunggu'", () => {
  const p = kode("app/admin/page.tsx");
  assert.match(p, /id: "menunggu"/, "saringan menunggu tidak ada");
  assert.match(p, /nMenunggu/, "hitungan menunggu tidak ada");
  assert.match(p, /org_status === "pending"/, "menunggu tidak diturunkan dari status pending");
});

// ── 3. TOP-UP TOKEN LEWAT UI ────────────────────────────────────────────────
test("top-up MENAMBAH, tidak menetapkan saldo", () => {
  // Skrip CLI-nya menetapkan saldo TARGET. Untuk tombol UI itu berbahaya:
  // admin yang mengetik 50000 bermaksud MENAMBAH; kalau ditafsirkan sebagai
  // target dan saldonya sudah 200rb, tafsir itu MENGHAPUS 150rb milik orang.
  const r = kode("app/api/admin/org-token/route.ts");
  assert.match(r, /INSERT INTO credit_ledger/, "tidak menulis baris ledger");
  assert.doesNotMatch(r, /targetBalance|saldo target/i, "masih memakai semantik target");
  assert.match(r, /jumlah <= 0/, "jumlah non-positif tidak ditolak");
});

test("top-up mengunci baris organisasi sebelum menghitung saldo", () => {
  // Dua admin yang menekan bersamaan harus berbaris, bukan sama-sama membaca
  // saldo lama.
  const r = kode("app/api/admin/org-token/route.ts");
  assert.match(r, /FOR UPDATE/, "baris organisasi tidak dikunci");
  assert.ok(r.indexOf("FOR UPDATE") < r.indexOf("INSERT INTO credit_ledger"),
    "kunci diambil setelah menulis");
});

test("ada pagu satu transaksi — ledger append-only tidak punya undo", () => {
  const r = kode("app/api/admin/org-token/route.ts");
  assert.match(r, /MAKS_SEKALI_IDR/, "tidak ada pagu salah ketik");
});

// ── 4. FOTO SCRAPING ────────────────────────────────────────────────────────
test("batas foto dari link sama dengan batas unggah manual", () => {
  // Angka 5 membuat pengguna yang MENEMPEL LINK dapat lebih sedikit bahan
  // daripada yang mengunggah sendiri — padahal link adalah jalur utamanya.
  assert.equal(MAX_IMAGES, 8);
  assert.match(kode("lib/extract.ts"), /imageUrls\.length >= MAX_IMAGES/);
  assert.match(kode("lib/product-image-download.ts"), /urls\.slice\(0, MAX_IMAGES\)/);
});

test("banner promo turun peringkat di bawah foto objek nyata", () => {
  const objek = { urutan: 3, lebar: 1000, tinggi: 1000, kata: 0 };
  const banner = { urutan: 0, lebar: 1200, tinggi: 600, kata: 12 };
  // Banner ada di urutan PERTAMA (og:image), foto objek di urutan keempat —
  // dan tetap harus kalah, karena urutan asal cuma pemecah seri.
  assert.deepEqual(urutkanFoto([banner, objek]), [objek, banner]);
});

test("OCR yang GAGAL tidak menghukum DAN tidak memberi bonus", () => {
  // -1 berarti "tidak diperiksa". Dua arah salah yang harus sama-sama tertutup:
  //
  //   dihukum  -> foto bagus tenggelam hanya karena tesseract tersedak
  //   diberi bonus -> `skor += kata * 10` tanpa penjaga membuat -1 jadi MINUS
  //                   sepuluh, dan foto yang tidak diperiksa naik MENGALAHKAN
  //                   foto yang terbukti bersih
  //
  // Versi pertama tes ini cuma membandingkan -1 dengan 0, dan mutasi
  // `f.kata >= 0` lolos karena 0 * 10 = 0 — dua jalur berbeda, hasil sama.
  const takDiperiksa = { urutan: 0, lebar: 1000, tinggi: 1000, kata: -1 };
  const bersih = { urutan: 0, lebar: 1000, tinggi: 1000, kata: 0 };
  const berteks = { urutan: 0, lebar: 1000, tinggi: 1000, kata: 5 };

  assert.equal(skorFoto(takDiperiksa), skorFoto(bersih), "yang tidak diperiksa dihukum/dibonusi");
  assert.ok(skorFoto(takDiperiksa) >= 0, "skor negatif = bonus untuk ketidaktahuan");
  assert.ok(skorFoto(takDiperiksa) < skorFoto(berteks), "yang tidak diperiksa kalah dari yang berteks");
  // Dan pengurutannya ikut: yang tidak diperiksa tidak boleh menyalip yang bersih.
  assert.deepEqual(urutkanFoto([takDiperiksa, bersih]), [takDiperiksa, bersih]);
});

test("bentuk banner dikenali, foto lanskap wajar tidak", () => {
  const spanduk = { urutan: 0, lebar: 2000, tinggi: 800, kata: 0 };   // 2,5:1
  const lanskap = { urutan: 0, lebar: 1200, tinggi: 900, kata: 0 };   // 1,33:1
  assert.ok(skorFoto(spanduk) > skorFoto(lanskap), "spanduk tidak dihukum");
  assert.ok(2000 / 800 >= RASIO_BANNER && 1200 / 900 < RASIO_BANNER, "ambangnya salah letak");
});

test("foto terlalu kecil turun peringkat", () => {
  const kecil = { urutan: 0, lebar: 320, tinggi: 320, kata: 0 };
  const besar = { urutan: 1, lebar: 1000, tinggi: 1000, kata: 0 };
  assert.ok(320 < MIN_SISI_PX);
  assert.deepEqual(urutkanFoto([kecil, besar]), [besar, kecil]);
});

test("pengurutan stabil — hasil yang sama untuk masukan yang sama", () => {
  const a = { urutan: 0, lebar: 800, tinggi: 800, kata: 0 };
  const b = { urutan: 1, lebar: 800, tinggi: 800, kata: 0 };
  assert.deepEqual(urutkanFoto([a, b]), [a, b]);
  assert.deepEqual(urutkanFoto([b, a]), [a, b]);
});

test("kueri admin MEMILIH org_id — tanpa itu tombol Setujui tidak pernah dirender", () => {
  // Bug bawaan sejak a117a17, ketahuan 8 Sep 2026 saat verifikasi produksi:
  // tipe barisnya mendeklarasikan org_id, JSX-nya menjaga dengan
  // `{u.org_id && ...}`, tapi kueri tidak pernah memilih kolomnya. Halaman
  // menampilkan "(pending)" tanpa satu tombol pun. Fiturnya ada di kode dan
  // mati di layar — bentuk kegagalan yang tidak muncul sebagai galat apa pun.
  const p = readFileSync(join(process.cwd(), "app/admin/page.tsx"), "utf8");
  assert.match(p, /org\.id\s+AS org_id/, "org_id tidak dipilih kueri");

  // Setiap kolom yang dijaga JSX harus benar-benar ada di kueri.
  const kode = p.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").filter((b) => !/^\s*--/.test(b)).join("\n");
  for (const kolom of ["org_id", "org_status", "org_nama", "org_saldo"]) {
    assert.match(kode, new RegExp(`AS ${kolom}`), `kolom ${kolom} dipakai JSX tapi tidak dipilih kueri`);
  }
});

// ── SHOPEE: HASH TELANJANG DI STATE HALAMAN ─────────────────────────────────
test("galeri Shopee diambil dari blok yang MEMUAT hash og:image", () => {
  // Diverifikasi pada link nyata Brian 8 Sep 2026 (iPhone 17 Pro): halaman
  // punya DELAPAN blok "images":[...] — sebagian milik produk lain. Yang
  // membedakan bukan urutan dan bukan panjangnya, melainkan memuat hash
  // og:image, satu-satunya penanda otoritatif di halaman itu.
  const og = "https://down-id.img.susercontent.com/file/id-A11111111111111111";
  const html = `
    <meta property="og:image" content="${og}"/>
    {"images":["id-ZZZZZZZZZZZZZZZZZZ","id-YYYYYYYYYYYYYYYYYY"]}
    {"images":["id-B22222222222222222","id-A11111111111111111","id-C33333333333333333"]}
  `;
  const hasil = parseShopeeStateImages(html, og);
  assert.equal(hasil.length, 3, "blok produk tidak ditemukan");
  // og:image DIDAHULUKAN — ia foto utama menurut Shopee sendiri, dan urutan
  // menentukan mana yang berpeluang jadi acuan render.
  //
  // Fixture sengaja menaruhnya di posisi KEDUA: kalau ia sudah pertama,
  // pengurutan kita tidak teruji dan mutasi yang menghapusnya lolos diam-diam.
  assert.equal(hasil[0], og, "og:image tidak dinaikkan ke depan");
  assert.equal(hasil.length, new Set(hasil).size, "ada URL ganda");
  assert.ok(hasil.every((u) => u.startsWith("https://down-id.img.susercontent.com/file/")));
  // Blok produk LAIN tidak ikut terbawa.
  assert.ok(!hasil.some((u) => u.includes("ZZZZ")), "blok produk lain ikut terambil");
});

test("basis CDN diturunkan dari og:image, tidak dipaku ke down-id", () => {
  // Shopee memakai host per wilayah. Memaku "down-id" membuat pemindai ini
  // diam-diam gagal begitu tokonya bukan Indonesia — kegagalan yang tidak
  // menghasilkan galat apa pun, cuma satu foto lagi seperti sebelumnya.
  const og = "https://down-sg.img.susercontent.com/file/sg-A11111111111111111";
  const html = `{"images":["sg-A11111111111111111","sg-B22222222222222222"]}`;
  const hasil = parseShopeeStateImages(html, og);
  assert.equal(hasil.length, 2);
  assert.ok(hasil.every((u) => u.startsWith("https://down-sg.img.susercontent.com/file/")));
});

test("halaman tanpa blok yang cocok mengembalikan kosong, bukan menebak", () => {
  const og = "https://down-id.img.susercontent.com/file/id-A11111111111111111";
  assert.deepEqual(parseShopeeStateImages(`{"images":["id-QQQQQQQQQQQQQQQQQQ"]}`, og), []);
  assert.deepEqual(parseShopeeStateImages("<html></html>", og), []);
  // og:image bukan URL Shopee -> bukan urusan pemindai ini.
  assert.deepEqual(parseShopeeStateImages(`{"images":["x"]}`, "https://cdn.lain.com/a.jpg"), []);
  assert.deepEqual(parseShopeeStateImages(`{"images":["x"]}`, null), []);
});
