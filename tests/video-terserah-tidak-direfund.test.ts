// Video yang SUDAH diserahkan tidak boleh direfund.
//
// Cacat aslinya sempit tapi nyata. Urutan di worker adalah:
//
//   markReady(job)          -> job.state = 'READY', video sudah bisa diunduh
//   captureCredits(job)     -> koneksi lain, transaksi lain
//
// Di celah antara keduanya, ledger job itu cuma punya baris 'hold'. Setiap
// pemanggil releaseCredits melihat "belum ada catatan terminal" dan merefund
// penuh — padahal videonya sudah di tangan pengguna. Tiga jalur bisa masuk ke
// celah itu, dan yang paling mungkin adalah yang paling berbahaya:
// lib/promo/worker.ts membungkus captureCredits di dalam try, sehingga
// captureCredits YANG GAGAL langsung memicu releaseCredits di blok catch-nya.
//
// failJob() memang sudah menolak job READY, tapi penjagaan itu ada di
// pemanggil, bukan di ledger — dan scripts/worker.ts serta lib/promo/worker.ts
// memanggil releaseCredits tanpa lewat failJob sama sekali.
//
// Tes ini memasang persis keadaan celah itu lalu memanggil releaseCredits
// langsung, seperti yang dilakukan kedua pemanggil tersebut.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-refund-ready-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-refund-ready-storage-${process.pid}`;

const { getDb } = await import("../lib/db");
const { findOrCreateUserByPhone } = await import("../lib/auth");
const { getBalance, holdCredits, releaseCredits, creditTopup } = await import("../lib/credits");

const db = getDb();
const user = findOrCreateUserByPhone("089999000222");
// Bonus onboarding saja (Rp12.000) hanya cukup untuk SATU hold. Tes pertama
// sengaja tidak mengembalikan hold-nya — itu inti perkaranya — jadi tanpa
// topup dua tes berikutnya gagal karena saldo habis, bukan karena cacat.
creditTopup({ userId: user.id, packageId: "hq5", gateway: "manual", gatewayRef: `uji-refund-${process.pid}` });
const saldoAwal = getBalance(user.id);

function pasangJob(id: string, state: string) {
  const t = new Date().toISOString();
  db.prepare("INSERT INTO products (id,user_id,name,category,price_idr,images,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(`p-${id}`, user.id, "Sabun Uji", "beauty", 24620, "[]", t);
  db.prepare("INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(`s-${id}`, `p-${id}`, "problem_solution", "lega", "santai", "[]", "cap", "[]", "{}", t);
  db.prepare("INSERT INTO jobs (id,user_id,product_id,script_id,format,quality_tier,duration_s,state,created_at,state_changed_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, user.id, `p-${id}`, `s-${id}`, "hands_only", "high_quality", 15, state, t, t);
}

test("job READY dengan hold belum ter-capture TIDAK boleh direfund", () => {
  pasangJob("job-ready", "READY");
  assert.equal(holdCredits(user.id, "job-ready", 12000), true);
  const sesudahHold = getBalance(user.id);
  assert.equal(sesudahHold, saldoAwal - 12000, "hold memotong saldo, seperti biasa");

  // Persis panggilan yang dilakukan scripts/worker.ts (backstop stalled) dan
  // lib/promo/worker.ts (blok catch yang membungkus captureCredits).
  const dikembalikan = releaseCredits(user.id, "job-ready");

  assert.equal(dikembalikan, 0, "videonya sudah diserahkan — tidak ada yang boleh dikembalikan");
  assert.equal(getBalance(user.id), sesudahHold, "saldo tidak boleh naik lagi");
  const release = db.prepare("SELECT id FROM credit_ledger WHERE job_id = ? AND type = 'release'").get("job-ready");
  assert.equal(release, undefined, "tidak boleh ada baris release untuk job READY");
});

test("job yang benar-benar gagal tetap direfund penuh", () => {
  pasangJob("job-gagal", "GENERATING_VISUAL");
  const sebelum = getBalance(user.id);
  assert.equal(holdCredits(user.id, "job-gagal", 12000), true);

  const dikembalikan = releaseCredits(user.id, "job-gagal");

  assert.equal(dikembalikan, 12000, "job yang gagal wajib dikembalikan utuh");
  assert.equal(getBalance(user.id), sebelum, "saldo kembali seperti sebelum hold");
});

test("hold tanpa baris job sama sekali tetap bisa dilepas", () => {
  // Skrip paritas kredit memakai id job karangan yang tidak ada di tabel jobs.
  // Penjagaan baru tidak boleh ikut memblokir kasus itu.
  const sebelum = getBalance(user.id);
  assert.equal(holdCredits(user.id, "job-tak-ada", 12000), true);
  assert.equal(releaseCredits(user.id, "job-tak-ada"), 12000);
  assert.equal(getBalance(user.id), sebelum);
});
