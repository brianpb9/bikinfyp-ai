// Temuan aksesibilitas audit QA 16 Agu 2026.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function semuaBerkas(dir: string, keluar: string[] = []): string[] {
  for (const nama of fs.readdirSync(dir)) {
    const p = path.join(dir, nama);
    if (fs.statSync(p).isDirectory()) semuaBerkas(p, keluar);
    else if (nama.endsWith(".tsx")) keluar.push(p);
  }
  return keluar;
}

// maximumScale: 1 memblokir pinch-zoom, jadi siapa pun yang perlu memperbesar
// teks tidak bisa. Alasan aslinya biasanya mencegah iOS melompat-zoom saat
// fokus ke input — tapi itu diselesaikan dengan font input >=16px.
test("pinch-zoom tidak diblokir", () => {
  // Baris komentar diabaikan: kalau tidak, tes ini melarang MENJELASKAN kenapa
  // maximumScale dihapus — dan komentar yang menerangkan keputusan justru yang
  // mencegah orang berikutnya memasangnya lagi.
  const kode = fs.readFileSync(path.join(process.cwd(), "app", "layout.tsx"), "utf8")
    .split("\n")
    .filter((b) => !b.trim().startsWith("//"))
    .join("\n");
  assert.ok(!/maximumScale:\s*1\b/.test(kode), "maximumScale: 1 memblokir pinch-zoom");
  assert.ok(!/userScalable:\s*false/.test(kode), "userScalable: false memblokir pinch-zoom");
});

// Syarat supaya poin di atas aman: input yang lebih kecil dari 16px membuat iOS
// otomatis melompat-zoom saat difokus, dan gangguan itulah yang dulu ditutup
// dengan mencabut zoom dari semua orang. Satu input text-sm mengembalikannya.
test("tidak ada input berfont di bawah 16px", () => {
  const pelanggar: string[] = [];
  for (const f of semuaBerkas(path.join(process.cwd(), "app"))) {
    const isi = fs.readFileSync(f, "utf8");
    for (const baris of isi.split("\n")) {
      if (!/<(input|textarea|select)\b/.test(baris)) continue;
      if (/\btext-(sm|xs)\b/.test(baris)) pelanggar.push(`${path.relative(process.cwd(), f)}: ${baris.trim().slice(0, 70)}`);
    }
  }
  assert.deepEqual(pelanggar, [], "input di bawah 16px memicu auto-zoom iOS saat difokus");
});
