// QC VISUAL — mata mesin untuk cacat yang hanya bisa dilihat.
//
// KENAPA ADA. Pada 2026-08-13 sebuah video 30 detik keluar dengan DUA
// perempuan dan EMPAT tangan di shot PENUTUP — hal terakhir yang dilihat
// penonton. Video itu LOLOS SEMUA QC yang ada dan sampai ke output. Ketahuan
// hanya karena saya kebetulan menontonnya.
//
// Sebabnya: QC-02 (silhouette) tidak pernah diimplementasi — komentarnya
// sendiri menulis "stub, butuh model CV". Selama itu stub, setiap cacat yang
// bentuknya "videonya valid tapi salah" akan lolos, dan yang menemukannya
// adalah brand yang membayar.
//
// Hari ini semua cacat besar ditemukan dengan MENONTON, bukan oleh tes. Lima
// bug struktural, nol ditemukan tes. Jarak menuju kualitas yang bisa
// dipertanggungjawabkan sebagian besar adalah membangun mata mesin, bukan
// menambah fitur.
//
// CARANYA: ambil beberapa frame dari video jadi, kirim ke model visi dengan
// pertanyaan TERSTRUKTUR, bukan "menurutmu bagus tidak". Pertanyaan terbuka
// menghasilkan jawaban yang menyenangkan; pertanyaan berupa hitungan
// menghasilkan angka yang bisa dibandingkan dengan aturan.
//
// BIAYA: beberapa frame per video, jauh di bawah satu render ulang. QC yang
// lebih mahal daripada cacat yang dicegahnya tidak layak dijalankan.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "../config";
import { runFfmpeg, probeDurationSec } from "./ffmpeg";

// Model TEKS-VISI, bukan model gambar. Percobaan pertama memakai model
// gambar dan timeout: itu model untuk MEMBUAT gambar, sedangkan tugas di sini
// MEMBACA gambar. Salah alat, bukan salah ukuran.
const MODEL = "gemini-flash-latest";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Berapa frame yang diperiksa per video. Tiga sudah menangkap cacat yang
 *  kita temui (semuanya bertahan sepanjang shot), dan tetap murah. Frame
 *  diambil di 20%, 50%, 85% durasi — bukan detik 0, karena frame pertama
 *  sering masih transisi. 85% dipilih supaya SHOT PENUTUP ikut diperiksa:
 *  cacat dua-orang itu ada di penutup. */
export const POSISI_SAMPEL = [0.2, 0.5, 0.85];

export interface TemuanFrame {
  /** Detik ke berapa frame ini diambil. */
  detik: number;
  /** Jumlah orang yang terlihat. 0 sah untuk shot tanpa orang. */
  jumlahOrang: number;
  /** Jumlah tangan manusia yang terlihat. */
  jumlahTangan: number;
  /** Ada tulisan yang tidak terbaca / huruf acak? */
  teksAcak: boolean;
  /** Ada anggota badan yang salah — jari berlebih, tangan tanpa pemilik,
   *  anggota badan berlipat. */
  anatomiRusak: boolean;
  /** Produk terlihat di frame ini? */
  produkTerlihat: boolean;
  /** Catatan singkat model, untuk ditunjukkan ke manusia saat gagal. */
  catatan: string;
}

export interface QcVisionInput {
  videoPath: string;
  /** Batas orang yang boleh tampil. 1 untuk format presenter tunggal, 2 untuk
   *  rute komedi, 0 untuk hands_only (wajah dilarang). */
  maksOrang: number;
  /** Format tanpa wajah: kemunculan orang sama sekali adalah kegagalan. */
  tanpaWajah?: boolean;
}

export interface QcVisionResult {
  /** null = pemeriksaan tidak bisa dijalankan (kunci tidak ada, model gagal).
   *  BUKAN lulus — pemanggil wajib memperlakukannya sebagai "tidak diperiksa". */
  temuan: TemuanFrame[] | null;
  lolos: boolean;
  /** PENGHALANG — menolak video. Hanya yang OBJEKTIF dan bisa dihitung. */
  masalah: string[];
  /** PERINGATAN — dicatat, tidak menolak. Yang subjektif atau yang memang
   *  batasan model yang sudah kita ketahui. */
  peringatan: string[];
}

const SKEMA = `Answer ONLY with a JSON object, no markdown fence:
{"jumlahOrang": <int>, "jumlahTangan": <int>, "teksAcak": <bool>,
 "anatomiRusak": <bool>, "produkTerlihat": <bool>, "catatan": "<max 15 words>"}

Definitions, be literal and count what you actually see:
- jumlahOrang: how many DISTINCT human beings are visible, including partly
  visible ones and reflections of a different person. A single person seen in
  a mirror alongside themselves counts as 2.
- jumlahTangan: how many human hands are visible in total.
- teksAcak: true if any visible writing is malformed, misspelled, or
  unreadable gibberish (common on product labels).
- anatomiRusak: true if there are extra fingers, hands not attached to a
  visible arm, duplicated or bent-wrong limbs.
- produkTerlihat: true if a consumer product package is clearly visible.`;

