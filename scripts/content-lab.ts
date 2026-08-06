// CONTENT LAB — sistem uji kualitas KONTEN terpisah dari app production
// (keputusan Brian 2026-08-07: "apps sudah 90%, tanpa konten bagus = sampah").
//
// Menjalankan PIPELINE PRODUKSI PENUH (script engine -> shot planner ->
// BytePlus -> compositor -> QC) secara LOKAL via dev server, sehingga resep
// prompt bisa diiterasi & dinilai side-by-side TANPA menyentuh bikinfyp.com
// dan tanpa membakar kredit user. Output per varian: video final + frame
// telaah + manifest (skrip, prompt shot, biaya, hasil QC).
//
// Prasyarat: dev server nyala dengan PROVIDER_VIDEO=byteplus:
//   PROVIDER_VIDEO=byteplus PORT=3210 npm run dev
// Jalankan: npx tsx scripts/content-lab.ts <varian> <kategoriKreator> [fotoDir]
// Contoh:  npx tsx scripts/content-lab.ts hijaber-candid hijaber storage/uploads/c1e0383d-4851-4cf2-9050-d5c04befb978

import fs from "node:fs";
import path from "node:path";
import { runFfmpeg } from "../lib/media/ffmpeg";

const BASE = `http://localhost:${process.env.PORT ?? 3210}`;
const VARIANT = process.argv[2] ?? "hijaber-candid";
const CATEGORY = process.argv[3] ?? "hijaber";
const PHOTO_DIR = process.argv[4] ?? path.join(process.cwd(), "storage", "uploads", "c1e0383d-4851-4cf2-9050-d5c04befb978");
const OUT_DIR = path.resolve(process.cwd(), "test_output", "content-lab", VARIANT);

let cookie = "";
async function api(url: string, opts?: { method?: string; json?: unknown; formData?: FormData }) {
  const res = await fetch(`${BASE}${url}`, {
    method: opts?.method ?? (opts?.json || opts?.formData ? "POST" : "GET"),
    headers: { ...(opts?.json ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: opts?.formData ?? (opts?.json ? JSON.stringify(opts.json) : undefined),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const photos = fs.readdirSync(PHOTO_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
  if (!photos.length) throw new Error(`tidak ada foto di ${PHOTO_DIR}`);

  const phone = `0816${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const login = await api("/api/auth/dev-login", { json: { phone } });
  if (login.status !== 200) throw new Error(`login: ${login.status}`);
  await api("/api/credits/topup", { json: { package_id: "hq5" } });

  const fd = new FormData();
  fd.set("name", "SKIN1004 Centella Ampoule");
  fd.set("price_idr", "159000");
  fd.set("category", "beauty");
  fd.set("product_visual_desc", "botol kaca bening berisi serum dengan kapsul putih kecil, label putih bertuliskan CENTELLA, tutup pipet putih");
  for (const p of photos) {
    fd.append("photos", new Blob([fs.readFileSync(path.join(PHOTO_DIR, p))], { type: "image/jpeg" }), p);
  }
  const prod = await api("/api/products", { formData: fd });
  if (prod.status !== 201) throw new Error(`produk: ${prod.status} ${JSON.stringify(prod.data)}`);
  const productId = prod.data.product_id;

  const gen = await api("/api/scripts/generate", {
    json: { product_id: productId, register: "bestie", emotion: "senang", format: "talking_head", quality_tier: "high_quality" },
  });
  if (!gen.data.scripts?.length) throw new Error(`generate: ${JSON.stringify(gen.data)}`);
  const script = gen.data.scripts[0];
  await api(`/api/scripts/${script.id}/approve`, { json: {} });

  const job = await api("/api/jobs", {
    json: { script_id: script.id, format: "talking_head", duration_s: 15, quality_tier: "high_quality", creator_category: CATEGORY },
  });
  if (job.status !== 201) throw new Error(`job: ${job.status} ${JSON.stringify(job.data)}`);
  const jobId = job.data.job_id;
  console.log(`[lab] varian=${VARIANT} job=${jobId} — render jalan (BytePlus, ~4-8 mnt)...`);

  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 15000));
    const st = await api(`/api/jobs/${jobId}`);
    const state = st.data.state;
    process.stdout.write(`  ${Math.round((Date.now() - t0) / 1000)}s ${state}\n`);
    if (state === "READY") break;
    if (["FAILED", "REFUNDED"].includes(state)) {
      fs.writeFileSync(path.join(OUT_DIR, "job-failed.json"), JSON.stringify(st.data, null, 2));
      throw new Error(`job ${state} — detail di ${OUT_DIR}/job-failed.json`);
    }
    if (Date.now() - t0 > 15 * 60_000) throw new Error("timeout 15 mnt");
  }

  const out = await api(`/api/jobs/${jobId}/output`);
  const videoRes = await fetch(out.data.video_url.startsWith("http") ? out.data.video_url : `${BASE}${out.data.video_url}`, { headers: { cookie } });
  const videoPath = path.join(OUT_DIR, "output.mp4");
  fs.writeFileSync(videoPath, Buffer.from(await videoRes.arrayBuffer()));
  for (const sec of [1, 4, 7, 10, 13]) {
    await runFfmpeg(["-y", "-v", "error", "-ss", String(sec), "-i", videoPath, "-frames:v", "1", path.join(OUT_DIR, `frame_${String(sec).padStart(2, "0")}s.png`)]);
  }
  const detail = await api(`/api/jobs/${jobId}`);
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify({
    variant: VARIANT, creator_category: CATEGORY, job: detail.data, script_segments: script.segments ?? script,
  }, null, 2));
  console.log(`[lab] SELESAI: ${videoPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
