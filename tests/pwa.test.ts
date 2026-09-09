// PWA — aplikasi terpasang dari browser (Brian, 8 Sep 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bolehTampil, waktuTunda, deteksiIosSafari, DIAM_HARI } from "../lib/pwa-pasang";

const baca = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

test("berkas PWA yang wajib ada, ada", () => {
  for (const f of ["public/manifest.json", "public/sw.js", "public/offline.html",
                   "public/icons/icon-192.png", "public/icons/icon-512.png",
                   "public/icons/icon-maskable-512.png"]) {
    assert.ok(existsSync(join(process.cwd(), f)), `${f} tidak ada`);
  }
});

test("manifest memenuhi syarat pemasangan", () => {
  const m = JSON.parse(baca("public/manifest.json")) as Record<string, unknown>;
  assert.equal(m.display, "standalone", "display bukan standalone");
  for (const k of ["name", "short_name", "start_url", "icons", "id", "scope"]) {
    assert.ok(m[k], `manifest tanpa ${k}`);
  }
  const ic = m.icons as { sizes: string; purpose?: string }[];
  // 192 dan 512 adalah syarat keras Chrome; maskable yang membuat ikonnya tidak
  // dipotong jadi lingkaran putih di Android.
  for (const s of ["192x192", "512x512"]) assert.ok(ic.some((i) => i.sizes === s), `ikon ${s} hilang`);
  assert.ok(ic.some((i) => i.purpose === "maskable"), "ikon maskable hilang");
});

test("start_url TIDAK menunjuk alamat yang mengalihkan", () => {
  // "/" menjawab 307 ke /onboarding. Aplikasi terpasang yang membuka start_url
  // akan selalu membayar satu lompatan, dan sebagian browser membaca start_url
  // yang mengalihkan sebagai tanda scope yang salah.
  const m = JSON.parse(baca("public/manifest.json")) as { start_url: string };
  assert.notEqual(m.start_url, "/", "start_url masih menunjuk alamat yang mengalihkan");
});

test("middleware TIDAK mengalihkan /sw.js dan /offline.html", () => {
  // Jebakan yang sudah pernah terjadi pada /previews/*.mp4 dan terulang:
  // middleware menjawab 307 ke /onboarding, pendaftaran service worker gagal,
  // dan aplikasinya tidak pernah bisa dipasang — tanpa satu pesan galat pun.
  const mw = baca("middleware.ts");
  const m = /matcher: \[\s*[\s\S]*?"([^"]+)"/.exec(mw);
  assert.ok(m, "matcher tidak ditemukan");
  // BACKSLASH DI-UNESCAPE DULU. Yang dibaca di sini adalah SUMBER TypeScript,
  // dan di sana "\\." adalah dua karakter yang menjadi satu backslash saat
  // string-nya dievaluasi. Membangun RegExp dari teks mentahnya menghasilkan
  // pola dengan arti BERBEDA dari yang benar-benar dipakai Next — versi pertama
  // tes ini gagal karena itu, bukan karena middleware-nya salah.
  const re = new RegExp(m[1]!.replace(/\\\\/g, "\\"));
  for (const p of ["/sw.js", "/offline.html", "/manifest.json", "/icons/icon-192.png"]) {
    assert.equal(re.test(p), false, `middleware masih menangkap ${p}`);
  }
  // Dan halaman biasa TETAP dijaga — pengecualian tidak boleh membocorkan rute.
  for (const p of ["/dashboard", "/bikin/produk", "/admin"]) {
    assert.equal(re.test(p), true, `middleware tidak lagi menjaga ${p}`);
  }
});

test("service worker TIDAK PERNAH menyentuh /api", () => {
  // Aplikasi menampilkan saldo token, status job, dan harga. Menyajikan versi
  // basi membuat orang menekan Generate dengan keyakinan salah tentang saldonya.
  const sw = baca("public/sw.js");
  assert.match(sw, /pathname\.startsWith\("\/api\/"\)\s*\)\s*return;/,
    "service worker tidak melewatkan /api");
});

