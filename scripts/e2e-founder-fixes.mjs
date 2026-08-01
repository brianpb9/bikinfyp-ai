// Bukti E2E founder_fixes (Playwright 390px, dev server mock):
//  (1) S2 autofill dari link Tokopedia asli
//  (2) return_to: saldo habis di S4 -> /kredit -> top-up -> balik otomatis, data utuh
// Output: test_output/founder_fixes/

import { chromium } from "playwright";
import fs from "node:fs";

const BASE = `http://localhost:${process.env.PORT ?? 3210}`;
const OUT = "../test_output/founder_fixes";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (n, p, x = "") => {
  results.push(p);
  console.log(`${p ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

async function devLogin(phone) {
  const res = await page.request.post(`${BASE}/api/auth/dev-login`, { data: { phone } });
  return res.status();
}

try {
  // --- (1) S2 autofill dari link Tokopedia asli ---
  await devLogin(`0817${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`);
  await page.goto(`${BASE}/bikin/produk`);
  await page.getByPlaceholder(/vt.tiktok|shopee/).fill("https://www.tokopedia.com/somethinc/somethinc-5-niacinamide-barrier-serum");
  await page.getByRole("button", { name: "Ambil Data" }).click();
  await page.waitForTimeout(14000); // fetch + unduh gambar
  const nameVal = await page.getByPlaceholder(/Nama produk/).inputValue();
  const priceVal = await page.getByPlaceholder(/Harga/).inputValue();
  ok("S2 autofill nama+harga dari link Tokopedia", nameVal.toLowerCase().includes("somethinc") && priceVal === "115000", `${nameVal.slice(0, 40)} · ${priceVal}`);
  await page.screenshot({ path: `${OUT}/s2_autofill.png`, fullPage: true });

  // --- (2) return_to: user BARU, habiskan kredit sampai 0, lalu S4 -> kredit -> balik ---
  await devLogin(`0818${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`);
  // buat produk manual cepat
  await page.goto(`${BASE}/bikin/produk`);
  await page.getByText("Isi manual aja →").click();
  await page.getByPlaceholder(/Nama produk/).fill("Serum Glow Bright");
  await page.getByPlaceholder(/Harga/).fill("85000");
  await page.locator("input[type=file]").setInputFiles("../test_output/hands_a.png");
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.waitForURL("**/bikin/gaya");
  await page.getByRole("button", { name: /Bikinkan Skripnya/ }).click();
  await page.waitForURL("**/bikin/skrip", { timeout: 20000 });
  await page.getByText("Versi 1 ·").first().click();
  await page.locator("textarea").first().click();
  await page.waitForTimeout(300);
  // paksa saldo 0: habiskan lewat job pertama? Lebih cepat: kurangi saldo via 1 job mock (gratis) —
  // tapi itu menunggu render. Alternatif: langsung klik Setuju & Lanjut dan ANDAI saldo 0 —
  // saldo user baru Rp5.000 = cukup 1 job. Jadi habiskan dulu 1 job (mock ~5 dtk).
  await page.getByRole("button", { name: "Setuju & Lanjut" }).click();
  await page.waitForURL("**/bikin/proses**", { timeout: 15000 });
  // job 1 menguras Rp5.000 -> saldo 0 setelah selesai/ditahan. Kembali ke alur untuk job 2:
  await page.goto(`${BASE}/bikin/gaya`);
  await page.getByRole("button", { name: /Bikinkan Skripnya/ }).click();
  await page.waitForURL("**/bikin/skrip", { timeout: 20000 });
  await page.getByText("Versi 1 ·").first().click();
  await page.locator("textarea").first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Setuju & Lanjut" }).click();
  await page.waitForTimeout(1500);
  const topupLink = page.getByRole("link", { name: /Top-up dulu di sini/ });
  ok("S4 tampilkan top-up saat saldo habis", await topupLink.isVisible());
  await page.screenshot({ path: `${OUT}/s4_saldo_habis.png`, fullPage: true });
  await topupLink.click();
  await page.waitForURL("**/kredit**");
  ok("redirect ke /kredit membawa return_to", page.url().includes("return_to="), page.url().split("?")[1] ?? "");
  await page.screenshot({ path: `${OUT}/s9_sebelum_topup.png`, fullPage: true });
  // top-up paket pertama (mode demo)
  await page.getByRole("button", { name: /5× Senyap\+Teks/ }).click();
  await page.waitForTimeout(2500);
  await page.waitForURL("**/bikin/skrip**", { timeout: 10000 });
  ok("otomatis balik ke /bikin/skrip setelah top-up", true, page.url());
  await page.waitForTimeout(800);
  const variantVisible = await page.getByText("Versi 1 ·").first().isVisible();
  ok("data skrip utuh setelah balik (hidrasi dari sessionStorage)", variantVisible);
  await page.screenshot({ path: `${OUT}/s4_balik_data_utuh.png`, fullPage: true });
} catch (err) {
  ok("alur", false, err instanceof Error ? err.message.split("\n")[0] : String(err));
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} lulus`);
process.exit(failed ? 1 : 0);
