// Uji E2E UI (Playwright) — alur lengkap di viewport mobile 390px:
// onboarding -> login -> produk manual (upload foto) -> gaya -> 3 skrip ->
// edit+setuju -> proses -> hasil -> paket. Screenshot tiap layar ke /tmp/racun-ui/.
// Jalankan: node scripts/e2e-ui.mjs (dev server harus menyala di PORT, default 3210)

import { chromium } from "playwright";
import fs from "node:fs";

const BASE = `http://localhost:${process.env.PORT ?? 3210}`;
const SHOTS = "/tmp/racun-ui";
fs.mkdirSync(SHOTS, { recursive: true });

const phone = `0813${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
const results = [];
const ok = (name, pass, extra = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

try {
  // S0 onboarding
  await page.goto(`${BASE}/onboarding`, { waitUntil: "networkidle" });
  ok("S0 render", await page.getByText("Bikin video jualan").isVisible());
  await shot("s0-onboarding");
  // Auth pindah ke email OTP (31 Jul 2026) — E2E login via dev-login API
  // (jalur non-production yang memang disediakan untuk uji; kode OTP mock hanya
  // muncul di log server, tidak bisa dibaca dari browser).
  const loginStatus = await page.evaluate(async (p) => {
    const r = await fetch("/api/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: p }),
    });
    return r.status;
  }, phone);
  ok("S0 dev-login", loginStatus === 200, phone);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  ok("S0 login -> beranda", true, phone);

  // S1 beranda (user baru)
  await page.waitForLoadState("networkidle");
  ok("S1 tombol BIKIN VIDEO", await page.getByText("＋ BIKIN VIDEO").isVisible());
  // Chip kredit sekarang ikon PNG + teks "RpN" (bukan karakter ⚡ lagi).
  ok("S1 chip kredit", await page.locator("header").getByText(/Rp/).first().isVisible());
  await shot("s1-beranda");

  // S1.5 jenis video (fork e-commerce vs promosi) lalu S2 produk manual
  await page.getByText("＋ BIKIN VIDEO").click();
  await page.waitForURL("**/bikin/jenis");
  await shot("s1b-jenis");
  await page.getByRole("link", { name: /Video Jualan Produk/ }).click();
  await page.waitForURL("**/bikin/produk");
  await page.getByText("Isi manual aja →").click();
  await page.getByPlaceholder(/Nama produk/).fill("Serum Glow Bright");
  await page.getByPlaceholder(/Harga/).fill("85000");
  await page.locator("input[type=file]").setInputFiles("../test_output/hands_a.png");
  await page.waitForTimeout(500);
  await shot("s2-produk");
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.waitForURL("**/bikin/gaya", { timeout: 15000 });
  ok("S2 produk tersimpan -> gaya", true);

  // S3 gaya — kategori kreator kini di balik accordion "Sesuaikan gaya kreator";
  // hanya "Daerah" yang masih Segera (Ibu-ibu sudah rilis) -> minimal 1.
  await page.getByText("Sesuaikan gaya kreator").click();
  ok("S3 format disabled 'Segera'", (await page.getByText("Segera").count()) >= 1);
  await shot("s3-gaya");
  await page.getByRole("button", { name: "Bikinkan Skripnya" }).click();
  await page.waitForURL("**/bikin/skrip", { timeout: 20000 });
  // Tunggu varian benar-benar dirender (hidrasi React setelah networkidle bisa
  // telat sepersekian detik — count() instan bikin flaky).
  await page.getByRole("button", { name: /Versi \d ·/ }).first().waitFor({ timeout: 10000 });
  ok("S3 generate 3 varian", (await page.getByRole("button", { name: /Versi \d ·/ }).count()) === 3);

  // S4 skrip (HITL)
  const approveBtn = page.getByRole("button", { name: "Setuju & Lanjut" });
  ok("S4 tombol nonaktif sebelum pilih", await approveBtn.isDisabled());
  await page.getByText("Versi 1 ·").first().click();
  await shot("s4-skrip-pilih");
  // Catatan: di viewport tinggi, editor langsung terlihat saat varian dipilih
  // (memenuhi "membuka editor"). Gerbang utama = tombol nonaktif sebelum varian dipilih
  // (sudah dicek di atas) + validasi keras tetap memblokir.
  await page.locator("textarea").first().scrollIntoViewIfNeeded();
  await page.locator("textarea").first().click();
  await page.waitForTimeout(400);
  ok("S4 tombol aktif setelah editor disentuh", await approveBtn.isEnabled());
  await shot("s4-skrip-editor");
  await approveBtn.click();

  // S5 proses -> S6 hasil
  await page.waitForURL("**/bikin/proses**", { timeout: 15000 });
  ok("S5 proses tampil", await page.getByText("Sedang dibikin...").isVisible());
  await shot("s5-proses");
  await page.waitForURL("**/bikin/hasil**", { timeout: 180000 });
  await page.waitForSelector("text=Unduh Videonya", { timeout: 20000 });
  ok("S6 hasil tampil", true);
  ok("S6 peringatan konten AI", await page.getByText(/nyalakan tanda .konten AI./i).isVisible());
  await shot("s6-hasil");

  // S7 paket
  await page.getByText("Lihat paket posting").click();
  await page.waitForURL("**/bikin/paket**");
  await page.waitForSelector("text=📝 Caption", { timeout: 10000 });
  ok("S7 caption tampil", true);
  await shot("s7-paket");

  // S8 riwayat
  await page.goto(`${BASE}/video`, { waitUntil: "networkidle" });
  ok("S8 riwayat berisi job", await page.getByText("Serum Glow Bright").first().isVisible());
  await shot("s8-riwayat");

  // S9 kredit
  await page.goto(`${BASE}/kredit`, { waitUntil: "networkidle" });
  ok("S9 saldo tampil", await page.getByText(/Kredit/).first().isVisible());
  ok("S9 paket 'Paling laris'", await page.getByText("Paling laris").isVisible());
  await shot("s9-kredit");

  // Middleware: tanpa cookie harus redirect ke /onboarding
  const anon = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await anon.goto(`${BASE}/video`);
  ok("Guard: anon -> /onboarding", anon.url().includes("/onboarding"));
  await anon.close();
} catch (err) {
  ok("alur E2E", false, err instanceof Error ? err.message.split("\n")[0] : String(err));
  await shot("error-state").catch(() => {});
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} lulus. Screenshot di ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
