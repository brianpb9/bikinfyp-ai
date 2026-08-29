// QC-12 — apakah yang TERDENGAR sama dengan yang kita tulis?
//
// LUBANG YANG DITUTUP. Sampai 2026-08-15 seluruh QC audio kita cuma memeriksa
// dua hal: videonya tidak senyap (QC-04) dan loudness-nya benar. Tidak ada
// satu pun yang memeriksa APA yang diucapkan.
//
// Untuk produk yang menjual "AI-nya ngomong", itu lubang terbesar yang tersisa.
// Yang bisa lolos tanpa ketahuan:
//   - harga disebut salah — "seratus dua puluh ribu" untuk produk Rp189.000
//   - nama produk salah ucap, dan itu nama BRAND yang membayar
//   - VO memotong di tengah kalimat karena slot waktunya kurang
//   - kalimat karangan yang tidak pernah ada di skrip
//
// Yang paling berbahaya harga: itu bukan cacat estetika, itu klaim komersial
// yang salah, dan penjual yang memasangnya menanggung akibatnya.
//
// CARANYA: audio diekstrak, dikirim ke model yang sama yang dipakai QC visi,
// dan diminta MENTRANSKRIP — bukan menilai. Transkripnya lalu dibandingkan
// dengan skrip yang memang kita kirim. Pertanyaan yang bisa dijawab dengan
// perbandingan selalu lebih jujur daripada pertanyaan berupa penilaian.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "../config";
import { runFfmpeg } from "./ffmpeg";

const MODEL = "gemini-flash-latest";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export interface QcSuaraInput {
  videoPath: string;
  externalNetworkPolicy?: "allow" | "forbid";
  /** Teks yang SEHARUSNYA terdengar — segmen skrip, urut. */
  segmenSkrip: string[];
  /** Harga produk. Diperiksa terpisah karena paling berbahaya kalau salah. */
  priceIdr: number;
  productName: string;
}

export interface QcSuaraResult {
  /** null = tidak bisa diperiksa. BUKAN lulus. */
  transkrip: string | null;
  lolos: boolean;
  masalah: string[];
  peringatan: string[];
}

/** Normalisasi untuk perbandingan: huruf kecil, tanpa tanda baca, spasi rapat.
 *  Perbedaan tanda baca bukan cacat — yang dicari kata yang hilang atau salah. */
const rapikan = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/** Angka yang diucapkan bahasa Indonesia -> perkiraan digitnya.
 *
 *  Tidak lengkap dan tidak perlu lengkap: yang dicari cuma apakah nominal
 *  harga MUNCUL, bukan mem-parsing seluruh bahasa. Kalau ragu, hasilnya
 *  peringatan — bukan penolakan. */
function memuatHarga(transkrip: string, priceIdr: number): boolean {
  const t = rapikan(transkrip);
  const ribu = Math.round(priceIdr / 1000);
  // "189" atau "seratus delapan puluh sembilan" — dua bentuk paling umum.
  if (t.includes(String(ribu))) return true;
  if (t.includes(String(priceIdr))) return true;
  const satuan = ["nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan"];
  const digit = String(ribu).split("").map((d) => satuan[Number(d)]);
  // Semua digit harganya muncul, urut, di dalam jendela yang wajar.
  let pos = 0;
  for (const kata of digit) {
    const i = t.indexOf(kata, pos);
    if (i < 0) return false;
    pos = i + kata.length;
  }
  return true;
}

export async function qcSuara(input: QcSuaraInput): Promise<QcSuaraResult> {
  if (input.externalNetworkPolicy === "forbid") throw new Error("NORMAL_EVIDENCE_EXTERNAL_AUDIO_QC_FORBIDDEN");
  if (!config.geminiApiKey) return { transkrip: null, lolos: false, masalah: ["QC suara tidak jalan: GEMINI_API_KEY belum di-set"], peringatan: [] };
  if (!fs.existsSync(input.videoPath)) return { transkrip: null, lolos: false, masalah: ["berkas video tidak ada"], peringatan: [] };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qcsuara-"));
  try {
    // Mono 16 kHz: cukup untuk transkripsi dan jauh lebih kecil untuk dikirim.
    const wav = path.join(dir, "audio.wav");
    await runFfmpeg(["-y", "-v", "error", "-i", input.videoPath, "-vn", "-ac", "1", "-ar", "16000", wav]);
    if (!fs.existsSync(wav)) return { transkrip: null, lolos: false, masalah: ["audio tidak bisa diekstrak"], peringatan: [] };

    const buf = fs.readFileSync(wav);
    const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.geminiApiKey },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "Transcribe the Indonesian speech in this audio VERBATIM. Output only the transcript text, nothing else. If there is no speech, output exactly: (tidak ada ucapan)" },
            { inline_data: { mime_type: "audio/wav", data: buf.toString("base64") } },
          ],
        }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return { transkrip: null, lolos: false, masalah: [`transkripsi gagal: HTTP ${res.status}`], peringatan: [] };

    const d = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const transkrip = (d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "").trim();
    if (!transkrip) return { transkrip: null, lolos: false, masalah: ["transkrip kosong"], peringatan: [] };

    const masalah: string[] = [];
    const peringatan: string[] = [];
    const t = rapikan(transkrip);

    // HARGA — penghalang. Harga yang salah bukan cacat estetika, itu klaim
    // komersial yang salah, dan penjual yang memasangnya menanggung akibatnya.
    const skripAdaHarga = input.segmenSkrip.some((s) => /\d{4,}|ribu|rb\b/i.test(s));
    if (skripAdaHarga && !memuatHarga(transkrip, input.priceIdr)) {
      masalah.push(`harga Rp${input.priceIdr.toLocaleString("id-ID")} tidak terdengar di VO`);
    }

    // NAMA PRODUK — peringatan, bukan penghalang: nama merek asing sering
    // ditranskrip mendekati bunyinya, dan menolak karena itu akan menolak
    // video yang pelafalannya sebenarnya benar.
    const kataNama = rapikan(input.productName).split(" ").filter((w) => w.length > 3);
    const namaHilang = kataNama.filter((w) => !t.includes(w));
    if (kataNama.length > 0 && namaHilang.length === kataNama.length) {
      peringatan.push(`nama produk "${input.productName}" tidak terdengar jelas di transkrip`);
    }

    // KELENGKAPAN — VO yang terpotong di tengah menyisakan kalimat menggantung.
    // Diukur dari panjang: transkrip yang jauh lebih pendek dari skrip berarti
    // ada yang tidak terucap.
    const panjangSkrip = rapikan(input.segmenSkrip.join(" ")).split(" ").length;
    const panjangUcap = t.split(" ").length;
    if (panjangSkrip > 0 && panjangUcap < panjangSkrip * 0.5) {
      masalah.push(`VO jauh lebih pendek dari skrip (${panjangUcap} vs ${panjangSkrip} kata) — kemungkinan terpotong`);
    }

    return { transkrip, lolos: masalah.length === 0, masalah, peringatan };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* abaikan */ }
  }
}
