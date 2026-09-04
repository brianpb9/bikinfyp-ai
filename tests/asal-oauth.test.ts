import assert from "node:assert/strict";
import { test } from "node:test";

process.env.APP_BASE_URL = "https://aiugc.id";
process.env.APP_ASAL_TAMBAHAN = "https://bikinfyp.com, http://tidak-aman.example, bukan-url";

const { asalOauth, redirectUriGoogle, asalDiizinkan } = await import("../lib/asal-oauth");

function req(headers: Record<string, string>): Request {
  return new Request("https://internal.invalid/api/auth/google", { headers });
}

test("asal-oauth: domain lama tetap bisa login selama masa pindahan", () => {
  // Inilah kerusakan yang ditambal: pengunjung bikinfyp.com TIDAK boleh
  // dikirim ke redirect_uri aiugc.id yang belum terdaftar di Google.
  const r = req({ host: "bikinfyp.com", "x-forwarded-proto": "https" });
  assert.equal(asalOauth(r), "https://bikinfyp.com");
  assert.equal(redirectUriGoogle(r), "https://bikinfyp.com/api/auth/google/callback");
});

test("asal-oauth: domain baru dipakai apa adanya", () => {
  const r = req({ host: "aiugc.id", "x-forwarded-proto": "https" });
  assert.equal(redirectUriGoogle(r), "https://aiugc.id/api/auth/google/callback");
});

test("asal-oauth: Host palsu TIDAK diikuti — code tidak boleh mendarat di domain penyerang", () => {
  for (const jahat of ["penyerang.example", "aiugc.id.penyerang.example", "bikinfyp.com.evil.co"]) {
    const r = req({ host: jahat, "x-forwarded-proto": "https" });
    assert.equal(asalOauth(r), "https://aiugc.id", `host ${jahat} seharusnya jatuh ke appBaseUrl`);
  }
});

test("asal-oauth: x-forwarded-host didahulukan, dan hanya nilai pertama yang dipakai", () => {
  const r = req({ host: "aiugc.id", "x-forwarded-host": "bikinfyp.com, penyerang.example", "x-forwarded-proto": "https" });
  assert.equal(asalOauth(r), "https://bikinfyp.com");
});

test("asal-oauth: header hilang -> appBaseUrl, bukan lempar", () => {
  assert.equal(asalOauth(new Request("https://internal.invalid/x")), "https://aiugc.id");
});

test("asal-oauth: http polos di domain publik ditolak (kode OAuth tak boleh lewat jalur telanjang)", () => {
  const r = req({ host: "bikinfyp.com", "x-forwarded-proto": "http" });
  assert.equal(asalOauth(r), "https://aiugc.id");
  // Penjagaan yang SAMA juga menyaring isi daftar-putihnya sendiri: satu baris
  // http yang salah ketik di env tidak boleh membuka jalur OAuth tanpa TLS,
  // dan entri yang bukan URL tidak boleh menjatuhkan proses.
  const r2 = req({ host: "tidak-aman.example", "x-forwarded-proto": "http" });
  assert.equal(asalOauth(r2), "https://aiugc.id");
  assert.ok(!asalDiizinkan().some((a) => a.startsWith("http:")), "entri http tidak boleh masuk daftar-putih");
});

test("asal-oauth: daftar-putih = appBaseUrl + tambahan, tanpa duplikat", () => {
  assert.deepEqual(asalDiizinkan().sort(), ["https://aiugc.id", "https://bikinfyp.com"]);
  // "http://tidak-aman.example" dan "bukan-url" di env sengaja dibuang, bukan diteruskan.
});
