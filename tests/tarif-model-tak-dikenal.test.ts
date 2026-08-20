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
});

test("model yang DIKENAL tetap memakai tarifnya sendiri", () => {
  const mini = hitungBiayaUntukUji("dreamina-seedance-2-0-mini-260615", undefined, 5, "720p");
  const penuh = hitungBiayaUntukUji("dreamina-seedance-2-0-260128", undefined, 5, "720p");
  assert.ok(penuh.idr > mini.idr * 3, `tarif mini dan penuh tertukar: mini Rp${mini.idr}, penuh Rp${penuh.idr}`);
});
