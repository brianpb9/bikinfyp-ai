// COGS Seedance 2.5 — DIUKUR dari task nyata di akun, bukan dari tarif publik.
//
// FINAL-MESIN-DAN-HARGA §7 menandai COGS 2.5 sebagai PERKIRAAN: ia disamakan
// dengan 2.0 penuh (Rp37.164) hanya karena config kita cuma mencatat tarif 2.0.
// Seluruh tabel harga TVC berdiri di atas angka itu.
//
// HANYA BACA. Skrip ini MENDAFTAR task yang SUDAH ada dan membaca `usage`-nya.
// Nol generation, nol biaya. Menjalankan render baru untuk mengukur tarif
// berarti membayar demi mengetahui berapa yang dibayar.
//
//   GET {base}/contents/generations/tasks?page_num=&page_size=
//   GET {base}/contents/generations/tasks/{id}
//
// Yang dicari: `usage.total_tokens` per task 2.5 beserta durasi dan resolusinya.
// Token per detik adalah besaran yang TIDAK bisa ditebak dari tarif publik, dan
// itulah yang membuat COGS 2.5 selama ini hanya tebakan.

import { config } from "../lib/config";

const BASE = process.env.BYTEPLUS_ARK_BASE ?? "https://ark.ap-southeast.bytepluses.com/api/v3";

type Task = {
  id?: string;
  model?: string;
  status?: string;
  created_at?: number | string;
  usage?: { completion_tokens?: number; total_tokens?: number };
  content?: { video_url?: string };
};

async function ambil(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${config.byteplusApiKey}` } });
  const teks = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}\n${teks.slice(0, 400)}`);
  return JSON.parse(teks);
}

async function main() {
  if (!config.byteplusApiKey) {
    console.error("BYTEPLUS_ARK_API_KEY kosong — tidak bisa mengukur. Ini BLOKIR, bukan hasil.");
    process.exit(2);
  }

  const semua: Task[] = [];
  for (let hal = 1; hal <= 10; hal++) {
    const j = (await ambil(`${BASE}/contents/generations/tasks?page_num=${hal}&page_size=100`)) as {
      items?: Task[];
      data?: Task[];
      total?: number;
    };
    const batch = j.items ?? j.data ?? [];
    semua.push(...batch);
    if (batch.length < 100) break;
  }

  console.log(`\nTOTAL TASK TERBACA: ${semua.length}`);
  const perModel = new Map<string, Task[]>();
  for (const t of semua) {
    const m = t.model ?? "(tanpa model)";
    perModel.set(m, [...(perModel.get(m) ?? []), t]);
  }

  console.log("\nPER MODEL (hanya yang sukses & punya usage):");
  for (const [model, ts] of [...perModel].sort()) {
    const sukses = ts.filter((t) => (t.status ?? "").includes("succe"));
    const berToken = sukses.filter((t) => typeof t.usage?.total_tokens === "number");
    const tok = berToken.map((t) => t.usage!.total_tokens!);
    const rata = tok.length ? Math.round(tok.reduce((a, b) => a + b, 0) / tok.length) : 0;
    console.log(
      `  ${model.padEnd(34)} task=${String(ts.length).padStart(4)}  sukses=${String(sukses.length).padStart(4)}` +
        `  ber-usage=${String(berToken.length).padStart(4)}  token_rata=${rata || "-"}`,
    );
    if (model.includes("2-5") && tok.length) {
      const min = Math.min(...tok), max = Math.max(...tok);
      console.log(`      token: min=${min} max=${max} n=${tok.length}`);
      console.log(`      contoh id: ${berToken.slice(0, 3).map((t) => t.id).join(", ")}`);
    }
  }
  console.log(
    "\nCATATAN: token != rupiah. Angka ini bahan untuk mencocokkan dengan TAGIHAN\n" +
      "BytePlus yang sebenarnya. Tanpa tagihan, COGS 2.5 tetap PERKIRAAN.\n",
  );
}

await main();
