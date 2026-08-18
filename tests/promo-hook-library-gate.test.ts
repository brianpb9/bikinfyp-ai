// Jalur /promo tidak memakai generateScripts — dan itu memang benar: di sana
// pengguna mengunggah klipnya sendiri dan memilih satu hook dari pustaka kami.
// Tidak ada naskah yang ditulis.
//
// TAPI promptnya tetap berangkat ke penyedia video yang sama, jadi ia tunduk
// pada aturan yang sama. Copy pustaka ini milik kami sendiri, jadi gerbangnya
// bisa berupa audit statis: setiap entri diperiksa sekali di sini, bukan
// dipercaya karena "kan kami yang menulis".

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-promohook-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-promohook-storage-${process.pid}`;
process.env.SCRIPT_LLM = "0";

const { HOOK_LIBRARY } = await import("../lib/promo/hook-library");
const { periksaPemicu, ringkasPemicu } = await import("../lib/media/pemicu-filter");
const { periksaKataTerlarang } = await import("../lib/script-engine/validator");

test("pustaka hook /promo tidak kosong dan tiap entri punya prompt", () => {
  assert.ok(HOOK_LIBRARY.length >= 10, `baru ${HOOK_LIBRARY.length} entri`);
  for (const h of HOOK_LIBRARY) assert.ok(h.prompt.length > 40, `${h.id}: prompt terlalu pendek`);
});

test("tidak satu pun prompt /promo memuat negasi tentang orang", () => {
  const gagal: string[] = [];
  for (const h of HOOK_LIBRARY) {
    const negasi = periksaPemicu(h.prompt).filter((t) => t.jenis === "negasi-orang");
    if (negasi.length) gagal.push(`${h.id}: ${ringkasPemicu(negasi)}`);
  }
  assert.deepEqual(gagal, [], "prompt /promo berangkat ke penyedia yang sama dengan pipeline naskah");
});

test("kosakata pemicu di /promo dicatat, dan daftarnya tidak boleh tumbuh diam-diam", () => {
  const kena = HOOK_LIBRARY.flatMap((h) =>
    periksaPemicu(h.prompt).filter((t) => t.jenis === "kosakata").map((t) => `${h.id}: ${t.cocok}`)
  );
  // Kosakata bertetangga TIDAK memblokir (lihat pemicu-filter): sebagian
  // memang milik adegannya. Yang dijaga: jumlahnya diketahui, bukan nol
  // yang dipercaya begitu saja.
  assert.ok(kena.length <= 4, `kosakata pemicu di pustaka /promo bertambah: ${JSON.stringify(kena)}`);
});

test("judul hook /promo bebas overclaim dan klaim medis", () => {
  const gagal: string[] = [];
  for (const h of HOOK_LIBRARY) {
    const isu = periksaKataTerlarang(`${h.title}`);
    if (isu.length) gagal.push(`${h.id}: ${isu.map((i) => i.message_id).join("; ")}`);
  }
  assert.deepEqual(gagal, [], "judul hook tampil ke pengguna dan ikut jadi janji produk");
});
