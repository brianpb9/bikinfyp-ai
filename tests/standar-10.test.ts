// STANDAR 10/10 (knowledge/rules/standard-10.md) sebagai tes.
//
// Fixture-nya BUKAN karangan: delapan contoh di §C adalah empat ide yang sudah
// diproduksi dan lulus, plus empat yang ditolak beserta alasannya. Contoh yang
// gagal jauh lebih berharga daripada yang lulus — pemeriksa yang cuma
// meloloskan contoh baik tidak membuktikan apa pun.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-std-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-std-storage-${process.pid}`;
process.env.SCRIPT_LLM = "0";

const {
  BARIS_10, BARIS_CAP, batasKataShot, kataPerShot, kategoriJenuh,
  levelHookCukup, nilaiBarisIde, payoffBukanKatalog, skor12, ujiCepatGenre,
  ujiTukarProduk, variasiKatalog, anomaliTanpaKata,
} = await import("../lib/script-engine/standar-10");
const { periksaPemicu } = await import("../lib/media/pemicu-filter");
const { blokStandar } = await import("../lib/script-engine/standar-10-teks");

// ---------------------------------------------------------------------------
// §C — empat contoh LULUS
// ---------------------------------------------------------------------------
const LULUS = [
  {
    nama: "Disimpan di brankas (JJ Glow, L4, forbidden)",
    contentType: "affiliate" as const,
    one_liner: "Serumnya aku simpan di brankas, bukan di meja rias",
    human_situation: "Dia buka brankas pagi-pagi, isinya cuma satu botol serum",
    mechanic: "forbidden",
    why_stop: "orang melihat brankas dibuka dan menunggu isinya apa",
    hookLevel: "agak_gila" as const,
    productName: "JJ Glow Serum",
    productCategory: "beauty",
  },
  {
    nama: "POV dari dalam kantong belanja (JJ Glow, L4, anomaly_pov)",
    contentType: "affiliate" as const,
    one_liner: "POV kamu di dalam kantong belanja pas serumnya dimasukin",
    human_situation: "Tangan memasukkan belanjaan satu per satu, kamera di dasar kantong",
    mechanic: "anomaly_pov",
    why_stop: "sudut yang belum pernah dipakai di kategori ini",
    hookLevel: "agak_gila" as const,
    productName: "JJ Glow Serum",
    productCategory: "beauty",
  },
  {
    nama: "Odol di meja meeting (MW-3, L4, contrast)",
    contentType: "ads" as const,
    one_liner: "Odol berdiri di tengah meja meeting, tidak ada yang menyinggung",
    human_situation: "Rapat berjalan normal sementara satu tube berdiri di antara laptop",
    mechanic: "contrast",
    why_stop: "benda yang salah tempat dan tidak dijelaskan siapa pun",
    hookLevel: "agak_gila" as const,
    productName: "MW-3 Toothpaste",
    productCategory: "beauty",
  },
  {
    nama: "Odol yang disembunyikan dari suami (MW-3, L4, social_theft)",
    contentType: "ads" as const,
    // Versi FINAL-nya memang tidak menyebut kamar mandi: penyebutan itu persis
    // yang membuat versi sebelumnya ditolak penyaring (§C, contoh gagal 3).
    one_liner: "Odol itu berdiri di antara sendok, di laci dapur",
    human_situation: "Dia menaruh tube di laci dapur sebelum suaminya bangun",
    mechanic: "social_theft",
    why_stop: "penonton menebak kenapa odol ada di laci sendok",
    hookLevel: "agak_gila" as const,
    productName: "MW-3 Toothpaste",
    productCategory: "beauty",
  },
];

