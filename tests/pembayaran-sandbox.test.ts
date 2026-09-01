// Koreksi Brian 20 Agu: Duitku masih SANDBOX (approval merchant tertunda).
//
// Dua invarian uang yang dikunci di sini:
//   1. payments_live TIDAK BOLEH true selama payments_env = sandbox — apa pun
//      isi PAYMENTS_GO_LIVE. Sebelumnya health menjawab live hanya karena kunci
//      sandbox terpasang, jadi landing mengiklankan "checkout aman" dan tombol
//      beli terbuka padahal yang mengalir uang mainan.
//   2. Callback sandbox tidak boleh mengisi dompet nyata tanpa penanda uji.
//      Bukan kekhawatiran teoretis: 19 Agu satu callback sandbox benar-benar
//      mengkredit Rp60.000 ke dompet pengguna produksi.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-sandbox-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-sandbox-storage-${process.pid}`;
process.env.RACUN_WORKER_DISABLED = "1";
process.env.PAYMENT_GATEWAY = "duitku";
process.env.DUITKU_MERCHANT_CODE = "DS34363";
process.env.DUITKU_API_KEY = "kunci-uji-sandbox";
process.env.DUITKU_IS_PRODUCTION = "false";
process.env.ADMIN_EMAILS = "penguji@bikinfyp.test";

const { paymentsEnv, paymentsLive, paymentsProvider, paymentsConfigured } = await import("../lib/config");

test("kontrak health: provider duitku, env sandbox, live FALSE", () => {
  assert.equal(paymentsProvider(), "duitku");
  assert.equal(paymentsEnv(), "sandbox");
  assert.equal(paymentsConfigured(), true, "kunci sandbox memang terpasang — itu kesiapan teknis, bukan izin");
  assert.equal(paymentsLive(), false, "sandbox tidak boleh mengaku live");
});

test("PAYMENTS_GO_LIVE=true TIDAK bisa membuat sandbox jadi live", async () => {
  const asli = process.env.PAYMENTS_GO_LIVE;
  process.env.PAYMENTS_GO_LIVE = "true";
  try {
    // config di-cache pada impor pertama, jadi izinnya dibaca ulang lewat modul
    // segar untuk menguji kombinasi env yang sebenarnya.
    const segar = await import(`../lib/config?sandbox-go-live=${Date.now()}`);
    assert.equal(segar.paymentsEnv(), "sandbox");
    assert.equal(
      segar.paymentsLive(),
      false,
      "izin manusia TIDAK boleh mengalahkan kenyataan lingkungan — sandbox tetap sandbox"
    );
  } finally {
    if (asli === undefined) delete process.env.PAYMENTS_GO_LIVE;
    else process.env.PAYMENTS_GO_LIVE = asli;
  }
});

test("production + kunci terpasang tapi TANPA izin -> tetap tidak live", async () => {
  const aslinya = { prod: process.env.DUITKU_IS_PRODUCTION, izin: process.env.PAYMENTS_GO_LIVE };
  process.env.DUITKU_IS_PRODUCTION = "true";
  delete process.env.PAYMENTS_GO_LIVE;
  try {
    const segar = await import(`../lib/config?prod-tanpa-izin=${Date.now()}`);
    assert.equal(segar.paymentsEnv(), "production");
    assert.equal(segar.paymentsLive(), false, "butuh keputusan eksplisit Brian, bukan sekadar flag production");
  } finally {
    process.env.DUITKU_IS_PRODUCTION = aslinya.prod ?? "false";
    if (aslinya.izin !== undefined) process.env.PAYMENTS_GO_LIVE = aslinya.izin;
  }
});

test("callback sandbox TIDAK mengkredit dompet pengguna biasa", async () => {
  const crypto = await import("node:crypto");
  const { getDb, now, uuid } = await import("../lib/db");
  const { findOrCreateUserByPhone } = await import("../lib/auth");
  const { getBalance } = await import("../lib/credits");
  const { POST: webhook } = await import("../app/api/webhooks/duitku/route");

  const db = getDb();
  const user = findOrCreateUserByPhone("085555111222"); // BUKAN ADMIN_EMAILS
  const orderId = `racun-sandbox-${uuid().slice(0, 8)}`;
  db.prepare(
    "INSERT INTO payments (id, user_id, gateway, gateway_ref, amount_idr, credits, status, raw_payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(uuid(), user.id, "duitku", orderId, 60000, 60000, "pending",
    JSON.stringify({ package_id: "hq5", payments_env: "sandbox" }), now());

  const sig = crypto.createHash("md5").update("DS34363" + "60000" + orderId + "kunci-uji-sandbox").digest("hex");
  const sebelum = getBalance(user.id);
  const res = await webhook(new Request("http://localhost/api/webhooks/duitku", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ merchantCode: "DS34363", amount: "60000", merchantOrderId: orderId, resultCode: "00", signature: sig }).toString(),
  }));

  assert.equal(res.status, 200, "Duitku harus berhenti mengulang");
  const body = await res.json();
  assert.equal(body.credited, false, "dompet pengguna biasa TIDAK boleh terisi dari sandbox");
  assert.equal(getBalance(user.id), sebelum, "saldo tidak boleh berubah");
  const pay = db.prepare("SELECT status FROM payments WHERE gateway_ref = ?").get(orderId) as { status: string };
  assert.equal(pay.status, "pending", "order tetap pending untuk rekonsiliasi, bukan diam-diam paid");
  const jejak = db.prepare("SELECT action FROM audit_log WHERE entity_id = ? ORDER BY rowid DESC LIMIT 1").get(orderId) as { action: string } | undefined;
  assert.equal(jejak?.action, "webhook.sandbox_ditolak", "penolakan wajib meninggalkan jejak audit");
});

