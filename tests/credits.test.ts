// Unit test ledger kredit — DENOMINASI RUPIAH (keputusan final 3-tier):
// hold sebesar harga tier, capture/release, append-only,
// webhook duplikat tidak menggandakan saldo (BR-10.3).

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-credits-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-credits-storage-${process.pid}`;

const { getDb } = await import("../lib/db");
const { findOrCreateUserByPhone } = await import("../lib/auth");
const { getBalance, holdCredits, captureCredits, releaseCredits, creditTopup, tierPriceIdr } = await import("../lib/credits");

const db = getDb();
const user = findOrCreateUserByPhone("089999000111"); // bonus onboarding: Rp5.000

test("user baru dapat bonus Rp5.000 (cukup 1 video Senyap+Teks)", () => {
  assert.equal(getBalance(user.id), 5000);
  const row = db.prepare("SELECT * FROM credit_ledger WHERE user_id = ? AND type = 'bonus'").get(user.id) as { delta: number };
  assert.equal(row.delta, 5000);
});

test("harga tier sesuai keputusan final: 5000 / 12000 / 49000", () => {
  assert.equal(tierPriceIdr("silent_caption"), 5000);
  assert.equal(tierPriceIdr("high_quality"), 12000);
  assert.equal(tierPriceIdr("super_hq"), 49000);
});

test("topup menambah saldo rupiah via ledger", () => {
  const r = creditTopup({ userId: user.id, packageId: "senyap5", gateway: "test", gatewayRef: "ref-1" });
  assert.equal(r.duplicated, false);
  assert.equal(r.amountIdr, 25000);
  assert.equal(getBalance(user.id), 30000);
});

test("hold sebesar harga tier; capture tidak mengubah saldo (hold jadi final)", () => {
  assert.equal(holdCredits(user.id, "job-1", 5000), true);
  assert.equal(getBalance(user.id), 25000);
  captureCredits(user.id, "job-1");
  assert.equal(getBalance(user.id), 25000); // delta capture = 0
});

test("release setelah capture = no-op (uang tidak kembali dua kali)", () => {
  const refunded = releaseCredits(user.id, "job-1");
  assert.equal(refunded, 0);
  assert.equal(getBalance(user.id), 25000);
});

test("hold -> release mengembalikan rupiah persis sebesar hold", () => {
  assert.equal(holdCredits(user.id, "job-2", 12000), true);
  assert.equal(getBalance(user.id), 13000);
  const refunded = releaseCredits(user.id, "job-2");
  assert.equal(refunded, 12000);
  assert.equal(getBalance(user.id), 25000);
  assert.equal(releaseCredits(user.id, "job-2"), 0);
  assert.equal(getBalance(user.id), 25000);
});

test("hold ditolak bila saldo kurang dari harga tier", () => {
  const miskin = findOrCreateUserByPhone("089999000222"); // bonus Rp5.000
  assert.equal(holdCredits(miskin.id, "job-x", 12000), false);
  assert.equal(getBalance(miskin.id), 5000);
  assert.equal(holdCredits(miskin.id, "job-y", 5000), true);
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
