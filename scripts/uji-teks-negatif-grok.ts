/**
 * UJI A/B: apakah daftar cacat di prompt benar-benar MEMUNCULKAN cacat itu?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERTANYAAN YANG DIJAWAB
 * ─────────────────────────────────────────────────────────────────────────────
 * Vonis Brian atas keluaran Standard: "tangan yang tiba-tiba banyak, ada sosok
 * objek banyak, transparan". Dari job_prompts produksi, teks yang dikirim untuk
 * job 2f95311f memang berisi "extra hands", "second person", "floating parts" —
 * tanpa satu pun penanda negasi, di field yang didokumentasikan kie.ai sebagai
 * "describing the desired video motion".
 *
 * Itu penjelasan yang kuat, tapi tetap sebuah ARGUMEN. Skrip ini menggantinya
 * dengan piksel: shot yang sama, mesin yang sama, dua teks berbeda.
 *
 *   A (LAMA)  "<shot>. Negative: <daftar cacat tanpa negasi>"
 *   B (BARU)  "<shot>. <mutu positif>. <larangan kepatuhan>"
 *
 * Lalu keduanya diperiksa QC yang SAMA dengan yang dipakai produksi — bukan
 * mata saya. QC-11 menghitung orang, QC-02 memeriksa siluet/jari. Kalau
 * hipotesisnya benar, A gagal di tempat yang sama seperti job 2f95311f dan B
 * tidak.
 *
 * BIAYANYA dua klip Standard 720p (~Rp6.750 x 2). Job yang gagal kemarin
 * menghabiskan Rp20.250 tanpa satu video pun, jadi ini murah untuk sebuah
 * jawaban yang pasti.
 *
 * Jalankan:
 *   RENDER_CONFIRM=YA npx tsx scripts/uji-teks-negatif-grok.ts <path-gambar.jpg>
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../lib/config";

if (process.env.RENDER_CONFIRM !== "YA") {
  throw new Error("Skrip ini MEMBAYAR render sungguhan. Setel RENDER_CONFIRM=YA kalau memang itu yang diinginkan.");
}
// Argumennya KUNCI OBJEK di penyimpanan media (mis.
// "uploads/<id-produk>/0.webp"), bukan path lokal: di server, foto produk ada
// di MinIO dan direktori storage kontainer memang kosong. materialize()
// menurunkannya ke path lokal lewat jalur yang sama dengan yang dipakai
// provider produksi.
const kunci = process.argv[2];
if (!kunci) throw new Error("Sebutkan kunci objek gambar, mis. uploads/<id-produk>/0.webp");
if (!config.kieApiKey) throw new Error("KIE_API_KEY kosong.");

// Shot yang dipakai SAMA untuk keduanya — hanya ekornya yang berbeda.
const SHOT =
  "close-up of a young Indonesian woman's hands holding a skincare bottle over a clean home table, " +
  "phone camera look, natural daylight, gentle push in";

// A: ekor LAMA, disalin apa adanya dari job_prompts.negative_prompt job 2f95311f.
const EKOR_LAMA =
  ". Negative: added text overlay, caption bar, subtitle, watermark, invented logo, face distortion, " +
  "extra fingers, plastic skin, distorted packaging, melted plastic, morphing, warping, uncanny artificial look, " +
  "oversmoothed skin, flickering, extra hands, third hand, duplicated limbs, flickering or disappearing product " +
  "label text, deformed packaging, duplicated caps or droppers, floating parts, second person, duplicate of the " +
  "same person, twin, extra people in frame, disembodied hands";

// B: ekor BARU — disusun fungsi produksi, bukan diketik ulang di sini.
const { teksPromptShot } = await import("../lib/providers/teks-prompt");
const ekorBaru = teksPromptShot(
  { negativePrompt: "no added text overlay" } as never,
  { prompt: SHOT } as never,
).slice(SHOT.length);

const VARIAN: { nama: string; teks: string }[] = [
  { nama: "A-LAMA", teks: SHOT + EKOR_LAMA },
  { nama: "B-BARU", teks: SHOT + ekorBaru },
];

async function kie(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.kieApiKey}`,
      ...(init?.headers ?? {}),
    },
  });
  const teks = await res.text();
  if (!res.ok) throw new Error(`kie.ai ${res.status}: ${teks.slice(0, 300)}`);
  const j = JSON.parse(teks) as { data?: Record<string, unknown>; code?: number; msg?: string };
  if (j.code !== undefined && j.code !== 200) throw new Error(`kie.ai code ${j.code}: ${j.msg}`);
  return j.data ?? {};
}

const keluar = path.join(process.cwd(), "storage", "uji-teks-negatif");
fs.mkdirSync(keluar, { recursive: true });

// Gambar referensi harus bisa diambil kie.ai lewat URL publik. Dipakai ulang
// jalur yang sama dengan produksi: unggah ke penyimpanan kita, lalu kirim URL-nya.
const { terbitkanGambarProvider } = await import("../lib/gambar-provider");
const { mediaStorage } = await import("../lib/storage");
const gambar = await mediaStorage().materialize(kunci);
if (!gambar || !fs.existsSync(gambar)) throw new Error(`objek tidak ditemukan di penyimpanan: ${kunci}`);
const imageUrl = await terbitkanGambarProvider(gambar, "uji-teks-negatif", 0);
console.log(`gambar referensi: ${imageUrl}\n`);

for (const v of VARIAN) {
  console.log(`=== ${v.nama} ===`);
  console.log(v.teks.slice(0, 200) + (v.teks.length > 200 ? " ..." : ""));
  const dibuat = await kie(`${config.kieBaseUrl}${config.kiePathCreate}`, {
    method: "POST",
    body: JSON.stringify({
      model: config.kieGrokModel,
      input: {
        image_urls: [imageUrl], index: 0, prompt: v.teks, mode: "normal",
        aspect_ratio: "9:16", duration: 6, resolution: "720p", nsfw_checker: true,
      },
    }),
  });
  const taskId = (dibuat.taskId ?? dibuat.task_id) as string;
  console.log(`taskId: ${taskId}`);

  let urlVideo = "";
  let kredit = 0;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const d = await kie(`${config.kieBaseUrl}${config.kiePathRecord}?taskId=${encodeURIComponent(taskId)}`);
    const state = String(d.state ?? d.status ?? "");
    if (/fail|error/i.test(state)) throw new Error(`${v.nama} gagal: ${JSON.stringify(d).slice(0, 300)}`);
    if (/success|complete/i.test(state)) {
      kredit = Number(d.creditsConsumed ?? 0);
      const hasil = typeof d.resultJson === "string" ? JSON.parse(d.resultJson) : d.resultJson;
      urlVideo = (hasil?.resultUrls ?? hasil?.result_urls ?? [])[0];
      break;
    }
  }
  if (!urlVideo) throw new Error(`${v.nama}: tidak ada URL hasil setelah 10 menit`);

  const berkas = path.join(keluar, `${v.nama}.mp4`);
  fs.writeFileSync(berkas, Buffer.from(await (await fetch(urlVideo)).arrayBuffer()));
  console.log(`video: ${berkas}  (kredit kie.ai: ${kredit})\n`);
}

console.log("Selesai. Jalankan QC atas kedua berkas di storage/uji-teks-negatif/.");
