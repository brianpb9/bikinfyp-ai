/**
 * QC-F1 — kesetiaan produk pada FRAME TURUNAN. TIGA KEADAAN.
 *
 * Gate 1 (brand fidelity): label dan bentuk produk harus identik dengan foto
 * aslinya. Wajib, bukan opsional.
 *
 * KENAPA TIGA KEADAAN, bukan lulus/gagal (temuan reviewer A10, 18 Agu).
 *
 * Versi sebelumnya mengembalikan `lulus: true` pada dua jalur yang sebenarnya
 * berarti "tidak tahu": kunci Gemini tidak ada, dan panggilan vision gagal.
 * Alasannya waktu itu terdengar masuk akal — "gagal MEMERIKSA bukan gagal
 * kesetiaan" — tapi akibatnya adalah frame yang tidak pernah diperiksa dikirim
 * ke Seedance sebagai referensi, dan seluruh gerbang jadi hiasan justru pada
 * saat ia paling dibutuhkan.
 *
 *   PASS        diperiksa dan setia.
 *   FAIL        diperiksa dan TIDAK setia.
 *   UNVERIFIED  tidak bisa diperiksa. BUKAN lolos.
 *
 * `lulus` sengaja DIHAPUS dari hasil. Selama field itu ada, pemanggil bisa
 * menulis `if (qc.lulus)` dan memperlakukan UNVERIFIED sebagai lolos tanpa
 * pernah menyadarinya. Sekarang mereka harus menyebut statusnya.
 *
 * Diperiksa DUA CARA, karena keduanya menangkap kegagalan berbeda:
 *
 *   Gemini vision  — bentuk, jenis tutup (dropper/pump/screw), warna, tata
 *                    letak label. Hal-hal yang tidak punya teks untuk dibaca.
 *   tesseract      — nama mereknya sendiri. Model bahasa bisa "merasa" label
 *                    itu benar sambil hurufnya sebenarnya berubah; OCR tidak
 *                    punya sopan santun itu.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { config } from "../config";
import { tokenMerekUtama } from "./qc";

const jalankan = promisify(execFile);
const MODEL = "gemini-flash-latest";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** Satu panggilan vision. Pecahan sen dibanding klip Rp2.771-8.313. */
const BIAYA_PERIKSA_IDR = 12;

export type StatusQcF1 = "PASS" | "FAIL" | "UNVERIFIED";

export interface HasilQcF1 {
  status: StatusQcF1;
  /** Alasan siap-baca — dipakai di log dan arsip prompt. */
  detail: string;
  /** Rincian per aspek, untuk menelusuri kegagalan yang berulang. */
  temuan: {
    bentukSama: boolean | null;
    tutupSama: boolean | null;
    warnaSama: boolean | null;
    tataLetakLabelSama: boolean | null;
    merekTerbaca: boolean | null;
  };
  biayaIdr: number;
  /** Binding byte-ke-byte agar verdict tidak bisa dipindahkan ke frame/foto lain. */
  evidence: {
    frameSha256: string | null;
    productPhotoSha256: string | null;
  };
}

/**
 * SATU-SATUNYA cara sah menanyakan "boleh dipakai sebagai referensi?".
 *
 * Ada supaya jawabannya tidak pernah ditulis ulang sebagai `!== "FAIL"` di
 * suatu tempat — yang akan diam-diam meloloskan UNVERIFIED.
 */
export function bolehJadiReferensi(hasil: HasilQcF1): boolean {
  return hasil.status === "PASS";
}

function dataUri(p: string) {
  const ext = path.extname(p).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return { mime_type: mime, data: fs.readFileSync(p).toString("base64") };
}

const PERTANYAAN =
  "You are checking whether a product was faithfully reproduced. " +
  "IMAGE 1 is a frame from an advertising video. IMAGE 2 is the ORIGINAL product photo, which is the truth. " +
  "Compare ONLY the product, ignoring background, people, lighting and camera angle.\n\n" +
  "Answer strictly as JSON with these boolean fields and one short string:\n" +
  '{"bentuk_sama":bool,"tutup_sama":bool,"warna_sama":bool,"tata_letak_label_sama":bool,"catatan":"<=20 words"}\n\n' +
  "bentuk_sama: same overall body shape and proportions.\n" +
  "tutup_sama: the closure is the SAME KIND — a dropper is not a pump, a pump is not a screw cap, " +
  "a spray is not a flip-top. This one matters most; closures drift silently.\n" +
  "warna_sama: same colour of the container and of the label.\n" +
  "tata_letak_label_sama: same label layout — same blocks in the same places, same relative sizes.\n" +
  "Be strict. If you are unsure, answer false.";

