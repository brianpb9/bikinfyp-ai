// Katalog format: struktur beat dari preset Marketing Studio.
//
// Presetnya TIDAK PERNAH dipanggil (Marketing Studio menolak avatar lewat API);
// yang diambil strukturnya. Yang diuji di sini: berkasnya utuh, aturan
// pemasangan mekanik x format benar-benar DITEGAKKAN, dan contoh prompt dari
// katalog tidak bocor jadi few-shot penulis naskah.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.DB_PATH = `/tmp/racun-test-format-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-format-storage-${process.pid}`;

const { muatFormat, formatById, bolehPasangan, formatTersedia, muatPrior, FORMAT_DILARANG } =
  await import("../lib/script-engine/format-katalog");

test("tiga belas format termuat, semuanya lengkap", () => {
  const f = muatFormat();
  assert.equal(f.length, 13, `harus 8 format, dapat ${f.length}`);
  for (const x of f) {
    assert.ok(x.beat_table.length >= 3, `${x.id}: butuh tabel beat`);
    for (const b of x.beat_table) assert.ok(b.durasi > 0 && b.isi.length > 5, `${x.id} beat ${b.beat}`);
    // technique dan failure_mode adalah inti pengetahuannya — format tanpa
    // keduanya cuma daftar durasi, dan daftar durasi tidak menolong siapa pun.
    assert.ok(x.technique.length > 40, `${x.id}: technique terlalu tipis`);
    assert.ok(x.failure_mode.length > 40, `${x.id}: failure_mode terlalu tipis`);
    assert.equal(typeof x.no_face_recommended, "boolean");
  }
});

test("durasi tiap format konsisten dan masuk akal", () => {
  for (const f of muatFormat()) {
    const total = f.beat_table.reduce((a, b) => a + b.durasi, 0);
    assert.ok(total >= 15 && total <= 25, `${f.id}: total ${total} dtk di luar rentang wajar`);
  }
});

test("format ber-CGI hanya boleh di level tontonan", () => {
  // giant_figure adalah satu-satunya yang butuh CGI di katalog sekarang.
  const cgi = muatFormat().filter((f) => f.butuh_cgi).map((f) => f.id);
  assert.deepEqual(cgi, ["giant_figure"]);
  assert.equal(bolehPasangan({ formatId: "giant_figure", hookLevel: "normal" }).boleh, false);
  assert.equal(bolehPasangan({ formatId: "giant_figure", hookLevel: "berani" }).boleh, false);
  assert.equal(bolehPasangan({ formatId: "giant_figure", hookLevel: "agak_gila" }).boleh, true);
  assert.equal(bolehPasangan({ formatId: "giant_figure", hookLevel: "gila" }).boleh, true);
  // Sebabnya harus bisa dibaca manusia, bukan cuma false.
  assert.match(bolehPasangan({ formatId: "giant_figure", hookLevel: "normal" }).sebab ?? "", /CGI/);
});

test("format dua-orang dilarang total, di level mana pun", () => {
  for (const id of FORMAT_DILARANG) {
    for (const level of ["normal", "gila"]) {
      const p = bolehPasangan({ formatId: id, hookLevel: level });
      assert.equal(p.boleh, false, `${id} di level ${level} harus dilarang`);
      assert.match(p.sebab ?? "", /dua orang/);
    }
  }
});

test("format tanpa wajah DIUTAMAKAN untuk kategori tekstur/kebersihan", () => {
  const p = bolehPasangan({ formatId: "mess_to_fresh", productCategory: "home" });
  assert.equal(p.boleh, true);
  assert.equal(p.diutamakan, true);
  // Kategori lain tetap boleh, cuma tidak diutamakan.
  assert.equal(bolehPasangan({ formatId: "mess_to_fresh", productCategory: "gadget" }).diutamakan, false);
  // Yang berwajah tidak pernah diutamakan lewat jalur ini.
  assert.equal(bolehPasangan({ formatId: "tutorial", productCategory: "home" }).diutamakan, false);

  const urut = formatTersedia({ productCategory: "beauty" });
  const tanpaWajah = urut.findIndex((f) => f.no_face_recommended);
  const denganWajah = urut.findIndex((f) => !f.no_face_recommended);
  assert.ok(tanpaWajah < denganWajah, "yang tanpa wajah harus disebut lebih dulu untuk kategori tekstur");
});

test("format ber-CGI tidak muncul sama sekali di daftar level normal", () => {
  // Melarang SETELAH model mengusulkannya berarti membayar panggilan termahal
  // di pipeline untuk kandidat yang sudah pasti gugur.
  assert.equal(formatTersedia({ hookLevel: "normal" }).some((f) => f.butuh_cgi), false);
  assert.equal(formatTersedia({ hookLevel: "gila" }).some((f) => f.butuh_cgi), true);
});

test("format_prior memetakan sifat produk ke format yang ADA", () => {
  const prior = muatPrior();
  assert.ok(prior.length >= 8, `prior terlalu sedikit: ${prior.length}`);
  for (const p of prior) {
    assert.ok(formatById(p.format), `prior menunjuk format "${p.format}" yang tidak ada berkasnya`);
    assert.ok(p.sifat_produk.length > 5);
  }
});

test("contoh prompt katalog TIDAK bocor jadi few-shot penulis", () => {
  // Keputusan Brian 18 Agu: strukturnya diambil, kalimatnya tidak. Contoh
  // prompt yang bagus akan ditiru bentuknya, dan hasilnya delapan naskah yang
  // semuanya terdengar sama — persis kondisi yang sedang ditinggalkan.
  const jejakPrompt = [
    "[CAST-LOCK]", "[PRODUCT-LOCK]", "[STYLE-LOCK]",
    "Handheld video, single continuous take",
    "A fingernail runs slowly along the sealed edge",
  ];
  for (const f of fs.readdirSync(path.join(process.cwd(), "knowledge", "formats"))) {
    const isi = fs.readFileSync(path.join(process.cwd(), "knowledge", "formats", f), "utf8");
    for (const jejak of jejakPrompt) {
      assert.ok(!isi.includes(jejak), `${f} memuat potongan prompt contoh: "${jejak}"`);
    }
  }
});

test("knowledge mencatat bahwa preset TIDAK dipanggil lewat API", () => {
  const readme = fs.readFileSync(path.join(process.cwd(), "knowledge", "README.md"), "utf8");
  assert.match(readme, /tidak pernah memanggil preset/i);
  assert.match(readme, /does not support this parameter/);
  // Dan alasan contoh prompt tidak dipakai ikut tercatat, bukan cuma faktanya.
  assert.match(readme, /TIDAK dipakai sebagai few-shot/);
});

test("rules.md memuat empat aturan bahasa yang diminta", () => {
  const r = fs.readFileSync(path.join(process.cwd(), "knowledge", "rules.md"), "utf8");
  assert.match(r, /enunciating every word clearly/);
  assert.match(r, /OFF CAMERA/);
  assert.match(r, /NO face, NO head, NO shoulders/);
  assert.match(r, /crisp detailed ASMR sound design/);
  // Perbedaan dengan L-21 harus disebut, kalau tidak keduanya terbaca saling
  // bertentangan: "NO face" boleh, "no other residents" tidak.
  assert.match(r, /L-21/);
});
