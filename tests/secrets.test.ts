// Penjaga rahasia tanda tangan (lib/secrets.ts). Gagal-tertutup di production.
import { test } from "node:test";
import assert from "node:assert/strict";

const { assertAuthSecretSafe, mediaUrlKey, otpHashKey } = await import("../lib/secrets");

test("di luar production apa pun diterima (dev tidak boleh terhambat)", () => {
  assertAuthSecretSafe({ NODE_ENV: "development", AUTH_SECRET: "" });
  assertAuthSecretSafe({ NODE_ENV: "test", AUTH_SECRET: "pendek" });
});

test("production menolak boot tanpa AUTH_SECRET", () => {
  assert.throws(
    () => assertAuthSecretSafe({ NODE_ENV: "production", AUTH_SECRET: "" }),
    /AUTH_SECRET wajib diisi/
  );
});

test("production menolak nilai bawaan pengembangan", () => {
  assert.throws(
    () => assertAuthSecretSafe({ NODE_ENV: "production", AUTH_SECRET: "dev-secret-racun-ai-jangan-dipakai-produksi" }),
    /nilai bawaan pengembangan/
  );
});

test("production menolak secret di bawah 32 byte", () => {
  // Naik dari peringatan jadi penolakan setelah panjang secret produksi
  // diverifikasi langsung di Shell Render (web dan worker sama-sama 32
  // karakter), jadi penegakan ini tidak mematikan apa pun yang berjalan.
  assert.throws(
    () => assertAuthSecretSafe({ NODE_ENV: "production", AUTH_SECRET: "pendek123" }),
    /terlalu pendek/
  );
});

test("tepat 32 byte diterima — ambangnya inklusif", () => {
  // Penting: produksi memakai persis 32. Kalau perbandingannya <= bukan <,
  // penegakan ini justru akan mematikan web DAN worker saat deploy.
  assert.doesNotThrow(() => assertAuthSecretSafe({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(32) }));
});

test("kunci turunan berbeda per fungsi dan stabil", () => {
  const media = mediaUrlKey().toString("hex");
  const otp = otpHashKey().toString("hex");
  assert.notEqual(media, otp, "kunci media dan OTP tidak boleh sama");
  assert.equal(media.length, 64, "32 byte");
  assert.equal(mediaUrlKey().toString("hex"), media, "harus deterministik");
});