/**
 * Apakah token merek benar-benar TERBACA UTUH di teks OCR?
 *
 * Aturannya asimetris, dan itu inti perbaikannya (reviewer A10).
 *
 * Versi lama mencocokkan AWALAN EMPAT HURUF, dengan alasan memberi toleransi
 * pada huruf tepi yang terpotong sudut kamera. Akibatnya terukur pada frame
 * c-no-face-2.5.png: label frame berbunyi "SCARLET" (satu T) sementara
 * mereknya "SCARLETT" — dan `"scarlet".includes("scar")` menjawab lolos.
 * Toleransi itu menerima MEREK LAIN, yang justru satu-satunya hal yang tidak
 * boleh diterima gerbang kesetiaan merek.
 *
 * Yang benar: kelebihan huruf boleh, KEKURANGAN huruf tidak.
 *   "scarlett"   -> cocok (persis)
 *   "scarlettx"  -> cocok (OCR menambah derau di ekor)
 *   "scarlet"    -> TIDAK cocok (mereknya terpotong: itu nama lain)
 */
export function merekCocok(teksOcr: string, token: string): boolean {
  const kata = teksOcr.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
  return kata.some((w) => w === token || w.startsWith(token));
}

export type HasilOcr = { terbaca: boolean; teks: string } | { terbaca: null; teks: "" };

/**
 * OCR nama merek di frame. Mengembalikan null HANYA kalau tidak ada merek
 * untuk dibaca; kegagalan menjalankan OCR MELEMPAR, supaya pemanggil bisa
 * membedakan "tidak ada merek" dari "tidak bisa diperiksa".
 */
