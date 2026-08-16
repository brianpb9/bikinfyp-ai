/**
 * SPIKE STEP 0.5 — tiga klip 5 detik, membelanjakan uang BytePlus sungguhan.
 *
 * Pertanyaan yang dijawab (dan tidak bisa dijawab tanpa render nyata):
 *   A. first_frame (foto produk) + generate_audio → diterima? mulut bicara?
 *   B. reference_image (foto produk) + generate_audio → sama, mode berbeda
 *   C. reference_image ×2 (produk + CAST-REF selfie hasil AI) + generate_audio
 *
 * Dipanggil lewat byteplusVideo.generate() — jalur yang SAMA dengan produksi,
 * bukan HTTP yang ditulis ulang di sini. Kalau ditulis ulang, yang terbukti
 * bukan perilaku aplikasi kita.
 *
 * TIDAK menyentuh jalur uang aplikasi: tanpa job, tanpa hold kredit, tanpa
 * antrean. Intake produksi tetap tertutup dan tidak terpengaruh.
 */
import fs from "node:fs";
import path from "node:path";
import { byteplusVideo } from "../lib/providers/stubs/byteplus";
import { generateFirstFrame } from "../lib/media/first-frame";
import type { VisualSpec } from "../lib/providers/types";

const FOTO = process.env.SPIKE_FOTO ?? "";
if (!fs.existsSync(FOTO)) { console.error("SPIKE_FOTO tidak ada:", FOTO); process.exit(2); }

const OUT = process.env.SPIKE_OUT ?? "/tmp/spike";
fs.mkdirSync(OUT, { recursive: true });

const DIALOG = "Serum ini ringan banget di kulit.";

/** Prompt sengaja RINGKAS — spike ini menguji perilaku API, bukan mutu naskah. */
function promptBicara(): string {
  return [
    "Vertical UGC selfie video. A young Indonesian woman in her mid-20s, natural makeup,",
    "sits in soft daylight at home, holding the product up beside her face at chest height,",
    "its label turned squarely to camera and kept fully inside frame the whole time.",
    "She looks straight into the lens and SPEAKS this line out loud in casual Indonesian,",
    `her mouth clearly moving in sync with the words: "${DIALOG}".`,
    "The product is the exact same one as in the reference image — identical bottle shape,",
    "identical label artwork, identical spelling. Natural phone-camera look, one continuous take.",
  ].join(" ");
}

const NEGATIF = "no crowd, no background people, no second person, no fake logos, no text overlay, no captions, no watermark, no cinematic colour grade, no studio gloss";

function spec(shotImage: string, extras: string[] | undefined, referenceOnly: boolean): VisualSpec {
  return {
    jobId: `spike-${Date.now()}`,
    width: 720, height: 1280,
    shots: [{ index: 0, durationSec: 5, prompt: promptBicara(), imageRefPath: shotImage }],
    negativePrompt: NEGATIF,
    qualityTier: "high_quality",
    generateAudio: true,
    ...(extras && extras.length ? { extraReferenceImagePaths: extras } : {}),
    ...(referenceOnly ? { referenceOnlyImages: true } : {}),
    ratio: "9:16",
    maxPeople: 1,
  } as VisualSpec;
}

async function jalankan(nama: string, s: VisualSpec) {
  const dir = path.join(OUT, nama);
  fs.mkdirSync(dir, { recursive: true });
  const mulai = Date.now();
  try {
    const aset = await byteplusVideo.generate(s, dir);
    const detik = ((Date.now() - mulai) / 1000).toFixed(0);
    for (const a of aset) console.log(`[${nama}] DITERIMA · ${detik}s · ${a.filePath}`);
    return { nama, status: "diterima", berkas: aset.map((a) => a.filePath) };
  } catch (err) {
    const pesan = err instanceof Error ? err.message : String(err);
    console.log(`[${nama}] DITOLAK · ${pesan}`);
    return { nama, status: "ditolak", error: pesan };
  }
}

const hasil: unknown[] = [];

console.log("=== A. first_frame (foto produk) + audio ===");
hasil.push(await jalankan("A-first-frame", spec(FOTO, undefined, false)));

console.log("\n=== B. reference_image (foto produk) + audio ===");
hasil.push(await jalankan("B-reference-image", spec(FOTO, undefined, true)));

console.log("\n=== C. reference_image x2 (produk + CAST-REF) + audio ===");
const castRef = path.join(OUT, "cast-ref.png");
try {
  const ff = await generateFirstFrame({
    productPhotoPath: FOTO,
    shotPrompt:
      "Head-and-shoulders selfie portrait of a young Indonesian woman in her mid-20s, natural makeup, " +
      "soft daylight, plain home background, looking straight at the camera with a relaxed neutral expression. " +
      "Photorealistic phone-camera look.",
    ratio: "9:16",
    outPath: castRef,
    withholdProduct: true,
  });
  console.log(`CAST-REF dibuat: ${ff.path} (Rp${ff.biayaIdr})`);
  hasil.push(await jalankan("C-dua-referensi", spec(FOTO, [castRef], true)));
} catch (err) {
  console.log("CAST-REF GAGAL dibuat:", err instanceof Error ? err.message : err);
  hasil.push({ nama: "C-dua-referensi", status: "dilewati", error: "CAST-REF gagal dibuat" });
}

console.log("\n=== RINGKASAN ===");
console.log(JSON.stringify(hasil, null, 2));
