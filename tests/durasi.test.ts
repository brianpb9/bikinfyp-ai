// DURASI — satu sumber, dan 8 detik sebagai bawaan.
//
// Sebelum 26 Agu 2026 daftar [15, 30, 45] disalin di delapan tempat. Yang
// berbahaya bukan duplikasinya, tapi bentuk kegagalannya: salinan yang
// terlewat tidak error — ia MENOLAK durasi yang di layar terlihat sah.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-durasi-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-durasi-storage-${process.pid}`;

const D = await import("../lib/durasi");
const { CAMPAIGN_TEMPLATES } = await import("../lib/templates");

test("BAWAAN 8 detik, dan 8 ada di daftar yang didukung", () => {
  assert.equal(D.DURASI_BAWAAN, 8);
  assert.ok(D.durasiDidukung(8));
  assert.deepEqual([...D.DURASI_DIDUKUNG], [8, 15, 30, 45]);
});

test("TVC menolak 8 detik — 8/3 beat tidak membagi habis", () => {
  // Durasi shot berpecahan dibulatkan NAIK oleh BytePlus, jadi pesanan 8 detik
  // diam-diam keluar 9 detik. Cacat yang sama pernah membuat 45 jadi 48.
  assert.equal(D.durasiSahUntukFormat("tvc", 8), false);
  assert.equal(D.durasiSahUntukFormat("tvc", 15), true);
  assert.equal(D.durasiBawaanUntukFormat("tvc"), 30);
  // Format lain justru sebaliknya.
  assert.equal(D.durasiSahUntukFormat("talking_head", 8), true);
  assert.equal(D.durasiBawaanUntukFormat("talking_head"), 8);
});

test("durasi di luar daftar ditolak, termasuk yang mirip", () => {
  for (const d of [0, 7, 9, 10, 20, 60, -8, NaN]) {
    assert.equal(D.durasiSahUntukFormat("hands_only", d), false, `${d} lolos padahal tidak didukung`);
  }
});

test("TIDAK ADA salinan daftar durasi yang tersisa di kode", () => {
  // Penjaga sebenarnya: begitu seseorang menulis ulang [15, 30, 45] di tempat
  // baru, durasi berikutnya yang ditambahkan akan meleset lagi di sana.
  const akar = process.cwd();
  const korban: string[] = [];
  const telusur = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (["node_modules", ".next", ".git", "test_output"].includes(e.name)) continue;
        telusur(f);
      } else if (/\.tsx?$/.test(e.name) && !f.includes("/tests/")) {
        // Komentar dikecualikan: catatan sejarah BOLEH menyebut daftar lama,
        // yang dilarang adalah daftar yang ikut dieksekusi.
        const isi = fs
          .readFileSync(f, "utf8")
          .split("\n")
          .filter((b) => !/^\s*(\/\/|\*|\/\*)/.test(b))
          .join("\n");
        if (/\[\s*15\s*,\s*30\s*,\s*45\s*\]/.test(isi)) korban.push(path.relative(akar, f));
      }
    }
  };
  for (const d of ["app", "lib"]) telusur(path.join(akar, d));
  assert.deepEqual(korban, [], `daftar durasi disalin lagi di: ${korban.join(", ")}`);
});

test("KATALOG belum punya template 8 detik — dan itu tercatat, bukan terlupa", () => {
  // Memindahkan 12 template affiliate ke 8 detik ditolak audit katalog: L-05
  // menghitung jatah kata berskala dari 15 detik, jadi 40 varian melewati
  // batas sekaligus. Naskahnya memang ditulis untuk 15 detik.
  //
  // Test ini SENGAJA menegaskan keadaan sekarang, supaya saat naskah 8 detik
  // benar-benar ditulis, ia ikut gagal dan memaksa catatan ini diperbarui —
  // bukan supaya 8 detik dilarang selamanya.
  const delapan = CAMPAIGN_TEMPLATES.filter((t) => t.durationSec === 8);
  assert.deepEqual(
    delapan.map((t) => t.id),
    [],
    "sudah ada template 8 detik — pastikan naskahnya lolos audit katalog, lalu perbarui catatan di lib/templates.ts"
  );
});
