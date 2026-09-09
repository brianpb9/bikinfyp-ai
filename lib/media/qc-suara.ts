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
import { terbilang } from "../script-engine/terbilang";

const MODEL = "gemini-flash-latest";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export interface QcSuaraInput {
  videoPath: string;
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

/**
 * Apakah harga benar-benar TERDENGAR di VO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KEGAGALAN YANG MELAHIRKAN VERSI INI (job 615855d8, 9 Sep 2026)
 * ────────────────────────────────────────────────────────────────────────────
 * Naskahnya berbunyi, dan VO mengucapkannya dengan benar:
 *
 *   "Harganya cuma sembilan belas ribu sembilan ratus dong, cek keranjang ya."
 *
 * QC-12 menolaknya: "harga Rp19.900 tidak terdengar di VO". Video dibuang,
 * tiga percobaan habis, kredit dikembalikan — untuk video yang benar.
 *
 * Sebabnya satu baris: versi lama menghitung `Math.round(priceIdr / 1000)`.
 * Untuk 19.900 itu menghasilkan 20, lalu ia mencari "20" atau digit-digitnya
 * yang dieja satu per satu — "dua", lalu "nol". Tidak ada penutur bahasa
 * Indonesia yang mengucapkan "dua nol ribu", dan naskahnya sendiri tidak
 * pernah memuat angka 20. Gerbang itu menuntut mendengar harga yang TIDAK
 * PERNAH DIMINTA untuk diucapkan.
 *
 * Akibatnya bukan kasus tepi. Harga eceran Indonesia hampir selalu berakhir
 * 9.900 / 4.900 / 9.500 — jadi pembulatannya meleset pada justru bentuk harga
 * yang paling umum, dan gerbang ini menolak video yang benar secara sistematis.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * YANG DIPAKAI SEKARANG: SUMBER YANG SAMA DENGAN PENULIS NASKAH
 * ────────────────────────────────────────────────────────────────────────────
 * terbilang() adalah fungsi yang dipakai mesin naskah untuk MENULIS harga.
 * Memakainya juga untuk MEMERIKSA harga membuat kedua sisi tidak bisa hanyut:
 * yang kita tuntut didengar persis yang kita suruh diucapkan.
 *
 * Bentuk longgar ikut diterima karena VO manusiawi memang memendekkan:
 * "sembilan belas ribu" saja, "19 ribu", "19.900". Yang TIDAK diterima adalah
 * harga lain — itu tetap klaim komersial yang salah, dan tetap penghalang.
 */
export function bentukHargaDiterima(priceIdr: number): string[] {
  const bentuk: string[] = [];
  const penuh = rapikan(terbilang(priceIdr));
  bentuk.push(penuh);

  // Potongan "…ribu" tanpa ekor ratusan: "sembilan belas ribu sembilan ratus"
  // -> "sembilan belas ribu". VO yang menyebut ini menyebut harga yang benar,
  // cuma dibulatkan ke bawah sebagaimana orang bicara.
  const iRibu = penuh.lastIndexOf(" ribu");
  if (iRibu > 0) bentuk.push(penuh.slice(0, iRibu + " ribu".length));

  // Bentuk angka. rapikan() membuang titik/koma, jadi "19.900" menjadi "19 900"
  // dan "Rp19.900" menjadi "rp19 900" -> keduanya tertangkap oleh dua entri ini.
  const ribuBulat = Math.floor(priceIdr / 1000);
  bentuk.push(String(priceIdr));
  if (ribuBulat > 0) {
    const sisa = priceIdr % 1000;
    bentuk.push(`${ribuBulat} ${String(sisa).padStart(3, "0")}`);
    bentuk.push(`${ribuBulat} ribu`);
    bentuk.push(`${ribuBulat}rb`);
  }
  return bentuk.filter((b) => b.length > 0);
}

/** Diekspor untuk diuji: ini gerbang penghalang, dan gerbang yang tidak bisa
 *  diuji langsung adalah gerbang yang cacatnya baru ketahuan di produksi. */
export function memuatHarga(transkrip: string, priceIdr: number): boolean {
  const t = rapikan(transkrip);
  return bentukHargaDiterima(priceIdr).some((b) => t.includes(b));
}

/**
 * Berapa kali transkripsi dicoba sebelum menyerah.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA ADA — GERBANG YANG MATI DIAM-DIAM
 * ────────────────────────────────────────────────────────────────────────────
 * QC-12 memeriksa apakah yang DIUCAPKAN cocok dengan naskah — satu-satunya cek
 * yang bisa menangkap harga salah sebut dan kalimat yang hilang. Ia memanggil
 * Gemini sekali, dan kalau Gemini menjawab 503 ia langsung menyerah.
 *
 * Diukur di produksi 4 Sep 2026: 3 dari 10 job READY tercatat "transkripsi
 * gagal: HTTP 503". Artinya 30% video keluar tanpa ucapannya pernah diperiksa —
 * dan di layar hasilnya terlihat sebagai "skip", bukan sebagai kegagalan.
 *
 * Gerbang mutu yang mati bersama pihak ketiga bukan gerbang, cuma dekorasi —
 * kalimat itu sudah tertulis di berkas ini sejak lama, tapi jalur transkripsi
 * belum mengikutinya.
 *
 * 503 dan 429 adalah kegagalan SEMENTARA: yang benar adalah menunggu sebentar
 * lalu mencoba lagi, bukan membuang seluruh pemeriksaan.
 */
const MAKS_PERCOBAAN_TRANSKRIP = 3;

/** Jeda antar percobaan, naik: 1 dtk lalu 3 dtk. */
const JEDA_MS = [1_000, 3_000];

/** Status yang PANTAS diulang. Sisanya (400, 401, 403) tidak akan membaik. */
function bolehDiulang(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function transkripsiDenganUlangan(
  buf: Buffer,
): Promise<{ ok: true; json: () => Promise<unknown> } | { ok: false; status: number }> {
  let status = 0;
  for (let percobaan = 1; percobaan <= MAKS_PERCOBAAN_TRANSKRIP; percobaan++) {
    try {
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
      if (res.ok) return { ok: true, json: () => res.json() as Promise<unknown> };
      status = res.status;
      // Kegagalan yang tidak akan membaik TIDAK diulang: mengulang 401 tiga
      // kali hanya menunda kabar buruk dan membakar waktu worker.
      if (!bolehDiulang(status)) return { ok: false, status };
    } catch (err) {
      // Jaringan putus / timeout — sama sementaranya dengan 503.
      status = 0;
      console.warn(`[qc-suara] transkripsi percobaan ${percobaan}: ${(err as Error).message}`);
    }
    if (percobaan < MAKS_PERCOBAAN_TRANSKRIP) {
      console.warn(`[qc-suara] transkripsi gagal (HTTP ${status || "jaringan"}), coba lagi ${percobaan + 1}/${MAKS_PERCOBAAN_TRANSKRIP}`);
      await new Promise((r) => setTimeout(r, JEDA_MS[percobaan - 1] ?? 3_000));
    }
  }
  return { ok: false, status };
}

export async function qcSuara(input: QcSuaraInput): Promise<QcSuaraResult> {
  if (!config.geminiApiKey) return { transkrip: null, lolos: false, masalah: ["QC suara tidak jalan: GEMINI_API_KEY belum di-set"], peringatan: [] };
  if (!fs.existsSync(input.videoPath)) return { transkrip: null, lolos: false, masalah: ["berkas video tidak ada"], peringatan: [] };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qcsuara-"));
  try {
    // Mono 16 kHz: cukup untuk transkripsi dan jauh lebih kecil untuk dikirim.
    const wav = path.join(dir, "audio.wav");
    await runFfmpeg(["-y", "-v", "error", "-i", input.videoPath, "-vn", "-ac", "1", "-ar", "16000", wav]);
    if (!fs.existsSync(wav)) return { transkrip: null, lolos: false, masalah: ["audio tidak bisa diekstrak"], peringatan: [] };

    const buf = fs.readFileSync(wav);
    const res = await transkripsiDenganUlangan(buf);
    if (!res.ok) {
      return {
        transkrip: null, lolos: false,
        masalah: [`transkripsi gagal setelah ${MAKS_PERCOBAAN_TRANSKRIP} percobaan: HTTP ${res.status}`],
        peringatan: [],
      };
    }

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
