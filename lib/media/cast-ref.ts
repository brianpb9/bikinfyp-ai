/**
 * CAST-REF: identitas avatar dikunci di tahap GAMBAR, bukan tahap video.
 *
 * Kenapa dua tahap, bukan langsung ke video:
 *
 *   Gemini MENERIMA wajah AI sebagai referensi. Seedance (2/2.5) belum —
 *   dan itu bukan dugaan, itu batas yang sudah lama kita tabrak: BytePlus
 *   menolak foto wajah asli ("input image may contain real person",
 *   2026-08-12), dan sampai spike 17 Agu belum pernah ada bukti ia menerima
 *   wajah BUATAN sekalipun.
 *
 * Jadi identitasnya dikunci di tempat yang memang menerimanya: satu paket
 * CAST-REF per avatar dibuat sekali dengan Gemini, lalu setiap frame awal
 * segmen DITURUNKAN darinya. Yang sampai ke Seedance adalah frame turunan —
 * sebuah adegan, bukan potret.
 *
 * Kalau Seedance menolak frame berwajah, SEEDANCE_FACE_REF=false membuat
 * frame turunannya dibuat TANPA wajah (produk + ruangan + tubuh dari leher ke
 * bawah), dan identitas avatar dibawa deskripsi teks seperti sekarang. Satu
 * flag, satu tempat, supaya bisa dibalik begitu Seedance membukanya.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { config } from "../config";

const MODEL = "gemini-3.1-flash-image";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** Sama dengan BIAYA_FRAME_IDR di first-frame.ts — satu panggilan gambar. */
const BIAYA_GAMBAR_IDR = 650;

export class CastRefUnavailable extends Error {
  constructor(sebab: string) { super(`CAST-REF tidak bisa dibuat: ${sebab}`); this.name = "CastRefUnavailable"; }
}

function dataUri(p: string) {
  const ext = path.extname(p).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return { mime_type: mime, data: fs.readFileSync(p).toString("base64") };
}

/** Aturan yang selalu ikut — sama semangatnya dengan negative prompt video. */
const SELALU =
  "Photorealistic, natural skin texture with visible pores, realistic imperfect lighting. " +
  "No text, no logo, no watermark, no caption, no border, no collage, no beauty filter, " +
  "no plastic skin, no oversmoothing. Exactly one person. Vertical 9:16 framing.";

async function gambar(prompt: string, refs: string[], outPath: string): Promise<{ path: string; biayaIdr: number }> {
  if (!config.geminiApiKey) throw new CastRefUnavailable("GEMINI_API_KEY belum di-set");
  for (const r of refs) if (!fs.existsSync(r)) throw new CastRefUnavailable(`referensi tidak ada: ${r}`);

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": config.geminiApiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${prompt}\n\n${SELALU}` }, ...refs.map((r) => ({ inline_data: dataUri(r) }))] }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new CastRefUnavailable(`HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: ({ inlineData?: { data: string }; inline_data?: { data: string } })[] } }[];
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const b64 = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  const isi = b64?.inlineData?.data ?? b64?.inline_data?.data;
  if (!isi) throw new CastRefUnavailable("respons tanpa gambar");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(isi, "base64"));
  return { path: outPath, biayaIdr: BIAYA_GAMBAR_IDR };
}

export interface PaketCastRef {
  netral: string;
  tigaPerempat: string;
  closeUp: string;
  biayaIdr: number;
}

/**
 * Bangun paket CAST-REF untuk satu avatar. Dipanggil SEKALI per avatar, bukan
 * per job — hasilnya disimpan dan dipakai ulang, itulah yang membuat wajahnya
 * konsisten antar video.
 *
 * Frame kedua dan ketiga diturunkan dari frame PERTAMA (dikirim balik sebagai
 * referensi), bukan digenerate mandiri dari teks yang sama. Tiga generate
 * mandiri menghasilkan tiga orang yang mirip tapi berbeda — persis masalah
 * yang paket ini dibuat untuk menyelesaikannya.
 */
