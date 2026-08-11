// Batas laju jalur mahal dashboard. Yang diuji di sini PERILAKUNYA, bukan
// Redis-nya: tanpa RACUN_QUEUE_MODE=redis, lib/rate-limit jatuh ke penghitung
// memori — jalur yang sama persis dipakai dev dan instance tunggal.
import { test } from "node:test";
import assert from "node:assert/strict";

const { assertDashboardRate, DASHBOARD_LIMITS } = await import("../lib/dashboard-rate-limit");

test("melewati batas -> ditolak, dan pesannya menyebut waktu tunggu", async () => {
  const org = "org-uji-batas";
  const { max } = DASHBOARD_LIMITS.confirm;
  for (let i = 0; i < max; i++) {
    await assertDashboardRate("confirm", org); // semua ini harus lolos
  }
  await assert.rejects(
    () => assertDashboardRate("confirm", org),
    // ApiError menaruh pesan Indonesia di .body.message_id, bukan di .message
    // (.message berisi teks Inggris untuk log).
    (err: { body?: { message_id?: string } }) =>
      /Terlalu banyak permintaan/.test(String(err.body?.message_id))
  );
});

test("organisasi lain TIDAK ikut kena", async () => {
  // Kuncinya per-org. Kalau bucket-nya bocor antar org, satu brand yang sibuk
  // akan memblokir brand lain — kegagalan yang jauh lebih buruk daripada
  // sekadar tidak membatasi.
  const { max } = DASHBOARD_LIMITS.template;
  for (let i = 0; i < max; i++) await assertDashboardRate("template", "org-A");
  await assert.rejects(() => assertDashboardRate("template", "org-A"));
  await assert.doesNotReject(() => assertDashboardRate("template", "org-B"));
});

test("bucket berbeda dihitung terpisah", async () => {
  const org = "org-bucket";
  const { max } = DASHBOARD_LIMITS.invite;
  for (let i = 0; i < max; i++) await assertDashboardRate("invite", org);
  await assert.rejects(() => assertDashboardRate("invite", org));
  // generate punya jatah sendiri, tidak ikut habis
  await assert.doesNotReject(() => assertDashboardRate("generate", org));
});
