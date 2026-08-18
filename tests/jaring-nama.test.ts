import { test } from "node:test";
import assert from "node:assert/strict";
import { namaPanggung, cobaDenganNamaPendek } from "../lib/script-engine/jaring-nama";

/**
 * Fixture utama = dua nama yang BENAR-BENAR memblokir render di canary 12 klip
 * (temuan #4): kopitang-a dan arva-b gagal L-05/S-09 tiga putaran karena nama
 * memakan jendela kata. Tesnya menjaga tangga nama menyelesaikan kasus nyata
 * itu, bukan kasus karangan.
 */

test("namaPanggung: nama canary yang gagal → merek yang diucapkan penjual", () => {
  assert.equal(namaPanggung("KOPI TANG Kopi Susu Gula Aren"), "KOPI TANG");
  assert.equal(namaPanggung("ARVA Tumbler Chrome"), "ARVA");
  assert.equal(namaPanggung("SOMETHINC Level 1% Retinol Serum Ampoule"), "SOMETHINC");
});

test("namaPanggung: merek huruf campuran → dua kata pertama", () => {
  assert.equal(namaPanggung("Mosseru Glow Serum Pencerah Wajah"), "Mosseru Glow");
});

test("namaPanggung: nama pendek tidak disentuh", () => {
  assert.equal(namaPanggung("Sabun Herbal"), "Sabun Herbal");
});

test("namaPanggung: tidak pernah memulangkan penggal menggantung", () => {
  // Kata kedua ≤3 huruf dibuang, bukan dipertahankan sebagai "JJ Gl".
  const hasil = namaPanggung("Glowie Zi Serum Whitening Premium");
  assert.ok(!/\s[A-Za-z]{1,3}$/.test(hasil) || hasil.split(" ").length === 1, hasil);
});

const varian = (passed: boolean) => ({ validation: { passed } });

test("tangga berhenti di nama asli bila lolos — nol panggilan ekstra", async () => {
  const dicoba: string[] = [];
  const hasil = await cobaDenganNamaPendek(async (n) => { dicoba.push(n); return [varian(true)]; }, "KOPI TANG Kopi Susu Gula Aren");
  assert.equal(hasil.adaLolos, true);
  assert.equal(hasil.shortenedTo, null);
  assert.deepEqual(dicoba, ["KOPI TANG Kopi Susu Gula Aren"]);
});

test("kasus canary: nama asli gagal, nama panggung lolos → shortenedTo terisi", async () => {
  const dicoba: string[] = [];
  const hasil = await cobaDenganNamaPendek(async (n) => {
    dicoba.push(n);
    return [varian(n === "KOPI TANG")];
  }, "KOPI TANG Kopi Susu Gula Aren");
  assert.equal(hasil.adaLolos, true);
  assert.equal(hasil.shortenedTo, "KOPI TANG");
  // Anak tangga duplikat tidak dicoba dua kali.
  assert.deepEqual(dicoba, [...new Set(dicoba)]);
});

test("semua tangga gagal → adaLolos false, varian putaran terakhir dikembalikan", async () => {
  let panggilan = 0;
  const hasil = await cobaDenganNamaPendek(async () => { panggilan++; return [varian(false)]; }, "ARVA Tumbler Chrome");
  assert.equal(hasil.adaLolos, false);
  assert.equal(hasil.shortenedTo, null);
  assert.ok(panggilan >= 2, `tangga harus dicoba (${panggilan} panggilan)`);
});
