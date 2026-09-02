/**
 * UKUR pemakaian token BytePlus yang SEBENARNYA — sekali render, angka nyata.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KENAPA DIUKUR, BUKAN DIAMBIL DARI CONFIG
 * ─────────────────────────────────────────────────────────────────────────────
 * cogsIdr di lib/config.ts dan perSecUsd di provider BytePlus adalah ESTIMASI
 * turunan BRD lama, bukan angka tagihan. Sementara tarif yang TERVERIFIKASI
 * dari tagihan sungguhan adalah $4,41 per 1 juta token ($1.300 /
 * 295.026.776 token).
 *
 * Menyusun harga jual di atas estimasi yang tidak pernah dicocokkan dengan
 * tagihan adalah persis cara sebuah tier dijual di bawah biaya berbulan-bulan.
 * Jadi skrip ini merender SATU klip pendek dan membaca `usage.total_tokens`
 * dari jawaban BytePlus — lalu mengalikannya dengan tarif tagihan.
 *
 * Ia MENGELUARKAN UANG SUNGGUHAN (satu klip pendek). Karena itu durasinya
 * sependek yang diizinkan mode-nya, dan ia hanya dijalankan saat harga sedang
 * ditetapkan.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../lib/config";

const TARIF_USD_PER_1M_TOKEN = 4.41; // terverifikasi dari tagihan: $1.300 / 295.026.776 token
const KURS_USD_IDR = 16_300;

const model = process.argv[2] ?? config.tiers.premium.byteplusModel;
const detik = Number(process.argv[3] ?? 4);
const mode = (process.argv[4] ?? "r2v") as "r2v" | "i2v";
const resolusi = process.argv[5] ?? "720p";

// BytePlus menolak gambar di bawah 300px ("expected the width to be at least
// 300px" — diuji langsung). Jadi gambarnya dibuat 512x512 polos: cukup sah
// untuk permintaan, dan yang diukur pemakaian tokennya, bukan mutu gambarnya.
const berkas = path.join(os.tmpdir(), `ukur-${Date.now()}.png`);
{
  const sharp = (await import("sharp")).default;
  await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 200, g: 180, b: 150 } } })
    .png()
    .toFile(berkas);
}
const png = fs.readFileSync(berkas);
const dataUri = `data:image/png;base64,${png.toString("base64")}`;

const teks =
  `${detik}s ${resolusi} ${mode} · a hand holds a small bottle, gentle push in. ` +
  `Negative: no text, no logo, no writing`;

const content: unknown[] = [{ type: "text", text: `${teks} --resolution ${resolusi} --duration ${detik} --ratio 9:16` }];
if (mode === "r2v") {
  content.push({ type: "image_url", image_url: { url: dataUri }, role: "reference_image" });
} else {
  content.push({ type: "image_url", image_url: { url: dataUri } });
}

const base = config.byteplusBaseUrl ?? "https://ark.ap-southeast.bytepluses.com/api/v3";
const kepala = { authorization: `Bearer ${config.byteplusApiKey}`, "content-type": "application/json" };

const buat = await fetch(`${base}/contents/generations/tasks`, {
  method: "POST",
  headers: kepala,
  body: JSON.stringify({ model, content }),
});
const dibuat = (await buat.json()) as { id?: string; error?: unknown };
if (!dibuat.id) {
  console.error(JSON.stringify({ status: "GAGAL_BUAT", jawaban: dibuat }));
  process.exit(1);
}

let hasil: Record<string, unknown> = {};
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const r = await fetch(`${base}/contents/generations/tasks/${dibuat.id}`, { headers: kepala });
  hasil = (await r.json()) as Record<string, unknown>;
  const status = String(hasil.status ?? "");
  if (status === "succeeded" || status === "failed" || status === "cancelled") break;
}

const usage = hasil.usage as { total_tokens?: number; completion_tokens?: number } | undefined;
const token = Number(usage?.total_tokens ?? usage?.completion_tokens ?? 0);
const usd = (token / 1_000_000) * TARIF_USD_PER_1M_TOKEN;

console.log(JSON.stringify({
  status: hasil.status,
  model, detik, mode, resolusi,
  total_tokens: token,
  token_per_detik: token ? Math.round(token / detik) : null,
  usd: Number(usd.toFixed(4)),
  idr: Math.round(usd * KURS_USD_IDR),
  idr_per_detik: token ? Math.round((usd * KURS_USD_IDR) / detik) : null,
  // Proyeksi ke durasi jual yang sebenarnya.
  idr_15_detik: token ? Math.round((usd * KURS_USD_IDR / detik) * 15) : null,
  error: hasil.error ?? null,
}, null, 2));
fs.rmSync(berkas, { force: true });
