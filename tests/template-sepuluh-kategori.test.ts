// SEPULUH TEMPLATE TERBAIK PER KATEGORI (keputusan Brian, 9 Sep 2026).
//
// "tampilkan 10 katalog terbaik kategori saja dan narasinya bisa ditambahkan
//  yang memancing engagement pengguna seperti X dari 60 pemenang"
//
// Yang dijaga tes ini bukan cuma jumlahnya. Sampai hari ini retail hanya
// melihat TIGA preset, sementara 28 template kampanye menganggur — dan yang
// menahannya adalah kartu berbunyi "X dari 110 video pemenang", angka yang
// TIDAK berlaku untuk template kampanye. Meminjamkan angka itu akan membuat
// aplikasi mengklaim bukti yang tidak pernah ada, kepada penjual yang
// memakainya untuk memutuskan belanja.
//
// Jadi tes ini menuntut dua hal sekaligus: daftarnya panjang DAN tiap kartu
// membawa angkanya sendiri.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { templateTeratas, semuaTemplatePilihan, PEMENANG_DIBEDAH } from "../lib/template-pilihan";
import terbukti from "../lib/config/template-terbukti.json";

test("sepuluh template, bukan tiga", () => {
  for (const kat of ["beauty", "food", "fashion", "otomotif", "gadget", "kategori-yang-belum-ada"]) {
    assert.equal(templateTeratas(kat).length, 10, `kategori ${kat}`);
  }
});

test("yang cocok kategori didahulukan", () => {
  const daftar = templateTeratas("beauty");
  const cocok = (t: (typeof daftar)[number]) => t.bestFor.length === 0 || t.bestFor.includes("beauty");
  const indeksTidakCocok = daftar.findIndex((t) => !cocok(t));
  if (indeksTidakCocok >= 0) {
    // Kalau ada yang tidak cocok, ia harus di BAWAH semua yang cocok.
    assert.ok(daftar.slice(indeksTidakCocok).every((t) => !cocok(t)), "urutan kategori tercampur");
  }
});

test("kategori otomotif punya template yang memang cocok, bukan sisa abjad", () => {
  // Produk Brian yang gagal adalah pengkilap kendaraan. Sebelum ini tidak ada
  // satu pun template menandai otomotif, jadi urutannya jatuh ke abjad dan
  // teratasnya adalah "Atap Jebol" — template tontonan untuk pengkilap motor.
  const daftar = templateTeratas("otomotif");
  const kampanye = daftar.filter((t) => !t.preset);
  assert.ok(kampanye.length > 0, "tidak ada template kampanye untuk otomotif");
  assert.ok(
    kampanye.every((t) => t.bestFor.includes("otomotif")),
    `masih ada template yang tidak menandai otomotif: ${kampanye.filter((t) => !t.bestFor.includes("otomotif")).map((t) => t.name).join(", ")}`,
  );
});

test("tiap kartu membawa ANGKA BUKTINYA SENDIRI — tidak ada yang dipinjam", () => {
  const semua = semuaTemplatePilihan();
  const preset = semua.filter((t) => t.preset);
  const kampanye = semua.filter((t) => !t.preset);
  assert.ok(preset.length > 0 && kampanye.length > 0, "salah satu sumber kosong");

  // Preset lama: studi korelasi GMV atas 110 video pemenang.
  for (const t of preset) {
    assert.match(t.bukti, new RegExp(`dari ${terbukti.total_winners} video pemenang`), t.name);
  }
  // Template kampanye: 12 video pemenang yang DIBEDAH shot demi shot. Angka
  // 110 tidak boleh muncul di sini — itu studi yang lain.
  for (const t of kampanye) {
    assert.match(t.bukti, new RegExp(`${PEMENANG_DIBEDAH} video pemenang`), t.name);
    assert.ok(
      !t.bukti.includes(String(terbukti.total_winners)),
      `template kampanye "${t.name}" meminjam angka studi preset: ${t.bukti}`,
    );
  }
});

test("urutannya total — kartu tidak berpindah sendiri antar render", () => {
  const a = templateTeratas("beauty").map((t) => t.id);
  const b = templateTeratas("beauty").map((t) => t.id);
  assert.deepEqual(a, b);
});

test("halaman benar-benar memakai daftar gabungan, termasuk keluarga hook-nya", () => {
  const src = readFileSync(new URL("../app/bikin/gaya/page.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.match(src, /templateTeratas\(p\.category\)/, "daftar tidak disaring kategori produk");
  assert.match(src, /daftarTemplate\.map/, "kartu masih dari sumber lama");
  assert.match(src, /\{t\.bukti\}/, "badge tidak memakai narasi bukti per kartu");
  // Cacat yang mudah tertinggal: keluarga hook diambil dari preset lama saja,
  // sehingga template kampanye terkirim tanpa bagian yang membuatnya template.
  assert.match(src, /hook_families: daftarTemplate\.find/, "keluarga hook tidak diambil dari daftar gabungan");
});
