import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * CSP PRODUCTION TIDAK BOLEH MEMUAT unsafe-eval.
 *
 * Smoke interaksi di CI terpaksa jalan di server dev (production menolak
 * SQLite, fail-closed yang benar), dan dev SENGAJA diberi unsafe-eval untuk
 * react-refresh. Tanpa tes ini, satu-satunya penjaga "production tidak pernah
 * dapat unsafe-eval" adalah komentar — dan komentar tidak gagal di CI.
 *
 * Membaca sumber next.config.ts, bukan menjalankan Next: yang dijaga adalah
 * BENTUK ekspresinya — unsafe-eval hanya boleh hidup di dalam cabang
 * development dari ternary, tidak pernah di bagian tak-bersyarat.
 */
const sumber = fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");

test("script-src production tetap 'self' 'unsafe-inline' tanpa unsafe-eval", () => {
  // Cari DIREKTIFNYA (template literal), bukan komentar yang menyebutnya.
  const baris = sumber.split("\n").find((b) => b.includes("`script-src"));
  assert.ok(baris, "next.config.ts harus punya baris direktif `script-src");
  // Bentuk yang diizinkan: unsafe-eval hanya di cabang development === true.
  assert.match(
    baris!,
    /`script-src 'self' 'unsafe-inline'\$\{process\.env\.NODE_ENV === "development" \? " 'unsafe-eval'" : ""\}`/,
    "script-src berubah bentuk — pastikan unsafe-eval TETAP hanya di cabang development, lalu perbarui tes ini secara sadar"
  );
});

test("tidak ada unsafe-eval tak-bersyarat di mana pun di next.config.ts", () => {
  for (const b of sumber.split("\n")) {
    if (!b.includes("unsafe-eval")) continue;
    const ok = b.includes('NODE_ENV === "development"') || b.trim().startsWith("//") || b.trim().startsWith("*");
    assert.ok(ok, `unsafe-eval di luar cabang development: ${b.trim()}`);
  }
});
