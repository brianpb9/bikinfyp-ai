import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBrandApproach } from "../lib/brand-approach";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";
import { TIDAK_OTOMATIS } from "../lib/auto-pick";

// Rekomendasi ini diturunkan dari katalog template, bukan ditulis tangan —
// itu kelebihannya (ikut benar sendiri waktu katalog bertambah) sekaligus
// risikonya (bisa diam-diam jadi ngawur waktu katalog berubah). Tes di sini
// mengunci SIFAT yang harus tetap benar apa pun isi katalognya, bukan
// mengunci nama template tertentu — kalau dikunci ke nama, tesnya akan pecah
// tiap kali kami menambah template padahal tidak ada yang rusak.

const SEMUA_KATEGORI = [
  "beauty", "health", "fashion", "muslim_fashion", "food", "kitchen",
  "home", "gadget", "electronics", "kids", "jasa", "app", "toko", "default",
];

test("tiap kategori dapat tiga saran template, tanpa duplikat", () => {
  for (const kategori of SEMUA_KATEGORI) {
    const a = buildBrandApproach({ category: kategori });
    assert.equal(a.pakai.length, 3, `${kategori} tidak dapat 3 saran`);
    const id = a.pakai.map((t) => t.id);
    assert.equal(new Set(id).size, 3, `${kategori} punya saran duplikat`);
  }
});

test("kategori yang tidak dikenal tidak bikin crash, jatuh ke saran serbaguna", () => {
  const a = buildBrandApproach({ category: "kategori-yang-tidak-ada" });
  assert.equal(a.pakai.length, 3);
  assert.ok(a.kreator.label);
  assert.ok(a.klaim.aman.length > 0);
});

test("kategori kosong diperlakukan sebagai default, bukan error", () => {
  const a = buildBrandApproach({ category: "" });
  assert.equal(a.pakai.length, 3);
});

// Template klaim-hasil butuh rekaman sebelum-sesudah yang TIDAK boleh kami
// buatkan. Aturan yang sama sudah dipegang mode otomatis (TIDAK_OTOMATIS di
// lib/auto-pick.ts); kalau saran ke brand melanggarnya, kami menjanjikan
// sesuatu yang tidak bisa ditepati.
test("template klaim-hasil tidak pernah masuk daftar 'jalankan duluan'", () => {
  for (const kategori of SEMUA_KATEGORI) {
    const a = buildBrandApproach({ category: kategori });
    for (const t of a.pakai) {
      assert.ok(!TIDAK_OTOMATIS.includes(t.id), `${kategori} menyarankan ${t.id} yang butuh rekaman asli`);
    }
  }
});

// Ini cacat yang benar-benar terjadi waktu builder pertama kali dijalankan:
// kategori "jasa" disarankan "Atap Jebol" tepat di sebelah kalimat "level
// hook: Normal, karena jasa dibeli karena dipercaya". Kartunya membantah
// dirinya sendiri.
test("saran template tidak pernah dua tingkat lebih heboh dari level hook yang disarankan", () => {
  const urutan = ["normal", "agak_berani", "berani", "agak_gila", "gila"];
  for (const kategori of SEMUA_KATEGORI) {
    const a = buildBrandApproach({ category: kategori });
    const batas = urutan.indexOf(a.hookLevel.level);
    for (const saran of a.pakai) {
      const t = CAMPAIGN_TEMPLATES.find((x) => x.id === saran.id)!;
      assert.ok(
        urutan.indexOf(t.hookLevel) - batas < 2,
        `${kategori}: menyarankan "${t.name}" (${t.hookLevel}) padahal level yang disarankan ${a.hookLevel.level}`
      );
    }
  }
});

// Brand jasa tidak punya barang untuk diperagakan tangan. Peringatannya dulu
// tidak pernah muncul karena dicari hanya di antara template yang menyebut
// "jasa" di bestFor — dan tidak ada satu pun template hands_only yang
// menyebutnya. Peringatan yang tidak pernah muncul sama saja tidak ada.
test("brand tanpa barang fisik tidak disarankan format tangan", () => {
  for (const kategori of ["jasa", "app", "toko"]) {
    const a = buildBrandApproach({ category: kategori });
    for (const saran of a.pakai) {
      const t = CAMPAIGN_TEMPLATES.find((x) => x.id === saran.id)!;
      assert.notEqual(t.format, "hands_only", `${kategori} disarankan format tangan lewat "${t.name}"`);
    }
  }
});

test("setiap kategori punya daftar 'hindari' yang terisi dan beralasan", () => {
  for (const kategori of SEMUA_KATEGORI) {
    const a = buildBrandApproach({ category: kategori });
    assert.ok(a.hindari.length > 0, `${kategori} tidak punya satu pun saran hindari`);
    for (const h of a.hindari) {
      assert.ok(h.alasan.length > 30, `${kategori}: alasan "${h.name}" terlalu pendek untuk berguna`);
    }
  }
});

test("template yang disarankan tidak muncul juga di daftar hindari", () => {
  for (const kategori of SEMUA_KATEGORI) {
    const a = buildBrandApproach({ category: kategori });
    const dihindari = new Set(a.hindari.map((h) => h.name));
    for (const t of a.pakai) {
      assert.ok(!dihindari.has(t.name), `${kategori}: "${t.name}" disarankan sekaligus dihindari`);
    }
  }
});

test("rambu klaim selalu punya sisi aman dan sisi hati-hati", () => {
  for (const kategori of SEMUA_KATEGORI) {
    const a = buildBrandApproach({ category: kategori });
    assert.ok(a.klaim.aman.length >= 3, `${kategori}: daftar aman terlalu pendek`);
    assert.ok(a.klaim.hatiHati.length >= 2, `${kategori}: daftar hati-hati terlalu pendek`);
  }
});

// Kategori yang paling diawasi di Indonesia. Kalau rambunya jatuh ke default
// yang umum, brand kesehatan tidak pernah diperingatkan soal klaim mengobati.
test("kategori kesehatan diperingatkan soal klaim mengobati", () => {
  const a = buildBrandApproach({ category: "health" });
  const gabung = a.klaim.hatiHati.join(" ").toLowerCase();
  assert.ok(/obat|sembuh/.test(gabung), "rambu kategori health tidak menyebut klaim pengobatan");
  assert.equal(a.hookLevel.level, "normal", "kategori health tidak boleh disarankan hook heboh");
});
