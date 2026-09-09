// TABEL PROVIDER_LOG KOSONG SEJAK HARI PERTAMA (ditemukan 9 Sep 2026).
//
// Log worker produksi, berulang di setiap render:
//
//   [provider-log] gagal mencatat: bind message supplies 14 parameters,
//                                  but prepared statement "" requires 15
//
// Daftar kolomnya 15, placeholder-nya $1..$15, array nilainya 14 — created_at
// tidak pernah dikirim, dan kolom itu NOT NULL tanpa default.
//
// Yang membuat cacat ini hidup lama bukan kesulitannya, melainkan bahwa
// catatProvider SENGAJA menelan galatnya sendiri: mencatat tidak boleh
// menggagalkan render. Keputusan itu benar, tapi konsekuensinya adalah tidak
// ada satu pun sinyal yang akan memberi tahu kalau pencatatannya rusak. Tab
// "Provider" yang Brian minta terlihat "belum ada data", bukan "rusak".
//
// Jalur yang menelan galatnya sendiri wajib dijaga tes yang menghitung
// bentuknya, karena tidak ada yang lain yang akan melakukannya.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/provider-log.ts", import.meta.url), "utf8");

test("jumlah kolom, placeholder, dan nilai INSERT provider_log cocok bertiga", () => {
  const mulai = src.indexOf("INSERT INTO provider_log");
  assert.ok(mulai > 0, "INSERT provider_log tidak ditemukan");
  const potong = src.slice(mulai, src.indexOf("],", mulai));

  // 1. kolom di dalam kurung pertama
  const kolomBlok = potong.slice(potong.indexOf("(") + 1, potong.indexOf(")"));
  const kolom = kolomBlok.split(",").map((k) => k.trim()).filter(Boolean);

  // 2. placeholder $N tertinggi
  const nomor = [...potong.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  const maks = Math.max(...nomor);

  // 3. nilai di dalam array argumen — komentar dibuang lebih dulu, dan
  //    barisnya dihitung dari koma di kedalaman kurung nol supaya
  //    "baris.x ?? null" atau "fn(a, b)" tidak terhitung dua.
  const arrMulai = potong.indexOf("[", potong.indexOf("VALUES"));
  const isi = potong.slice(arrMulai + 1)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  let dalam = 0, nilai = 0, adaIsi = false;
  for (const ch of isi) {
    if ("([{".includes(ch)) dalam++;
    else if (")]}".includes(ch)) dalam--;
    else if (ch === "," && dalam === 0) { nilai++; adaIsi = false; continue; }
    if (!" \t\n\r".includes(ch)) adaIsi = true;
  }
  if (adaIsi) nilai++;

  assert.equal(kolom.length, maks, `kolom ${kolom.length} vs placeholder ${maks}`);
  assert.equal(nilai, maks, `nilai ${nilai} vs placeholder ${maks} — Postgres akan menolak SETIAP baris`);
});

test("created_at benar-benar dikirim — kolomnya NOT NULL tanpa default", () => {
  const migrasi = readFileSync(new URL("../migrations/postgres/0043_provider_log.sql", import.meta.url), "utf8");
  assert.match(migrasi, /created_at TEXT NOT NULL/, "asumsi tes berubah: created_at tidak lagi NOT NULL");
  assert.doesNotMatch(migrasi, /created_at TEXT NOT NULL DEFAULT/, "kalau sudah ada default, tes ini boleh dilonggarkan");

  const potong = src.slice(src.indexOf("INSERT INTO provider_log"), src.indexOf("],", src.indexOf("INSERT INTO provider_log")));
  const kode = potong.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(kode, /new Date\(\)\.toISOString\(\)/, "created_at tidak diisi di daftar nilai");
});
