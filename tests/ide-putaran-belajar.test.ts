// Idea Stage: putaran kedua BELAJAR dari putaran pertama (20 Agu 2026).
//
// Empat generate nyata menunjukkan gate tidak pernah lulus (59-66 vs ambang 75),
// dan sebabnya dua-duanya struktural:
//
//   1. Putaran kedua hanya diberi daftar mekanik terlarang. Model tahu apa yang
//      tidak boleh dipakai lagi, tapi TIDAK PERNAH tahu apa yang salah — jadi
//      ia menulis ulang kelemahan yang sama dengan kalimat berbeda. Penulis
//      naskah sudah lama punya jalur perbaikan seperti ini; pembuat ide tidak.
//
//   2. Setiap mekanik yang kandidatnya gagal langsung dilarang. Saat sepuluh
//      kandidat gagal — kondisi normal hari ini — hampir seluruh bank ikut
//      terlarang, dan putaran kedua dipaksa memakai sisa yang paling lemah.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-ide-belajar-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-ide-belajar-storage-${process.pid}`;

const { susunKritik, BATAS_LARANG_MEKANIK, MAKS_PUTARAN_IDE, DIMENSI_FYP } = await import("../lib/script-engine/ide");

const ide = (one_liner: string, mechanic: string) => ({
  one_liner, mechanic, format: "unboxing_asmr", human_situation: "x", why_stop: "y",
  story: { setup: "", tension: "", payoff: "" }, product_role: "", claim_safety: "",
  hook_device: "", hook_level: "agak_berani",
} as never);

const nilai = (total: number, perDimensi: Record<string, number>, sebabGagal: string[] = []) => ({
  total, lulus: false, borderline: false, perDimensi, sebabGagal, alasan: "uji",
} as never);

test("kritik menyebut dimensi yang paling sering jatuh, berikut ambangnya", () => {
  const peringkat = [
    { ide: ide("ide satu", "secret"), nilai: nilai(66, { scroll_stop: 6, story_pull: 5, distinctiveness: 8, payoff: 7, brand_fidelity_plan: 8, nativeness: 7 }) },
    { ide: ide("ide dua", "absence"), nilai: nilai(63, { scroll_stop: 6, story_pull: 6, distinctiveness: 7, payoff: 7, brand_fidelity_plan: 8, nativeness: 7 }) },
  ];
  const kritik = susunKritik(peringkat as never);
  assert.ok(kritik.length > 0, "kritik tidak boleh kosong saat semua gagal");
  const gabung = kritik.join("\n");
  assert.match(gabung, /story_pull/, "dimensi yang jatuh harus disebut");
  assert.match(gabung, /scroll_stop/);
  assert.match(gabung, /ambang 7/, "ambangnya harus ikut — angka tanpa target tidak bisa dikejar");
  // Pertanyaan juri ikut, supaya model tahu apa yang sebenarnya diukur.
  assert.ok(DIMENSI_FYP.some((d) => gabung.includes(d.tanya.slice(0, 25))), "pertanyaan dimensi harus ikut");
});

test("kritik menyertakan ide TERBAIK yang tetap gagal — ambangnya jadi nyata", () => {
  const peringkat = [
    { ide: ide("Botol serum dioper enam anak kos sampai tinggal seujung kuku", "time_compression"), nilai: nilai(71, { story_pull: 6 }) },
    { ide: ide("ide dua", "absence"), nilai: nilai(60, { story_pull: 5 }) },
  ];
  const kritik = susunKritik(peringkat as never).join("\n");
  assert.match(kritik, /71\/100/, "skor tertinggi harus disebut");
  assert.match(kritik, /Botol serum dioper/, "one-liner terbaik harus dikutip");
});

test("sebab yang berulang dari juri ikut dilaporkan, dengan hitungannya", () => {
  const sama = "one-liner tidak menyebut produk/kategorinya";
  const peringkat = [
    { ide: ide("a", "secret"), nilai: nilai(60, { story_pull: 5 }, [sama]) },
    { ide: ide("b", "absence"), nilai: nilai(59, { story_pull: 5 }, [sama]) },
  ];
  const kritik = susunKritik(peringkat as never).join("\n");
  assert.match(kritik, /muncul 2x/, "pola berulang harus terlihat sebagai pola");
});

test("kritik kosong kalau tidak ada yang dinilai", () => {
  assert.deepEqual(susunKritik([]), []);
});

test("ambang larang mekanik jauh DI BAWAH ambang lulus — bank tidak boleh terkuras", () => {
  assert.ok(BATAS_LARANG_MEKANIK < 75, "melarang di ambang lulus akan mengosongkan bank tiap putaran gagal");
  assert.ok(BATAS_LARANG_MEKANIK <= 50, `batas ${BATAS_LARANG_MEKANIK} masih terlalu dekat dengan skor normal (59-66)`);
});

test("kode benar-benar memakai batas itu, bukan melarang semua yang gagal", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("lib/script-engine/ide.ts", "utf8");
  assert.match(src, /if \(!d\.nilai\.lulus && d\.nilai\.total < BATAS_LARANG_MEKANIK\)/,
    "larangan mekanik harus bersyarat skor, bukan sekadar 'tidak lulus'");
  assert.match(src, /kritikPutaranLalu: kritik/, "kritik harus diteruskan ke putaran berikutnya");
  assert.equal(MAKS_PUTARAN_IDE, 2);
});

test("prompt pembuat ide menerima kritik sebagai instruksi perbaikan", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("lib/script-engine/ide.ts", "utf8");
  assert.match(src, /THIS IS A SECOND ROUND/, "putaran kedua harus tahu ia sedang memperbaiki");
  assert.match(src, /Do not merely rephrase/, "menulis ulang kalimat yang sama bukan perbaikan");
});
