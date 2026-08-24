// Smoke test produksi untuk migrasi Duitku + syarat onboarding (2026-08-19).
//
// Jalankan terhadap deployment NYATA (bukan localhost):
//   node scripts/smoke-duitku-production.mjs
//   BASE_URL=https://bikinfyp.com node scripts/smoke-duitku-production.mjs
//
// Semua pemeriksaan bersifat AMAN untuk produksi: read-only, atau menulis
// hal yang memang dirancang ditolak (webhook signature palsu, checkout tanpa
// login). Tidak ada order atau invoice baru yang dibuat.
//
// Kredensial Duitku (untuk uji signature sah + transactionStatus) dibaca dari
// env DUITKU_MERCHANT_CODE / DUITKU_API_KEY — di mesin dev otomatis terisi
// dari .env.local lewat lib/config-style loader mini di bawah.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "https://bikinfyp.com";

// mini loader .env.local (tanpa impor lib/config agar skrip berdiri sendiri)
try {
  const file = path.join(process.cwd(), ".env.local");
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch { /* boleh tidak ada */ }

const MERCHANT = process.env.DUITKU_MERCHANT_CODE ?? "";
const APIKEY = process.env.DUITKU_API_KEY ?? "";
const DUITKU_BASE = process.env.DUITKU_IS_PRODUCTION === "true" ? "https://api-prod.duitku.com" : "https://api-sandbox.duitku.com";
// Order yang SUDAH paid dari uji e2e 19 Agu — dipakai untuk cek status read-only.
const PAID_ORDER = process.env.SMOKE_PAID_ORDER ?? "racun-9f1b7d04-18dbf97f-2c35";

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? "" });
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---- 1. Health & konfigurasi deploy ----
await check("health: kontrak pembayaran konsisten dengan lingkungannya", async () => {
  const r = await fetch(`${BASE}/api/health`);
  const d = await r.json();
  expect(r.status === 200 && d.ok === true, `health ${r.status} ok=${d.ok}`);
  expect(d.payments_provider === "duitku", `provider=${d.payments_provider}, harusnya duitku`);
  expect(["sandbox", "production"].includes(d.payments_env), `payments_env=${d.payments_env}`);
  // INVARIAN, bukan preferensi (koreksi Brian 20 Agu): sandbox TIDAK PERNAH
  // mengaku live. Versi pertama skrip ini menuntut payments_live=true dan
  // karena itu MERAH pada sistem yang justru benar — alat ukur yang menuntut
  // kondisi salah mengajari orang mengabaikan alarmnya.
  if (d.payments_env === "sandbox") {
    expect(d.payments_live === false, "sandbox mengaku live — uang mainan diiklankan sebagai checkout sungguhan");
  }
  return `build_sha=${String(d.build_sha).slice(0, 7)} intake=${d.intake} env=${d.payments_env} live=${d.payments_live}`;
});

// ---- 2. Halaman publik syarat onboarding ----
await check("/harga publik: harga Rupiah + Duitku + identitas PT", async () => {
  const r = await fetch(`${BASE}/harga`);
  const t = await r.text();
  expect(r.status === 200, `HTTP ${r.status}`);
  for (const s of ["Rp12.000", "Rp60.000", "Rp400.000", "Duitku", "PT Bastara Capital Asia"]) {
    expect(t.includes(s), `teks "${s}" tidak ditemukan`);
  }
  expect(!t.includes("belum dibuka"), "masih ada klaim pembelian belum dibuka");
});

await check("/kontak publik: telepon + email + alamat", async () => {
  const r = await fetch(`${BASE}/kontak`);
  const t = await r.text();
  expect(r.status === 200, `HTTP ${r.status}`);
  for (const s of ["+62 816-300-592", "hdrvstudio@gmail.com", "Kebon Kacang", "PT Bastara Capital Asia"]) {
    expect(t.includes(s), `teks "${s}" tidak ditemukan`);
  }
});

await check("/legal/terms: identitas PT, tanpa banner draf", async () => {
  const r = await fetch(`${BASE}/legal/terms`);
  const t = await r.text();
  expect(r.status === 200, `HTTP ${r.status}`);
  expect(t.includes("PT Bastara Capital Asia"), "identitas PT tidak ada");
  expect(!t.includes("bukan pengganti tinjauan hukum"), "banner draf masih tampil");
});

