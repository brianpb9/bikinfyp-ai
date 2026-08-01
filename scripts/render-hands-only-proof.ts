// Render bukti hands_only_fix: 1 job byteplus (silent_caption) per kategori via API,
// lalu ekstrak 6 frame (1,4,7,10,12,14 dtk) + tulis info job.
// Prasyarat: dev server jalan dengan PROVIDER_VIDEO=byteplus (PORT, default 3210).
// Jalankan: npx tsx scripts/render-hands-only-proof.ts <kategori> [foto]
// Contoh:  npx tsx scripts/render-hands-only-proof.ts genz ../test_output/crop_fix/foto_uji_persegi.png

import fs from "node:fs";
import path from "node:path";
import { runFfmpeg } from "../lib/media/ffmpeg";

const BASE = `http://localhost:${process.env.PORT ?? 3210}`;
const CATEGORY = process.argv[2] ?? "genz";
const PHOTO = process.argv[3] ?? path.resolve(process.cwd(), "..", "test_output", "crop_fix", "foto_uji_persegi.png");
const OUT_DIR = path.resolve(process.cwd(), "..", "test_output", "hands_only_fix", CATEGORY);
const VISUAL_DESC = "kotak merah solid dengan huruf P putih besar di tengah, latar krem polos";

let cookie = "";
async function api(url: string, opts?: { method?: string; json?: unknown; formData?: FormData }) {
  const res = await fetch(`${BASE}${url}`, {
    method: opts?.method ?? (opts?.json || opts?.formData ? "POST" : "GET"),
    headers: {
      ...(opts?.json ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: opts?.formData ?? (opts?.json ? JSON.stringify(opts.json) : undefined),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const phone = `0816${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

  const login = await api("/api/auth/dev-login", { json: { phone } });
  if (login.status !== 200) throw new Error(`login: ${login.status}`);
  await api("/api/credits/topup", { json: { package_id: "senyap5" } }); // cukup untuk beberapa percobaan

  const fd = new FormData();
  fd.set("name", "Serum Glow Bright");
  fd.set("price_idr", "85000");
  fd.set("category", "beauty");
  fd.set("product_visual_desc", VISUAL_DESC);
  fd.append("photos", new Blob([fs.readFileSync(PHOTO)], { type: "image/png" }), "foto.png");
  const prod = await api("/api/products", { formData: fd });
  if (prod.status !== 201) throw new Error(`produk: ${prod.status} ${JSON.stringify(prod.data)}`);
  const productId = prod.data.product_id;

  const gen = await api("/api/scripts/generate", {
    json: { product_id: productId, register: "bestie", emotion: "senang", format: "hands_only", quality_tier: "silent_caption" },
  });
  if (!gen.data.scripts?.length) throw new Error(`generate: ${JSON.stringify(gen.data)}`);
  const scriptId = gen.data.scripts[0].id;

  await api(`/api/scripts/${scriptId}/approve`, { json: {} });
  const job = await api("/api/jobs", {
    json: { script_id: scriptId, format: "hands_only", duration_s: 15, quality_tier: "silent_caption", creator_category: CATEGORY },
  });
  if (job.status !== 201) throw new Error(`job: ${job.status} ${JSON.stringify(job.data)}`);
  const jobId = job.data.job_id;
  console.log(`[${CATEGORY}] job ${jobId}`);

  let detail: Record<string, unknown> = {};
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const res = await api(`/api/jobs/${jobId}`);
    detail = res.data;
    if (["READY", "FAILED", "REFUNDED"].includes(String(res.data.state))) break;
  }
  console.log(`[${CATEGORY}] state=${detail.state} cost=Rp${detail.cost_actual_idr} provider=${detail.provider_video}`);

  const info = { jobId, category: CATEGORY, state: detail.state, cost: detail.cost_actual_idr, provider: detail.provider_video, qc: detail.qc_result };
  fs.writeFileSync(path.join(OUT_DIR, "job.json"), JSON.stringify(info, null, 2));

  if (detail.state === "READY") {
    const out = await api(`/api/jobs/${jobId}/output`);
    const video = await fetch(`${BASE}${out.data.video_url}`, { headers: { cookie } });
    const videoPath = path.join(OUT_DIR, "video.mp4");
    fs.writeFileSync(videoPath, Buffer.from(await video.arrayBuffer()));
    for (const t of [1, 4, 7, 10, 12, 14]) {
      await runFfmpeg(["-y", "-v", "error", "-ss", String(t), "-i", videoPath, "-frames:v", "1", path.join(OUT_DIR, `frame_${t}s.png`)]);
    }
    console.log(`[${CATEGORY}] READY — 6 frame diekstrak ke ${OUT_DIR}`);
  } else {
    console.log(`[${CATEGORY}] TIDAK READY (${detail.state}) — QC menangkap masalah / provider gagal. Detail di job.json`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
