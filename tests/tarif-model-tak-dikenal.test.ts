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

test("SATU TARIF untuk semua dreamina — model berhenti menentukan biaya", () => {
  // ASERSI INI SUDAH DUA KALI SALAH, DAN KEDUANYA MENARIK.
  //
  // Mula-mula ia menuntut `penuh > mini * 3`, diambil dari tarif/detik lama
  // ($0,034 vs $0,143 = 4,21x). Lalu ia dipatok 2,11x, sesudah satuannya
  // dibetulkan jadi token. Tagihan Agustus 2026 membatalkan dua-duanya:
  // tarifnya SATU, $4,41/1M untuk seluruh akun. Selisih tarif antar model
  // dreamina tidak pernah ada — ia sepenuhnya artefak dua angka BRD yang
  // diturunkan dari kasus dengan MODE berbeda.
  //
  // Jadi yang dijaga sekarang kebalikannya: model TIDAK boleh membedakan biaya.
  const tok = 324_900;
  const mini = hitungBiayaUntukUji("dreamina-seedance-2-0-mini-260615", tok, 15, "720p");
  const penuh = hitungBiayaUntukUji("dreamina-seedance-2-0-260128", tok, 15, "720p");
  const duaLima = hitungBiayaUntukUji("dreamina-seedance-2-5-260628", tok, 15, "720p");
  assert.equal(mini.idr, penuh.idr, "model masih membedakan biaya — tarif turunan BRD hidup lagi");
  assert.equal(mini.idr, duaLima.idr);
  for (const h of [mini, penuh, duaLima]) assert.equal(h.asalTarif, "tagihan");
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

test("tidak ada tarif TURUNAN atau BROSUR yang tersisa di jalur produksi", () => {
  // Kedua kelas itu pernah menyesatkan harga jual kita: turunan-cogs melingkar
  // (kerendahan 2,7x), brosur tidak berlaku untuk akun kita (ketinggian 1,5x
  // dan 2,4x). Yang boleh menentukan margin cuma tagihan.
  for (const m of [
    "dreamina-seedance-2-0-mini-260615",
    "dreamina-seedance-2-0-260128",
    "dreamina-seedance-2-5-260628",
  ]) {
    const h = hitungBiayaUntukUji(m, 648_900, 15, "720p");
    assert.equal(h.asalTarif, "tagihan", `${m} masih memakai tarif ${h.asalTarif}`);
  }
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
