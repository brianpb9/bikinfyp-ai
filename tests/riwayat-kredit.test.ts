// Riwayat jatah video: pembeli harus bisa melihat jatahnya pergi ke mana.
//
// Permintaan Brian 3 Sep 2026: "history penggunaan video dan video apa yang
// digunakan juga perlu ditambahkan sehingga user dapat melihat" — dan
// "informasi video yang di generate itu menggunakan package yang mana".
//
// Sampai kini pembeli hanya melihat ANGKA SISA. Angka sisa yang turun tanpa
// riwayat adalah bentuk paling murni dari "jatah saya hilang ke mana": tidak
// ada cara membedakan jatah yang jadi video, jatah yang dikembalikan karena
// rendernya gagal, dan bonus yang masuk. Ketiganya sudah tercatat di
// kredit_video sejak awal — yang belum ada hanya pintu untuk membacanya.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

test("paket ikut dibaca dari database di KEDUA runtime", () => {
  // Dua salinan kueri daftar job. Mengubah satu saja berarti paketnya muncul di
  // produksi tapi hilang di dev — atau sebaliknya, dan yang hilang tidak akan
  // ketahuan sampai ada yang membuka halamannya di runtime yang lain.
  assert.match(
    baca("lib/postgres/smoke-runtime.ts"), /SELECT j\.id,j\.state,j\.format,j\.duration_s,j\.quality_tier,/,
    "jalur PostgreSQL tidak mengambil quality_tier",
  );
  assert.match(
    baca("app/api/jobs/route.ts"), /SELECT j\.id, j\.state, j\.format, j\.duration_s, j\.quality_tier,/,
    "jalur SQLite tidak mengambil quality_tier",
  );
});

test("halaman video menampilkan paketnya, termasuk pada video yang GAGAL", () => {
  const hal = baca("app/video/page.tsx");
  assert.match(hal, /quality_tier\?: string \| null;/, "tipe paket tidak ada di item job");
  assert.match(hal, /PAKET_LABEL\[j\.quality_tier\]/, "paket tidak dirender");
  // Badge-nya menempel pada baris status yang dipakai SEMUA job, bukan
  // dibungkus syarat state === "READY": saat sesuatu tidak beres, hal pertama
  // yang ingin diketahui orang adalah jatah mana yang barusan dipakai.
  const potongan = hal.slice(hal.indexOf("{j.quality_tier && ("), hal.indexOf("{j.quality_tier && (") + 400);
  assert.doesNotMatch(potongan, /state === "READY"/, "paket disembunyikan di video gagal");
});

test("tier lama tetap punya nama yang bisa dibaca", () => {
  // Riwayat memuat job yang dibuat sebelum susunan standard/premium/ultra ada.
  // Menampilkan "high_quality" mentah kepada orang yang membeli "Premium"
  // membuat riwayatnya sendiri terasa asing.
  const hal = baca("app/video/page.tsx");
  for (const lama of ["high_quality", "super_hq", "silent_caption"]) {
    assert.ok(hal.includes(`${lama}:`), `tier lama "${lama}" tidak punya label`);
  }
});

test("riwayat dikirim rute kredit, dan bentuknya sama di kedua runtime", () => {
  assert.match(baca("app/api/kredit-video/route.ts"), /riwayatKredit\(user\.id, 30\)/, "riwayat tidak diambil");
  assert.match(baca("app/api/kredit-video/route.ts"), /riwayat: riwayat\.map/, "riwayat tidak dikirim ke klien");
  // Kueri yang sama harus ada di kedua implementasi — satu komponen UI membaca
  // keduanya, dan dua bentuk berbeda untuk satu layar adalah cara paling pasti
  // membuat salah satunya rusak diam-diam.
  for (const f of ["lib/postgres/kredit-video.ts", "lib/kredit-video-sqlite.ts"]) {
    const src = baca(f);
    assert.match(src, /LEFT JOIN jobs j ON j\.id = kv\.job_id/, `${f}: job tidak di-LEFT JOIN`);
    assert.match(src, /LEFT JOIN products p ON p\.id = j\.product_id/, `${f}: produk tidak di-LEFT JOIN`);
  }
});

test("baris tanpa job TIDAK hilang dari riwayat", () => {
  // Bonus dan pembelian tidak punya job. JOIN biasa akan membuangnya — dan yang
  // terbuang justru penjelasan atas KENAIKAN saldo, separuh dari pertanyaan
  // yang mau dijawab riwayat ini.
  for (const f of ["lib/postgres/kredit-video.ts", "lib/kredit-video-sqlite.ts"]) {
    const src = baca(f);
    const kueri = src.slice(src.indexOf("FROM kredit_video kv"), src.indexOf("FROM kredit_video kv") + 400);
    assert.doesNotMatch(kueri, /\n\s+JOIN jobs/, `${f}: memakai JOIN biasa, baris bonus akan hilang`);
  }
});

test("riwayat memakai bahasa pembeli, bukan istilah database", () => {
  const hal = baca("app/kredit/page.tsx");
  assert.match(hal, /pakai: "dipakai untuk video"/);
  // Baris yang paling sering ditanyakan harus menyebut ALASANNYA, bukan satu
  // kata teknis: "jatahmu tidak hangus" adalah kabar baik.
  assert.match(hal, /kembali: "dikembalikan — render gagal"/);
  assert.match(hal, /Riwayat Penggunaan Package/);
});
