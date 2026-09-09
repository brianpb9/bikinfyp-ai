// HOOK YANG MENGULANG KERANGKA YANG SAMA (Brian, 9 Sep 2026).
//
// Dua hasil berturut-turut untuk satu produk:
//   "Nah, gue ganti-ganti cat rambut, baru ini yang benaran terasa beda"
//   "Eh, gue ganti-ganti cat rambut terus, baru ini yang benaran nempel"
//
// Kerangkanya sama persis: [seruan], gue ganti-ganti X, baru ini yang benaran Y.
//
// SEBABNYA BUKAN MODEL YANG MISKIN IDE. L-19 adalah gerbang KERAS, dan penulis
// diberi daftar penanda yang dicocokkan regex, dengan kalimat penutup "the
// marker must actually appear in it". Perangkat "penemuan setelah gagal" cuma
// punya empat penanda, jadi jalan termurah untuk lolos adalah menempelkan
// "ganti-ganti" lalu "baru ini" — dua kali, tiga kali, setiap kali.
//
// Gerbang yang memberitahukan token regex-nya berhenti mengukur mutu dan mulai
// mengukur kepatuhan kata kunci.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  POLA_PERANGKAT, PENANDA_PERANGKAT, memakaiPerangkat,
  panduanPerangkatHook, perangkatUntukVarian,
} from "../lib/script-engine/hook-devices";

test("dua hook Brian memang terdeteksi sebagai kerangka yang sama", () => {
  // Bukti bahwa keluhannya terukur, bukan soal selera.
  const a = "Nah, gue ganti-ganti cat rambut, baru ini yang benaran terasa beda";
  const b = "Eh, gue ganti-ganti cat rambut terus, baru ini yang benaran nempel";
  const pola = POLA_PERANGKAT["penemuan setelah gagal"];
  assert.ok(pola.test(a) && pola.test(b));
  for (const penanda of ["ganti-ganti", "baru ini"]) {
    assert.ok(a.includes(penanda) && b.includes(penanda), `keduanya memakai "${penanda}"`);
  }
});

test("penemuan-setelah-gagal punya banyak cara lolos, bukan cuma satu", () => {
  // Kalau cuma ada satu-dua jalan, gerbangnya sendiri yang memaksa keseragaman.
  const lolos = [
    "Udah bolak-balik nyobain, ini yang bertahan",
    "Jujur gue sempat kapok sama kategori ini",
    "Hampir nyerah, terus nemu yang ini",
    "Dari sekian banyak, cuma ini yang nempel",
    "Baru nemu yang begini setelah setahun",
    "Satu-satunya yang nggak bikin nyesel",
  ];
  for (const h of lolos) {
    assert.ok(POLA_PERANGKAT["penemuan setelah gagal"].test(h), `belum dikenali: ${h}`);
  }
  // Dan tak satu pun memakai kerangka lama.
  for (const h of lolos) assert.ok(!h.includes("ganti-ganti"), h);
});

test("setiap penanda yang diberitahukan benar-benar lolos pengukurnya", () => {
  // Daftar yang hanyut dari detektornya mengirim penulis mengejar kata yang
  // tidak dicocoki apa pun — pola bug yang sudah dibayar tiga kali di repo ini.
  for (const [nama, penanda] of Object.entries(PENANDA_PERANGKAT)) {
    for (const kata of penanda.match(/"([^"]+)"/g) ?? []) {
      const bersih = kata.replace(/"/g, "");
      if (bersih === "?") continue;
      assert.ok(memakaiPerangkat(`kalimat uji ${bersih} lanjutannya`), `"${bersih}" (${nama}) tidak lolos memakaiPerangkat`);
    }
  }
});

test("panduan menyuruh MEMVARIASIKAN, bukan menempel penanda", () => {
  const g = panduanPerangkatHook();
  assert.match(g, /VARY EVERYTHING ELSE/);
  // Kalimat yang dulu berdiri sendiri sebagai "tempel penandanya" harus sudah
  // diberi lawan yang eksplisit.
  assert.match(g, /opening skeleton/);
});

