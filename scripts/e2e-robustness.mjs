// Bukti browser deterministik Area 6.2. Jalankan terhadap dev server mock:
// RACUN_WORKER_DISABLED=1 PORT=3211 npm run dev
// lalu BASE_URL=http://localhost:3211 node scripts/e2e-robustness.mjs
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3211";
const OUT = path.resolve("..", "test_output", "robustness");
const IMAGE = path.resolve("..", "test_output", "hands_a.png");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

try {
  const login = await context.request.post(`${BASE}/api/auth/dev-login`, {
    data: { phone: `0812${String(Date.now()).slice(-6)}` },
  });
  if (!login.ok()) throw new Error(`dev-login gagal: ${login.status()}`);

  // 1) PUTUS DI TENGAH UPLOAD: endpoint di-abort, UI harus keluar dari loading
  // dan memberi pesan yang bisa ditindaklanjuti.
  let interrupt = true;
  await page.route("**/api/products", async (route) => {
    if (route.request().method() === "POST" && interrupt) return route.abort("connectionrefused");
    return route.continue();
  });
  await page.goto(`${BASE}/bikin/produk`);
  await page.getByRole("button", { name: /isi manual/i }).click();
  await page.getByPlaceholder(/nama produk/i).fill("Serum Bukti");
  await page.getByPlaceholder(/harga/i).fill("85000");
  await page.locator('input[type="file"]').setInputFiles(IMAGE);
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByText("Upload terputus. Coba cek internet lalu upload lagi ya.").waitFor({ timeout: 8_000 });
  await page.screenshot({ path: path.join(OUT, "upload_terputus.png"), fullPage: true });

  // 2) UPLOAD PULIH: retry yang sama menerima respons sukses dan meninggalkan S2.
  interrupt = false;
  await page.unroute("**/api/products");
  await page.route("**/api/products", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ product_id: "produk-pulih", images: [] }) });
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.waitForURL("**/bikin/gaya");
  await page.screenshot({ path: path.join(OUT, "upload_pulih.png"), fullPage: true });

  // 3) REFRESH S5: status job yang sama harus dipoll kembali dari URL sesudah reload.
  await page.unroute("**/api/products");
  let statusHits = 0;
  await page.route("**/api/jobs/job-refresh", async (route) => {
    statusHits++;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "job-refresh", state: "QUEUED", message: "Lagi dibikin" }) });
  });
  await page.route("**/api/meta", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ estimate_text: "Sekitar 1–2 menit lagi" }) }));
  await page.goto(`${BASE}/bikin/proses?job=job-refresh`);
  await page.getByRole("heading", { name: /sedang dibikin/i }).waitFor();
  await page.waitForTimeout(750);
  await page.reload();
  await page.getByRole("heading", { name: /sedang dibikin/i }).waitFor();
  await page.waitForTimeout(750);
  if (statusHits < 2) throw new Error(`refresh tidak mem-poll ulang status job (hits=${statusHits})`);
  await page.screenshot({ path: path.join(OUT, "proses_setelah_refresh.png"), fullPage: true });
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ base: BASE, status_hits_after_refresh: statusHits, result: "ok" }, null, 2));
  console.log(`E2E robustness OK: ${OUT}`);
} finally {
  await browser.close();
}
