/**
 * UJI A/B: apakah menyebut nama cacat di prompt benar-benar MEMUNCULKAN cacat itu?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KENAPA SKRIP INI BERDIRI SENDIRI (tanpa impor lib)
 * ─────────────────────────────────────────────────────────────────────────────
 * Kredensial kie.ai hanya ada di server, dan kontainer produksi memuat hasil
 * build — bukan sumber TypeScript. Skrip yang mengimpor lib/ tidak bisa
 * dijalankan di satu-satunya tempat yang bisa menjalankannya.
 *
 * Konsekuensinya teks varian B ditulis ulang di sini, dan teks yang disalin
 * PASTI hanyut. Itu dijaga tes: tests/uji-teks-negatif-selaras.test.ts
 * membandingkan EKOR_BARU di bawah dengan keluaran teksPromptShot() yang
 * sungguhan. Kalau kode produksi berubah dan skrip ini tidak, tesnya merah.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * YANG DIUJI
 * ─────────────────────────────────────────────────────────────────────────────
 * Shot sama, mesin sama (Grok Imagine lewat kie.ai), dua ekor teks:
 *
 *   A (LAMA)  ". Negative: <daftar cacat>" — disalin apa adanya dari
 *             job_prompts.negative_prompt job 2f95311f di produksi.
 *   B (BARU)  ". <mutu positif>. <larangan kepatuhan>"
 *
 * Dipakai text-to-video, bukan image-to-video: pertanyaannya tentang TEKS, dan
 * membuang gambar referensi membuang satu-satunya variabel lain.
 *
 * Jalankan di dalam kontainer web:
 *   docker compose exec -e RENDER_CONFIRM=YA web node scripts/uji-teks-negatif-grok.mjs
 */
import fs from "node:fs";
import path from "node:path";

// Pagar biaya dan kredensial diperiksa DI DALAM blok jalan, bukan saat impor.
// Versi pertama memeriksanya di tingkat modul, dan itu menjatuhkan tes yang
// mengimpor file ini hanya untuk membaca konstanta teksnya — pagar yang benar
// dipasang di tempat yang salah tetap menahan orang yang tidak sedang membayar
// apa pun.
const KEY = process.env.KIE_API_KEY;
const BASE = process.env.KIE_BASE_URL || "https://api.kie.ai";
const MODEL = "grok-imagine/text-to-video";

const SHOT =
  "close-up of a young Indonesian woman's hands holding a small skincare bottle over a clean home table, " +
  "phone camera look, natural daylight, gentle push in";

// Disalin apa adanya dari produksi (job_prompts job 2f95311f).
const EKOR_LAMA =
  ". Negative: added text overlay, caption bar, subtitle, watermark, invented logo, face distortion, " +
  "extra fingers, plastic skin, distorted packaging, melted plastic, morphing, warping, uncanny artificial look, " +
  "oversmoothed skin, flickering, extra hands, third hand, duplicated limbs, flickering or disappearing product " +
  "label text, deformed packaging, duplicated caps or droppers, floating parts, second person, duplicate of the " +
  "same person, twin, extra people in frame, disembodied hands";

// Dijaga selaras dengan teksPromptShot() oleh tests/uji-teks-negatif-selaras.test.ts.
const EKOR_BARU =
  ". Single continuous take of exactly one person, both hands with five fingers each, " +
  "natural undistorted face and anatomy, solid opaque objects that stay whole, " +
  "realistic skin texture, product packaging stable and undeformed with its printed label legible throughout. " +
  "Do not add any text overlay, caption bar, subtitle, watermark, or invented logo.";

export const EKOR = { LAMA: EKOR_LAMA, BARU: EKOR_BARU };

async function kie(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, ...(init?.headers ?? {}) },
  });
  const teks = await res.text();
  if (!res.ok) throw new Error(`kie.ai ${res.status}: ${teks.slice(0, 300)}`);
  const j = JSON.parse(teks);
  if (j.code !== undefined && j.code !== 200) throw new Error(`kie.ai code ${j.code}: ${j.msg}`);
  return j.data ?? {};
}

if (process.argv[1] && process.argv[1].endsWith("uji-teks-negatif-grok.mjs")) {
  if (process.env.RENDER_CONFIRM !== "YA") {
    throw new Error("Skrip ini MEMBAYAR render sungguhan. Setel RENDER_CONFIRM=YA.");
  }
  if (!KEY) throw new Error("KIE_API_KEY kosong.");
  const keluar = "/tmp/uji-teks-negatif";
  fs.mkdirSync(keluar, { recursive: true });
  const ringkas = [];

  for (const [nama, ekor] of [["A-LAMA", EKOR_LAMA], ["B-BARU", EKOR_BARU]]) {
    const prompt = SHOT + ekor;
    console.log(`\n=== ${nama} ===\n${prompt.slice(0, 180)} ...`);
    const dibuat = await kie(`${BASE}/api/v1/jobs/createTask`, {
      method: "POST",
      body: JSON.stringify({
        model: MODEL,
        input: { prompt, mode: "normal", aspect_ratio: "9:16", duration: 6, resolution: "720p", nsfw_checker: true },
      }),
    });
    const taskId = dibuat.taskId ?? dibuat.task_id;
    console.log(`taskId: ${taskId}`);

    let url = "", kredit = 0;
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const d = await kie(`${BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
      const state = String(d.state ?? d.status ?? "");
      if (/fail|error/i.test(state)) throw new Error(`${nama} gagal: ${JSON.stringify(d).slice(0, 400)}`);
      if (/success|complete/i.test(state)) {
        kredit = Number(d.creditsConsumed ?? 0);
        const h = typeof d.resultJson === "string" ? JSON.parse(d.resultJson) : d.resultJson;
        url = (h?.resultUrls ?? h?.result_urls ?? [])[0];
        break;
      }
    }
    if (!url) throw new Error(`${nama}: tidak ada URL hasil setelah 10 menit`);
    const berkas = path.join(keluar, `${nama}.mp4`);
    fs.writeFileSync(berkas, Buffer.from(await (await fetch(url)).arrayBuffer()));
    console.log(`video: ${berkas} (kredit kie.ai: ${kredit})`);
    ringkas.push({ nama, berkas, kredit });
  }
  console.log(`\n${JSON.stringify(ringkas, null, 2)}`);
}
