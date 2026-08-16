// Kamus salah ucap: kata yang dibacakan salah oleh TTS walau ejaannya benar.
//
// Ini kelas cacat yang TIDAK bisa ditangkap alat cek berbasis model. Sumbernya
// mencatat tiga kali berturut-turut Gemini melaporkan audionya bersih padahal
// tidak — model bahasa cenderung MEMPERBAIKI input yang cacat, jadi justru buta
// terhadap cacat yang sedang dicari. Yang berhasil hanya membanding kata per
// kata lawan naskah acuan.
//
// Maka pencegahannya di sini: jangan pernah menulis kata yang bentuknya rawan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { KAMUS_SALAH_UCAP, temuanSalahUcap } from "../lib/script-engine/kamus-ucap";
import { TEMPLATE_COPY, TEMPLATE_COPY_CAPACITY } from "../lib/script-engine/template-copy";
import { REGISTERS } from "../lib/script-engine/registers";

test("kata yang terbukti salah ucap terdeteksi beserta penggantinya", () => {
  const hasil = temuanSalahUcap("Kakinya lecet setelah jalan jauh.");
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].kata, "lecet");
  assert.match(hasil[0].saran, /luka/);
});

test("kata aman tidak ikut tertuduh", () => {
  // Semuanya bersuku kata tertutup, semuanya terbukti lolos uji dengar. Sebuah
  // heuristik "suku kata tertutup = rawan" akan menuduh seluruh baris ini.
  assert.deepEqual(temuanSalahUcap("Masuk, banget, cukup, ringan, tebal, gerak, enak."), []);
});

test("tabrakan konsonan sesudah akhiran -nya terdeteksi", () => {
  const hasil = temuanSalahUcap("cek detailnya di bawah ya");
  assert.equal(hasil.length, 1);
  assert.match(hasil[0].saran, /detailnya ada di/);
});

test("pencocokan memakai batas kata, bukan potongan", () => {
  // "berlecetan" bukan entri kamus; menandainya berarti tuduhan palsu.
  assert.deepEqual(temuanSalahUcap("kata berlecetan bukan entri kamus"), []);
});

test("setiap entri kamus menyimpan sebabnya", () => {
  for (const entri of KAMUS_SALAH_UCAP) {
    assert.ok(entri.sebab.length > 10, `${entri.kata}: sebab kosong — tanpa itu kamus cuma catatan, bukan alat menebak kata rawan berikutnya`);
    assert.notEqual(entri.kata, entri.ganti);
  }
});

// Gerbang katalog SENGAJA hanya berdiri di atas kata tabel, bukan pola
// tabrakan "-nya di".
//
// Alasannya terukur, bukan selera. Pola itu muncul 39 kali di 23 dari 33
// template — ia bentuk baku CTA afiliasi kita ("...nya di keranjang kuning").
// Sementara buktinya berasal dari audio bawaan Seedance, dan hampir seluruh
// katalog justru disuarakan Gemini TTS yang MENIMPA audio model; hanya jalur
// presenter-lipsync (super_hq + talking_head) yang mempertahankannya.
//
// Menulis ulang 39 CTA berdasarkan bukti dari mesin yang tidak menyuarakannya
// adalah cacat yang sama yang sedang diperbaiki di repo ini: alat ukur yang
// percaya diri tanpa bukti. Temuannya dilaporkan scripts/lint-ucap.ts, dan
// keputusan memperbaikinya milik pemilik produk.
//
// Kata tabel beda urusan: "lecet" dan "tumit" bentuknya memang rawan di TTS
// mana pun, penggantinya sepadan, dan katalog sekarang bersih — jadi gerbang
// ini menjaga supaya tetap begitu.
test("tidak ada naskah katalog yang memakai kata rawan ucap", () => {
  const ctx = {
    reg: REGISTERS.bestie, harga: "85 ribu", produk: "Serum Wardah", noun: "skincare",
    pain: "kusamnya", proof: "teksturnya", space: "Meja rias",
    aktivitas: "skincare-an malem", identitas: "tim glowing",
  };
  const pelanggaran: string[] = [];
  for (const [id, varian] of Object.entries(TEMPLATE_COPY)) {
    for (let i = 0; i < TEMPLATE_COPY_CAPACITY; i++) {
      const c = varian[i](ctx);
      const kataTabel = new Set(KAMUS_SALAH_UCAP.map((e) => e.kata));
      for (const t of temuanSalahUcap(`${c.hook} ${c.demo} ${c.cta}`)) {
        if (kataTabel.has(t.kata)) pelanggaran.push(`${id}#${i}: "${t.kata}" — ${t.saran}`);
      }
    }
  }
  assert.deepEqual(pelanggaran, [], `naskah memakai kata rawan ucap:\n${pelanggaran.join("\n")}`);
});
