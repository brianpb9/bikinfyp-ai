// Gerbang viralitas: skor FYP berhenti jadi hiasan dan mulai menjaga.
//
// Permintaan Brian 3 Sep 2026: "apabila kurang lakukan regenerate ulang
// scriptnya sehingga memiliki nilai tinggi. lakukan sampai 3 kali baru
// tampilkan opsinya. minimum tresholdnya 60."
//
// Skor FYP sudah dihitung sejak lama tapi tidak pernah menolak apa pun: naskah
// berskor 38 ditawarkan persis sama dengan naskah 97 (21 snapshot produksi,
// median 86, satu pencilan 38). Tes ini menjaga perilaku gerbangnya, bukan
// angka modelnya.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AMBANG_VIRAL, MAKS_PERCOBAAN_VIRAL, lewatiGerbangViral, memenuhiAmbang, urutkanBerdasarSkor,
} from "../lib/script-engine/gerbang-viral";
import type { HookCode } from "../lib/config/hooks";
import type { SegmentDraft } from "../lib/script-engine/templates";

/** Varian palsu — gerbangnya diuji lewat skor yang disuntik, bukan model FYP. */
type Palsu = { hook_family: HookCode; segments: SegmentDraft[]; validation: { passed: boolean }; tandai: string };
const v = (tandai: string, passed = true): Palsu =>
  ({ hook_family: "H1", segments: [], validation: { passed }, tandai }) as Palsu;

test("ambang dan jumlah percobaan sesuai yang diminta", () => {
  assert.equal(AMBANG_VIRAL, 60);
  assert.equal(MAKS_PERCOBAAN_VIRAL, 3);
});

test("urutan menaruh skor tertinggi di depan, yang tak terukur di belakang", () => {
  const urut = urutkanBerdasarSkor([
    { varian: v("a"), skor: 40 }, { varian: v("b"), skor: null }, { varian: v("c"), skor: 90 },
  ]);
  assert.deepEqual(urut.map((d) => (d.varian as Palsu).tandai), ["c", "a", "b"]);
});

test("varian yang GAGAL validator tidak boleh memuaskan ambang", () => {
  // Cacat yang ditutup saat menulis gerbang ini: tanpa penyaring kelayakan,
  // naskah berskor 90 yang gagal gerbang validator membuat gerbang berhenti
  // "karena sudah 60" — lalu naskah itu dibuang di hilir, dan pengguna
  // menerima naskah berskor rendah yang justru mau dicegah.
  const daftar = [{ varian: v("gagal", false), skor: 90 }, { varian: v("sah"), skor: 30 }];
  assert.equal(memenuhiAmbang(daftar, 60), true, "tanpa penyaring: ikut terhitung");
  assert.equal(
    memenuhiAmbang(daftar, 60, (x: Palsu) => (x as Palsu).validation.passed), false,
    "dengan penyaring: naskah yang akan dibuang tidak boleh menutup gerbang",
  );
});

test("berhenti di percobaan pertama kalau ambang sudah tercapai", async () => {
  const dipanggil: number[] = [];
  const hasil = await lewatiGerbangViral(
    async (n) => { dipanggil.push(n); return [v("bagus")]; },
    {} as never,
    { nilai: () => 88, layak: (x: Palsu) => (x as Palsu).validation.passed } as never,
  );
  assert.deepEqual(dipanggil, [1], "tidak boleh menulis ulang naskah yang sudah lolos ambang");
  assert.equal(hasil.percobaan, 1);
  assert.equal(hasil.lolosAmbang, true);
});

test("naskah di bawah ambang ditulis ulang, maksimal tiga kali, lalu tetap disajikan", async () => {
  const dipanggil: number[] = [];
  const hasil = await lewatiGerbangViral(
    async (n) => { dipanggil.push(n); return [v(`babak${n}`)]; },
    {} as never,
    // Selalu 45: ambang tidak pernah tercapai.
    { nilai: () => 45, layak: (x: Palsu) => (x as Palsu).validation.passed } as never,
  );
  assert.deepEqual(dipanggil, [1, 2, 3], "harus mencoba tepat tiga kali, tidak lebih dan tidak kurang");
  assert.equal(hasil.lolosAmbang, false);
  // TETAP DISAJIKAN. Menolak keras sesudah tiga panggilan model berbayar
  // meninggalkan pembeli tanpa apa-apa — kerugian di kedua sisi.
  assert.equal(hasil.terpilih.length, 3, "hasil seluruh percobaan dikumpulkan, bukan dibuang");
  assert.equal(hasil.skorTertinggi, 45);
});

test("hasil percobaan sebelumnya tidak dibuang saat percobaan berikutnya berjalan", async () => {
  const skor: Record<string, number> = { babak1: 55, babak2: 20 };
  const hasil = await lewatiGerbangViral(
    async (n) => [v(`babak${n}`)],
    {} as never,
    { nilai: (x: Palsu) => skor[x.tandai] ?? 10, layak: (x: Palsu) => (x as Palsu).validation.passed } as never,
  );
  // Percobaan 2 lebih buruk dari percobaan 1; yang disajikan tetap yang terbaik.
  assert.equal((hasil.terpilih[0].varian as Palsu).tandai, "babak1");
  assert.equal(hasil.skorTertinggi, 55);
});

test("percobaan yang tidak menghasilkan naskah sah menghentikan gerbang", async () => {
  // Kalau yang menahan naskah adalah validator, menulis ulang demi SKOR tidak
  // mengubah apa pun — ia hanya melipatgandakan biaya model.
  const dipanggil: number[] = [];
  await lewatiGerbangViral(
    async (n) => { dipanggil.push(n); return [v("gagal", false)]; },
    {} as never,
    { nilai: () => 90, layak: (x: Palsu) => (x as Palsu).validation.passed } as never,
  );
  assert.deepEqual(dipanggil, [1], "tidak boleh menulis ulang tiga kali kalau validator yang menolak");
});
