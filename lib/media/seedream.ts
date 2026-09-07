/**
 * SEEDREAM 5.0 PRO — generator gambar storyboard (BytePlus Ark).
 *
 * ---------------------------------------------------------------------------
 * KENAPA MODEL INI, BUKAN Gemini YANG SUDAH ADA
 * ---------------------------------------------------------------------------
 * lib/media/first-frame.ts memakai gemini-3.1-flash-image untuk membuat frame
 * pertama video. Itu tetap dipakai di jalurnya sendiri. Untuk storyboard Brian
 * memilih Seedream 5.0 pro (keputusan 7 Sep 2026), dan alasannya bisa dilihat:
 * hasilnya fotorealistik dengan tampilan rekaman ponsel, presenter Indonesia,
 * dan rasio tegak yang benar tanpa diminta dua kali.
 *
 * ---------------------------------------------------------------------------
 * ANGKA YANG DIUKUR, BUKAN DIPERKIRAKAN (7 Sep 2026, dari server produksi)
 * ---------------------------------------------------------------------------
 *   size "1K" -> 800x1424  ~200KB  ~21 detik
 *   size "2K" -> 1584x2816 ~399KB  ~45 detik
 *
 * Kita memakai 1K. Bukan untuk berhemat biaya melainkan WAKTU: storyboard 15
 * detik punya 3 scene, dan selisihnya 63 detik menunggu versus 135 detik.
 * Tier video tertinggi kita merender 720p; 800px sudah di atas kebutuhan itu,
 * jadi 2K hanya membeli piksel yang akan dibuang saat render.
 *
 * ---------------------------------------------------------------------------
 * WATERMARK WAJIB MATI
 * ---------------------------------------------------------------------------
 * Contoh permintaan resmi BytePlus memakai "watermark": true. Kalau nilai itu
 * ikut tersalin, tanda air BytePlus masuk ke gambar storyboard — dan karena
 * gambar yang sama dipakai sebagai frame pertama render, ia ikut masuk ke VIDEO
 * yang dijual ke pelanggan. Brian menyebut ini eksplisit. Nilainya dipaku di
 * sini sebagai konstanta, bukan parameter, supaya tidak ada pemanggil yang bisa
 * menyalakannya karena salah salin.
 */
import { config } from "../config";

const MODEL = "dola-seedream-5-0-pro-260628";
const UKURAN = "1K";

/** Dipaku, bukan parameter. Lihat catatan di atas. */
const WATERMARK = false;

/**
 * PERKIRAAN biaya per gambar (IDR) — BUKAN tarif terverifikasi.
 *
 * Per 7 Sep 2026 tarif Seedream 5.0 pro belum saya konfirmasi ke sumber resmi
 * BytePlus; yang terukur baru pemakaiannya (17.424 output token untuk satu
 * gambar 2K). Angka ini dipakai untuk menghitung pagu kuota di lib/storyboard.ts,
 * jadi ia harus bisa dikoreksi tanpa menyentuh kode begitu tagihan sungguhan
 * datang — karena itu lewat env, bukan konstanta yang dipaku.
 */
export const BIAYA_GAMBAR_IDR = Number(process.env.SEEDREAM_BIAYA_GAMBAR_IDR ?? "700");

export class SeedreamError extends Error {}

export interface GambarStoryboard {
  bytes: Buffer;
  contentType: string;
  biayaIdr: number;
}

/**
 * Bahasa Inggris untuk generator, sesuai aturan Layer 2.5 — dialog tetap
 * Indonesia dan TIDAK ikut dikirim ke sini. Menuliskan kalimat Indonesia ke
 * prompt gambar membuat model mencoba MENGGAMBAR teksnya, dan hasilnya huruf
 * acak di dalam frame.
 */
export function promptGambar(input: {
  prompt: string;
  startState?: string | null;
  ratio?: string;
}): string {
  const bagian = [
    // Keadaan yang sudah benar di frame pertama menang atas prompt shot.
    // Prompt shot menggambarkan apa yang TERJADI sepanjang klip; kalau ia
    // dipakai apa adanya, gambar diamnya menggambarkan gerakan.
    input.startState?.trim() || input.prompt.trim(),
    "Natural phone-camera realism, ordinary skin texture, unforced expression, natural room light.",
    "No text, no caption, no watermark, no logo overlay, no user-interface element.",
    `Vertical ${input.ratio ?? "9:16"} framing.`,
  ];
  return bagian.filter(Boolean).join(" ");
}

interface JawabanArk {
  data?: { url?: string; b64_json?: string }[];
  error?: { message?: string; code?: string };
}

/** Generate satu gambar storyboard. Melempar SeedreamError bila gagal —
 *  pemanggil yang memutuskan apakah itu berarti scene gagal atau storyboard
 *  gagal seluruhnya. */
export async function generateGambarStoryboard(input: {
  prompt: string;
  startState?: string | null;
  ratio?: string;
  signal?: AbortSignal;
}): Promise<GambarStoryboard> {
  if (!config.byteplusApiKey) throw new SeedreamError("BYTEPLUS_ARK_API_KEY belum diisi.");

  const res = await fetch(`${config.byteplusBaseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.byteplusApiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: promptGambar(input),
      response_format: "url",
      size: UKURAN,
      stream: false,
      watermark: WATERMARK,
    }),
    signal: input.signal,
  });

  const teks = await res.text();
  let jawaban: JawabanArk;
  try {
    jawaban = JSON.parse(teks) as JawabanArk;
  } catch {
    throw new SeedreamError(`Jawaban Seedream bukan JSON (HTTP ${res.status}): ${teks.slice(0, 200)}`);
  }
  if (!res.ok || jawaban.error) {
    throw new SeedreamError(`Seedream menolak (HTTP ${res.status}): ${jawaban.error?.message ?? teks.slice(0, 200)}`);
  }

  const item = jawaban.data?.[0];
  if (!item?.url && !item?.b64_json) throw new SeedreamError("Seedream tidak mengembalikan gambar.");

  if (item.b64_json) {
    return { bytes: Buffer.from(item.b64_json, "base64"), contentType: "image/jpeg", biayaIdr: BIAYA_GAMBAR_IDR };
  }

  // URL dari BytePlus BERUMUR PENDEK (bucket TOS sementara). Gambarnya harus
  // ditarik dan disimpan ke storage kita sekarang juga; menyimpan URL-nya saja
  // berarti kartu storyboard berubah jadi kotak rusak beberapa jam kemudian.
  const unduh = await fetch(item.url!, { signal: input.signal });
  if (!unduh.ok) throw new SeedreamError(`Gagal mengunduh gambar Seedream (HTTP ${unduh.status}).`);
  const bytes = Buffer.from(await unduh.arrayBuffer());
  if (bytes.length < 1024) throw new SeedreamError("Gambar Seedream terlalu kecil — kemungkinan bukan gambar.");

  return {
    bytes,
    contentType: unduh.headers.get("content-type") ?? "image/jpeg",
    biayaIdr: BIAYA_GAMBAR_IDR,
  };
}
