// Bukti gabungan (Playwright, viewport 390x844) — dev server HARUS jalan dengan PROVIDER_VIDEO=byteplus.
//  (1b) crop check jalur byteplus: produk memakai foto uji persegi (teks pojok)
//  (2b) kategori Gen-Z end-to-end via UI
//  (5)  screenshot S5 di tengah render nyata + bukti pulih setelah tutup & balik
//  (3)  audit DOM: kartu pilihan S3 adalah <button>
// Output: test_output/kategori_genz/ + test_output/s5_bukti/

import { chromium } from "playwright";
import fs from "node:fs";

const BASE = `http://localhost:${process.env.PORT ?? 3210}`;
const OUT_GENZ = "../test_output/kategori_genz";
const OUT_S5 = "../test_output/s5_bukti";
fs.mkdirSync(OUT_GENZ, { recursive: true });
fs.mkdirSync(OUT_S5, { recursive: true });

const phone = `0815${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
const results = [];
const ok = (name, pass, extra = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

try {
  // Login
  await page.goto(`${BASE}/onboarding`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT_S5}/s0_dengan_video.png` });
  await page.getByRole("button", { name: "Coba Gratis" }).click();
  await page.getByPlaceholder("08xxxxxxxxxx").fill(phone);
  await page.getByRole("button", { name: "Masuk & Mulai" }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 10000 });

  // S2: produk dengan foto uji persegi (teks pojok untuk crop check)
  await page.getByText("＋ BIKIN VIDEO").click();
  await page.waitForURL("**/bikin/produk");
  await page.getByText("Isi manual aja →").click();
  await page.getByPlaceholder(/Nama produk/).fill("Serum Glow Bright");
  await page.getByPlaceholder(/Harga/).fill("85000");
  await page.locator("input[type=file]").setInputFiles("../test_output/crop_fix/foto_uji_persegi.png");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.waitForURL("**/bikin/gaya", { timeout: 15000 });

  // S3: screenshot kategori + audit DOM button
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT_GENZ}/s3_kategori.png`, fullPage: true });
  const dom = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim().slice(0, 24));
    return {
      genzIsButton: buttons.some((t) => t?.includes("Gen-Z")),
      priaIsButton: buttons.some((t) => t?.includes("Pria")),
      hijaberPressed: !!document.querySelector('button[aria-pressed="true"]'),
      buttonCount: buttons.length,
    };
  });
  ok("S3 kartu kategori adalah <button>", dom.genzIsButton && dom.priaIsButton, JSON.stringify(dom));
  const catCount = await page.locator("section", { hasText: "Kategori kreator" }).locator("button:not([disabled])").count();
  ok("S3 5 kategori aktif", catCount === 5, `aktif=${catCount}`);

  // Pilih Gen-Z
  await page.getByRole("button", { name: /Gen-Z/ }).first().click();
  await page.getByRole("button", { name: /Bikinkan Skripnya/ }).click();
  await page.waitForURL("**/bikin/skrip", { timeout: 20000 });
  await page.getByText("Versi 1 ·").first().click();
  await page.locator("textarea").first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Setuju & Lanjut" }).click();
  await page.waitForURL("**/bikin/proses**", { timeout: 15000 });
  const jobId = new URL(page.url()).searchParams.get("job");
  ok("job dibuat", !!jobId, jobId ?? "");

  // S5 di tengah render: tangkap momen state berbeda (interval 3 dtk)
  const seen = new Set();
  const cookieHeader = async () => (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  for (let i = 0; i < 100; i++) {
    const j = await fetch(`${BASE}/api/jobs/${jobId}`, { headers: { cookie: await cookieHeader() } }).then((r) => r.json());
    if (!seen.has(j.state) && j.state !== "READY") {
      seen.add(j.state);
      await page.screenshot({ path: `${OUT_S5}/s5_${j.state.toLowerCase()}.png` });
      console.log(`  S5 captured: ${j.state}`);
    }
    if (j.state === "READY" || j.state === "REFUNDED" || j.state === "FAILED") break;
    await page.waitForTimeout(3000);
  }
  ok("S5 tengah render terekam", seen.size >= 2, [...seen].join(","));

  // Tutup & balik: TAB BARU DI CONTEXT YANG SAMA (cookie auth terbawa)
  const page2 = await context.newPage();
  await page2.goto(`${BASE}/bikin/proses?job=${jobId}`);
  await page2.waitForTimeout(2500);
  await page2.screenshot({ path: `${OUT_S5}/s5_pulih_setelah_tutup.png` });
  ok("S5 pulih setelah tutup & balik", await page2.getByText(/Sedang dibikin|Hasil|Unduh/).first().isVisible().catch(() => false));

  // Tunggu READY di page2, lalu unduh output
  await page2.waitForURL("**/bikin/hasil**", { timeout: 300000 });
  await page2.waitForSelector("text=Unduh Videonya", { timeout: 20000 });
  await page2.screenshot({ path: `${OUT_S5}/s6_hasil.png` });
  const cookies = await page2.context().cookies();
  const out = await fetch(`${BASE}/api/jobs/${jobId}/output`, { headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") } }).then((r) => r.json());
  const video = await fetch(`${BASE}${out.video_url}`);
  fs.writeFileSync(`${OUT_GENZ}/genz_silent_caption.mp4`, Buffer.from(await video.arrayBuffer()));
  ok("video Gen-Z terunduh", fs.statSync(`${OUT_GENZ}/genz_silent_caption.mp4`).size > 100000);

  // Job detail: provider & persona kategori
  const job = await fetch(`${BASE}/api/jobs/${jobId}`, { headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") } }).then((r) => r.json());
  console.log("  job:", JSON.stringify({ provider_video: job.provider_video, quality_tier: job.quality_tier, cost: job.cost_actual_idr }));
  fs.writeFileSync(`${OUT_GENZ}/job.json`, JSON.stringify(job, null, 2));
} catch (err) {
  ok("alur", false, err instanceof Error ? err.message.split("\n")[0] : String(err));
  await page.screenshot({ path: `${OUT_S5}/error.png` }).catch(() => {});
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} lulus`);
process.exit(failed.length ? 1 : 0);