export async function buatPaketCastRef(avatarDesc: string, outDir: string): Promise<PaketCastRef> {
  const netral = path.join(outDir, "netral.png");
  const a = await gambar(
    `Head-and-shoulders portrait photo of this person: ${avatarDesc}. ` +
      `Relaxed neutral expression, looking straight into a phone camera, soft indoor daylight, ` +
      `plain lived-in home background. Casual selfie framing.`,
    [],
    netral
  );

  const TETAP =
    "Keep exactly the same person as the reference: same face, same facial proportions, same skin tone, " +
    "same hair, same wardrobe. Change ONLY what is described next.";

  const tigaPerempat = path.join(outDir, "tiga-perempat.png");
  const b = await gambar(
    `${TETAP} Change only this: she is turned three-quarters to the camera, one hand relaxed near her chest ` +
      `as if about to hold something up, same room, same lighting.`,
    [netral],
    tigaPerempat
  );

  const closeUp = path.join(outDir, "close-up.png");
  const c = await gambar(
    `${TETAP} Change only this: a closer framing from mid-chest up, her face larger in frame, ` +
      `a small warm smile, same room, same lighting.`,
    [netral],
    closeUp
  );

  return { netral, tigaPerempat, closeUp, biayaIdr: a.biayaIdr + b.biayaIdr + c.biayaIdr };
}

/**
 * Paket CAST-REF milik satu avatar, dibuat SEKALI lalu dipakai ulang.
 *
 * Cache-nya berkas di disk, bukan basis data — sengaja. Paket ini adalah tiga
 * PNG; menaruhnya di tabel berarti migrasi, dan yang dibutuhkan cuma "sudah
 * pernah dibuat atau belum". Kalau berkasnya hilang, ia dibuat lagi seharga
 * Rp1.950 dan tidak ada yang rusak.
 *
 * Kuncinya WAJIB stabil per identitas avatar. Untuk preset, id presetnya.
 * Untuk avatar unggahan sendiri, sidik jari deskripsinya — dua deskripsi
 * berbeda adalah dua orang berbeda dan tidak boleh berbagi paket.
 */
export function kunciCastRef(input: { presetId?: string | null; customDesc?: string | null }): string {
  const custom = input.customDesc?.trim();
  if (custom) return `custom-${createHash("sha1").update(custom).digest("hex").slice(0, 16)}`;
  return `preset-${(input.presetId ?? "hijaber").replace(/[^a-z0-9_-]/gi, "")}`;
}

export async function paketCastRefTersimpan(
  kunci: string,
  avatarDesc: string,
  baseDir: string
): Promise<PaketCastRef> {
  const dir = path.join(baseDir, "castref", kunci);
  const netral = path.join(dir, "netral.png");
  const tigaPerempat = path.join(dir, "tiga-perempat.png");
  const closeUp = path.join(dir, "close-up.png");
  if ([netral, tigaPerempat, closeUp].every((p) => fs.existsSync(p))) {
    return { netral, tigaPerempat, closeUp, biayaIdr: 0 };
  }
  fs.mkdirSync(dir, { recursive: true });
  return buatPaketCastRef(avatarDesc, dir);
}

/**
 * Frame awal satu segmen, DITURUNKAN dari CAST-REF + foto produk.
 *
 * `denganWajah` mengikuti SEEDANCE_FACE_REF. Saat false, frame sengaja dibuat
 * tanpa wajah (produk + ruangan + tubuh dari leher ke bawah) supaya bisa
 * dikirim ke Seedance tanpa memicu penolakan wajah — identitas avatar dibawa
 * deskripsi teks di prompt video, seperti perilaku sekarang.
 */
export interface HasilFrameTurunan {
  path: string;
  biayaIdr: number;
  /** Verdict QC-F1 pada frame yang akhirnya dipakai. */
  qc: import("./qc-frame").HasilQcF1;
  /** Berapa kali frame digulung ulang sebelum diterima (0 = sekali jadi). */
  ulang: number;
}

