// GETAR TAP: jangan memanggil vibrate() saat kita SUDAH TAHU akan ditolak.
//
// Dilaporkan Brian 7 Sep 2026 dari console:
//   [Intervention] Blocked call to navigator.vibrate because user hasn't
//   tapped on the frame or any embedded frame yet
//
// Chrome menolak vibrate() sampai halaman pernah benar-benar disentuh. Kita
// memanggilnya di pointerdown, jadi tap PERTAMA sesudah halaman dimuat selalu
// ditolak — satu baris peringatan per sesi, dan tap pertama yang tidak pernah
// bergetar. try/catch tidak menolong: ini intervensi yang ditulis Chrome, bukan
// lemparan yang bisa ditangkap.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const kode = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");

test("vibrate dijaga userActivation, bukan cuma try/catch", () => {
  const src = kode("app/_components/SiteChrome.tsx");
  assert.match(src, /userActivation/, "tidak memeriksa aktivasi pengguna");
  assert.match(src, /hasBeenActive/, "tidak memakai hasBeenActive");
  // Penjagaannya harus MENDAHULUI panggilannya, kalau tidak ia tidak mencegah
  // apa pun.
  const iJaga = src.indexOf("hasBeenActive");
  const iVibrate = src.indexOf("navigator.vibrate");
  assert.ok(iJaga >= 0 && iVibrate > iJaga, "penjagaan tidak mendahului panggilan vibrate");
});

test("browser tanpa userActivation tetap dilewatkan, bukan diblokir selamanya", () => {
  // Safari lama tidak punya userActivation DAN tidak punya vibrate. Menolak
  // saat propertinya tidak ada berarti mematikan haptic di browser yang
  // sebenarnya tidak bermasalah.
  const src = kode("app/_components/SiteChrome.tsx");
  assert.match(src, /if \(aktivasi && !aktivasi\.hasBeenActive\) return;/, "penjagaan tidak menoleransi browser tanpa userActivation");
});

test("try/catch TETAP ada — penjagaan menambah, bukan menggantikan", () => {
  // vibrate masih bisa melempar di konteks lain (iframe tanpa izin).
  assert.match(kode("app/_components/SiteChrome.tsx"), /try \{ navigator\.vibrate\?\.\(8\); \} catch/);
});
