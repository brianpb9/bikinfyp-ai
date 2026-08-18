import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * JANJI WAKTU RENDER HANYA BOLEH HIDUP DI lib/janji-waktu.ts.
 *
 * Board review 19 Agu §3.2: landing berkata "2–3 menit", dashboard "3–8
 * menit" — dua janji untuk satu mesin. Penyatuannya mudah; yang susah adalah
 * MENJAGANYA tetap satu saat halaman baru ditulis. Tes ini yang menjaganya:
 * tidak boleh ada kisaran menit hardcoded di app/.
 */
function* berkasTsx(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* berkasTsx(p);
    else if (/\.(tsx|ts)$/.test(e.name)) yield p;
  }
}

test("tidak ada kisaran menit hardcoded di app/ — semua lewat JANJI_WAKTU", () => {
  const pelanggar: string[] = [];
  for (const f of berkasTsx(path.join(process.cwd(), "app"))) {
    const s = fs.readFileSync(f, "utf8");
    // Kisaran "N–M menit" (en-dash atau minus). "Berlaku 5 menit" (OTP)
    // bukan kisaran, jadi tidak tersapu. Komentar dikecualikan — komentar yang
    // MENGUTIP pengukuran justru bagus.
    for (const baris of s.split("\n")) {
      const t = baris.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
      const m = t.match(/\d+\s*[–-]\s*\d+\s*menit/);
      if (m) pelanggar.push(`${path.relative(process.cwd(), f)}: "${m[0]}"`);
    }
  }
  assert.deepEqual(pelanggar, [], `Janji waktu hardcoded — pakai JANJI_WAKTU dari lib/janji-waktu.ts:\n${pelanggar.join("\n")}`);
});
