// MODEL TAK DIKENAL DITAKSIR MAHAL, BUKAN MURAH.
//
// Ditemukan 20 Agu dari daftar task BytePlus nyata: akun memakai
// `dreamina-seedance-2-5-260628` yang tidak ada di MODEL_RATES. Fallback lama
// jatuh ke tarif termurah di tabel (0,01 USD/dtk), jadi 300 detik render model
// kelas atas tercatat ~Rp49.000 alih-alih ratusan ribu.
//
// Yang membuatnya berbahaya: anggaran canary dan stop-rule membaca angka ini.
// Taksiran terlalu murah = cap Rp250.000 terlampaui tanpa gerbang menyadarinya.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-tarif-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-tarif-storage-${process.pid}`;

const { hitungBiayaUntukUji } = await import("../lib/providers/stubs/byteplus");

test("model TAK DIKENAL ditaksir dengan tarif tertinggi, bukan terendah", () => {
  const takDikenal = hitungBiayaUntukUji("model-yang-belum-pernah-ada", undefined, 300, "720p");
  const termurah = hitungBiayaUntukUji("seedance-1-0-lite-i2v-250428", undefined, 300, "480p");
  assert.ok(
    takDikenal.idr > termurah.idr * 3,
    `model tak dikenal ditaksir Rp${takDikenal.idr} — terlalu dekat dengan tarif termurah Rp${termurah.idr}; ` +
      "stop-rule anggaran akan melewatkan pemakaian mahal"
  );
  assert.equal(takDikenal.estimated, true, "taksiran harus mengaku dirinya taksiran");
  assert.equal(takDikenal.dasar, "tarif-tertinggi");
});

test("model yang DIKENAL tetap memakai tarifnya sendiri", () => {
  const mini = hitungBiayaUntukUji("dreamina-seedance-2-0-mini-260615", undefined, 5, "720p");
  const penuh = hitungBiayaUntukUji("dreamina-seedance-2-0-260128", undefined, 5, "720p");
  assert.ok(penuh.idr > mini.idr, `tarif mini dan penuh tertukar: mini Rp${mini.idr}, penuh Rp${penuh.idr}`);

  // ASERSI INI DULU BERBUNYI `> mini.idr * 3`, DAN ANGKA 3 ITU KELIRU.
  //
  // Ia diambil dari tarif/detik lama ($0,034 vs $0,143 = 4,21x). Tapi kedua
  // angka itu diturunkan dari kasus yang MODE-nya berbeda: BRD menurunkan mini
  // dari render TANPA referensi (324.900 token) dan 2.0 penuh dari render
  // DENGAN reference_video (648.900 token). Jadi 4,21x adalah selisih tarif
  // DIKALI selisih mode, dilaporkan seolah selisih model.
  //
  // Pada mode yang sama, jaraknya 2,11x. Separuh dari "mini jauh lebih murah"
  // selama ini adalah mode, bukan model — dan itu bukan test yang dilonggarkan
  // untuk lolos, itu angka yang baru bisa dilihat sesudah satuannya benar.
  const rasio = penuh.idr / mini.idr;
  assert.ok(
    rasio > 2.0 && rasio < 2.25,
    `jarak tarif mini vs 2.0 penuh pada MODE YANG SAMA harus ~2,11x, terukur ${rasio.toFixed(2)}x`
  );
});

test("TOKEN NYATA mengalahkan tarif/detik — dua mode berhenti dilaporkan sama", () => {
  // INI CACAT YANG DIPERBAIKI. Sebelum 26 Agu, kedua render di bawah dilaporkan
  // Rp8.313 — angka yang IDENTIK — karena tarif/detik hanya melihat durasi.
  // Padahal tokennya beda dua kali lipat, dan tagihan menghitung token.
  const M = "dreamina-seedance-2-0-mini-260615";
  const tanpaRef = hitungBiayaUntukUji(M, 324_900, 15, "720p");
  const denganRef = hitungBiayaUntukUji(M, 648_900, 15, "720p");

  assert.equal(tanpaRef.dasar, "token-nyata");
  assert.equal(denganRef.dasar, "token-nyata");
  assert.ok(
    denganRef.idr > tanpaRef.idr * 1.9,
    `reference_video menggandakan token tapi biaya cuma naik dari Rp${tanpaRef.idr} ke Rp${denganRef.idr} — ` +
      "jalur biaya kembali buta terhadap mode"
  );
  // Token dibawa keluar, bukan dibuang: tanpa ini tagihan tidak punya lawan
  // untuk dicocokkan.
  assert.equal(denganRef.totalTokens, 648_900, "total_tokens hilang dari hasil — rekonsiliasi tagihan mustahil");
});

test("tarif MELINGKAR mengaku dirinya melingkar", () => {
  // Tarif token kedua model 2.0 dibalik DARI asumsi COGS BRD. Kalau asalnya
  // tidak ikut terbawa, angka ini akan dikutip sebagai kalau-kalau ia tarif.
  const mini = hitungBiayaUntukUji("dreamina-seedance-2-0-mini-260615", 324_900, 15, "720p");
  assert.equal(mini.asalTarif, "turunan-cogs");
  const duaLima = hitungBiayaUntukUji("dreamina-seedance-2-5-260628", 648_900, 15, "720p");
  assert.equal(duaLima.asalTarif, "publik", "tarif brosur 2.5 tidak boleh tertukar jadi turunan COGS");
});

test("resolusi yang BELUM diukur jatuh ke tarif/detik, dan jatuhnya ditandai", () => {
  // 480p dan 1080p belum diukur per-mode di akun ini. Yang penting bukan
  // angkanya, tapi bahwa hasilnya MENGAKU buta mode alih-alih menyamar sebagai
  // hitungan token.
  const h = hitungBiayaUntukUji("seedance-1-0-pro-fast-251015", undefined, 15, "480p");
  assert.equal(h.dasar, "tarif-per-detik");
  assert.equal(h.estimated, true);
  assert.equal(h.totalTokens, undefined);
});