test("§C: empat contoh yang sudah lulus TIDAK ditolak pemeriksa mekanis", () => {
  for (const c of LULUS) {
    const { gagal } = nilaiBarisIde({
      ...c,
      pemicu: periksaPemicu(`${c.one_liner}. ${c.human_situation}.`, { namaProduk: c.productName }).map((t) => t.cocok),
    });
    assert.deepEqual(gagal, [], `${c.nama}: ${JSON.stringify(gagal)}`);
    assert.equal(skor12(gagal).nilai, 10, c.nama);
  }
});

// ---------------------------------------------------------------------------
// §C — empat contoh GAGAL, masing-masing dengan sebabnya
// ---------------------------------------------------------------------------

test('§C gagal 1: "Aku ngopi terus" — generik, lolos uji tukar produk', () => {
  const hasil = ujiTukarProduk({
    one_liner: "Aku ngopi terus, jadi aku pakai ini tiap hari",
    productName: "MW-3 Toothpaste",
    productCategory: "beauty",
  });
  assert.equal(hasil.lolos, false, "kalimat ini bisa dipasang ke produk apa pun");
  // Pembanding: kalimat yang menyebut kategorinya LULUS.
  assert.equal(
    ujiTukarProduk({ one_liner: "Odol yang aku sembunyiin dari suami", productName: "MW-3 Toothpaste" }).lolos,
    true
  );
});

test('§C gagal 2: "Satu aku simpan di tas" — L1 di kategori jenuh', () => {
  const hasil = levelHookCukup({ hookLevel: "normal", productCategory: "beauty", productName: "MW-3 Toothpaste" });
  assert.equal(hasil.lolos, false);
  assert.match(hasil.sebab!, /L2/);
  // Kategori yang belum jenuh tidak dipaksa naik.
  assert.equal(levelHookCukup({ hookLevel: "normal", productCategory: "gadget", productName: "Kabel USB" }).lolos, true);
  assert.equal(kategoriJenuh({ productCategory: "beauty" }), true);
  assert.equal(kategoriJenuh({ productCategory: "gadget", productName: "Kabel USB" }), false);
});

test("§C gagal 3: versi CCTV — guilty + hurried + kelas handuk", () => {
  const temuan = periksaPemicu(
    "she hides the tube and glances left and right, hurried, before entering the bathroom with a towel",
    { namaProduk: "MW-3 Toothpaste" }
  );
  const cocok = temuan.map((t) => t.cocok.toLowerCase());
  for (const kata of ["hides", "hurried", "towel"]) {
    assert.ok(cocok.some((c) => c.includes(kata)), `"${kata}" tidak terdeteksi: ${JSON.stringify(cocok)}`);
  }
  assert.ok(temuan.some((t) => t.cocok.toLowerCase().includes("glances left and right")));
});

test("§C gagal 4: kamera di dalam botol — ide Ads yang menjual transaksi ditolak", () => {
  // Versi CGI-nya dijaga penaltiCgi (nativeness); yang dijaga DI SINI adalah
  // uji cepat §A: ide Ads yang masih berbicara belanja.
  const hasil = ujiCepatGenre({
    contentType: "ads",
    one_liner: "Kamera dari dalam botol pas lagi diskon 50 persen",
    human_situation: "Dia menuang serum sambil bilang harganya lagi turun",
  });
  assert.equal(hasil.lolos, false);
  assert.match(hasil.sebab[0], /Affiliate yang menyamar/);

  // Arah sebaliknya: ide Affiliate tanpa satu pun tindakan pribadi.
  const salahKamar = ujiCepatGenre({
    contentType: "affiliate",
    one_liner: "Odol berdiri di tengah meja meeting",
    human_situation: "Rapat berjalan normal sementara satu tube berdiri di antara laptop",
  });
  assert.equal(salahKamar.lolos, false);
  assert.match(salahKamar.sebab[0], /salah kamar/);
});

// ---------------------------------------------------------------------------
// Pemeriksa tingkat NASKAH
// ---------------------------------------------------------------------------

