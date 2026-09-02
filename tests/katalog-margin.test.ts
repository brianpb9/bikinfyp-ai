// MARGIN KATALOG — dijaga tes, bukan diperiksa dengan mata.
//
// Harga dan isi paket adalah tempat kerugian bersembunyi paling lama: tidak
// ada yang gagal ketika sebuah paket dijual di bawah biaya, dan yang menemukan
// biasanya laporan akhir bulan. Berkas ini membuat pelanggarannya berbunyi
// saat itu juga.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-katalog-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-katalog-storage-${process.pid}`;

const {
  PAKET_REKOMENDASI, HARGA_SATUAN, MARGIN_MINIMUM,
  hitungPaket, marginSatuan, modalPerVideo,
  BEBAN_GAGAL, BEBAN_TETAP_PER_VIDEO_IDR, BIAYA_GATEWAY_IDR,
} = await import("../lib/katalog-rekomendasi");
const { config } = await import("../lib/config");
const { JENIS_VIDEO } = await import("../lib/kredit-video");

test("tidak ada paket yang dijual di bawah margin minimum", () => {
  for (const p of PAKET_REKOMENDASI) {
    const h = hitungPaket(p);
    assert.ok(
      h.marginPersen >= MARGIN_MINIMUM,
      `paket ${p.nama}: margin ${(h.marginPersen * 100).toFixed(1)}% — jual ${p.hargaIdr}, modal ${h.modalIdr}`,
    );
  }
});

test("tidak ada harga satuan yang dijual di bawah margin minimum", () => {
  for (const j of JENIS_VIDEO) {
    assert.ok(
      marginSatuan(j) >= MARGIN_MINIMUM,
      `${j}: margin ${(marginSatuan(j) * 100).toFixed(1)}% — jual ${HARGA_SATUAN[j]}, modal ${modalPerVideo(j)}`,
    );
  }
});

test("paket SELALU lebih murah per video daripada beli satuan", () => {
  // Kalau tidak, paket adalah hukuman bagi yang membeli banyak — dan pembeli
  // yang menghitung akan menemukannya.
  for (const p of PAKET_REKOMENDASI) {
    const h = hitungPaket(p);
    assert.ok(
      p.hargaIdr < h.nilaiSatuanIdr,
      `paket ${p.nama} (${p.hargaIdr}) tidak lebih murah daripada beli satuan (${h.nilaiSatuanIdr})`,
    );
    // Diskonnya harus TERASA. Hemat 3% tidak akan pernah mengubah keputusan
    // siapa pun, tapi tetap memotong margin kita.
    assert.ok(h.hematPersen >= 0.15, `paket ${p.nama}: hemat cuma ${(h.hematPersen * 100).toFixed(0)}%`);
  }
});

test("modal dihitung dari COGS terukur, dan bebannya tidak diam-diam nol", () => {
  // Yang dijaga: seseorang menaikkan margin di atas kertas dengan mengecilkan
  // beban, bukan dengan menurunkan biaya sungguhan.
  assert.ok(BEBAN_GAGAL >= 0.05, "beban render gagal dinolkan — kita tetap membayar klip yang tidak lolos QC");
  assert.ok(BEBAN_TETAP_PER_VIDEO_IDR > 0, "biaya naskah dan penyimpanan dinolkan");
  assert.ok(BIAYA_GATEWAY_IDR > 0, "biaya gateway dinolkan — pada paket Rp50.000 ia 8% dari pendapatan");

  for (const j of JENIS_VIDEO) {
    const cogs = config.tiers[j].cogsIdr;
    assert.ok(cogs > 0, `${j}: cogsIdr nol — mesin tanpa biaya akan terlihat paling untung`);
    assert.ok(modalPerVideo(j) > cogs, `${j}: beban tidak ikut dihitung`);
  }
});

test("COGS Premium dan Ultra SAMA — selisih harganya keputusan posisi, bukan biaya", () => {
  // Diukur langsung ke BytePlus 2 Sep 2026: 2.0-mini dan 2.5 sama-sama
  // menghabiskan 87.300 token untuk klip 4 detik 720p. Kalau suatu saat
  // seseorang membedakan cogsIdr keduanya, ia harus punya pengukuran baru —
  // bukan asumsi bahwa model yang lebih baru pasti lebih mahal.
  assert.equal(config.tiers.premium.cogsIdr, config.tiers.ultra.cogsIdr);
  assert.ok(
    HARGA_SATUAN.ultra > HARGA_SATUAN.premium,
    "Ultra tidak lagi dijual lebih mahal — posisinya hilang tanpa penghematan biaya apa pun",
  );
});

test("Standard jauh lebih murah daripada Premium — itu keunggulan yang nyata", () => {
  // Mesin lain di pasar yang memakai Seedance berbiaya sekelas Premium kita.
  // Kalau selisih ini menyempit, keunggulan harga Standard hilang dan strategi
  // paket masuk Rp50.000 ikut runtuh.
  const rasio = config.tiers.premium.cogsIdr / config.tiers.standard.cogsIdr;
  assert.ok(rasio >= 4, `Standard cuma ${rasio.toFixed(1)}x lebih murah daripada Premium`);
});

test("paket masuk tetap Rp50.000 dan berisi minimal 5 video", () => {
  // Titik masuk yang diminta Brian. Paket masuk yang isinya dua-tiga video
  // terasa seperti sampel, bukan paket.
  const masuk = PAKET_REKOMENDASI.reduce((a, b) => (a.hargaIdr <= b.hargaIdr ? a : b));
  assert.equal(masuk.hargaIdr, 50_000);
  assert.ok(hitungPaket(masuk).totalVideo >= 5, "paket masuk terlalu tipis");
});

test("harga naik seiring isinya, tanpa pembalikan", () => {
  const urut = [...PAKET_REKOMENDASI].sort((a, b) => a.hargaIdr - b.hargaIdr);
  for (let i = 1; i < urut.length; i++) {
    const kecil = hitungPaket(urut[i - 1]);
    const besar = hitungPaket(urut[i]);
    assert.ok(
      besar.totalVideo > kecil.totalVideo,
      `${urut[i].nama} lebih mahal daripada ${urut[i - 1].nama} tapi tidak memberi lebih banyak video`,
    );
  }
});