async function periksaFrame(framePath: string, detik: number, percobaan = 0): Promise<TemuanFrame | null> {
  const buf = fs.readFileSync(framePath);
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.geminiApiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SKEMA }, { inline_data: { mime_type: "image/jpeg", data: buf.toString("base64") } }] }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    // Timeout dan galat jaringan MELEMPAR, tidak mengembalikan respons — jadi
    // tanpa tangkapan ini satu panggilan lambat membatalkan seluruh
    // pemeriksaan. Terjadi sungguhan saat menjalankan papan nilai: satu frame
    // timeout, empat video sisanya tidak pernah diperiksa.
    if (percobaan < 1) return periksaFrame(framePath, detik, percobaan + 1);
    return null;
  }
  if (!res.ok) {
    // Sekali coba lagi. Gerbang mutu yang gagal karena satu hiccup jaringan
    // akan membuat orang berhenti memercayainya.
    if (percobaan < 1) return periksaFrame(framePath, detik, percobaan + 1);
    return null;
  }
  const d = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const teks = d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const m = teks.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return {
      detik,
      jumlahOrang: Number(j.jumlahOrang ?? 0),
      jumlahTangan: Number(j.jumlahTangan ?? 0),
      teksAcak: Boolean(j.teksAcak),
      anatomiRusak: Boolean(j.anatomiRusak),
      produkTerlihat: Boolean(j.produkTerlihat),
      catatan: String(j.catatan ?? "").slice(0, 120),
    };
  } catch {
    if (percobaan < 1) return periksaFrame(framePath, detik, percobaan + 1);
    return null;
  }
}

/** Periksa video jadi. Tidak melempar — kegagalan pemeriksaan dilaporkan
 *  sebagai "tidak diperiksa", bukan sebagai lulus. */
export async function qcVision(input: QcVisionInput): Promise<QcVisionResult> {
  if (!config.geminiApiKey) return { temuan: null, lolos: false, masalah: ["QC visual tidak jalan: GEMINI_API_KEY belum di-set"], peringatan: [] };
  if (!fs.existsSync(input.videoPath)) return { temuan: null, lolos: false, masalah: ["berkas video tidak ada"], peringatan: [] };

  const durasi = await probeDurationSec(input.videoPath).catch(() => 0);
  if (!durasi) return { temuan: null, lolos: false, masalah: ["durasi video tidak terbaca"], peringatan: [] };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qcvision-"));
  try {
    const temuan: TemuanFrame[] = [];
    for (const p of POSISI_SAMPEL) {
      const detik = Math.max(0.1, durasi * p);
      const f = path.join(dir, `f${Math.round(detik * 10)}.jpg`);
      await runFfmpeg(["-y", "-ss", String(detik), "-i", input.videoPath, "-frames:v", "1", "-q:v", "3", f]);
      if (!fs.existsSync(f)) continue;
      const t = await periksaFrame(f, Math.round(detik * 10) / 10);
      if (t) temuan.push(t);
    }
    if (temuan.length === 0) return { temuan: null, lolos: false, masalah: ["tidak satu pun frame bisa diperiksa"], peringatan: [] };

    // PENGHALANG vs PERINGATAN, dan pembagiannya diuji pada video nyata.
    //
    // Penghalang hanya yang OBJEKTIF DAN BISA DIHITUNG: jumlah orang, jumlah
    // tangan. Cacat yang menghancurkan video kemarin — dua perempuan di shot
    // penutup — masuk ke sini, dan memang tertangkap.
    //
    // Peringatan untuk yang SUBJEKTIF atau yang memang batasan model yang
    // sudah kita ketahui:
    //   - teksAcak menyala di HAMPIR SEMUA video kita, karena teks kecil di
    //     label memang tidak pernah dirender presisi oleh model video (sudah
    //     didokumentasikan di IDENTITY_INSTRUCTION). Menjadikannya penghalang
    //     berarti menolak seluruh keluaran.
    //   - anatomiRusak terbukti terlalu galak: ia menolak video yang saya
    //     periksa sendiri dan jarinya ambigu, tidak jelas rusak bagi penonton
    //     biasa. QC yang mengada-ada lebih buruk daripada tidak ada — sekali
    //     orang berhenti memercayainya, ia berhenti berguna.
    const masalah: string[] = [];
    const peringatan: string[] = [];
    for (const t of temuan) {
      if (input.tanpaWajah && t.jumlahOrang > 0) {
        masalah.push(`detik ${t.detik}: ada ${t.jumlahOrang} orang, padahal format ini tanpa wajah`);
      } else if (t.jumlahOrang > input.maksOrang) {
        masalah.push(`detik ${t.detik}: ${t.jumlahOrang} orang, maksimal ${input.maksOrang}`);
      }
      // Dua tangan per orang. Longgar satu, karena tangan yang terpotong tepi
      // frame kadang terhitung ganda oleh model.
      const batasTangan = Math.max(2, t.jumlahOrang * 2) + 1;
      if (t.jumlahTangan > batasTangan) {
        masalah.push(`detik ${t.detik}: ${t.jumlahTangan} tangan untuk ${t.jumlahOrang} orang`);
      }
      if (t.anatomiRusak) peringatan.push(`detik ${t.detik}: kemungkinan anatomi janggal — ${t.catatan}`);
      if (t.teksAcak) peringatan.push(`detik ${t.detik}: teks di layar tidak terbaca (batasan model, bukan cacat baru)`);
    }
    return { temuan, lolos: masalah.length === 0, masalah, peringatan };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* abaikan */ }
  }
}