async function merekTerbaca(framePath: string, merekEksplisit?: string | null): Promise<HasilOcr> {
  const token = tokenMerekUtama(merekEksplisit);
  // null = tidak ada MEREK TEPERCAYA. Bukan "produk polos" — kita memang tidak
  // tahu, dan pemanggil yang memutuskan itu berarti UNVERIFIED untuk hero.
  if (!token) return { terbaca: null, teks: "" };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qcf1-"));
  try {
    const png = path.join(dir, "besar.png");
    await jalankan("ffmpeg", ["-y", "-v", "error", "-i", framePath, "-vf", "scale=1440:-2:flags=lanczos", png]);
    const { stdout } = await jalankan("tesseract", [png, "stdout", "-l", "eng", "--psm", "11"]);
    // SATU token yang menentukan, bukan "salah satu token".
    //
    // Menerima token mana pun membuat kata lemah yang memutuskan: pada frame
    // c-no-face-2.5.png mereknya terbaca "SCARLET" (salah) tapi kata "acne"
    // benar, dan gerbangnya lolos karena "acne". Kesetiaan MEREK tidak boleh
    // dibuktikan oleh kata yang bukan merek. Pemilihan tokennya sendiri ada di
    // tokenMerekUtama() — urutan, bukan panjang.
    return { terbaca: merekCocok(stdout, token), teks: stdout.trim().slice(0, 200) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function qcF1FrameFidelity(input: {
  framePath: string;
  /** SELALU foto produk ASLI — tidak pernah frame turunan sebelumnya. */
  productPhotoPath: string;
  productName: string;
  /** Merek eksplisit dari catatan produk/intake. Menang atas tebakan dari nama. */
  merekEksplisit?: string | null;
  /**
   * Peran produk di frame ini. Menentukan apakah OCR merek WAJIB.
   *
   * Hanya frame HERO yang wajib nama mereknya terbaca — itu janji produk kita
   * (Gate 1), dan di sanalah produknya memang diangkat dekat ke kamera. Pada
   * frame "partial" produk sengaja jauh atau sebagian tertutup tangan;
   * menuntut OCR di situ akan menolak frame yang justru benar.
   *
   * Bentuk, tutup, warna, dan tata letak label tetap diperiksa penuh di kedua
   * peran — pergeseran bentuk salah di mana pun ia muncul.
   */
  productState?: "hero" | "partial";
}): Promise<HasilQcF1> {
  const kosong = { bentukSama: null, tutupSama: null, warnaSama: null, tataLetakLabelSama: null, merekTerbaca: null };
  const hashJikaAda = (p: string) => fs.existsSync(p)
    ? createHash("sha256").update(fs.readFileSync(p)).digest("hex") : null;
  const evidence = {
    frameSha256: hashJikaAda(input.framePath),
    productPhotoSha256: hashJikaAda(input.productPhotoPath),
  };
  const hero = (input.productState ?? "hero") === "hero";

  if (!config.geminiApiKey) {
    // BUKAN lolos. Frame yang tidak diperiksa tidak boleh jadi referensi.
    return {
      status: "UNVERIFIED",
      detail: "QC-F1 tidak dapat dijalankan: GEMINI_API_KEY belum di-set. Frame TIDAK boleh dipakai sebagai referensi.",
      temuan: kosong,
      biayaIdr: 0,
      evidence,
    };
  }

  let ocr: HasilOcr;
  try {
    ocr = await merekTerbaca(input.framePath, input.merekEksplisit);
  } catch (err) {
    // OCR mati (tesseract/ffmpeg tidak ada) pada frame HERO berarti janji
    // "nama merek terbaca" tidak bisa dibuktikan — dan janji yang tidak bisa
    // dibuktikan tidak boleh diperlakukan sebagai terbukti.
    if (hero) {
      return {
        status: "UNVERIFIED",
        detail: `QC-F1 tidak dapat memeriksa merek pada frame hero (${(err as Error).message}). Frame TIDAK dipakai.`,
        temuan: kosong,
        biayaIdr: 0,
        evidence,
      };
    }
    ocr = { terbaca: null, teks: "" };
  }

  // SEKALI ULANG untuk galat sesaat sebelum menyatakan UNVERIFIED.
  //
  // Timeout jaringan bukan bukti apa pun tentang framenya, sementara
  // menyatakannya UNVERIFIED membuang frame turunan seharga Rp650 demi
  // pemeriksaan Rp12. Yang TIDAK diulang: jawaban vision yang sah tapi
  // menyatakan FAIL — itu jawaban, bukan kegagalan.
  let vision: Record<string, unknown> | null = null;
  let galatTerakhir = "";
  for (let percobaan = 0; percobaan < 3 && !vision; percobaan++) {
  // Jeda menaik: 503 dari penyedia biasanya sesaat, dan mencoba lagi seketika
  // hanya menambah beban pada layanan yang sedang tersendat.
  if (percobaan > 0) await new Promise((r) => setTimeout(r, percobaan * 1500));
  try {
    const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.geminiApiKey },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: PERTANYAAN },
          { inline_data: dataUri(input.framePath) },
          { inline_data: dataUri(input.productPhotoPath) },
        ] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    vision = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "") as Record<string, unknown>;
  } catch (err) {
    galatTerakhir = (err as Error).message;
  }
  }
  if (!vision) {
    return {
      status: "UNVERIFIED",
      detail: `QC-F1 tidak dapat dijalankan (${galatTerakhir}). Frame TIDAK dipakai sebagai referensi.`,
      temuan: { ...kosong, merekTerbaca: ocr.terbaca },
      biayaIdr: 0,
      evidence,
    };
  }

  // HERO TANPA MEREK TEPERCAYA = UNVERIFIED.
  //
  // Janji Gate 1 adalah "nama merek terbaca". Tanpa sumber merek yang bisa
  // dipercaya, janji itu tidak bisa dibuktikan — dan janji yang tidak bisa
  // dibuktikan tidak boleh diperlakukan sebagai terbukti hanya karena bentuk
  // dan warnanya kebetulan cocok.
  if (hero && ocr.terbaca === null) {
    return {
      status: "UNVERIFIED",
      detail:
        "QC-F1 tidak punya merek tepercaya untuk diperiksa pada frame hero " +
        "(products.brand / merek hasil intake belum ada). Frame TIDAK dipakai sebagai referensi.",
      temuan: { ...kosong, merekTerbaca: null },
      biayaIdr: BIAYA_PERIKSA_IDR,
      evidence,
    };
  }

  const temuan = {
    bentukSama: vision.bentuk_sama === true,
    tutupSama: vision.tutup_sama === true,
    warnaSama: vision.warna_sama === true,
    tataLetakLabelSama: vision.tata_letak_label_sama === true,
    merekTerbaca: ocr.terbaca,
  };

  const gagal: string[] = [];
  if (!temuan.bentukSama) gagal.push("bentuk berbeda");
  if (!temuan.tutupSama) gagal.push("jenis tutup berbeda");
  if (!temuan.warnaSama) gagal.push("warna berbeda");
  if (!temuan.tataLetakLabelSama) gagal.push("tata letak label berbeda");
  // ocr.terbaca === null berarti tidak ada merek untuk dibaca — bukan kegagalan.
  if (ocr.terbaca === false && hero) {
    gagal.push(`nama merek tidak terbaca utuh${ocr.teks ? ` (OCR membaca: "${ocr.teks.replace(/\s+/g, " ").slice(0, 60)}")` : ""}`);
  }

  const catatan = typeof vision.catatan === "string" ? ` (${vision.catatan})` : "";
  return {
    status: gagal.length === 0 ? "PASS" : "FAIL",
    detail: gagal.length === 0 ? `QC-F1 PASS${catatan}` : `QC-F1 FAIL: ${gagal.join(", ")}${catatan}`,
    temuan,
    biayaIdr: BIAYA_PERIKSA_IDR,
    evidence,
  };
}
