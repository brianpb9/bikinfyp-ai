// FRAME PERTAMA — dibuat sendiri, bukan diambil dari foto produk apa adanya.
//
// MASALAH YANG DISELESAIKAN, terukur lewat tiga putaran render 2026-08-13:
// mode i2v BytePlus menjadikan gambar yang dikirim sebagai FRAME PERTAMA
// PERSIS. Selama gambar itu foto produk, setiap shot berangkat dari foto
// produk — dan setiap template yang premisnya justru MENAHAN produk jadi
// mustahil dijalankan.
//
// Yang gagal karenanya: "Meja Kosong" (harusnya meja penuh alat, tanpa
// produk) keluar sebagai orang memegang produk; "Jam Tiga Pagi" (harusnya
// kamar gelap) keluar dengan botol nangkring sejak detik pertama; empat
// pattern-interrupt (atap runtuh, pintu didobrak) tidak pernah punya
// interupsinya.
//
// SOLUSINYA: buat dulu frame pertamanya sebagai GAMBAR DIAM yang sesuai
// perannya, baru umpankan ke video. Gambar ~Rp600, klip video Rp2.771-8.313 —
// jadi salah di tahap gambar 5-15x lebih murah daripada salah di tahap video.
// Ini juga yang membuat gerbang persetujuan brand masuk akal: menyetujui
// gambar itu murah, menyetujui video tidak.
//
// Referensi produk tetap dikirim supaya produknya tetap produk MEREKA — yang
// berubah cuma komposisi dan tempatnya.

import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

const MODEL = "gemini-3.1-flash-image";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Perkiraan biaya per gambar (IDR). Dipakai menampilkan estimasi ke brand dan
 *  menahan diri dari membuat kandidat berlebihan. Angka kasar dari tarif
 *  gambar Gemini; ditandai ESTIMASI karena tarif bisa berubah. */
export const BIAYA_FRAME_IDR = 600;

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
};

export interface FirstFrameInput {
  /** Foto produk asli brand — dikirim sebagai referensi identitas produk. */
  productPhotoPath: string;
  /** Prompt shot dari perencana. Yang menentukan komposisi dan tempatnya. */
  shotPrompt: string;
  /** 9:16 untuk UGC, 16:9 untuk TVC. */
  ratio: string;
  outPath: string;
  /** true = produk TIDAK boleh muncul di frame ini. Diambil dari peran shot
   *  ("the product is NOT visible yet"). Tanpa ini, model hampir selalu
   *  menyelipkan produknya karena fotonya ikut dikirim sebagai referensi. */
  withholdProduct?: boolean;
}

/** Instruksi yang SELALU ikut, apa pun shot-nya.
 *
 *  "no text, no logo, no watermark" sama dengan negative prompt video kita —
 *  frame pertama yang membawa teks akan mewariskan teks itu ke seluruh klip,
 *  dan teks karangan model hampir selalu jadi huruf acak. */
const SELALU =
  "Photorealistic, natural lighting, believable everyday Indonesian setting, real skin texture, " +
  "accurate hands. No text, no captions, no logo, no watermark, no borders, no collage.";

function dataUri(p: string): { mime_type: string; data: string } {
  const buf = fs.readFileSync(p);
  return { mime_type: MIME[path.extname(p).toLowerCase()] ?? "image/jpeg", data: buf.toString("base64") };
}

export class FirstFrameUnavailable extends Error {
  constructor(sebab: string) {
    super(`frame pertama tidak bisa dibuat: ${sebab}`);
    this.name = "FirstFrameUnavailable";
  }
}

/** Buat satu frame pertama. Melempar bila gagal — pemanggil yang memutuskan
 *  apakah jatuh kembali ke foto produk atau menggagalkan job. */
export async function generateFirstFrame(input: FirstFrameInput): Promise<{ path: string; biayaIdr: number }> {
  if (!config.geminiApiKey) throw new FirstFrameUnavailable("GEMINI_API_KEY belum di-set");
  if (!fs.existsSync(input.productPhotoPath)) {
    throw new FirstFrameUnavailable(`foto produk tidak ada: ${input.productPhotoPath}`);
  }

  const orientasi = input.ratio === "16:9" ? "horizontal 16:9" : "vertical 9:16";
  const aturanProduk = input.withholdProduct
    ? "CRITICAL: the product shown in the reference image must NOT appear anywhere in this frame. " +
      "The reference is provided only so you know what to leave out."
    : "The product must look exactly like the one in the reference image — same shape, same colour, " +
      "same proportions, same packaging. Do not redesign it.";

  const prompt =
    `Create the FIRST FRAME of a ${orientasi} advertising video. The frame must already look like a still ` +
    `taken from the middle of the scene described, not like a posed product photo.\n\n` +
    `SCENE: ${input.shotPrompt}\n\n${aturanProduk}\n${SELALU}`;

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": config.geminiApiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: dataUri(input.productPhotoPath) }] }],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new FirstFrameUnavailable(`HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: ({ inlineData?: { data: string }; inline_data?: { data: string } })[] } }[];
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  const b64 = img?.inlineData?.data ?? img?.inline_data?.data;
  if (!b64) throw new FirstFrameUnavailable("respons tanpa gambar");

  fs.mkdirSync(path.dirname(input.outPath), { recursive: true });
  fs.writeFileSync(input.outPath, Buffer.from(b64, "base64"));
  return { path: input.outPath, biayaIdr: BIAYA_FRAME_IDR };
}

