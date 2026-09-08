// PESAN KEGAGALAN MENYEBUT SEBABNYA (Brian, produksi 8 Sep 2026).
//
// Job b95da10d gagal karena mesin video MENOLAK gambar acuan lewat filter
// otomatis mereka. Yang Brian baca: "Hasilnya belum bagus... Coba ganti
// fotonya ya." Fotonya tidak salah, dan tidak ada satu klip pun yang pernah
// dibuat. Ia disuruh memperbaiki sesuatu yang tidak rusak.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sebabDariAlasan, pesanKegagalan } from "../lib/pesan-kegagalan";

test("penolakan moderasi dikenali, bukan dianggap masalah mutu", () => {
  // Teks persis dari produksi.
  const nyata = "Semua provider video gagal: byteplus-ark-seedance: byteplus: HTTP 400: "
    + "The request failed because the input image 'content[3]' may contain sensitive information.";
  assert.equal(sebabDariAlasan(nyata), "moderasi_acuan");
});

test("moderasi menang atas 'penyedia', karena pesannya memang datang dari penyedia", () => {
  // Ini jebakan urutannya: teks yang sama memuat "byteplus" DAN "HTTP 400".
  // Mencocokkan pola penyedia lebih dulu menelan seluruh kasus moderasi, dan
  // pengguna kembali menerima pesan yang salah.
  const nyata = "byteplus: HTTP 400: input image may contain real person";
  assert.equal(sebabDariAlasan(nyata), "moderasi_acuan");
  assert.notEqual(sebabDariAlasan(nyata), "penyedia");
});

test("kegagalan ffmpeg disebut sebagai masalah KAMI", () => {
  const nyata = "/usr/bin/ffmpeg gagal (exit 1): Input link in0:v0 parameters (size 704x1280) do not match";
  assert.equal(sebabDariAlasan(nyata), "teknis_kami");
  assert.match(pesanKegagalan("teknis_kami"), /di sisi kami/);
});

test("hanya kegagalan MUTU yang menyuruh mengganti foto", () => {
  for (const s of ["moderasi_acuan", "teknis_kami", "penyedia", "tidak_diketahui"] as const) {
    assert.doesNotMatch(pesanKegagalan(s), /ganti fotonya/,
      `sebab "${s}" tidak boleh menyuruh mengganti foto`);
  }
  assert.match(pesanKegagalan("mutu"), /ganti fotonya/);
});

test("setiap pesan menyatakan kreditnya kembali", () => {
  // Itu hal pertama yang ingin diketahui orang yang videonya gagal.
  for (const s of ["moderasi_acuan", "teknis_kami", "penyedia", "mutu", "tidak_diketahui"] as const) {
    assert.match(pesanKegagalan(s), /kredit kamu sudah (kembali|kami balikin)/i, `sebab "${s}"`);
  }
});

test("alasan kosong tidak mengarang sebab", () => {
  assert.equal(sebabDariAlasan(null), "tidak_diketahui");
  assert.equal(sebabDariAlasan(""), "tidak_diketahui");
  assert.equal(sebabDariAlasan("   "), "tidak_diketahui");
});
