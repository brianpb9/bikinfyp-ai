// Mesin & model per paket ditentukan dari /admin, bukan dari kode.
//
// Permintaan Brian 4 Sep 2026: "pada halaman admin terdapat opsi mapping untuk
// package standard, premium dan ultra... sehingga memungkinkan ekspansi bisnis
// model apabila kedepan muncul efisiensi bisnis dengan perubahan model untuk
// setiap packagenya."
//
// Sampai kini mesin dan model dipaku di lib/kualitas-video.ts. Mengganti model
// Premium menuntut ubah kode, bangun image, dan deploy — dan deploy hari ini
// terbukti membunuh proses yang sedang berjalan. Keputusan yang sifatnya
// komersial tidak seharusnya menuntut rilis.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { KUALITAS } from "../lib/kualitas-video";
import { mesinBerlaku, modelBerlaku, periksaPemetaan, setPemetaanUntukUji } from "../lib/pemetaan-model";

const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

test("tanpa pemetaan tersimpan, bawaan kode yang berlaku", () => {
  // Fitur baru tidak boleh mengubah apa pun sampai ada yang memakainya.
  setPemetaanUntukUji(null);
  for (const k of ["standard", "premium", "ultra"] as const) {
    assert.equal(mesinBerlaku(k), KUALITAS[k].mesin, `${k}: mesin bawaan berubah`);
    assert.equal(modelBerlaku(k), KUALITAS[k].model, `${k}: model bawaan berubah`);
  }
});

test("pemetaan admin menang atas bawaan, dan hanya untuk paket yang diatur", () => {
  setPemetaanUntukUji([{ kualitas: "premium", mesin: "byteplus", model: "seedance-1-0-pro-250528" }]);
  assert.equal(modelBerlaku("premium"), "seedance-1-0-pro-250528");
  // Paket lain TIDAK ikut berubah — mengatur satu paket tidak boleh menyentuh
  // yang lain, karena itu justru cara perubahan tak sengaja menyebar.
  assert.equal(modelBerlaku("ultra"), KUALITAS.ultra.model);
  assert.equal(mesinBerlaku("standard"), KUALITAS.standard.mesin);
  setPemetaanUntukUji(null);
});

test("bentuk model diperiksa terhadap mesinnya — ditolak SEBELUM render", () => {
  // Pemetaan silang menghasilkan HTTP 404 di ujung render: sesudah naskah
  // ditulis, gambar disiapkan, dan pembeli menunggu. Ditolak di sini.
  assert.match(
    periksaPemetaan({ kualitas: "premium", mesin: "byteplus", model: "grok-imagine/image-to-video" }) ?? "",
    /dreamina-|seedance-/,
    "model kie.ai diterima untuk mesin BytePlus",
  );
  assert.match(
    periksaPemetaan({ kualitas: "standard", mesin: "kie-grok", model: "seedance-1-0-pro-250528" }) ?? "",
    /keluarga.*tugas|\//,
    "model BytePlus diterima untuk mesin kie.ai",
  );
  assert.ok(periksaPemetaan({ kualitas: "premium", mesin: "byteplus", model: "  " }), "model kosong harus ditolak");
  assert.ok(periksaPemetaan({ kualitas: "tidak-ada", mesin: "byteplus", model: "seedance-x" }), "paket asing harus ditolak");
  assert.ok(periksaPemetaan({ kualitas: "premium", mesin: "mesin-karangan", model: "seedance-x" }), "mesin asing harus ditolak");
  // Yang SAH lolos — gerbang tidak boleh asal ketat.
  assert.equal(periksaPemetaan({ kualitas: "premium", mesin: "byteplus", model: "seedance-1-0-pro-250528" }), null);
  assert.equal(periksaPemetaan({ kualitas: "standard", mesin: "kie-grok", model: "grok-imagine/image-to-video" }), null);
});

test("BIAYA dihitung untuk model yang BENAR-BENAR dipakai", () => {
  // Cacat yang paling mudah terlewat: model dikirim dari pemetaan admin, tapi
  // biaya dihitung dari config.tiers. Tagihannya lalu dihitung untuk model yang
  // tidak pernah dipanggil, dan salahnya baru ketahuan saat tagihan bulanan
  // datang — jauh dari sebabnya.
  const src = baca("lib/providers/stubs/byteplus.ts");
  const kode = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // Definisi fungsinya sendiri ikut tercocoki kalau tidak disaring — argumen
  // ber-anotasi tipe ("model: string") adalah parameter, bukan pemanggilan.
  const panggilanBiaya = [...kode.matchAll(/estimateCostIdr\(([^,]+),/g)]
    .map((m) => m[1].trim())
    .filter((a) => !a.includes(":"));
  assert.ok(panggilanBiaya.length >= 2, "panggilan penghitung biaya tidak ketemu");
  for (const arg of panggilanBiaya) {
    assert.ok(
      /modelUntukSpec|modelTerpakai/.test(arg),
      `biaya dihitung dari "${arg}" — bukan model yang dipakai. Ganti model dari admin akan menghasilkan tagihan yang salah.`,
    );
  }
});

test("tier LAMA tidak ikut dipetakan — job lama tetap memakai mesin aslinya", () => {
  // high_quality/super_hq/silent_caption masih dipakai job lama. Memetakannya
  // berarti mengubah cara job lama dirender ulang, dan riwayat tidak boleh
  // menunjuk sesuatu yang berubah di belakangnya.
  const registry = baca("lib/providers/registry.ts");
  assert.match(registry, /kualitasDikenal\(tier\) \? mesinBerlaku\(tier as Kualitas\) : mesinUntuk\(/,
    "tier lama ikut membaca pemetaan admin");
});

test("migrasi memasang pagar di database, bukan cuma di aplikasi", () => {
  // Tabel bisa diisi lewat psql langsung. Pagar yang hanya ada di aplikasi
  // adalah pagar yang bisa dilewati.
  const sql = baca("migrations/postgres/0038_pemetaan_model.sql");
  assert.match(sql, /CHECK \(kualitas IN \('standard', 'premium', 'ultra'\)\)/);
  assert.match(sql, /CHECK \(mesin IN \('kie-grok', 'byteplus'\)\)/);
  assert.match(sql, /length\(trim\(model\)\) > 0/);
});
