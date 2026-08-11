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

test("secret pendek MEMPERINGATKAN tapi tidak mematikan boot", () => {
  // Sengaja tidak melempar: panjang secret produksi tidak bisa diperiksa dari
  // repo (diatur manual di Render), dan mematikan situs karena tebakan lebih
  // buruk daripada secret yang lebih lemah. Lihat komentar di lib/secrets.ts.
  assert.doesNotThrow(() => assertAuthSecretSafe({ NODE_ENV: "production", AUTH_SECRET: "pendek123" }));
});

test("kunci turunan berbeda per fungsi dan stabil", () => {
  const media = mediaUrlKey().toString("hex");
  const otp = otpHashKey().toString("hex");
  assert.notEqual(media, otp, "kunci media dan OTP tidak boleh sama");
  assert.equal(media.length, 64, "32 byte");
  assert.equal(mediaUrlKey().toString("hex"), media, "harus deterministik");
});