test("navigasi JARINGAN DULU, bukan cache dulu", () => {
  // Deploy blue/green sering. HTML yang di-cache menunjuk bundel JS versi lama;
  // sesudah deploy bundel itu hilang dan aplikasinya membuka layar putih tanpa
  // satu pesan pun.
  const sw = baca("public/sw.js");
  const i = sw.indexOf('request.mode === "navigate"');
  assert.ok(i > 0, "cabang navigasi tidak ada");
  const blok = sw.slice(i, i + 400);
  assert.ok(blok.indexOf("fetch(request)") < blok.indexOf("caches.match"),
    "navigasi memakai cache sebelum jaringan");
});

test("halaman offline menyebut nasib job yang sedang jalan", () => {
  // "Tidak ada koneksi" saja membuat orang yang videonya sedang diproses panik
  // mengira prosesnya ikut berhenti.
  const h = baca("public/offline.html");
  assert.match(h, /tetap jalan di server/i);
});

// ── AJAKAN PASANG ───────────────────────────────────────────────────────────
test("ajakan TIDAK muncul saat aplikasi sudah terpasang", () => {
  // Mengajak memasang aplikasi yang sudah terpasang membuat kita terlihat tidak
  // tahu keadaan pengguna sendiri.
  assert.equal(bolehTampil({
    pathname: "/", sudahTerpasang: true, adaPrompt: true, iosSafari: false,
    tundaSampai: null, sekarang: 1_000,
  }), false);
});

test("ajakan TIDAK muncul di alur berbayar dan halaman kerja", () => {
  // Yang dikecualikan adalah ALUR KERJA, bukan seluruh aplikasi: di sana orang
  // sedang mengisi form, meninjau storyboard, atau menunggu render yang ia bayar.
  for (const p of ["/bikin/produk", "/bikin/storyboard", "/onboarding", "/admin",
                   "/dashboard/campaign", "/dashboard/matrix", "/dashboard/menunggu"]) {
    assert.equal(bolehTampil({
      pathname: p, sudahTerpasang: false, adaPrompt: true, iosSafari: false,
      tundaSampai: null, sekarang: 1_000,
    }), false, `masih muncul di ${p}`);
  }
  // Dan MUNCUL di halaman biasa — kalau tidak, fiturnya cuma mati.
  for (const p of ["/", "/video", "/kredit"]) {
    assert.equal(bolehTampil({
      pathname: p, sudahTerpasang: false, adaPrompt: true, iosSafari: false,
      tundaSampai: null, sekarang: 1_000,
    }), true, `tidak muncul di ${p}`);
  }
});

test("BRAND melihat ajakan — seluruh /dashboard sempat terblokir", () => {
  // Bug yang Brian temukan 9 Sep 2026: daftar blokir memuat "/dashboard" polos,
  // dan SELURUH aplikasi brand ada di bawah awalan itu. Akibatnya pengguna
  // brand tidak pernah melihat ajakan di halaman mana pun — padahal merekalah
  // yang membuka aplikasi ini tiap hari dan paling diuntungkan memasangnya.
  for (const p of ["/dashboard", "/dashboard/credits", "/dashboard/library", "/dashboard/team"]) {
    assert.equal(bolehTampil({
      pathname: p, sudahTerpasang: false, adaPrompt: true, iosSafari: false,
      tundaSampai: null, sekarang: 1_000,
    }), true, `brand masih tidak melihat ajakan di ${p}`);
  }
});

test("ada PINTU PERMANEN, bukan cuma banner berjangka waktu", () => {
  // Banner muncul 6 detik sekali lalu diam 30 hari kalau ditutup. Fitur yang
  // hanya hidup di sana tidak punya alamat tetap: pertanyaan "di mana
  // tombolnya?" tidak punya jawaban yang bisa ditunjuk.
  const menu = readFileSync(join(process.cwd(), "app/_components/AccountMenu.tsx"), "utf8");
  const brand = readFileSync(join(process.cwd(), "app/dashboard/_components/DashboardChrome.tsx"), "utf8");
  assert.match(menu, /<TombolPasang/, "menu akun retail tanpa pintu pasang");
  assert.match(brand, /<TombolPasang/, "sidebar brand tanpa pintu pasang");

  // Dan tombolnya menyembunyikan diri kalau tidak ada yang bisa dikerjakan —
  // tombol mati lebih buruk daripada tidak ada tombol.
  const tb = readFileSync(join(process.cwd(), "app/_components/TombolPasang.tsx"), "utf8");
  assert.match(tb, /if \(terpasang \|\| \(!ev && !ios\)\) return null;/, "tombol mati tetap ditampilkan");
});

