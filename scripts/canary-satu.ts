/** CANARY — satu keluaran per jalankan, concurrency 1 by construction.
 *  Dipakai langkah keamanan 20 Agu: keluaran #1 dirender sendirian dan baris
 *  biayanya diperiksa sebelum sembilan sisanya berjalan. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { planShots } from "../lib/media/shot-planner";
import { periksaPromptAkhir, ringkasTemuanPrompt } from "../lib/media/gerbang-prompt";
import { assertVisualSpec } from "../lib/providers/types";
import { byteplusVideo } from "../lib/providers/stubs/byteplus";
import { getCreatorCategory } from "../lib/personas";
import { generateScripts, type ProductInput } from "../lib/script-engine";
import { klasifikasiGambar } from "../lib/media/klasifikasi-gambar";
import { probeVideoSize } from "../lib/media/ffmpeg";

const T = path.resolve(process.cwd(), "..", "test_output");
const OUT = path.join(T, "canary_20agu");

const ROSTER: Record<string, { produk: ProductInput; foto: string }> = {
  "mw3": { produk: { id: "p-mw3", name: "Metoo MW-3 Sabun Wajah", price_idr: 45000, category: "beauty", sourceUrl: null } as ProductInput,
           foto: path.join(T, "metoo-mw3", "mw3-packshot-4000px.webp") },
  "glow": { produk: { id: "p-glow", name: "Serum Glow Bright", price_idr: 85000, category: "beauty", sourceUrl: null } as ProductInput,
            foto: path.join(T, "canary-glow.jpg") },
  "arva": { produk: { id: "p-arva", name: "ARVA Tumbler Chrome", price_idr: 150000, category: "home", sourceUrl: null } as ProductInput,
            foto: path.join(T, "canary-arva.jpg") },
  "polos": { produk: { id: "p-sabun", name: "Sabun Susu Kambing", price_idr: 25000, category: "beauty", sourceUrl: null } as ProductInput,
             foto: path.join(T, "produk-polos.jpg") },
};

async function main() {
  const [id, tier, ct] = process.argv.slice(2);
  if (process.env.RENDER_CONFIRM !== "YA") { console.error("Render BERBAYAR. RENDER_CONFIRM=YA."); process.exit(2); }
  const r = ROSTER[id];
  if (!r) { console.error(`roster tidak dikenal: ${id} (ada: ${Object.keys(ROSTER).join(",")})`); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });

  // ASAL-USUL BAHAN dulu — kalau fotonya tidak layak, tidak ada uang keluar.
  const k = await klasifikasiGambar(r.foto);
  const dim = await probeVideoSize(r.foto).catch(() => ({ width: 0, height: 0 }));
  const sha = crypto.createHash("sha256").update(fs.readFileSync(r.foto)).digest("hex").slice(0, 8);
  console.log(`ASAL-USUL: ${path.basename(r.foto)} sha ${sha} ${k.jenis} ${dim.width}x${dim.height} layak=${k.layakReferensi}`);
  if (!k.layakReferensi) { console.error("BATAL — foto tidak layak jadi referensi."); process.exit(1); }

  const [skrip] = await generateScripts({
    product: r.produk, register: "bestie", qualityTier: tier as never, durationSec: 15, count: 1,
    hookLevel: "berani", contentType: ct as never, format: "hands_only",
  } as never);
  console.log(`NASKAH: ${skrip.script_source} · ${skrip.standarGaris ?? "-"}`);
  for (const s of skrip.segments) console.log(`  [${s.role}] "${s.text}"`);

  const spec = planShots({
    jobId: `canary-${id}`, durationSec: 15, segments: skrip.segments,
    category: getCreatorCategory("hijaber")!, productName: r.produk.name,
    productCategory: r.produk.category, imageRefPath: r.foto,
    qualityTier: tier as never, format: "hands_only", hookLevel: "berani",
  } as never) as { shots: { index: number; prompt: string }[]; negativePrompt: string };
  assertVisualSpec(spec as never);
  const keras = periksaPromptAkhir({ shots: [spec.shots[0]], negativePrompt: spec.negativePrompt,
    namaProduk: r.produk.name, format: "hands_only", withAudio: true }).filter((t) => t.keras);
  if (keras.length) { console.error(`GERBANG TOLAK: ${ringkasTemuanPrompt(keras)}`); process.exit(1); }
  console.log("gerbang prompt akhir: LOLOS");

  const dir = path.join(OUT, `${id}-${tier}-${ct}`);
  fs.mkdirSync(dir, { recursive: true });
  const satu = { ...(spec as Record<string, unknown>), shots: [{ ...spec.shots[0], index: 0 }] };
  const aset = await byteplusVideo.generate(satu as never, dir);
  const biaya = aset.reduce((n: number, a: { costIdr: number }) => n + a.costIdr, 0);
  const baris = { id, tier, contentType: ct, foto: path.basename(r.foto), sha, klasifikasi: k.jenis,
    resolusi: `${dim.width}x${dim.height}`, biayaIdr: biaya, berkas: aset[0].filePath, naskah: skrip.script_source };
  const led = path.join(OUT, "ledger.jsonl");
  fs.appendFileSync(led, JSON.stringify(baris) + "\n");
  const total = fs.readFileSync(led, "utf8").split("\n").filter(Boolean)
    .reduce((n, b) => n + Number(JSON.parse(b).biayaIdr || 0), 0);
  console.log(`\nBARIS LEDGER: ${JSON.stringify(baris)}`);
  console.log(`TOTAL BERJALAN: Rp${total.toLocaleString("id-ID")} / cap Rp250.000`);
  if (total > 250000) { console.error("STOP-RULE: cap terlampaui."); process.exit(3); }
}
main().catch((e) => { console.error(e); process.exit(1); });
