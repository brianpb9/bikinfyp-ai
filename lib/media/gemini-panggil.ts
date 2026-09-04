/**
 * SATU pintu memanggil Gemini, berikut percobaan ulangnya.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA DIPUSATKAN
 * ────────────────────────────────────────────────────────────────────────────
 * QC-12 (transkripsi) mati 3 dari 10 job produksi karena Gemini menjawab 503
 * dan pemanggilnya menyerah pada percobaan pertama. Percobaan ulang dipasang di
 * sana 4 Sep 2026.
 *
 * Beberapa jam kemudian pemanggil KEDUA lahir — deteksi kotak produk — dan
 * gagal dengan 503 yang sama pada percobaan pertamanya. Menyalin logika
 * ulangannya ke sana akan menciptakan dua salinan yang harus sepakat, dan
 * salinan kedua pasti tertinggal saat yang pertama diperbaiki.
 *
 * Jadi ulangannya tinggal satu, di sini.
 *
 * 429 dan 5xx SEMENTARA: ditunggu lalu diulang. 400/401/403 tidak akan membaik;
 * mengulangnya hanya menunda kabar buruk dan membakar waktu worker.
 */

import { config } from "../config";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export const MAKS_PERCOBAAN_GEMINI = 3;

/** Jeda antar percobaan, naik: 1 dtk lalu 3 dtk. */
const JEDA_MS = [1_000, 3_000];

export function bolehDiulang(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export interface HasilGemini {
  ok: boolean;
  status: number;
  /** Teks gabungan dari part pertama; kosong bila gagal. */
  teks: string;
  percobaan: number;
}

/**
 * Panggil generateContent dengan percobaan ulang.
 *
 * `label` hanya untuk log — supaya baris kegagalannya menyebut SIAPA yang
 * gagal, bukan sekadar "gemini gagal".
 */
export async function panggilGemini(input: {
  model: string;
  body: unknown;
  label: string;
  timeoutMs?: number;
  /**
   * Berapa kali dicoba. Bawaannya 3.
   *
   * Bisa dikecilkan untuk pemanggilan yang sifatnya PENYEMPURNAAN: menunggu
   * tiga kali 45 detik demi sesuatu yang boleh gagal berarti menambah dua menit
   * ke setiap job saat Gemini sedang penuh — dan Gemini memang sempat menolak
   * seluruh permintaan bergambar dengan "experiencing high demand" pada 4 Sep
   * 2026. Yang wajib (transkripsi QC) tetap tiga.
   */
  maksPercobaan?: number;
}): Promise<HasilGemini> {
  const maks = input.maksPercobaan ?? MAKS_PERCOBAAN_GEMINI;
  if (!config.geminiApiKey) return { ok: false, status: 0, teks: "", percobaan: 0 };
  let status = 0;
  for (let percobaan = 1; percobaan <= maks; percobaan++) {
    try {
      const res = await fetch(`${ENDPOINT}/${input.model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": config.geminiApiKey },
        body: JSON.stringify(input.body),
        signal: AbortSignal.timeout(input.timeoutMs ?? 45_000),
      });
      status = res.status;
      if (res.ok) {
        const d = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const teks = d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        return { ok: true, status, teks, percobaan };
      }
      if (!bolehDiulang(status)) return { ok: false, status, teks: "", percobaan };
    } catch (err) {
      status = 0;
      console.warn(`[gemini:${input.label}] percobaan ${percobaan}: ${(err as Error).message}`);
    }
    if (percobaan < maks) {
      console.warn(`[gemini:${input.label}] gagal (HTTP ${status || "jaringan"}), coba lagi ${percobaan + 1}/${maks}`);
      await new Promise((r) => setTimeout(r, JEDA_MS[percobaan - 1] ?? 3_000));
    }
  }
  return { ok: false, status, teks: "", percobaan: maks };
}
