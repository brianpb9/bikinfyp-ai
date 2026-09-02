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
  PAKET_REKOMENDASI, HARGA_SATUAN, MARGIN_MINIMUM, MARGIN_TARGET, MARGIN_SATUAN,
  hitungPaket, marginSatuan, modalPerVideo, targetMarginPaket,
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

test("paket MENCAPAI target margin per jenis, bukan sekadar lewat batas bawah", () => {
  // 20% untuk Standard dan Premium, 30% untuk Ultra (keputusan Brian
  // 2 Sep 2026). Paket campuran memakai target tertimbang menurut porsi modal.
  // Arahnya penting: harga dibulatkan ke ATAS ke kelipatan Rp5.000, jadi
  // margin tidak pernah jatuh di bawah target — hanya sedikit melewatinya.
  // Batas atas 2,5% menjaga pembulatan tidak berubah jadi kenaikan harga
  // diam-diam.
  for (const p of PAKET_REKOMENDASI) {
    const target = targetMarginPaket(p.kuota);
    const nyata = hitungPaket(p).marginPersen;
    assert.ok(nyata >= target - 0.001, `paket ${p.nama}: margin ${(nyata * 100).toFixed(1)}% DI BAWAH target ${(target * 100).toFixed(1)}%`);
    assert.ok(nyata <= target + 0.025, `paket ${p.nama}: margin ${(nyata * 100).toFixed(1)}% jauh di atas target ${(target * 100).toFixed(1)}% — pembulatan jadi kenaikan harga`);
  }
});

test("target margin Ultra memang lebih tinggi daripada Standard dan Premium", () => {
  assert.equal(MARGIN_TARGET.standard, 0.20);
  assert.equal(MARGIN_TARGET.premium, 0.20);
  assert.equal(MARGIN_TARGET.ultra, 0.30);
});

test("margin satuan SELALU di atas target paket — kalau tidak, paket bukan diskon", () => {
  for (const j of Object.keys(MARGIN_TARGET) as (keyof typeof MARGIN_TARGET)[]) {
    assert.ok(
      MARGIN_SATUAN[j] > MARGIN_TARGET[j],
      `${j}: margin satuan ${MARGIN_SATUAN[j]} tidak di atas target paket ${MARGIN_TARGET[j]}`,
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
  // Mesin lain di pasar yang memakai Seedance berbiaya sekelas Premium kita;
  // Standard-lah yang membuat titik masuk kita mungkin. Rasionya MENYEMPIT
  // dari 6,5x ke 3,5x saat 720p jadi bawaan (Grok 480p Rp3.600 -> 720p
  // Rp6.750), dan itu memang harga dari keputusan kualitas. Kalau ia menyempit
  // lagi di bawah 3x, paket masuk berhenti masuk akal dan strateginya harus
  // ditinjau, bukan dibiarkan.
  const rasio = config.tiers.premium.cogsIdr / config.tiers.standard.cogsIdr;
  assert.ok(rasio >= 3, `Standard cuma ${rasio.toFixed(1)}x lebih murah daripada Premium`);
});

test("paket masuk berisi minimal 5 video dan hematnya terasa", () => {
  // Titik masuknya TIDAK lagi dipaku Rp50.000: sejak 720p jadi bawaan, modal
  // Standard naik dari Rp3.600 ke Rp6.750, dan Rp50.000 hanya cukup untuk 4
  // video pada margin 20% — paket sebesar itu nyaris tidak lebih murah
  // daripada membeli satuan. Yang dijaga sekarang adalah SIFATNYA: cukup isi
  // untuk terasa seperti paket, dan cukup hemat untuk layak dipilih.
  const masuk = PAKET_REKOMENDASI.reduce((a, b) => (a.hargaIdr <= b.hargaIdr ? a : b));
  const h = hitungPaket(masuk);
  assert.ok(h.totalVideo >= 5, `paket masuk cuma ${h.totalVideo} video — terasa seperti sampel`);
  assert.ok(h.hematPersen >= 0.15, `paket masuk cuma hemat ${(h.hematPersen * 100).toFixed(0)}%`);
});

test("semua video 15 detik 720p — yang membedakan paket adalah MODEL", async () => {
  const { config } = await import("../lib/config");
  const { KUALITAS } = await import("../lib/kualitas-video");
  for (const j of JENIS_VIDEO) {
    assert.equal(config.tiers[j].resolution, "720p", `${j} bukan 720p — modalnya sudah dihitung untuk 720p`);
    assert.equal(KUALITAS[j].resolusi, "720p", `${j} dipajang bukan 720p — layar dan biaya jadi bercerita beda`);
  }
  // Dan modelnya memang berbeda — kalau sama, tiga paket menjual barang yang sama.
  const model = JENIS_VIDEO.map((j) => KUALITAS[j].model);
  assert.equal(new Set(model).size, model.length, "ada dua jenis video yang memakai model yang sama");
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

test("harga acuan di config sama dengan katalog yang dihitung", () => {
  // config.tiers.priceIdr dipakai laporan dan riwayat, sementara harga yang
  // DITAGIH datang dari harga_kredit_video yang diisi dari katalog ini. Kalau
  // keduanya berbeda, laporan margin akan menghitung untung dari angka yang
  // tidak pernah dibayar siapa pun.
  //
  // config tidak bisa mengimpor katalog (katalog yang mengimpor config), jadi
  // angkanya memang harus ditulis dua kali — dan tes inilah yang menjaganya.
  for (const j of JENIS_VIDEO) {
    assert.equal(
      config.tiers[j].priceIdr,
      HARGA_SATUAN[j],
      `${j}: config menulis ${config.tiers[j].priceIdr}, katalog menghitung ${HARGA_SATUAN[j]}`,
    );
  }
});
