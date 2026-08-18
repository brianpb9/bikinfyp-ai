/**
 * SMOKE INTERAKSI — apakah halaman benar-benar HIDUP, bukan cuma ter-render.
 *
 * Kelas kegagalan yang dijaga BENAR-BENAR PERNAH TERJADI (19 Agu): CSP
 * memblokir unsafe-eval yang dibutuhkan react-refresh, hidrasi mati total, dan
 * setiap onClick diam — sementara halamannya tampak normal. Screenshot "laci
 * terbuka" menampilkan halaman tanpa laci, dan tidak ada satu pun tes yang
 * menyadarinya karena semua tes menilai HTML, bukan interaksi.
 *
 * Ujinya sengaja minimal — SATU interaksi murni-klien per area: kalau satu
 * onClick hidup, hidrasinya hidup. Bukan pengganti e2e.
 *
 * Jalankan (server harus menyala di BASE, bawaan http://localhost:3210):
 *   node scripts/smoke-interaksi.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3210";
const gagal = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });

// Kegagalan hidrasi khas muncul sebagai error konsol (CSP/EvalError) —
// ditangkap supaya laporan menyebut SEBABNYA, bukan cuma "tombol diam".
const konsol = [];
page.on("console", (m) => { if (m.type() === "error") konsol.push(m.text().slice(0, 160)); });

// 1. Landing: bukti hidrasi yang DETERMINISTIK. HTML server merender CTA
// keadaan "memuat" ("Lihat contoh skripnya"); hanya React yang hidup yang bisa
// menukarnya sesuai /api/health. Kita baca health dulu, hitung teks yang WAJIB
// muncul, lalu tunggu teks itu. Mengisi input saja bukan bukti — form HTML
// statis pun menerima ketikan.
const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
if (!health) { console.error("BASE tidak menjawab /api/health — server belum menyala?"); process.exit(2); }
const buktiHidrasi = health.intake === "open"
  ? "Bikin video pertama — gratis"                          // label keadaan "terbuka"
  : "Pembuatan video sedang ditutup sementara";             // catatan keadaan "tertutup"
await page.goto(`${BASE}/onboarding`, { waitUntil: "networkidle" });
try {
  await page.waitForSelector(`text=${buktiHidrasi}`, { timeout: 10_000 });
} catch {
  gagal.push(`landing: CTA tidak pernah berubah ke "${buktiHidrasi}" — hidrasi mati (persis kelas bug CSP 19 Agu)`);
}

// 2. /coba: form input harus menerima ketikan dan tombol merespons.
await page.goto(`${BASE}/coba`, { waitUntil: "networkidle" });
const input = page.locator("input, textarea").first();
if (await input.count()) {
  await input.fill("Serum Uji Smoke");
  const nilai = await input.inputValue();
  if (nilai !== "Serum Uji Smoke") gagal.push("/coba: input tidak menerima ketikan");
} else {
  gagal.push("/coba: tidak ada input sama sekali");
}

// 3. Deteksi eksplisit error hidrasi/CSP di konsol.
const cspError = konsol.find((k) => /EvalError|Content Security Policy|Hydration/i.test(k));
if (cspError) gagal.push(`konsol: ${cspError}`);

await browser.close();

if (gagal.length) {
  console.error("SMOKE INTERAKSI GAGAL:");
  for (const g of gagal) console.error(" -", g);
  process.exit(1);
}
console.log("SMOKE INTERAKSI LULUS — halaman hidup, bukan cuma ter-render.");