/** Apakah shot ini perlu frame pertama buatan?
 *
 *  TIDAK untuk semua shot — kalau frame pertama boleh saja berupa produk apa
 *  adanya, memakai foto asli brand justru LEBIH baik: identitas produknya
 *  dijamin persis, dan tidak ada biaya tambahan.
 *
 *  Yang butuh: shot yang perannya secara eksplisit menahan produk, atau yang
 *  menuntut komposisi yang tidak mungkin berangkat dari foto produk (tampak
 *  atas, POV dari dalam kardus, ruangan tanpa produk). Ditandai dari teks
 *  perannya sendiri supaya tidak ada daftar kedua yang harus dijaga sinkron. */
export function perluFrameBuatan(shot: { prompt: string; withholdProduct?: boolean }): boolean {
  if (shot.withholdProduct) return true;
  // Cadangan untuk komposisi yang tidak bisa berangkat dari foto produk tapi
  // produknya boleh tetap tampil (tampak atas, POV dari dalam kardus). Ini
  // masih membaca prosa, dan itu disengaja: hanya dipakai untuk kasus yang
  // TIDAK mengeluarkan keputusan menahan produk.
  return /POV from INSIDE|top-down overhead/i.test(shot.prompt);
}

/** Produk harus disembunyikan di frame ini? Penanda saja — tidak menebak. */
export function harusMenahanProduk(shot: { withholdProduct?: boolean }): boolean {
  return shot.withholdProduct === true;
}

/** Berapa frame buatan yang boleh dibuat untuk satu job, per tier.
 *
 *  BUKAN angka teknis — angka MARGIN. Frame ~Rp600, sedangkan margin per
 *  video: silent_caption Rp2.555, high_quality Rp3.198, super_hq Rp42.836
 *  (lib/config.ts). Membuat frame untuk setiap shot pada tier bersuara akan
 *  memakan hampir seluruh marginnya.
 *
 *  Batasnya disetel supaya biaya frame tinggal di bawah ~25% margin. Kalau
 *  tarif atau harga berubah, angka di sini HARUS ditinjau ulang — dan ada tes
 *  yang membandingkannya dengan config supaya tidak diam-diam hanyut.
 *
 *  Yang diprioritaskan saat jatah habis: shot yang WAJIB menahan produk.
 *  Shot itu bukan sekadar lebih bagus dengan frame buatan — tanpa frame
 *  buatan ia MUSTAHIL benar, karena foto produk akan jadi frame pertamanya. */
export const MAKS_FRAME_PER_TIER: Record<string, number> = {
  silent_caption: 1,
  high_quality: 1,
  super_hq: 6,
  // Susunan baru. Sebelumnya ketiganya TIDAK ada di sini dan jatuh ke bawaan
  // 1 — termasuk Ultra, tier termahal kita, yang jadi diam-diam kehilangan
  // kemampuan yang dulu dipunyai super_hq.
  //
  // Angkanya keputusan MARGIN: 6 frame = Rp3.600, masih di bawah seperempat
  // margin Ultra (Rp26.467). Untuk Standard dan Premium marginnya lebih tipis,
  // jadi jatahnya tetap 1.
  standard: 1,
  premium: 1,
  ultra: 6,
};

/** Pilih shot mana yang dapat jatah frame buatan. Mengembalikan indeks shot,
 *  terurut: yang wajib menahan produk lebih dulu, lalu urutan shot. */
export function pilihShotUntukFrame(
  shots: { prompt: string; withholdProduct?: boolean }[],
  tier: string
): number[] {
  const maks = MAKS_FRAME_PER_TIER[tier] ?? 1;
  const kandidat = shots
    .map((sh, i) => ({ i, perlu: perluFrameBuatan(sh), wajib: harusMenahanProduk(sh) }))
    .filter((x) => x.perlu);
  kandidat.sort((a, b) => (a.wajib === b.wajib ? a.i - b.i : a.wajib ? -1 : 1));
  return kandidat.slice(0, maks).map((x) => x.i).sort((a, b) => a - b);
}