test("baris 4: kalimat shot 2 adalah alasan, bukan katalog", () => {
  assert.equal(payoffBukanKatalog({ teksShot2: "Isinya dua sabun batang" }).lolos, false);
  assert.equal(
    payoffBukanKatalog({ teksShot2: "Kalau ketahuan suami, habisnya dua kali lebih cepet" }).lolos,
    true
  );
  // Mekanik yang memang tentang tekstur dikecualikan — di sana bendanya payoff.
  assert.equal(payoffBukanKatalog({ teksShot2: "Teksturnya lumer pelan", mechanic: "transformation" }).lolos, true);
});

test("baris 9: batas kata per shot mengikuti durasi shot-nya", () => {
  assert.equal(batasKataShot(5), 10, "shot 5 detik: 10 kata (angka §B)");
  assert.equal(batasKataShot(20), 30, "shot 20 detik: 1,5 kata/detik");
  const panjang = [{ role: "hook", start: 0, end: 5, text: "satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas" }];
  assert.equal(kataPerShot(panjang as never).lolos, false);
  const pas = [{ role: "hook", start: 0, end: 5, text: "satu dua tiga empat lima enam tujuh delapan sembilan sepuluh" }];
  assert.equal(kataPerShot(pas as never).lolos, true);
});

test("baris 1: frame pertama harus punya start_state DAN product_state", () => {
  assert.equal(anomaliTanpaKata([{ role: "hook", start: 0, end: 4, text: "x", visual_direction: "" } as never]).lolos, false);
  assert.equal(
    anomaliTanpaKata([
      { role: "hook", start: 0, end: 4, text: "x", visual_direction: "", start_state: "The tube is standing between spoons in the drawer", product_state: "partial" } as never,
    ]).lolos,
    true
  );
});

test("baris 11: fungsinya bekerja, dan statusnya dicatat BELUM ditegakkan", () => {
  const riwayat = [
    { shot2: "Kalau ketahuan suami, habisnya dua kali lebih cepet", cta: "Detailnya ada di bawah ya" },
    { shot2: "Kalau ketahuan suami, habisnya dua kali lebih cepet", cta: "Detailnya ada di bawah ya" },
  ];
  assert.equal(variasiKatalog({ shot2: riwayat[0].shot2, cta: "Cek ya", riwayat }).lolos, false);
  assert.equal(variasiKatalog({ shot2: "Kalimat baru yang berbeda", cta: "Cek ya", riwayat }).lolos, true);
  // Statusnya jujur: belum ada riwayat per-talent yang tersimpan.
  assert.equal(BARIS_10.find((b) => b.no === 11)!.penegakan, "belum");
});

test("skor 12/12: cap 6 kalau baris kritis gagal", () => {
  assert.equal(skor12([]).nilai, 10);
  assert.equal(skor12([{ no: 3, sebab: "x" }]).nilai, 9);
  assert.equal(skor12([{ no: 3, sebab: "x" }, { no: 5, sebab: "y" }]).nilai, 8);
  // Baris 1/2/6/8 menahan di 6, berapa pun sisanya.
  for (const no of BARIS_CAP) {
    const s = skor12([{ no, sebab: "x" }]);
    assert.equal(s.nilai, 6, `baris ${no} harus menahan di 6`);
    assert.equal(s.capKritis, true);
  }
  assert.match(skor12([{ no: 3, sebab: "x" }]).garis, /11\/12/);
});

test("dokumen standar benar-benar terbaca dan ikut ke prompt", () => {
  const blok = blokStandar();
  assert.match(blok, /Ads dan Affiliate adalah dua produk berbeda/);
  assert.match(blok, /12 baris/);
  // Setiap baris punya status penegakan, dan yang bukan "kode" WAJIB beralasan.
  assert.equal(BARIS_10.length, 12);
  for (const b of BARIS_10) {
    if (b.penegakan !== "kode") assert.ok(b.catatan, `baris ${b.no} bukan kode tapi tidak menjelaskan kenapa`);
  }
});
