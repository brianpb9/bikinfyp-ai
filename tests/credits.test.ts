// Unit test ledger kredit — DENOMINASI RUPIAH (keputusan final 3-tier):
// hold sebesar harga tier, capture/release, append-only,
// webhook duplikat tidak menggandakan saldo (BR-10.3).

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-credits-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-credits-storage-${process.pid}`;

const { getDb } = await import("../lib/db");
const { config } = await import("../lib/config");
const { findOrCreateUserByPhone } = await import("../lib/auth");
const { getBalance, holdCredits, captureCredits, releaseCredits, creditTopup, tierPriceIdr } = await import("../lib/credits");

const db = getDb();
const user = findOrCreateUserByPhone("089999000111");

// DOMPET RUPIAH SEKARANG WARISAN, bukan alat bayar render.
//
// Sejak 2 Sep 2026 render dibayar dengan JATAH VIDEO per jenis (lihat
// tests/kredit-video.test.ts). Mekanik hold/capture/release di bawah masih
// hidup dan masih dipakai jalur promo, jadi tesnya dipertahankan apa adanya —
// yang berubah cuma dari mana saldo awalnya datang: dulu bonus pendaftaran,
// sekarang diisi eksplisit di sini supaya tesnya menguji mekaniknya, bukan
// menguji kebijakan bonus yang sudah pindah.
db.prepare(
  "INSERT INTO credit_ledger (id, user_id, delta, type, job_id, payment_id, created_at) VALUES (?,?,?,?,NULL,NULL,?)"
).run("seed-saldo-uji", user.id, 12000, "bonus", new Date().toISOString());

test("pendaftar baru TIDAK lagi menerima saldo rupiah — ia menerima jatah video", () => {
  // Bonus rupiah untuk pendaftar sudah dihapus: rupiah tidak membeli apa pun
  // lagi, jadi memberikannya berarti menjanjikan saldo yang ditolak tepat saat
  // orang menekan Bikin.
  const bonusRupiah = db
    .prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE user_id = ? AND type = 'bonus' AND id != 'seed-saldo-uji'")
    .get(user.id) as { n: number };
  assert.equal(bonusRupiah.n, 0, "pendaftaran masih menulis bonus rupiah");

  const jatah = db
    .prepare("SELECT jenis, delta FROM kredit_video WHERE user_id = ? AND tipe = 'bonus'")
    .all(user.id) as { jenis: string; delta: number }[];
  assert.equal(jatah.length, 1, "pendaftar baru tidak menerima paket gratis apa pun");
  // Jumlah dan jenisnya mengikuti config, bukan dipaku di sini: yang dijaga
  // adalah "pendaftar menerima jatah VIDEO, sekali", bukan jenis mana yang
  // sedang dipilih sebagai promosi.
  assert.equal(jatah[0].delta, config.signupBonusQty);
  assert.equal(jatah[0].jenis, config.signupBonusJenis);
});

test("harga tier sesuai keputusan final: 5000 / 12000 / 80000", () => {
  assert.equal(tierPriceIdr("silent_caption"), 5000);
  assert.equal(tierPriceIdr("high_quality"), 12000);
  assert.equal(tierPriceIdr("super_hq"), 80000); // r7: presenter/lipsync premium
});

test("topup menambah saldo rupiah via ledger", () => {
  const r = creditTopup({ userId: user.id, packageId: "hq5", gateway: "test", gatewayRef: "ref-1" });
  assert.equal(r.duplicated, false);
  assert.equal(r.amountIdr, 60000);
  assert.equal(getBalance(user.id), 72000);
});

test("hold sebesar harga tier; capture tidak mengubah saldo (hold jadi final)", () => {
  assert.equal(holdCredits(user.id, "job-1", 5000), true);
  assert.equal(getBalance(user.id), 67000);
  captureCredits(user.id, "job-1");
  assert.equal(getBalance(user.id), 67000); // delta capture = 0
});

test("release setelah capture = no-op (uang tidak kembali dua kali)", () => {
  const refunded = releaseCredits(user.id, "job-1");
  assert.equal(refunded, 0);
  assert.equal(getBalance(user.id), 67000);
});

test("hold -> release mengembalikan rupiah persis sebesar hold", () => {
  assert.equal(holdCredits(user.id, "job-2", 12000), true);
  assert.equal(getBalance(user.id), 55000);
  const refunded = releaseCredits(user.id, "job-2");
  assert.equal(refunded, 12000);
  assert.equal(getBalance(user.id), 67000);
  assert.equal(releaseCredits(user.id, "job-2"), 0);
  assert.equal(getBalance(user.id), 67000);
});

test("hold ditolak bila saldo kurang dari harga tier", () => {
  const miskin = findOrCreateUserByPhone("089999000222");
  // Saldo diisi eksplisit, sama alasannya dengan seed di atas: pendaftaran
  // tidak lagi memberi rupiah.
  db.prepare(
    "INSERT INTO credit_ledger (id, user_id, delta, type, job_id, payment_id, created_at) VALUES (?,?,?,?,NULL,NULL,?)"
  ).run("seed-saldo-miskin", miskin.id, 12000, "bonus", new Date().toISOString());
  assert.equal(holdCredits(miskin.id, "job-x", 80000), false); // Super HQ > saldo
  assert.equal(getBalance(miskin.id), 12000);
  assert.equal(holdCredits(miskin.id, "job-y", 12000), true); // AI Bersuara pas
});

test("webhook/topup duplikat via gateway_ref tidak menggandakan saldo", () => {
  const before = getBalance(user.id);
  for (let i = 0; i < 5; i++) {
    const r = creditTopup({ userId: user.id, packageId: "hq10", gateway: "stub", gatewayRef: "ref-dup" });
    if (i > 0) assert.equal(r.duplicated, true);
  }
  assert.equal(getBalance(user.id), before + 120000); // hanya bertambah 1x
});

test("ledger append-only: tidak ada UPDATE/DELETE pada credit_ledger di kode", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../lib/credits.ts", import.meta.url), "utf8");
  assert.ok(!/UPDATE\s+credit_ledger/i.test(src));
  assert.ok(!/DELETE\s+FROM\s+credit_ledger/i.test(src));
});
