#!/usr/bin/env node
// PEMBACA fyp-gate-log — audit E15 (19 Agu 2026).
//
// catatSkorGate() menulis satu baris JSON per penilaian ide sejak Idea Stage
// hidup, dan tidak ada satu pun yang membacanya: laporan yang tidak pernah
// dibaca adalah biaya tanpa manfaat. Ini pembacanya.
//
// Sengaja TETAP file JSONL, bukan tabel (keputusan asli di ide.ts: ini catatan
// penelitian, bukan bagian produk). Yang diperbaiki cuma satu: sekarang ada
// yang bisa menjawab "berapa sering gate lulus, dan dimensi mana yang jatuh".
//
// Pemakaian:
//   node scripts/laporan-fyp-gate.mjs            # seluruh isi log
//   node scripts/laporan-fyp-gate.mjs 7          # 7 hari terakhir
//   STORAGE_DIR=/path node scripts/laporan-fyp-gate.mjs

import fs from "node:fs";
import path from "node:path";

const hari = Number(process.argv[2] ?? 0);
const storageDir = process.env.STORAGE_DIR ?? "./storage";
const file = path.resolve(storageDir, "fyp-gate-log.jsonl");

if (!fs.existsSync(file)) {
  console.error(`fyp-gate-log.jsonl tidak ada di ${file} — belum ada penilaian ide, atau STORAGE_DIR beda.`);
  process.exit(1);
}

const batas = hari > 0 ? Date.now() - hari * 86_400_000 : 0;
const baris = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
const data = [];
let rusak = 0;
for (const b of baris) {
  try {
    const j = JSON.parse(b);
    // Nama fieldnya `waktu` (lihat catat() di lib/script-engine/ide.ts).
    if (batas && j.waktu && Date.parse(j.waktu) < batas) continue;
    data.push(j);
  } catch { rusak++; }
}

if (!data.length) {
  console.log(`(tidak ada entri${hari ? ` dalam ${hari} hari terakhir` : ""})`);
  process.exit(0);
}

const lulus = data.filter((d) => d.lulus === true).length;
const pct = (n) => `${Math.round((n / data.length) * 100)}%`;

console.log(`FYP GATE — ${data.length} penilaian${hari ? ` (${hari} hari terakhir)` : ""}${rusak ? `, ${rusak} baris rusak dilewati` : ""}`);
console.log(`Lulus: ${lulus} (${pct(lulus)}) · Gagal: ${data.length - lulus} (${pct(data.length - lulus)})`);

// Dimensi mana yang paling sering menjatuhkan gate — itu yang menentukan
// perbaikan berikutnya, bukan skor totalnya.
// Ambang per dimensi disalin dari DIMENSI di lib/script-engine/ide.ts — log
// menyimpan nilainya saja, bukan ambangnya. Kalau angka di sana berubah,
// baris ini ikut diperbarui; ia hanya untuk membaca catatan, bukan gerbang.
const AMBANG = { scroll_stop: 7, distinctiveness: 7, story_pull: 7, payoff: 7, brand_fidelity_plan: 8, nativeness: 7 };
const jatuh = {};
const barisStandar = {};
const totals = [];
for (const d of data) {
  if (typeof d.total === "number") totals.push(d.total);
  for (const [dim, nilai] of Object.entries(d.perDimensi ?? {})) {
    const ambang = AMBANG[dim];
    if (typeof nilai === "number" && typeof ambang === "number" && nilai < ambang) {
      jatuh[`${dim} (<${ambang})`] = (jatuh[`${dim} (<${ambang})`] ?? 0) + 1;
    }
  }
  for (const no of d.standarGagal ?? []) {
    barisStandar[`baris ${no}`] = (barisStandar[`baris ${no}`] ?? 0) + 1;
  }
}
if (totals.length) {
  totals.sort((a, b) => a - b);
  const med = totals[Math.floor(totals.length / 2)];
  console.log(`Skor total: min ${totals[0]} · median ${med} · maks ${totals[totals.length - 1]}`);
}
const urut = Object.entries(jatuh).sort((a, b) => b[1] - a[1]).slice(0, 12);
if (urut.length) {
  console.log("\nPenyebab paling sering:");
  for (const [k, n] of urut) console.log(`  [${n}] ${k}`);
}

// Mekanik yang dipakai — masukan langsung untuk anti-repeat per merek.
const mek = {};
for (const d of data) if (d.mechanic) mek[d.mechanic] = (mek[d.mechanic] ?? 0) + 1;
const urutStandar = Object.entries(barisStandar).sort((a, b) => b[1] - a[1]);
if (urutStandar.length) {
  console.log("\nBaris standar 10/10 yang paling sering gagal:");
  for (const [k, n] of urutStandar) console.log(`  [${n}] ${k}`);
}

const urutMek = Object.entries(mek).sort((a, b) => b[1] - a[1]);
if (urutMek.length) {
  console.log("\nMekanik terpilih:");
  for (const [k, n] of urutMek) console.log(`  [${n}] ${k}`);
}