test("tiga varian satu permintaan berangkat dari perangkat BERBEDA", () => {
  const tiga = [0, 1, 2].map((i) => perangkatUntukVarian(i).nama);
  assert.equal(new Set(tiga).size, 3, `varian bertemu di perangkat sama: ${tiga.join(", ")}`);
  // Dan sarannya harus nyata — nama yang dikenali POLA_PERANGKAT.
  for (const n of tiga) assert.ok(POLA_PERANGKAT[n], `perangkat tak dikenal: ${n}`);
});

test("saran perangkat sampai ke prompt per-permintaan, bukan ke blok cache", () => {
  // Blok aturan di-cache dan identik untuk semua varian; kalau sarannya
  // ditaruh di sana, ketiga varian menerima saran yang sama dan gunanya hilang.
  // Komentar DIBUANG dulu: nama fungsinya disebut di komentar tipe, dan tes
  // yang mencocoki komentar mengukur prosa, bukan perilaku.
  const buang = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const llm = buang(readFileSync(new URL("../lib/script-engine/llm.ts", import.meta.url), "utf8"));
  const blokTugas = llm.slice(llm.indexOf("function blokTugas("), llm.indexOf("export async function tulisNaskah"));
  assert.match(blokTugas, /perangkatDisarankan/, "saran tidak ada di blokTugas");
  assert.equal(llm.indexOf("perangkatUntukVarian"), -1, "saran seharusnya dihitung pemanggil, bukan di dalam llm.ts");
  // Dan pemanggilnya memang menghitungnya per varian.
  const idx = buang(readFileSync(new URL("../lib/script-engine/index.ts", import.meta.url), "utf8"));
  assert.match(idx, /perangkatDisarankan: perangkatUntukVarian\(variantIndex\)/);
});

// ── PENANTIAN ───────────────────────────────────────────────────────────────

test("tidak ada caption yang menebak nomor percobaan dari stopwatch", () => {
  // "Percobaan terakhir, sebentar lagi" muncul di detik 60 apa pun keadaannya.
  // Pada premium, detik 60 biasanya masih Idea Stage — percobaan PERTAMA pun
  // belum mulai, dan yang tersisa masih sekitar satu setengah menit.
  const src = readFileSync(new URL("../app/_components/TungguNaskah.tsx", import.meta.url), "utf8");
  const kode = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/Percobaan terakhir/.test(kode), "caption masih mengklaim percobaan terakhir");
  assert.ok(!/percobaan/i.test(kode), "caption masih menyebut nomor percobaan");
});

test("perkiraan lama mengikuti tier — 20-40 detik bukan angka premium", () => {
  const src = readFileSync(new URL("../app/_components/TungguNaskah.tsx", import.meta.url), "utf8");
  const kode = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/20–40 detik/.test(kode), "masih menjanjikan 20-40 detik untuk semua tier");
  assert.match(kode, /JANJI_WAKTU\.naskahIde/, "premium tidak diberi perkiraan yang jujur");
  assert.match(kode, /TAHAP_IDE/, "jadwal Idea Stage tidak ada");
  // Dan halaman yang memakainya harus benar-benar mengirim tier-nya.
  const gaya = readFileSync(new URL("../app/bikin/gaya/page.tsx", import.meta.url), "utf8");
  assert.match(gaya, /<TungguNaskah[^>]*tier=\{tier\}/, "tier tidak diteruskan ke lapisan tunggu");
});

test("tiga varian retail selesai dalam SATU gelombang", () => {
  // LEBAR 2 dengan 3 varian berarti gelombang kedua berisi satu varian sendirian
  // — membeli satu naskah dengan harga waktu satu gelombang penuh.
  const src = readFileSync(new URL("../lib/script-engine/index.ts", import.meta.url), "utf8");
  const m = src.match(/const LEBAR = (\d+);/);
  assert.ok(m, "LEBAR tidak ketemu");
  assert.ok(Number(m![1]) >= 3, `LEBAR=${m![1]} masih memecah 3 varian jadi dua gelombang`);
});
