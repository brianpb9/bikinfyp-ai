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
  // Pasangan silang: model ADA di katalog, tapi milik mesin yang lain.
  // Bentuk ini penting dibedakan dari "model tidak dikenal" — alasan tolaknya
  // berbeda, dan orang yang membacanya perlu tahu mana yang salah: mesinnya
  // atau modelnya.
  assert.match(
    periksaPemetaan({ kualitas: "premium", mesin: "byteplus", model: "grok-imagine/image-to-video" }) ?? "",
    /milik mesin kie-grok/,
    "model kie.ai diterima untuk mesin BytePlus",
  );
  assert.match(
    periksaPemetaan({ kualitas: "standard", mesin: "kie-grok", model: "seedance-1-0-pro-250528" }) ?? "",
    /milik mesin byteplus/,
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

// ---------------------------------------------------------------------------
// KATALOG MODEL — daftar tertutup, dan kenapa itu penting
// ---------------------------------------------------------------------------
// Penghitung biaya memakai MODEL_RATES[model]. Model yang tidak terdaftar
// jatuh ke tarif cadangan $0,01/detik — sepersepuluh biaya sebenarnya. Repo ini
// sudah membayar cacat itu sekali: Seedance 2.5 sempat tidak ada di daftar, dan
// tier TERMAHAL jadi tier yang biayanya paling salah dihitung.
//
// Selama model hanya bisa diganti lewat rilis, cacat itu butuh seorang
// programmer yang lupa. Sejak bisa diganti dari layar admin, ia cukup butuh
// satu salah ketik.

test("setiap model di katalog punya tarif — tanpa itu biayanya pasti salah", async () => {
  const { KATALOG_MODEL } = await import("../lib/katalog-model");
  const src = baca("lib/providers/stubs/byteplus.ts");
  for (const m of KATALOG_MODEL) {
    if (m.mesin !== "byteplus") continue;
    assert.ok(
      src.includes(`"${m.id}"`),
      `model "${m.id}" bisa dipilih dari admin tapi tidak ada di MODEL_RATES — biayanya akan jatuh ke tarif cadangan $0,01/dtk`,
    );
  }
});

test("model di luar katalog DITOLAK, dengan alasan yang menyebut biayanya", async () => {
  const alasan = periksaPemetaan({ kualitas: "premium", mesin: "byteplus", model: "seedance-karangan-999" });
  assert.ok(alasan, "model asing diterima");
  assert.match(alasan ?? "", /tarif|biaya/i, "alasannya tidak menjelaskan kenapa berbahaya");
});

test("model kedua yang Brian aktifkan bisa dipilih untuk BytePlus", async () => {
  const { modelDikenal } = await import("../lib/katalog-model");
  for (const id of ["seedance-1-0-pro-fast-251015", "seedance-1-0-pro-250528"]) {
    const m = modelDikenal(id);
    assert.ok(m, `${id} tidak ada di katalog`);
    assert.equal(m?.mesin, "byteplus");
    assert.equal(periksaPemetaan({ kualitas: "premium", mesin: "byteplus", model: id }), null, `${id} ditolak`);
  }
});

test("tarif BROSUR tidak boleh menyamar sebagai angka pasti", async () => {
  // "estimated: false" berarti angkanya bisa dipertanggungjawabkan, dan itu
  // menuntut DUA hal: token nyata DAN tarif yang pernah dicocokkan dengan
  // tagihan kami. Tarif brosur dengan token nyata tetap taksiran — menyebutnya
  // pasti adalah cara taksiran yang meleset 2,8x bertahan tanpa dicurigai.
  const src = baca("lib/providers/stubs/byteplus.ts");
  assert.match(src, /estimated: rate\.tarifTerukur !== true/, "tarif brosur masih dilaporkan sebagai angka pasti");
  assert.match(src, /TARIF TIDAK DIKENAL untuk model/, "model tanpa tarif tidak dilaporkan keras");
  // Model yang tarifnya dari tagihan sendiri ditandai; yang brosur tidak.
  const { KATALOG_MODEL } = await import("../lib/katalog-model");
  const brosur = KATALOG_MODEL.filter((m) => m.tarif === "brosur").map((m) => m.id);
  for (const id of brosur) {
    const blok = src.slice(src.indexOf(`"${id}"`), src.indexOf(`"${id}"`) + 220);
    assert.doesNotMatch(blok, /tarifTerukur: true/, `${id} bertarif brosur tapi ditandai terukur`);
  }
});
