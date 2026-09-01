// HALAMAN ADMIN — dan satu perbandingan tipe yang mematikannya seluruhnya.
//
// Dilaporkan Brian 2 Sep: /admin menjawab "Application error: a server-side
// exception has occurred", digest 7516165. Di log:
//
//   error: operator does not exist: text > timestamp with time zone
//
// `created_at` bertipe TEXT di SELURUH skema — timestamp disimpan sebagai
// string ISO-8601. Query admin satu-satunya di repo ini yang meminta Postgres
// melakukan aritmetika waktu (`NOW() - INTERVAL '7 days'`), dan Postgres
// menolak membandingkannya dengan kolom text. Halaman gagal total, bukan
// sekadar salah angka.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-admin-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-admin-storage-${process.pid}`;

const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const kode = (p: string) =>
  baca(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((b) => !/^\s*\/\//.test(b))
    .join("\n");

test("admin TIDAK membandingkan kolom text dengan timestamp SQL", () => {
  const src = kode("app/admin/page.tsx");
  assert.doesNotMatch(src, /NOW\(\)\s*-\s*INTERVAL/i, "kembali meminta Postgres melakukan aritmetika waktu");
  assert.match(src, /created_at > \$1/, "batas waktu tidak lagi dikirim sebagai parameter");
  assert.match(src, /toISOString\(\)/, "ambang batas tidak dihitung sebagai ISO di JS");
});

test("SELURUH repo memakai pola yang sama untuk batas waktu", () => {
  // Yang membuat cacat ini bertahan: satu query menyimpang dari pola yang
  // dipakai semua query lain. Sapuan ini menjaga agar penyimpangan berikutnya
  // ketahuan sebelum sampai ke halaman orang.
  const akar = process.cwd();
  const korban: string[] = [];
  const telusur = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (["node_modules", ".next", ".git"].includes(e.name)) continue;
        telusur(f);
      } else if (/\.tsx?$/.test(e.name)) {
        const isi = kode(path.relative(akar, f));
        // Aritmetika waktu di SQL atas kolom yang bertipe text.
        if (/(created_at|completed_at|changed_at)\s*[<>]\s*NOW\(\)/i.test(isi)) korban.push(path.relative(akar, f));
      }
    }
  };
  for (const d of ["app", "lib"]) telusur(path.join(akar, d));
  assert.deepEqual(korban, [], `membandingkan kolom text dengan NOW(): ${korban.join(", ")}`);
});
