// RESOLUSI ACUAN RENDER (Brian, link TikTok Shop 8 Sep 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { urlResolusiTinggi, SISI_DIMINTA } from "../lib/gambar-resolusi";

const TIKTOK = "https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/8e587b834eb1422ea10cf25074c7da10"
  + "~tplv-aphluv4xwc-resize-webp:260:260.webp?dr=15582&t=555f072d&idc=my2&from=2001012042";

test("thumbnail TikTok Shop dinaikkan ke sisi yang diminta", () => {
  // Diukur pada link nyata: :260:260 -> 260x260 (6 KB); :1080:1080 -> 800x800
  // (47 KB). 260 ada DI BAWAH ambang tolak foto produk kita sendiri (400px),
  // jadi satu-satunya foto yang bisa didapat dari TikTok Shop justru terlalu
  // kecil untuk jadi acuan render yang layak.
  const hasil = urlResolusiTinggi(TIKTOK);
  assert.match(hasil, new RegExp(`:${SISI_DIMINTA}:${SISI_DIMINTA}`));
  assert.doesNotMatch(hasil, /:260:260/);
});

test("query string tidak ikut dirusak", () => {
  // Pola ':\\d+:\\d+' polos akan menyentuh cap waktu atau rasio di query string.
  // Yang boleh diganti hanya angka DI DALAM direktif tplv.
  const hasil = urlResolusiTinggi(TIKTOK);
  assert.match(hasil, /dr=15582/);
  assert.match(hasil, /from=2001012042/);
  assert.match(hasil, /idc=my2/);
});

test("URL yang sudah besar dibiarkan, tidak diturunkan", () => {
  const besar = TIKTOK.replace(":260:260", ":1600:1600");
  assert.equal(urlResolusiTinggi(besar), besar);
});

test("pola tidak dikenali dikembalikan APA ADANYA, bukan dikosongkan", () => {
  // Fungsi ini duduk di jalur unduhan foto: URL asing harus tetap dicoba.
  // Kehilangan satu foto lebih buruk daripada mengunduhnya kecil.
  for (const u of [
    "https://down-id.img.susercontent.com/file/id-11134207-81zti-mfkljll",
    "https://images.tokopedia.net/img/cache/700/product-1/2020/1/1/foo.jpg",
    "bukan-url",
    "",
  ]) {
    assert.equal(urlResolusiTinggi(u), u, `URL "${u.slice(0, 40)}" berubah`);
  }
});

test("angka di jalur non-tplv tidak tersentuh", () => {
  const u = "https://cdn.contoh.com/a/300:300/foto.jpg?ts=12:34";
  assert.equal(urlResolusiTinggi(u), u);
});

test("cap waktu di query TIDAK dikira direktif ukuran", () => {
  // Kasus yang membuktikan pola harus TERIKAT ke ~tplv, bukan sekadar
  // ":angka:angka" di mana pun. Cap waktu ISO memuat pola itu persis:
  //
  //     ?t=2026-09-08T12:30:45   ->   ":30:45"
  //
  // Pola longgar akan menulis ulang jam tandatangan URL jadi ":1080:1080" dan
  // membuat permintaannya ditolak CDN. Versi pertama tes ini tidak menangkapnya
  // karena satu pun kasus ujinya tidak memuat bentuk berbahaya itu.
  const u = "https://cdn.contoh.com/foto.jpg?t=2026-09-08T12:30:45&sig=abc";
  assert.equal(urlResolusiTinggi(u), u, "cap waktu ikut ditulis ulang");

  // Dan pada URL tplv yang SAH, cap waktunya tetap utuh sementara direktifnya
  // berubah — dua hal yang harus terjadi bersamaan.
  const sah = "https://p16-oec-sg.ibyteimg.com/x/y~tplv-k-resize-webp:260:260.webp?t=2026-09-08T12:30:45";
  const hasil = urlResolusiTinggi(sah);
  assert.match(hasil, /:1080:1080\.webp/, "direktif tplv tidak dinaikkan");
  assert.match(hasil, /t=2026-09-08T12:30:45/, "cap waktu ikut rusak");
});

test("peringatan foto promo MENANG atas kalimat 'apa yang ketemu'", () => {
  // "Nama & foto ketemu" secara teknis benar tapi menyesatkan kalau foto yang
  // ketemu adalah banner "DISKON 55%". Pengguna menganggap beres, lalu membayar
  // video yang tulisan promonya ikut tergambar.
  const src = readFileSync(join(process.cwd(), "app/bikin/produk/page.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");
  const i = src.indexOf("res.peringatan_foto");
  const j = src.indexOf("res.warning");
  assert.ok(i > 0, "peringatan foto tidak dipakai layar intake");
  assert.ok(i < j, "peringatan foto diperiksa SESUDAH warning biasa");
});

test("ambang peringatan sama dengan ambang penolakan render", () => {
  // Tidak ada yang lebih membingungkan daripada layar yang bilang "aman" lalu
  // mesin yang bilang "poster".
  const dl = readFileSync(join(process.cwd(), "lib/product-image-download.ts"), "utf8");
  const fp = readFileSync(join(process.cwd(), "lib/media/foto-produk.ts"), "utf8");
  const ambangRender = /AMBANG_KATA_BANNER\s*=\s*(\d+)/.exec(fp)?.[1];
  const ambangIntake = /const AMBANG\s*=\s*(\d+)/.exec(dl)?.[1];
  assert.ok(ambangRender && ambangIntake, "ambang tidak ditemukan");
  assert.equal(ambangIntake, ambangRender, "ambang intake beda dari ambang render");
});