/**
 * Frame awal + QC-F1 + gulung ulang maksimal dua kali.
 *
 * MAKSIMAL DUA, lalu frame terakhir tetap dikembalikan bersama verdict-nya
 * yang GAGAL — bukan dilempar sebagai error. Alasannya: pemanggil (worker)
 * yang berhak memutuskan apakah menahan job, dan keputusan itu berbeda antara
 * jalur retail dan jalur review brand. Yang wajib adalah verdictnya tercatat,
 * bukan bahwa fungsi ini yang menghentikan semuanya.
 *
 * Foto produk ASLI dikirim ulang di SETIAP percobaan — tidak pernah menurunkan
 * produk dari frame sebelumnya. Menurunkan dari turunan membuat pergeseran
 * bentuk menumpuk diam-diam: percobaan kedua akan setia pada botol yang sudah
 * salah di percobaan pertama.
 */
export async function turunkanFrameAwalTerperiksa(input: {
  castRefPath: string;
  productPhotoPath: string;
  productName: string;
  startState: string;
  outPath: string;
  denganWajah: boolean;
  /** Diteruskan ke QC-F1 — hanya frame hero yang wajib lolos OCR merek. */
  productState?: "hero" | "partial";
}): Promise<HasilFrameTurunan> {
  const { qcF1FrameFidelity } = await import("./qc-frame");
  const MAKS_ULANG = 2;
  let biaya = 0;
  let terakhir: import("./qc-frame").HasilQcF1 | null = null;

  for (let ulang = 0; ulang <= MAKS_ULANG; ulang++) {
    const f = await turunkanFrameAwal(input);
    biaya += f.biayaIdr;
    const qc = await qcF1FrameFidelity({
      framePath: f.path,
      // ASLI, selalu — lihat catatan di atas.
      productPhotoPath: input.productPhotoPath,
      productName: input.productName,
      productState: input.productState,
    });
    biaya += qc.biayaIdr;
    terakhir = qc;
    // Hanya PASS yang boleh dipakai. UNVERIFIED sengaja TIDAK diulang: kalau
    // kuncinya tidak ada atau OCR mati, mengulang cuma membakar biaya gambar
    // untuk pemeriksa yang tetap tidak bisa memeriksa.
    if (qc.status === "PASS") return { path: f.path, biayaIdr: biaya, qc, ulang };
    if (qc.status === "UNVERIFIED") {
      console.error(`[QC-F1] frame ${path.basename(input.outPath)}: ${qc.detail}`);
      return { path: input.outPath, biayaIdr: biaya, qc, ulang };
    }
    console.warn(`[QC-F1] frame ${path.basename(input.outPath)} percobaan ${ulang + 1}: ${qc.detail}`);
  }

  console.error(`[QC-F1] frame ${path.basename(input.outPath)} TETAP ${terakhir!.status} setelah ${MAKS_ULANG + 1} percobaan: ${terakhir!.detail}`);
  return { path: input.outPath, biayaIdr: biaya, qc: terakhir!, ulang: MAKS_ULANG };
}

export async function turunkanFrameAwal(input: {
  castRefPath: string;
  productPhotoPath: string;
  startState: string;
  outPath: string;
  denganWajah: boolean;
}): Promise<{ path: string; biayaIdr: number }> {
  const wajah = input.denganWajah
    ? "Keep exactly the same person as the first reference: same face, same hair, same wardrobe."
    : "IMPORTANT: no face is visible in this frame. Crop or angle the shot so the person is seen from the " +
      "neck down only — hands, arms and torso. Do not show any face, and do not invent a second person.";
  const produk =
    "The product must look exactly like the second reference image — same shape, same colour, same packaging, " +
    "same label artwork and spelling. Do not redesign it.";

  return gambar(
    `Create a still frame that already looks like it was taken from the middle of a real UGC video, ` +
      `not a posed product photo.\n\nSCENE: ${input.startState}\n\n${wajah}\n${produk}`,
    [input.castRefPath, input.productPhotoPath],
    input.outPath
  );
}
