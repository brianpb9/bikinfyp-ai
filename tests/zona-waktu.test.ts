// ZONA WAKTU — Asia/Jakarta untuk TAMPILAN, UTC untuk PENYIMPANAN.
//
// Pembedaan ini yang menjaga data tetap benar. Menyimpan waktu dalam zona
// lokal membuat urutan dan perbandingan rusak begitu zona server berubah —
// dan kerusakannya baru terlihat berbulan-bulan kemudian, saat tidak ada lagi
// yang ingat servernya pernah pindah zona.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-tz-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-tz-storage-${process.pid}`;

const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

test("waktu DISIMPAN sebagai ISO UTC, apa pun zona prosesnya", async () => {
  const { now } = await import("../lib/db");
  const t = now();
  assert.match(t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `now() bukan ISO UTC: ${t}`);
  assert.ok(t.endsWith("Z"), "waktu tersimpan kehilangan penanda UTC");
});

test("now() TIDAK memakai waktu lokal", () => {
  // Penjagaan terhadap "perbaikan" yang tampak masuk akal: mengganti
  // toISOString() dengan waktu lokal agar log "enak dibaca". Itu akan
  // merusak seluruh perbandingan created_at, yang di skema ini bertipe TEXT
  // dan diurutkan secara leksikografis.
  const src = baca("lib/db.ts");
  assert.match(src, /export const now = \(\) => new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(src, /export const now[^\n]*toLocaleString/);
});

test("keempat layanan berjalan di Asia/Jakarta", () => {
  const compose = baca("docker-compose.server.yml");
  const jumlah = (compose.match(/TZ: Asia\/Jakarta/g) ?? []).length;
  assert.equal(jumlah, 4, `TZ terpasang di ${jumlah} layanan, seharusnya 4 (postgres, redis, web, worker)`);
});

test("jadwal cadangan memakai jam LOKAL, bukan UTC lama", () => {
  // Sejak zona server pindah ke Jakarta, systemd membaca OnCalendar dalam
  // waktu lokal. Membiarkan 19:00 berarti cadangan berjalan jam 7 malam —
  // saat orang justru sedang memakai sistemnya.
  const timer = baca("deploy/bikinfyp-backup.timer");
  assert.match(timer, /OnCalendar=\*-\*-\* 02:00:00/);
  assert.doesNotMatch(timer, /OnCalendar=\*-\*-\* 19:00:00/);
  assert.match(timer, /Persistent=true/, "satu reboot di jam jadwal akan melewatkan cadangan diam-diam");
});
