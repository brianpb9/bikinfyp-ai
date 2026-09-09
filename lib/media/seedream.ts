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
import { catatProvider } from "../provider-log";

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
  /** Ada acuan produk terlampir? Mengubah kalimat pembukanya. */
  adaAcuan?: boolean;
}): string {
  // PRODUK HARUS TERLIHAT JELAS (permintaan Brian, 9 Sep 2026: "untuk proses
  // rendering image yang menggunakan seedream pastikan juga gambar jelas
  // product utama brand terlihat").
  //
  // REFERENCE AUTHORITY di bawah mengunci IDENTITAS produk — bentuk, warna,
  // bahan. Ia tidak pernah menuntut produknya TERLIHAT. Dua hal berbeda, dan
  // kartu yang identitasnya benar tapi produknya kecil, buram, terpotong, atau
  // tertutup tangan tetap gagal sebagai storyboard: kartu ini dipakai sebagai
  // frame pertama render, jadi apa yang samar di sini ikut samar di videonya.
  //
  // Hanya dikirim kalau ada acuan. Scene ber-withhold_product sengaja
  // menyembunyikan produk (build-up sebelum reveal), dan pemanggil menandainya
  // dengan tidak melampirkan foto — jadi syarat ini tidak akan pernah
  // bertabrakan dengan scene yang memang tidak boleh menampilkannya.
  const terlihat = input.adaAcuan
    ? "PRODUCT VISIBILITY (required): the product must be clearly visible, sharp and in focus, "
      + "unobstructed, fully inside the frame and not cropped at any edge. Its front label must face "
      + "the camera and stay legible. Hands may hold it but must not cover the label. "
      + "It occupies a clear focal share of the frame, never a small background detail."
    : "";
  const bagian = [
    // REFERENCE AUTHORITY — bagian pertama pada spesifikasi Layer 2.5, dan
    // bukan basa-basi.
    //
    // Diukur 7 Sep 2026 dengan prompt shot yang SAMA dan acuan yang SAMA:
    //   tanpa kalimat ini -> foto produk di atas meja, TANPA TANGAN, walau
    //                        prompt-nya berbunyi "hands and forearms only"
    //   dengan kalimat ini -> tangan memegang produk yang benar, adegan baru
    //
    // Tanpanya model memperlakukan acuan sebagai "gambar ulang foto ini" alih-
    // alih "pakai produk ini di adegan baru". Untuk video hands_only itu berarti
    // setiap kartu jadi foto katalog, dan frame pertama render ikut salah.
    input.adaAcuan
      ? "REFERENCE AUTHORITY: the attached image shows ONLY the product. Use it as the authority for the "
        + "product shape, colour, material and proportions. Do NOT reproduce the reference photo composition, "
        + "background or framing — build the NEW scene described below."
      : "",
    terlihat,
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

/** Tipe acuan dibaca dari isi berkasnya, bukan dari nama berkas: foto produk
 *  disimpan sebagai .webp maupun .jpg tergantung jalur unggahnya. */
function mimeAcuan(b: Buffer): string {
  if (b.length > 12 && b.subarray(0, 4).toString("hex") === "89504e47") return "image/png";
  if (b.length > 12 && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "image/jpeg";
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
  /**
   * Foto produk ASLI pengguna sebagai acuan gambar.
   *
   * WAJIB DIISI untuk scene yang menampilkan produk. Tanpa ini Seedream
   * menggambar produk dari nol berdasarkan teks, dan hasilnya barang yang
   * BERBEDA — terbukti pada uji produksi 7 Sep 2026: produknya pouch lipat
   * hijau zaitun, kartu storyboard menampilkan tas batik cokelat. Kartu itu
   * lalu dipakai sebagai frame pertama render, jadi videonya ikut menjual
   * barang yang tidak pernah dimiliki pengguna, dan QC-03 (identitas produk)
   * menjatuhkannya sesudah uang ditahan.
   *
   * Dikosongkan HANYA untuk scene yang memang harus menahan produk
   * (withholdProduct) — di situ menyertakan acuannya justru membuat produk
   * muncul di shot yang seharusnya belum memperlihatkannya.
   */
  fotoProduk?: Buffer | null;
  /** Dipakai HANYA untuk mengaitkan baris log ke job/scene-nya. */
  jobId?: string | null;
  shotIndex?: number | null;
  signal?: AbortSignal;
}): Promise<GambarStoryboard> {
  if (!config.byteplusApiKey) throw new SeedreamError("BYTEPLUS_ARK_API_KEY belum diisi.");

  const mulai = Date.now();
  const res = await fetch(`${config.byteplusBaseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.byteplusApiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: promptGambar({ ...input, adaAcuan: Boolean(input.fotoProduk) }),
      // Acuan dikirim sebagai data URI. Diverifikasi terhadap API sungguhan
      // (usage.input_images naik jadi 1), dan output_tokens justru TURUN dari
      // 17.424 ke 4.450 — mengacu pada foto lebih murah daripada mengarang.
      ...(input.fotoProduk ? { image: `data:${mimeAcuan(input.fotoProduk)};base64,${input.fotoProduk.toString("base64")}` } : {}),
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
    const pesan = `Jawaban Seedream bukan JSON (HTTP ${res.status}): ${teks.slice(0, 200)}`;
    void catatProvider({
      jobId: input.jobId ?? null, shotIndex: input.shotIndex ?? null,
      provider: "byteplus-seedream", model: MODEL, fase: "gagal",
      httpStatus: res.status, error: pesan, durasiMs: Date.now() - mulai,
    });
    throw new SeedreamError(pesan);
  }
  if (!res.ok || jawaban.error) {
    // GALAT PROVIDER DICATAT UTUH (sesudah disamarkan), bukan cuma dilempar.
    //
    // Brian 9 Sep 2026: "ketika regenerate apabila gagal tidak diinformasikan
    // gagal disebabkan kenapa dan saya tidak bisa tracing root cause-nya."
    // Pesan asli BytePlus-lah yang menjawab itu — "may contain sensitive
    // information" dan "InvalidParameter" menuntut tindakan yang berbeda.
    const pesan = `Seedream menolak (HTTP ${res.status}): ${jawaban.error?.message ?? teks.slice(0, 200)}`;
    void catatProvider({
      jobId: input.jobId ?? null, shotIndex: input.shotIndex ?? null,
      provider: "byteplus-seedream", model: MODEL, fase: "gagal",
      httpStatus: res.status, error: pesan, response: jawaban.error ?? teks,
      durasiMs: Date.now() - mulai,
      requestRingkas: `ukuran=${UKURAN} watermark=${WATERMARK} acuan=${input.fotoProduk ? "ya" : "tidak"}`,
    });
    throw new SeedreamError(pesan);
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

  void catatProvider({
    jobId: input.jobId ?? null, shotIndex: input.shotIndex ?? null,
    provider: "byteplus-seedream", model: MODEL, fase: "selesai",
    httpStatus: res.status, durasiMs: Date.now() - mulai, biayaIdr: BIAYA_GAMBAR_IDR,
    requestRingkas: `ukuran=${UKURAN} acuan=${input.fotoProduk ? "ya" : "tidak"}`,
    response: { bytes: bytes.length },
  });
  return {
    bytes,
    contentType: unduh.headers.get("content-type") ?? "image/jpeg",
    biayaIdr: BIAYA_GAMBAR_IDR,
  };
}