test("ditutup berarti diam, dan diamnya berakhir", () => {
  const sekarang = 1_000_000;
  const sampai = waktuTunda(sekarang);
  const dasar = { pathname: "/", sudahTerpasang: false, adaPrompt: true, iosSafari: false };
  assert.equal(bolehTampil({ ...dasar, tundaSampai: sampai, sekarang: sampai - 1 }), false, "muncul saat masih ditunda");
  assert.equal(bolehTampil({ ...dasar, tundaSampai: sampai, sekarang: sampai + 1 }), true, "diam selamanya");
  assert.equal(sampai - sekarang, DIAM_HARI * 86_400_000);
});

test("tidak menawarkan pemasangan yang tidak bisa dikerjakan", () => {
  // Firefox desktop: tanpa event, tanpa menu Add to Home Screen. Menampilkan
  // tombol di sana berarti menjanjikan sesuatu yang tidak terjadi.
  assert.equal(bolehTampil({
    pathname: "/", sudahTerpasang: false, adaPrompt: false, iosSafari: false,
    tundaSampai: null, sekarang: 1_000,
  }), false);
});

test("Safari iOS dikenali; Chrome iOS TIDAK", () => {
  const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const chromeIos = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";
  const android = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
  assert.equal(deteksiIosSafari(safari, "Apple Computer, Inc."), true);
  // Chrome iOS memakai WebKit yang sama tapi TIDAK punya "Add to Home Screen".
  // Menyuruhnya membuka menu bagikan hanya membuat orang bingung.
  assert.equal(deteksiIosSafari(chromeIos, "Apple Computer, Inc."), false);
  assert.equal(deteksiIosSafari(android, "Google Inc."), false);
});

test("event pemasangan dipakai sekali, dan bilah bawaan Chrome dicegah", () => {
  const src = readFileSync(join(process.cwd(), "app/_components/AjakPasang.tsx"), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");
  // Tanpa preventDefault(), Chrome menampilkan bilahnya sendiri dan pengguna
  // melihat DUA ajakan sekaligus.
  assert.match(src, /e\.preventDefault\(\)/, "bilah bawaan Chrome tidak dicegah");
  // Event hanya sah sekali; menyimpannya membuat ketukan kedua gagal diam-diam.
  const i = src.indexOf("async function pasang");
  assert.match(src.slice(i, i + 600), /setEv\(null\)/, "event tidak dibuang setelah dipakai");
});

test("beforeinstallprompt ditangkap SEBELUM React siap", () => {
  // Chrome menyalakan event ini di sekitar page-load — lebih dulu daripada
  // hydration — dan tidak pernah mengulanginya. Listener yang cuma ada di
  // useEffect memasang diri sesudahnya dan tidak pernah kebagian.
  //
  // Terbukti di produksi 9 Sep 2026: service worker aktif, manifest lolos,
  // tidak ditunda, tidak standalone — dan tombolnya tetap tidak muncul karena
  // eventnya sudah lewat. Bentuk kegagalan yang tidak menghasilkan galat apa
  // pun; yang terlihat cuma fitur yang "tidak jalan".
  const layout = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");
  assert.match(layout, /beforeinstallprompt/, "penangkap awal tidak ada di layout");
  assert.match(layout, /__aiugcPasang/, "event tidak dititipkan ke window");
  assert.match(layout, /e\.preventDefault\(\)/, "bilah bawaan Chrome tidak dicegah di penangkap awal");
  // Harus di <head>, bukan di akhir <body>: gunanya justru jalan lebih dulu.
  assert.ok(layout.indexOf("beforeinstallprompt") < layout.indexOf("<body"),
    "penangkap dipasang setelah <body> — terlalu lambat");

  const komp = readFileSync(join(process.cwd(), "app/_components/AjakPasang.tsx"), "utf8");
  assert.match(komp, /__aiugcPasang/, "komponen tidak membaca titipan");
  // Tetap mendengar langsung juga — sebagian browser menyalakannya belakangan.
  assert.match(komp, /addEventListener\("beforeinstallprompt"/, "listener langsung dilepas");
});