await check("/legal/privacy: Duitku terdaftar sebagai pemroses", async () => {
  const r = await fetch(`${BASE}/legal/privacy`);
  const t = await r.text();
  expect(r.status === 200 && t.includes("Duitku"), "Duitku tidak disebut");
  expect(!t.includes("Midtrans"), "masih menyebut Midtrans");
});

await check("landing /onboarding: tautan /harga + /kontak di footer", async () => {
  const r = await fetch(`${BASE}/onboarding`);
  const t = await r.text();
  expect(r.status === 200, `HTTP ${r.status}`);
  expect(t.includes('href="/harga"') && t.includes('href="/kontak"'), "footer tidak menautkan harga/kontak");
});

// ---- 3. Gerbang auth ----
await check("/kredit tanpa login -> redirect (bukan bocor)", async () => {
  const r = await fetch(`${BASE}/kredit`, { redirect: "manual" });
  expect([301, 302, 307, 308].includes(r.status), `HTTP ${r.status}, harusnya redirect`);
});

await check("checkout tanpa login -> 401", async () => {
  const r = await fetch(`${BASE}/api/credits/checkout`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ package_id: "hq5" }),
  });
  expect(r.status === 401, `HTTP ${r.status}`);
});

// ---- 4. Keamanan webhook Duitku (fail-closed) ----
await check("webhook: signature palsu -> 401 tanpa side effect", async () => {
  const r = await fetch(`${BASE}/api/webhooks/duitku`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ merchantCode: MERCHANT || "DSXXXXX", amount: "60000", merchantOrderId: "smoke-uji", signature: "palsu" }).toString(),
  });
  const d = await r.json();
  expect(r.status === 401 && d.code === "INVALID_SIGNATURE", `HTTP ${r.status} code=${d.code}`);
});

if (MERCHANT && APIKEY) {
  await check("webhook: signature SAH order tak dikenal -> 200 ignored", async () => {
    const orderId = `smoke-tak-dikenal-${Date.now()}`;
    const sig = crypto.createHmac("sha256", APIKEY).update(MERCHANT + "60000" + orderId).digest("hex");
    const r = await fetch(`${BASE}/api/webhooks/duitku`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ merchantCode: MERCHANT, amount: "60000", merchantOrderId: orderId, resultCode: "00", signature: sig }).toString(),
    });
    const d = await r.json();
    expect(r.status === 200 && d.ignored === true, `HTTP ${r.status} ${JSON.stringify(d)}`);
  });

  // ---- 5. API Duitku dari sisi merchant (read-only) ----
  await check("Duitku transactionStatus order paid -> statusCode 00", async () => {
    const sig = crypto.createHmac("sha256", APIKEY).update(MERCHANT + PAID_ORDER).digest("hex");
    const statusUrl = DUITKU_BASE.includes("sandbox")
      ? "https://sandbox.duitku.com/webapi/api/merchant/transactionStatus"
      : "https://passport.duitku.com/webapi/api/merchant/transactionStatus";
    const r = await fetch(statusUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ merchantCode: MERCHANT, merchantOrderId: PAID_ORDER, signature: sig }),
    });
    const d = await r.json().catch(() => ({}));
    expect(d.statusCode === "00", `statusCode=${d.statusCode ?? "?"} (${d.statusMessage ?? "no body"})`);
    return `ref=${d.reference ?? "-"} amount=${d.amount ?? "-"}`;
  });
} else {
  results.push({ name: "webhook signature sah + transactionStatus", ok: false, detail: "DILEWATI: DUITKU_MERCHANT_CODE/API_KEY tidak tersedia di env" });
}

// ---- Laporan ----
const pad = (s, n) => String(s).padEnd(n);
let fail = 0;
console.log(`\nSMOKE TEST DUITKU — ${BASE} — ${new Date().toISOString()}\n`);
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`${r.ok ? "✅ PASS" : "❌ FAIL"}  ${pad(r.name, 55)} ${r.detail}`);
}
console.log(`\n${results.length - fail}/${results.length} lolos.`);
process.exit(fail ? 1 : 0);