test("callback sandbox TETAP mengkredit penguji terdaftar", async () => {
  const crypto = await import("node:crypto");
  const { getDb, now, uuid } = await import("../lib/db");
  const { getBalance } = await import("../lib/credits");
  const { POST: webhook } = await import("../app/api/webhooks/duitku/route");

  const db = getDb();
  const id = uuid();
  db.prepare("INSERT INTO users (id, phone, email, name, tier, locale, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, null, "penguji@bikinfyp.test", "Penguji", "free", "id", now());
  const orderId = `racun-sandbox-admin-${uuid().slice(0, 8)}`;
  db.prepare(
    "INSERT INTO payments (id, user_id, gateway, gateway_ref, amount_idr, credits, status, raw_payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(uuid(), id, "duitku", orderId, 60000, 60000, "pending",
    JSON.stringify({ package_id: "hq5", payments_env: "sandbox" }), now());

  const sig = crypto.createHash("md5").update("DS34363" + "60000" + orderId + "kunci-uji-sandbox").digest("hex");
  const sebelum = getBalance(id);
  const res = await webhook(new Request("http://localhost/api/webhooks/duitku", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ merchantCode: "DS34363", amount: "60000", merchantOrderId: orderId, resultCode: "00", signature: sig }).toString(),
  }));
  const body = await res.json();
  assert.equal(body.credited, true, "penguji terdaftar harus tetap bisa menguji settlement");
  assert.equal(getBalance(id), sebelum + 60000);
});

// ── Checkout sandbox dibuka 26 Agu 2026 ──────────────────────────────────────
//
// Pendaftaran merchant Duitku DITOLAK dengan alasan: "Mohon menambahkan fitur
// checkout/fitur pembelian hingga pembayaran pada website (silakan
// mengintegrasikan website dengan Sandbox Duitku)."
//
// Penyebabnya bukan backend — jalur /api/credits/checkout -> invoice Duitku ->
// callback sudah lengkap. Penyebabnya halaman kredit menutup tombol beli
// berdasarkan payments_live, dan payments_live SELALU false di sandbox. Kita
// menutup sendiri alur yang diminta untuk diperlihatkan.
//
// Perbaikannya memisahkan dua pertanyaan yang selama ini satu boolean. Test di
// bawah menjaga agar pemisahan itu tidak berubah jadi pelonggaran: sandbox
// boleh CHECKOUT, tapi tidak pernah boleh MENGAKU uang sungguhan.

import fs from "node:fs";
import path from "node:path";

const HALAMAN = fs.readFileSync(path.join(process.cwd(), "app/kredit/page.tsx"), "utf8");
const META = fs.readFileSync(path.join(process.cwd(), "app/api/meta/route.ts"), "utf8");

test("meta memisahkan 'kunci terpasang' dari 'uang sungguhan'", () => {
  assert.match(META, /payments_configured:\s*paymentsConfigured\(\)/);
  assert.match(META, /payments_live:\s*paymentsLive\(\)/);
  // Invarian lama tetap: sandbox tidak pernah live.
  assert.equal(paymentsConfigured(), true);
  assert.equal(paymentsLive(), false);
});

test("tombol beli TIDAK lagi digantung pada payments_live", () => {
  // Kalau tombolnya kembali dikunci payments_live, checkout mati lagi di
  // sandbox dan penolakan Duitku terulang.
  // Awalan ekspresi, bukan seluruhnya. Sejak 2 Sep tombol juga menunggu
  // pembeli memilih kanal (QRIS/VA) — syarat yang MEMPERKETAT, jadi
  // memaksa kecocokan persis akan menandai pengetatan sebagai regresi.
  assert.match(HALAMAN, /disabled=\{busy !== null \|\| bisaBayar !== true/);
  assert.doesNotMatch(HALAMAN, /disabled=\{busy !== null \|\| paymentsLive !== true\}/);
});

test("default tetap TERTUTUP selagi server belum menjawab", () => {
  // "!== true", bukan "=== false": keadaan null (belum dijawab) harus ikut
  // menutup tombol. Ini temuan audit QA 16 Agu dan tidak boleh hilang hanya
  // karena pertanyaannya berganti.
  assert.match(HALAMAN, /bisaBayar !== true/);
  assert.doesNotMatch(HALAMAN, /bisaBayar === false \?\s*false/);
});

test("MODE UJI dikatakan terang-terangan, bukan disembunyikan", () => {
  // Membiarkan orang menyelesaikan pembayaran sandbox lalu heran kreditnya
  // tidak bertambah adalah kegagalan yang bisa diramalkan.
  assert.match(HALAMAN, /Mode uji coba/);
  assert.match(HALAMAN, /tidak ada uang sungguhan yang dipotong/);
  assert.match(HALAMAN, /modeSandbox/);
});

test("klaim UANG SUNGGUHAN tetap dikunci payments_live", () => {
  // Yang boleh longgar cuma tombolnya. Klaim keamanan/uang sungguhan tetap
  // menunggu production + izin.
  assert.match(HALAMAN, /paymentsLive !== true && \(/);
  assert.match(HALAMAN, /belum memotong uang sungguhan/);
});
