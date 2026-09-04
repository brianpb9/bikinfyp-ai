/**
 * UKUR pemakaian token model yang baru diaktifkan — sebelum dipetakan ke paket.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KENAPA TIDAK LANGSUNG PAKAI ANGKA BROSUR
 * ─────────────────────────────────────────────────────────────────────────────
 * Brian meminta pemetaan "mulai dari yang termurah". Urutan itu hanya berguna
 * kalau harganya benar. Taksiran brosur BytePlus pernah meleset 2,8x — tier
 * Rp12.000 ternyata berbiaya Rp23.533, rugi di setiap video selama
 * berminggu-minggu tanpa ada yang tahu.
 *
 * Yang bisa diukur di sini: `usage.total_tokens` yang DILAPORKAN BytePlus untuk
 * render yang sama persis (15 dtk, 720p, tanpa referensi). Itu satuan tagihan
 * untuk keluarga 2.x, dan pembandingnya sudah kita punya: 324.900 token =
 * Rp23.355.
 *
 * Yang TIDAK bisa diukur di sini: harga per token untuk keluarga 1.0, karena
 * itu hanya muncul di tagihan bulanan. Jadi hasil skrip ini dilaporkan sebagai
 * PEMAKAIAN, dan konversinya ke rupiah ditandai sebagai turunan tarif keluarga
 * 2.x — bukan angka tagihan.
 *
 *   RENDER_CONFIRM=YA npx tsx scripts/ukur-model-baru.ts <model>...
 */
import { config } from "../lib/config";

if (process.env.RENDER_CONFIRM !== "YA") {
  console.error("Ditolak: ini render berbayar. Ulangi dengan RENDER_CONFIRM=YA.");
  process.exit(1);
}
const model = process.argv.slice(2);
if (!model.length) throw new Error("Sebutkan id model.");

const BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
const PROMPT =
  "close-up of a young Indonesian woman's hands presenting a small product over a clean home table, " +
  "phone camera look, natural daylight, gentle push in  --resolution 720p  --duration 15";

// Pembanding TERUKUR: 15 dtk 720p tanpa referensi pada keluarga 2.x.
const TOKEN_ACUAN = 324_900;
const RUPIAH_ACUAN = 23_355;

async function ark(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${config.byteplusApiKey}`, ...(init?.headers ?? {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`ark ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t) as Record<string, unknown>;
}

const hasil: Record<string, unknown>[] = [];
for (const m of model) {
  const mulai = Date.now();
  try {
    const dibuat = await ark("/contents/generations/tasks", {
      method: "POST",
      body: JSON.stringify({ model: m, content: [{ type: "text", text: PROMPT }] }),
    });
    const id = String(dibuat.id);
    let usage: { total_tokens?: number } | undefined;
    let status = "";
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 10_000));
      const d = await ark(`/contents/generations/tasks/${id}`);
      status = String(d.status ?? "");
      if (status === "succeeded") { usage = d.usage as { total_tokens?: number }; break; }
      if (status === "failed") throw new Error(`gagal: ${JSON.stringify(d).slice(0, 200)}`);
    }
    const detik = Math.round((Date.now() - mulai) / 1000);
    const token = usage?.total_tokens ?? 0;
    const nisbah = token / TOKEN_ACUAN;
    console.log(
      `${m.padEnd(34)} ${status.padEnd(10)} ${detik}s  token=${token.toLocaleString("id-ID")}  ` +
        `(${nisbah.toFixed(2)}x acuan)  setara Rp${Math.round(nisbah * RUPIAH_ACUAN).toLocaleString("id-ID")} bila tarif/token sama`,
    );
    hasil.push({ model: m, status, detik, token, nisbah: +nisbah.toFixed(3), setara_idr: Math.round(nisbah * RUPIAH_ACUAN) });
  } catch (e) {
    console.log(`${m.padEnd(34)} ERROR ${(e as Error).message}`);
    hasil.push({ model: m, error: (e as Error).message });
  }
}
console.log(`\n${JSON.stringify(hasil, null, 2)}`);
