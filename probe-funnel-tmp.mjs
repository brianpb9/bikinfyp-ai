import { chromium } from 'playwright';
import fs from 'fs';

const OUT = 'docs/evidence/board-live-2026-08-19';
const log = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); log.push({ name, ok: true, ms: Date.now() - t0 }); }
  catch (e) { log.push({ name, ok: false, ms: Date.now() - t0, err: String(e).slice(0, 250) }); }
  console.log(JSON.stringify(log[log.length - 1]));
}

// --- 1. /coba free script flow ---
const p1 = await ctx.newPage();
await step('coba:load', async () => {
  await p1.goto('https://bikinfyp.com/coba', { waitUntil: 'domcontentloaded', timeout: 90000 });
});
await step('coba:fill+submit', async () => {
  await p1.getByPlaceholder(/Nama produk/i).fill('Serum Glow Bright');
  await p1.getByPlaceholder(/Harga/i).fill('85000');
  await p1.screenshot({ path: `${OUT}/funnel-coba-1-filled.png`, fullPage: true });
  await p1.getByRole('button', { name: /Bikinkan Skripnya/i }).click();
});
await step('coba:wait-result', async () => {
  await p1.waitForTimeout(3000);
  await p1.screenshot({ path: `${OUT}/funnel-coba-2-loading.png`, fullPage: true });
  // wait up to 90s for script text to appear
  await p1.waitForFunction(() => document.body.innerText.length > 1500, null, { timeout: 90000 });
  await p1.waitForTimeout(2000);
  await p1.screenshot({ path: `${OUT}/funnel-coba-3-hasil.png`, fullPage: true });
  fs.writeFileSync(`${OUT}/funnel-coba-hasil-text.txt`, await p1.innerText('body'));
});
await p1.close();

// --- 2. /mulai quiz click-through ---
const p2 = await ctx.newPage();
await step('mulai:load', async () => {
  await p2.goto('https://bikinfyp.com/mulai', { waitUntil: 'domcontentloaded', timeout: 90000 });
});
await step('mulai:step1', async () => {
  await p2.getByText('AI UGC Affiliate', { exact: false }).first().click();
  await p2.waitForTimeout(1500);
  await p2.screenshot({ path: `${OUT}/funnel-mulai-2.png`, fullPage: true });
});
await step('mulai:step2', async () => {
  const btn = p2.getByRole('button').first();
  const opts = await p2.$$('button, [role=radio], [role=option]');
  if (opts.length) await opts[Math.min(1, opts.length - 1)].click();
  await p2.waitForTimeout(1500);
  await p2.screenshot({ path: `${OUT}/funnel-mulai-3.png`, fullPage: true });
});
await step('mulai:step3', async () => {
  const opts = await p2.$$('button, [role=radio], [role=option]');
  if (opts.length) await opts[Math.min(1, opts.length - 1)].click();
  await p2.waitForTimeout(2500);
  await p2.screenshot({ path: `${OUT}/funnel-mulai-4-akhir.png`, fullPage: true });
  log.push({ name: 'mulai:finalUrl', url: p2.url() });
});
await p2.close();

// --- 3. /brands CTA ---
const p3 = await ctx.newPage();
await step('brands:load', async () => {
  await p3.goto('https://bikinfyp.com/brands', { waitUntil: 'domcontentloaded', timeout: 90000 });
});
await step('brands:cta', async () => {
  await p3.getByRole('link', { name: /Mulai sekarang/i }).first().click().catch(async () =>
    await p3.getByRole('button', { name: /Mulai sekarang/i }).first().click());
  await p3.waitForTimeout(4000);
  await p3.screenshot({ path: `${OUT}/funnel-brands-cta.png`, fullPage: true });
  log.push({ name: 'brands:ctaUrl', url: p3.url() });
});
await p3.close();

await browser.close();
fs.writeFileSync(`${OUT}/funnel-report.json`, JSON.stringify(log, null, 2));
console.log('DONE');
