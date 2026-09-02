import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-robustness-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-robustness-storage-${process.pid}`;
process.env.RACUN_WORKER_DISABLED = "1";

const { validPriceIdr, validProductName } = await import("../lib/product-validation");
const { getDb, now, uuid } = await import("../lib/db");
const { findOrCreateUserByPhone } = await import("../lib/auth");
const { getBalance, holdCredits } = await import("../lib/credits");
const { failJob, getJob, transition } = await import("../lib/jobs");

test("nama emoji-saja dan harga malformed ditolak server-side", () => {
  assert.equal(validProductName("✨🔥"), null);
  assert.equal(validProductName("Serum ✨"), "Serum ✨");
  assert.equal(validPriceIdr("-100"), null);
  assert.equal(validPriceIdr("12000abc"), null);
  assert.equal(validPriceIdr("12000"), 12000);
});

test("failJob idempoten: refund sekali dan tidak pernah menimpa READY", async () => {
  const db = getDb();
  const user = findOrCreateUserByPhone("086666000333");
  const productId = uuid();
  const scriptId = uuid();
  db.prepare("INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES (?,?, 'P',1000,'default','[]',?)").run(productId, user.id, now());
  db.prepare("INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,approved_by_user_at,created_at) VALUES (?,?, 'H1','x','netral','[]','','[]','{}',?,?)").run(scriptId, productId, now(), now());
  const jobId = uuid();
  db.prepare("INSERT INTO jobs (id,user_id,product_id,script_id,format,duration_s,state,created_at,state_changed_at) VALUES (?,?,?,?, 'hands_only',15,'QUEUED',?,?)").run(jobId, user.id, productId, scriptId, now(), now());
  // Saldo rupiah diisi eksplisit: pendaftaran tidak lagi memberi rupiah sejak
  // render dibayar dengan jatah video. Mekanik hold/release-nya sendiri masih
  // hidup (jalur promo), jadi tes ini tetap menjaganya.
  db.prepare(
    "INSERT INTO credit_ledger (id,user_id,delta,type,job_id,payment_id,created_at) VALUES (?,?,?,?,NULL,NULL,?)"
  ).run(uuid(), user.id, 5000, "bonus", now());
  assert.ok(holdCredits(user.id, jobId, 5000));
  // Jatah video ikut dipotong, supaya pengembaliannya bisa diperiksa di bawah.
  // Jatahnya datang dari paket gratis pendaftaran (1 video premium) — tidak
  // perlu ditambah, dan menambahnya justru menyembunyikan apakah paket gratis
  // itu benar-benar diberikan.
  const { pakaiKredit, sisaKredit } = await import("../lib/kredit-video-sqlite");
  assert.equal(pakaiKredit(user.id, "premium", jobId), "topup");
  assert.equal(sisaKredit(user.id).premium.total, 0);
  const before = getBalance(user.id);
  failJob(getJob(jobId)!, "provider timeout");
  failJob(getJob(jobId)!, "provider timeout lagi");
  assert.equal(getJob(jobId)!.state, "REFUNDED");
  assert.equal(getBalance(user.id), before + 5000);
  // Jatah video kembali PERSIS SEKALI, walau failJob dipanggil dua kali.
  assert.equal(sisaKredit(user.id).premium.total, 1);
  db.prepare("UPDATE jobs SET state = 'READY' WHERE id = ?").run(jobId);
  failJob(getJob(jobId)!, "stale sweep");
  assert.equal(getJob(jobId)!.state, "READY");
});

test("job yang sudah direfund tidak bisa dihidupkan lagi oleh worker terlambat", () => {
  const db = getDb();
  const user = findOrCreateUserByPhone("086666000444");
  const productId = uuid();
  const scriptId = uuid();
  db.prepare("INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES (?,?, 'P',1000,'default','[]',?)").run(productId, user.id, now());
  db.prepare("INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,approved_by_user_at,created_at) VALUES (?,?, 'H1','x','netral','[]','','[]','{}',?,?)").run(scriptId, productId, now(), now());
  const jobId = uuid();
  db.prepare("INSERT INTO jobs (id,user_id,product_id,script_id,format,duration_s,state,created_at,state_changed_at) VALUES (?,?,?,?, 'hands_only',15,'QUEUED',?,?)").run(jobId, user.id, productId, scriptId, now(), now());
  failJob(getJob(jobId)!, "timeout sweep");
  assert.equal(transition(jobId, "GENERATING_VOICE"), false);
  assert.equal(transition(jobId, "READY"), false);
  assert.equal(getJob(jobId)!.state, "REFUNDED");
});
